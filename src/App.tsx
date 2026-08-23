import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Zap, Plug, FileText, BarChart2, TrendingUp, Activity, AlertCircle, DollarSign, ChevronRight, LightbulbIcon, Gauge, Upload, History } from 'lucide-react';
import { ExportModal } from './components/export/ExportModal';

// Types and Utilities
import { type TimeRange, type MetricMode, type PeakSchedule } from './types';
import { formatCost, toDollars, formatShortDate, parseDateTimeLocal } from './utils/formatters';
import { createBrushData, type IntervalBlockMeta } from './utils/dataUtils';
import { mergeDatasets, detectMergeWarnings, detectMergeBlockers, buildMergeName, commonValue, type MergePreview, type MergeSource } from './utils/mergeData';
import { downloadDatasetFile, downloadNativeFile } from './utils/nativeFormat';
import { type EnergyUnit, formatEnergyValue, suggestUnit } from './utils/energyUnits';
import { toDemandKW, formatDemandValue } from './utils/demandUnits';
import { aggregateWeatherData } from './utils/weatherData';
import { ROWS_PER_PAGE, BRUSH_POINTS, RATE_TOLERANCE_PERCENT, BLOCK_DAILY_THRESHOLD } from './constants';

// Hooks
import { useAnalysis } from './hooks/useAnalysis';
import { useWeather } from './hooks/useWeather';
import { useEnergyData } from './hooks/useEnergyData';
import { useChartProcessing } from './hooks/useChartProcessing';
import { useFileHistory, type FileHistoryEntry } from './hooks/useFileHistory';
import { usePersistentState } from './hooks/usePersistentState';
import { sanitizePeakSchedule } from './utils/peakSchedule';
import { DEMO_PEAK_SCHEDULE } from './utils/demoPeakSchedule';

// Components
import { StatCard } from './components/common/StatCard';
import { TabButton } from './components/common/TabButton';
import { PulseLoader, LoadingOverlay, StatusChip } from './components/common/PulseLoader';
import { UploadSection } from './components/dashboard/UploadSection';
import { DateRangeControls } from './components/dashboard/DateRangeControls';
import { MainChart } from './components/charts/MainChart';
import { AnalysisPanel } from './components/dashboard/AnalysisPanel';
import { TableView, type SortField, type SortDirection } from './components/dashboard/TableView';
import { ChartToolbar } from './components/dashboard/ChartToolbar';
import { InsightsModal, type InsightPreset } from './components/common/InsightsModal';
import type { RankingEntry } from './utils/rankings';
import { RateChangesCard } from './components/dashboard/RateChangesCard';
import { PeakSplitCard } from './components/dashboard/PeakSplitCard';
import type { BrushDataPoint } from './components/common/RangeBrush';
import { AnimatedBackground } from './components/common/AnimatedBackground';
import { BlockPickerModal } from './components/common/BlockPickerModal';
import { RecentFilesModal } from './components/common/RecentFilesModal';

export default function App() {
  // UI State
  const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'analysis'>('analysis');
  const [resolution, setResolution] = useState<string>('RAW');
  const [page, setPage] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);
  const [metricMode, setMetricMode] = useState<MetricMode>('cost');
  const [temperatureUnit, setTemperatureUnit] = useState<'C' | 'F'>('F');

  // File history (IndexedDB)
  const { entries: historyEntries, saveEntry, updateEntry, loadEntry, deleteEntry } = useFileHistory();
  const [showRecentFiles, setShowRecentFiles] = useState(false);

  // Peak rate schedule. It belongs to the dataset, not to the browser: Green
  // Button data carries no rate metadata, so a schedule is only ever what the
  // loaded data brought with it (a native file's `peakSchedule`, a history
  // entry's, the demo's) or what the user typed in for the data in front of
  // them. Every load starts from nothing — see onLoadStart — so a schedule can
  // never follow the user onto a file it says nothing about.
  const [rawPeakSchedule, setRawPeakSchedule] = useState<PeakSchedule | null>(null);
  const [showPeakBands, setShowPeakBands] = usePersistentState('peakBandsVisible', true);
  // Re-validated on read: what arrives may have been written by an older build,
  // hand-edited in a shared file, or pasted into the editor's import box.
  const peakSchedule = useMemo(() => sanitizePeakSchedule(rawPeakSchedule), [rawPeakSchedule]);

  // Read by the upload pipeline, which adopts a file's schedule and saves the
  // history entry in the same tick — before React has re-rendered, so state
  // alone would still read null there.
  const peakScheduleRef = useRef<PeakSchedule | null>(null);

  // Which history entry the open dataset came from — the row that schedule edits
  // are written back to. Set when an entry is saved or loaded, cleared whenever a
  // different dataset starts loading. `persistedSchedule` is the schedule that
  // row already holds, serialized, so adopting an entry's own schedule on load
  // does not immediately write it back.
  const historyEntryIdRef = useRef<number | null>(null);
  const persistedScheduleRef = useRef<string | null>(null);

  const trackHistoryEntry = useCallback((id: number | null, schedule?: PeakSchedule | null) => {
    historyEntryIdRef.current = id;
    persistedScheduleRef.current = JSON.stringify(schedule ?? null);
  }, []);

  const applyPeakSchedule = useCallback((next: PeakSchedule | null) => {
    peakScheduleRef.current = sanitizePeakSchedule(next);
    setRawPeakSchedule(next);
    // A schedule that just arrived is worth showing without a second click, and
    // clearing one should not leave a dangling toggle.
    setShowPeakBands((next?.periods.length ?? 0) > 0);
  }, [setShowPeakBands]);

  // Dataset, upload pipeline, and data bounds
  const {
    rawData,
    loading,
    error,
    fileName,
    pendingBlocks,
    dataBounds,
    loadId,
    handleFileUpload,
    handleSelectBlock,
    handleCancelBlockPicker,
    loadSampleData,
    loadFromHistory,
    reset,
  } = useEnergyData({
    setResolution,
    onLoadStart: (source) => {
      setPage(1);
      // Clean slate for the incoming dataset: whatever schedule the last one had
      // is not this one's. Anything the new data carries is applied a moment
      // later, once it has been parsed. The demo is the only dataset that ships
      // with a schedule of its own — a generated meter with generated rates.
      applyPeakSchedule(source === 'sample' ? DEMO_PEAK_SCHEDULE : null);
      // The incoming dataset has no history row yet; loadFromHistory / the save
      // below name one a moment later.
      trackHistoryEntry(null);
    },
    onDataLoaded: useCallback(async (name: string, data: Parameters<typeof saveEntry>[1], res: string, meta?: IntervalBlockMeta) => {
      const schedule = peakScheduleRef.current ?? undefined;
      const id = await saveEntry(name, data, res, {
        flowDirection: meta?.flowDirection,
        commodity: meta?.commodity,
        intervalLength: meta?.intervalLength,
        // Whatever schedule is in force when the file loads, so reopening the
        // entry from Recent Files brings its rate periods back with it.
        peakSchedule: schedule,
      });
      trackHistoryEntry(id, schedule);
    }, [saveEntry, trackHistoryEntry]),
    onPeakScheduleLoaded: applyPeakSchedule,
  });

  // Time State
  const [viewRange, setViewRange] = useState<TimeRange>({ start: null, end: null });

  // Analysis State. Defaults match what a fresh dataset resets to (see the
  // loadId effect below).
  const [groupBy, setGroupBy] = useState<'dayOfWeek' | 'month' | 'hour'>('month');
  const [analysisView, setAnalysisView] = useState<'averages' | 'timeline'>('timeline');
  const [autoZoom, setAutoZoom] = useState(true);

  // Table sort and temperature filter live in App — not in TableView /
  // AnalysisPanel — so they survive a tab switch, which unmounts and remounts
  // those components. (`page` is already lifted here for the same reason.)
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [tempFilter, setTempFilter] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  const [userHasSetTempFilter, setUserHasSetTempFilter] = useState(false);

  const [brushData, setBrushData] = useState<BrushDataPoint[]>([]);
  const [energyUnit, setEnergyUnit] = useState<EnergyUnit>('Wh');

  // Weather hook
  const weather = useWeather(dataBounds.start, dataBounds.end);


  // --- Effects & Data Logic ---

  useEffect(() => {
    if (rawData && rawData.length > 0) {
      const bounds = { start: rawData[0].timestamp, end: rawData[rawData.length - 1].timestamp };
      // viewRange is user-mutable (zoom/brush); reset it to full bounds whenever a
      // new dataset loads. Genuinely an effect, not derived render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewRange(bounds);
      setBrushData(createBrushData(rawData, BRUSH_POINTS));
    }
  }, [rawData]);

  // Return the analysis view to its defaults and clear transient per-tab settings
  // (table sort, temperature filter) whenever a NEW dataset loads. Keyed on
  // loadId — deliberately not run when the tab panels mount — so switching tabs
  // preserves whatever the user had set. This replaces a mount effect that used
  // to live in AnalysisPanel and wiped these on every return to the tab.
  useEffect(() => {
    setGroupBy('month');
    setAnalysisView('timeline');
    setAutoZoom(true);
    setSortField('timestamp');
    setSortDirection('asc');
    setTempFilter({ min: null, max: null });
    setUserHasSetTempFilter(false);
  }, [loadId]);

  // Temperature-filter values are expressed in the active unit, so clear them
  // when the user flips °F/°C to avoid misfiltering on stale numbers. In App, not
  // the panel, so a tab switch (which remounts the panel) doesn't wipe the filter.
  useEffect(() => {
    setTempFilter({ min: null, max: null });
    setUserHasSetTempFilter(false);
  }, [temperatureUnit]);

  const viewData = useMemo(() => {
    if (!rawData || !viewRange.start || !viewRange.end) return rawData || [];
    // When the view spans the whole dataset (the default, un-zoomed state),
    // skip the filter — it would copy every point, doubling resident memory
    // for no benefit. rawData is sorted ascending, so a full span needs no work.
    if (viewRange.start <= rawData[0].timestamp && viewRange.end >= rawData[rawData.length - 1].timestamp) {
      return rawData;
    }
    return rawData.filter(d => d.timestamp >= viewRange.start! && d.timestamp <= viewRange.end!);
  }, [rawData, viewRange]);

  const {
    filters: analysisFilters,
    setFilters: setAnalysisFilters,
    results: analysisResults,
    isProcessing: analysisProcessing,
    isDataSampled,
    sampledCount,
    originalCount
  } = useAnalysis(activeTab, viewData, groupBy, showPeakBands ? peakSchedule : null);

  const { isProcessing, chartData } = useChartProcessing(viewData, resolution);

  const spansMultipleDays = useMemo(() => {
    if (chartData.length < 2) return false;
    return new Date(chartData[0].timestamp * 1000).toDateString() !== new Date(chartData[chartData.length - 1].timestamp * 1000).toDateString();
  }, [chartData]);

  // Single O(n) pass over rawData for both extents. Avoids four separate
  // Math.max(...spread) passes (and the call-stack blowout that spread risks on
  // 100k+ element arrays); yAxisMax/yAxisMaxCost/unit all derive from this.
  const dataExtents = useMemo(() => {
    let maxValue = 0;
    let maxCost = 0;
    let maxDemand = 0;
    if (rawData) {
      for (const d of rawData) {
        if (d.value > maxValue) maxValue = d.value;
        const cost = d.cost ?? 0;
        if (cost > maxCost) maxCost = cost;
        const demand = toDemandKW(d.value, d.duration);
        if (demand > maxDemand) maxDemand = demand;
      }
    }
    return { maxValue, maxCost, maxDemand };
  }, [rawData]);

  useEffect(() => {
    if (rawData && rawData.length > 0) {
      // energyUnit is user-overridable in the toolbar; re-suggest a default only
      // when a new dataset's magnitude changes. Intentional effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEnergyUnit(suggestUnit(dataExtents.maxValue));
    }
  }, [rawData, dataExtents.maxValue]);

  const weatherDataMap = useMemo(() => {
    if (!weather.enabled || !weather.hourlyData.length) return new Map<number, number>();
    const res = resolution === 'RAW' || resolution === 'HOURLY' ? 'hourly' : resolution === 'DAILY' ? 'daily' : 'monthly';
    return aggregateWeatherData(weather.hourlyData, res);
  }, [weather.enabled, weather.hourlyData, resolution]);

  const analysisWeatherMap = useMemo(() => {
    if (!weather.enabled || !weather.hourlyData.length) return new Map<number, number>();
    const res = groupBy === 'hour' ? 'hourly' : groupBy === 'dayOfWeek' ? 'daily' : 'monthly';
    return aggregateWeatherData(weather.hourlyData, res);
  }, [weather.enabled, weather.hourlyData, groupBy]);

  const stats = useMemo(() => {
    if (!viewData.length) return null;

    const totalValue = viewData.reduce((a, c) => a + c.value, 0);
    const totalCost = viewData.reduce((a, c) => a + (c.cost ?? 0), 0);

    const dailyTotals = new Map<string, { value: number; cost: number; date: Date }>();
    // Peak demand is the single highest-kW interval over the view (when it hit).
    let peakDemand = 0;
    let peakDemandTs = viewData[0].timestamp;
    let totalHours = 0;
    for (const d of viewData) {
      const date = new Date(d.timestamp * 1000);
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const existing = dailyTotals.get(dayKey);
      if (existing) { existing.value += d.value; existing.cost += d.cost ?? 0; }
      else { dailyTotals.set(dayKey, { value: d.value, cost: d.cost ?? 0, date: new Date(date.getFullYear(), date.getMonth(), date.getDate()) }); }

      const demand = toDemandKW(d.value, d.duration);
      if (demand > peakDemand) { peakDemand = demand; peakDemandTs = d.timestamp; }
      totalHours += (d.duration ?? 3600) / 3600;
    }

    let peakDay = { value: 0, cost: 0, date: new Date() };
    for (const day of dailyTotals.values()) { if (day.value > peakDay.value) peakDay = day; }

    const totalKwh = totalValue / 1000; // value is in Wh
    const totalDollars = toDollars(totalCost);
    const effectiveRate = totalKwh > 0 ? totalDollars / totalKwh : 0;
    const numDays = dailyTotals.size;
    const avgDailyValue = numDays > 0 ? Math.round(totalValue / numDays) : 0;
    const avgDailyCost = numDays > 0 ? Math.round(totalCost / numDays) : 0;
    // Average demand = total energy (Wh) over total hours, expressed in kW.
    const avgDemand = totalHours > 0 ? (totalValue / totalHours) / 1000 : 0;

    const peakDemandDateObj = new Date(peakDemandTs * 1000);
    const peakDemandDayStart = Math.floor(new Date(peakDemandDateObj.getFullYear(), peakDemandDateObj.getMonth(), peakDemandDateObj.getDate()).getTime() / 1000);

    return {
      total: formatEnergyValue(totalValue, energyUnit), totalCost: formatCost(totalCost),
      average: formatEnergyValue(avgDailyValue, energyUnit), avgCost: formatCost(avgDailyCost),
      peak: formatEnergyValue(peakDay.value, energyUnit), peakCost: formatCost(peakDay.cost),
      peakDate: formatShortDate(peakDay.date), peakDayStart: Math.floor(peakDay.date.getTime() / 1000),
      readings: viewData.length, numDays,
      range: `${formatShortDate(new Date(viewData[0].timestamp * 1000))} – ${formatShortDate(new Date(viewData[viewData.length - 1].timestamp * 1000))}`,
      effectiveRate: `$${effectiveRate.toFixed(3)}/kWh`, unit: energyUnit,
      peakDemand: formatDemandValue(peakDemand), avgDemand: formatDemandValue(avgDemand),
      peakDemandDate: `${formatShortDate(peakDemandDateObj)}, ${peakDemandDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      peakDemandDayStart,
    };
  }, [viewData, energyUnit]);

  const yAxisMax = useMemo(() => {
    const max = dataExtents.maxValue;
    if (!max) return 1000;
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / magnitude) * magnitude;
  }, [dataExtents.maxValue]);

  const yAxisMaxCost = useMemo(() => {
    const max = dataExtents.maxCost;
    if (max === 0) return 100000;
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / magnitude) * magnitude;
  }, [dataExtents.maxCost]);

  const yAxisMaxDemand = useMemo(() => {
    const max = dataExtents.maxDemand;
    if (!max) return 10;
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / magnitude) * magnitude;
  }, [dataExtents.maxDemand]);

  // O(n) rather than Math.max(...spread), for the same reason dataExtents is:
  // the timeline has a row per calendar bucket, and grouping a long dataset by
  // hour makes that array big enough for a spread to overflow the call stack.
  const currentAnalysisMax = useMemo(() => {
    let max = 0;
    if (analysisView === 'averages') {
      for (const d of analysisResults.averages) {
        const v = (metricMode === 'energy' ? d.average : metricMode === 'demand' ? d.demand : d.avgCost) || 0;
        if (v > max) max = v;
      }
    } else {
      for (const d of analysisResults.timeline) {
        const v = (metricMode === 'energy' ? d.value : metricMode === 'demand' ? d.demand : d.cost) || 0;
        if (v > max) max = v;
      }
    }
    return max;
  }, [analysisResults, analysisView, metricMode]);

  const analysisDomain = useMemo((): [number, number] => {
    if (autoZoom) return [0, Math.ceil(currentAnalysisMax * 1.1)];
    return [0, metricMode === 'energy' ? yAxisMax : metricMode === 'demand' ? yAxisMaxDemand : yAxisMaxCost];
  }, [autoZoom, currentAnalysisMax, yAxisMax, yAxisMaxCost, yAxisMaxDemand, metricMode]);

  const isZoomed = dataBounds.start !== null && (viewRange.start !== dataBounds.start || viewRange.end !== dataBounds.end);

  // --- Handlers ---
  const handleViewInput = (field: 'start' | 'end', value: string) => {
    const ts = parseDateTimeLocal(value);
    if (ts && dataBounds.start !== null && dataBounds.end !== null) {
      const clamped = Math.max(dataBounds.start, Math.min(dataBounds.end, ts));
      setViewRange(prev => ({ ...prev, [field]: clamped })); setPage(1);
    }
  };

  const handleZoomOut = () => { setViewRange({ start: dataBounds.start, end: dataBounds.end }); setPage(1); };

  // Shift the view window forward (+1) or backward (-1) by its current duration,
  // clamped so the window stays within the available data bounds.
  const handlePan = (direction: 1 | -1) => {
    if (viewRange.start === null || viewRange.end === null || dataBounds.start === null || dataBounds.end === null) return;
    const duration = viewRange.end - viewRange.start;
    let newStart = viewRange.start + direction * duration;
    let newEnd = viewRange.end + direction * duration;
    if (newEnd > dataBounds.end) { newEnd = dataBounds.end; newStart = newEnd - duration; }
    if (newStart < dataBounds.start) { newStart = dataBounds.start; newEnd = Math.min(dataBounds.end, newStart + duration); }
    setViewRange({ start: newStart, end: newEnd });
    setPage(1);
  };
  const handleChartSelection = (range: { start: number; end: number }) => { setViewRange({ start: range.start, end: range.end }); setPage(1); };

  // Open the analysis timeline grouped by hour, scoped to the peak day's 24h window.
  const handleViewPeakDay = useCallback(() => {
    if (!stats || dataBounds.start === null || dataBounds.end === null) return;
    const dayStart = Math.max(dataBounds.start, stats.peakDayStart);
    const dayEnd = Math.min(dataBounds.end, stats.peakDayStart + 86400 - 1);
    setActiveTab('analysis');
    setGroupBy('hour');
    setAnalysisView('timeline');
    setViewRange({ start: dayStart, end: dayEnd });
    setPage(1);
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [stats, dataBounds, setGroupBy, setAnalysisView]);

  // Open the analysis timeline grouped by hour, scoped to the 24h window of the
  // day when peak demand occurred.
  const handleViewPeakDemand = useCallback(() => {
    if (!stats || dataBounds.start === null || dataBounds.end === null) return;
    const dayStart = Math.max(dataBounds.start, stats.peakDemandDayStart);
    const dayEnd = Math.min(dataBounds.end, stats.peakDemandDayStart + 86400 - 1);
    setActiveTab('analysis');
    setGroupBy('hour');
    setAnalysisView('timeline');
    setViewRange({ start: dayStart, end: dayEnd });
    setPage(1);
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [stats, dataBounds, setGroupBy, setAnalysisView]);

  const handleSelectInsight = useCallback((preset: InsightPreset) => {
    setActiveTab('analysis');
    setAnalysisFilters({
      daysOfWeek: preset.filters.daysOfWeek ?? [],
      months: preset.filters.months ?? [],
      hourRanges: preset.filters.hourRanges ?? [{ start: 0, end: 23 }],
    });
    setGroupBy(preset.groupBy);
    setAnalysisView(preset.analysisView);
    if (preset.metricMode) {
      setMetricMode(preset.metricMode);
    }
  }, [setAnalysisFilters]);

  // Open the analysis timeline scoped to the period of a Top Ranking entry.
  // Hours/days expand to the full 24h day; weeks to 7 days; months to the whole
  // month — grouped so each bar represents the natural sub-period.
  const handleViewRanking = useCallback((entry: RankingEntry) => {
    if (dataBounds.start === null || dataBounds.end === null) return;
    const d = new Date(entry.periodStart * 1000);
    let rangeStart: number;
    let rangeEnd: number;

    if (entry.granularity === 'hour' || entry.granularity === 'day') {
      rangeStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
      rangeEnd = rangeStart + 86400 - 1;
      setGroupBy('hour');
    } else if (entry.granularity === 'week') {
      rangeStart = entry.periodStart;
      rangeEnd = rangeStart + 7 * 86400 - 1;
      setGroupBy('dayOfWeek');
    } else {
      rangeStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000;
      rangeEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).getTime() / 1000;
      setGroupBy('dayOfWeek');
    }

    // Match the chart's primary metric to the ranking the user picked (temp
    // rankings have no metric of their own, so leave the current mode alone).
    if (entry.metric === 'cost' || entry.metric === 'energy' || entry.metric === 'demand') {
      setMetricMode(entry.metric);
    }

    setActiveTab('analysis');
    setAnalysisView('timeline');
    setViewRange({
      start: Math.max(dataBounds.start, rangeStart),
      end: Math.min(dataBounds.end, rangeEnd),
    });
    setPage(1);
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [dataBounds, setGroupBy, setAnalysisView]);

  // Schedule edits made after the load belong to the dataset just as much as one
  // that arrived with it, so they are written back onto its history row — Recent
  // Files then reopens the file with the rate periods the user last had. Skipped
  // when the schedule already matches what that row holds, which is the case
  // right after loading an entry that carried one.
  useEffect(() => {
    const id = historyEntryIdRef.current;
    if (id == null) return;
    const serialized = JSON.stringify(peakSchedule ?? null);
    if (serialized === persistedScheduleRef.current) return;
    persistedScheduleRef.current = serialized;
    void updateEntry(id, { peakSchedule: peakSchedule ?? undefined });
  }, [peakSchedule, updateEntry]);

  // Save the loaded dataset with its peak schedule embedded, straight from the
  // peak editor — the same native .json the export panel and the merge flow
  // write, so re-loading it restores readings and rate periods together. Always
  // the whole dataset, not the zoomed view: this is "save my file", not an
  // export of what is on screen.
  const handleSaveDataFile = useCallback(() => {
    if (!rawData?.length) return;
    downloadDatasetFile(rawData, { fileName, resolution, peakSchedule });
  }, [rawData, fileName, resolution, peakSchedule]);

  const showChartControls = activeTab === 'chart' || activeTab === 'analysis';

  // Bring a stored entry into the app: its readings, the schedule it was saved
  // with, and the history row that later schedule edits are written back to.
  const adoptHistoryEntry = useCallback((entry: FileHistoryEntry) => {
    loadFromHistory(entry.data, entry.fileName, entry.resolution);
    if (entry.peakSchedule) applyPeakSchedule(entry.peakSchedule);
    trackHistoryEntry(entry.id, entry.peakSchedule);
    setShowRecentFiles(false);
  }, [loadFromHistory, applyPeakSchedule, trackHistoryEntry]);

  const handleLoadFromHistory = useCallback(async (id: number) => {
    const entry = await loadEntry(id);
    if (entry) adoptHistoryEntry(entry);
  }, [loadEntry, adoptHistoryEntry]);

  // Convert a stored file to the native .json: a compact, re-loadable copy of
  // the readings carrying whatever peak schedule that entry holds. Loading it is
  // the caller's choice — converting a file you are not switching to is a common
  // enough case that it stays the default.
  const handleDownloadFromHistory = useCallback(async (id: number, opts: { load: boolean }) => {
    const entry = await loadEntry(id);
    if (!entry) return;
    downloadDatasetFile(entry.data, {
      fileName: entry.fileName,
      resolution: entry.resolution,
      peakSchedule: entry.peakSchedule,
    });
    if (opts.load) adoptHistoryEntry(entry);
  }, [loadEntry, adoptHistoryEntry]);

  // Load the selected history entries, merge them, and assemble a preview for
  // the modal to confirm. Returns null if fewer than two entries resolve.
  const handleMergePreview = useCallback(async (ids: number[]): Promise<MergePreview | null> => {
    const loaded = (await Promise.all(ids.map((id) => loadEntry(id))))
      .filter((e): e is NonNullable<typeof e> => e !== null);
    if (loaded.length < 2) return null;

    const sources: MergeSource[] = loaded.map((e) => ({
      fileName: e.fileName,
      data: e.data,
      flowDirection: e.flowDirection,
      commodity: e.commodity,
      intervalLength: e.intervalLength,
      peakSchedule: e.peakSchedule,
    }));
    const result = mergeDatasets(sources);
    const warnings = detectMergeWarnings(sources);
    const blockers = detectMergeBlockers(sources);

    // Keep the shared resolution when all sources agree; otherwise fall back to
    // the same RAW/DAILY threshold the upload pipeline uses.
    const resolutions = new Set(loaded.map((e) => e.resolution));
    const resolution = resolutions.size === 1
      ? loaded[0].resolution
      : (result.data.length > BLOCK_DAILY_THRESHOLD ? 'DAILY' : 'RAW');

    return {
      ...result,
      warnings,
      blockers,
      resolution,
      defaultName: buildMergeName(loaded.map((e) => e.fileName)),
      flowDirection: commonValue(sources.map((s) => s.flowDirection)),
      commodity: commonValue(sources.map((s) => s.commodity)),
    };
  }, [loadEntry]);

  // Confirm a merge: load it into the app, save it back to history (so it lands
  // in Recent Files), and optionally download a re-loadable native .json copy.
  const handleMergeConfirm = useCallback(async (
    preview: MergePreview,
    name: string,
    actions: { load: boolean; download: boolean },
  ) => {
    // Only what the merged sources themselves carried: the dataset that happens
    // to be open at merge time has no say over the new one's rate periods.
    const mergedSchedule = preview.peakSchedule ?? undefined;
    if (actions.load) {
      loadFromHistory(preview.data, name, preview.resolution);
      const id = await saveEntry(name, preview.data, preview.resolution, {
        isMerged: true,
        sources: preview.sources,
        flowDirection: preview.flowDirection,
        commodity: preview.commodity,
        peakSchedule: mergedSchedule,
      });
      if (preview.peakSchedule) applyPeakSchedule(preview.peakSchedule);
      trackHistoryEntry(id, mergedSchedule);
    }
    if (actions.download) {
      downloadNativeFile(preview.data, {
        fileName: name,
        resolution: preview.resolution,
        sources: preview.sources,
        peakSchedule: mergedSchedule,
      });
    }
  }, [loadFromHistory, saveEntry, applyPeakSchedule, trackHistoryEntry]);

  return (
    <AnimatedBackground>
      <div className="min-h-screen text-slate-100 font-sans selection:bg-emerald-500/30">
        <header className="bg-header border-b border-line sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="bg-emerald-500/10 p-2 rounded-xl shrink-0"><Plug className="w-6 h-6 sm:w-[22px] sm:[22px] text-emerald-400" /></div>
              <div className="min-w-0">
                <h1 className="text-lg md:text-xl font-bold tracking-tight">
                  <span className="text-emerald-400">GB</span> Energy Meter
                  <a
                    href="https://github.com/jekrch/energy-meter/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1.5 align-middle text-[10px] font-medium text-slate-500 hover:text-emerald-400 transition-colors"
                  >
                    v4
                  </a>
                </h1>
                {fileName && <p className="text-slate-500 text-xs font-mono truncate max-w-[180px] sm:max-w-[260px] mt-0.5">{fileName}</p>}
              </div>
            </div>
            {rawData && (
              <div className="shrink-0 flex items-center gap-2">
                {historyEntries.length > 0 && (
                  <button
                    onClick={() => setShowRecentFiles(true)}
                    title={`${historyEntries.length} recent file${historyEntries.length !== 1 ? 's' : ''}`}
                    className="flex items-center gap-1.5 text-sm font-semibold bg-surface-3 hover:bg-white/5 text-slate-400 hover:text-slate-200 border border-line-2 hover:border-slate-500 px-3 py-2 rounded-lg transition-colors"
                  >
                    <History className="w-4 h-4" />
                    <span className="text-sm font-medium">{historyEntries.length}</span>
                  </button>
                )}
                {/* Dropping the dataset drops its schedule with it — the next
                    one starts from whatever it carries, not from this one. */}
                <button onClick={() => { reset(); applyPeakSchedule(null); trackHistoryEntry(null); }} className="flex items-center gap-2 text-sm font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 sm:px-4 py-2 rounded-lg transition-colors">
                  <Upload className="w-4 h-4" />
                  <span className="hidden sm:inline">Load</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 pb-8 pt-4">
          {!rawData ? (
            loading ? (
              <div className="flex items-center justify-center min-h-[60vh]">
                <PulseLoader variant="energy" size="lg" message="Parsing Green Button XML..." subMessage="Extracting energy readings" />
              </div>
            ) : (
              <UploadSection
                onUpload={handleFileUpload}
                onLoadSample={loadSampleData}
                onShowHistory={() => setShowRecentFiles(true)}
                historyCount={historyEntries.length}
                loading={loading}
                error={error}
              />
            )
          ) : (
            stats && (
              <div key={loadId} className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <StatCard className="rise-in" style={{ animationDelay: '0ms' }} accent="bg-slate-500" icon={<Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />} label={isZoomed ? "View Total" : "Total"} value={stats.total} unit={stats.unit} subHighlight={stats.avgDemand} sub="kW avg" />
                  <StatCard className="rise-in" style={{ animationDelay: '70ms' }} accent="bg-emerald-400" icon={<DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />} label="Total Cost" value={stats.totalCost} subHighlight={stats.effectiveRate} sub="effective rate" />
                  {metricMode === 'demand' ? (
                    <StatCard className="rise-in" style={{ animationDelay: '140ms' }} accent="bg-slate-500" icon={<Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />} label="Avg Demand" value={stats.avgDemand} unit="kW" subHighlight={stats.avgCost} sub="avg cost" />
                  ) : (
                    <StatCard className="rise-in" style={{ animationDelay: '140ms' }} accent="bg-slate-500" icon={<Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />} label="Avg/Day" value={stats.average} unit={stats.unit} subHighlight={stats.avgCost} sub="avg cost" />
                  )}
                  {metricMode === 'demand' ? (
                    <StatCard className="rise-in" style={{ animationDelay: '210ms' }} accent="bg-red-400" icon={<Gauge className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-400" />} label="Peak Demand" value={stats.peakDemand} unit="kW" subHighlight={stats.peakDemandDate} actionLabel="View" onAction={handleViewPeakDemand} />
                  ) : (
                    <StatCard className="rise-in" style={{ animationDelay: '210ms' }} accent="bg-red-400" icon={<AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-400" />} label="Peak Day" value={stats.peak} unit={stats.unit} subHighlight={stats.peakDate} sub={`• ${stats.peakCost}`} actionLabel="View" onAction={handleViewPeakDay} />
                  )}
                </div>

                <div className="rise-in" style={{ animationDelay: '280ms' }}>
                  <DateRangeControls viewRange={viewRange} dataBounds={dataBounds} brushData={brushData} isZoomed={isZoomed} onViewChange={handleViewInput} onZoomOut={handleZoomOut} onBrushChange={handleChartSelection} onPan={handlePan} />
                </div>

                <InsightsModal
                  onSelectInsight={handleSelectInsight}
                  onViewRanking={handleViewRanking}
                  data={rawData ?? []}
                  weather={weather.hourlyData}
                  hasTemperature={weather.enabled && weather.hourlyData.length > 0}
                  energyUnit={energyUnit}
                  temperatureUnit={temperatureUnit}
                >
                  {(openModal) => (
                    <button
                      onClick={openModal}
                      className="rise-in w-full group bg-linear-to-r from-surface-2 from-60% to-amber-950/40 hover:to-amber-900/50 border border-amber-900/40 hover:border-amber-500/40 rounded-2xl p-3.5 sm:p-5 transition-colors duration-300"
                      style={{ animationDelay: '350ms' }}
                    >
                      <div className="flex items-center gap-2.5 sm:gap-4">
                        <div className="shrink-0 bg-linear-to-br from-amber-500 to-amber-400 w-10 h-10 sm:w-[42px] sm:h-[42px] rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:shadow-amber-500/40 transition-shadow">
                          <LightbulbIcon className="w-5 h-5 text-amber-950" />
                        </div>
                        <div className="text-left flex-1 min-w-0">
                          <h3 className="text-sm sm:text-base font-medium text-slate-300! group-hover:text-white! transition-colors whitespace-nowrap truncate">
                            Answer Questions About Your Usage
                          </h3>
                          <p className="text-xs sm:text-[13px] text-slate-400 group-hover:text-slate-300 transition-colors mt-0.5">
                            Tap to explore guided insights like peak hours, seasonal trends, and cost patterns
                          </p>
                        </div>
                        <ChevronRight className="shrink-0 w-5 h-5 -ml-1 sm:ml-0 text-slate-500 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-[color,transform] duration-150" />
                      </div>
                    </button>
                  )}
                </InsightsModal>

                <div ref={panelRef} className="rise-in bg-surface-2 rounded-2xl border border-line hover:border-white/30 transition-colors duration-150 overflow-hidden flex flex-col min-h-[600px]" style={{ animationDelay: '420ms' }}>
                  <div className="border-b border-header-line px-3 md:px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex bg-sunken p-1 rounded-lg border border-line">
                        <TabButton active={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')} icon={<BarChart2 className="w-4 h-4" />}>Analysis</TabButton>
                        <TabButton active={activeTab === 'chart'} onClick={() => setActiveTab('chart')} icon={<TrendingUp className="w-4 h-4" />}>Chart</TabButton>
                        <TabButton active={activeTab === 'table'} onClick={() => setActiveTab('table')} icon={<FileText className="w-4 h-4" />}>Data</TabButton>
                      </div>

                      <div className="text-[11px] text-slate-500">
                        {activeTab === 'chart' && <StatusChip loading={isProcessing} count={chartData.length} />}
                        {activeTab === 'analysis' && <StatusChip loading={analysisProcessing} count={0} label={groupBy === 'hour' ? '24h' : groupBy === 'dayOfWeek' ? '7d' : '12mo'} />}
                        {activeTab === 'table' && (
                          <div className="flex items-center gap-2">
                            <div className="hidden sm:block">
                              <StatusChip loading={false} count={viewData.length} label={`${viewData.length.toLocaleString()} rows`} />
                            </div>
                            <ExportModal
                              data={viewData}
                              energyUnit={energyUnit}
                              weatherAvailable={weather.enabled && weather.hourlyData.length > 0}
                              hourlyWeatherData={weather.hourlyData}
                              temperatureUnit={temperatureUnit}
                              fileName={fileName ?? undefined}
                              resolution={resolution}
                              peakSchedule={peakSchedule}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {showChartControls && (
                      <ChartToolbar
                        activeTab={activeTab}
                        metricMode={metricMode}
                        setMetricMode={setMetricMode}
                        energyUnit={energyUnit}
                        setEnergyUnit={setEnergyUnit}
                        resolution={resolution}
                        setResolution={setResolution}
                        temperatureUnit={temperatureUnit}
                        setTemperatureUnit={setTemperatureUnit}
                        weather={weather}
                        peakSchedule={peakSchedule}
                        setPeakSchedule={applyPeakSchedule}
                        showPeakBands={showPeakBands}
                        setShowPeakBands={setShowPeakBands}
                        onSaveDataFile={rawData?.length ? handleSaveDataFile : undefined}
                      />
                    )}
                  </div>

                  <div className="flex-1 relative min-h-[300px]">
                    {activeTab === 'chart' && (
                      <>
                        <LoadingOverlay visible={isProcessing} variant="chart" size="md" message="Aggregating data..." subMessage={`Processing ${viewData.length.toLocaleString()} readings`} />
                        <MainChart data={chartData} resolution={resolution} isProcessing={isProcessing} spansMultipleDays={spansMultipleDays} metricMode={metricMode} energyUnit={energyUnit} weatherData={weatherDataMap} showWeather={weather.enabled} temperatureUnit={temperatureUnit} peakSchedule={peakSchedule} showPeakBands={showPeakBands} setResolution={setResolution} />
                      </>
                    )}

                    {activeTab === 'analysis' && (
                      <div className="min-h-[600px]">
                        <AnalysisPanel
                          filters={analysisFilters}
                          setFilters={setAnalysisFilters}
                          groupBy={groupBy}
                          setGroupBy={setGroupBy}
                          analysisView={analysisView}
                          setAnalysisView={setAnalysisView}
                          results={analysisResults}
                          isProcessing={analysisProcessing}
                          isDataSampled={isDataSampled}
                          sampledCount={sampledCount}
                          originalCount={originalCount}
                          analysisDomain={analysisDomain}
                          tempFilter={tempFilter}
                          setTempFilter={setTempFilter}
                          userHasSetTempFilter={userHasSetTempFilter}
                          setUserHasSetTempFilter={setUserHasSetTempFilter}
                          metricMode={metricMode}
                          viewRange={viewRange}
                          energyUnit={energyUnit}
                          weatherData={analysisWeatherMap}
                          showWeather={weather.enabled}
                          temperatureUnit={temperatureUnit}
                          peakSchedule={peakSchedule}
                          showPeakBands={showPeakBands}
                        />
                      </div>
                    )}

                    {activeTab === 'table' && (
                      <TableView data={viewData} page={page} setPage={setPage} rowsPerPage={ROWS_PER_PAGE} isSelectionSubset={isZoomed} energyUnit={energyUnit} sortField={sortField} setSortField={setSortField} sortDirection={sortDirection} setSortDirection={setSortDirection} />
                    )}
                  </div>
                </div>

                {peakSchedule && peakSchedule.periods.length > 0 && (
                  <div className="rise-in" style={{ animationDelay: '420ms' }}>
                    <PeakSplitCard data={viewData} schedule={peakSchedule} energyUnit={energyUnit} />
                  </div>
                )}

                {/* Rate Changes Card */}
                <div className="rise-in" style={{ animationDelay: '490ms' }}>
                  <RateChangesCard data={viewData} tolerancePercent={RATE_TOLERANCE_PERCENT} />
                </div>
              </div>
            )
          )}
        </main>

        {pendingBlocks && (
          <BlockPickerModal
            blocks={pendingBlocks}
            onSelect={handleSelectBlock}
            onCancel={handleCancelBlockPicker}
          />
        )}
        {showRecentFiles && (
          <RecentFilesModal
            entries={historyEntries}
            onLoad={handleLoadFromHistory}
            onUpload={handleFileUpload}
            onDelete={deleteEntry}
            onDownload={handleDownloadFromHistory}
            onClose={() => setShowRecentFiles(false)}
            onMergePreview={handleMergePreview}
            onMergeConfirm={handleMergeConfirm}
          />
        )}
      </div>
    </AnimatedBackground>
  );
}