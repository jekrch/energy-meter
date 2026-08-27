import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Zap, Plug, FileText, BarChart2, TrendingUp, Activity, AlertCircle, DollarSign, ChevronRight, LightbulbIcon, Gauge, Upload, History } from 'lucide-react';
import { ExportModal } from './components/export/ExportModal';

// Types and Utilities
import { type TimeRange, type MetricMode, type PeakSchedule, type DataPoint } from './types';
import { formatCost, toDollars, formatShortDate, parseDateTimeLocal } from './utils/formatters';
import {
  useSlidingHighlight, highlightStyle, SLIDING_HIGHLIGHT_CLASS,
} from './hooks/useSlidingHighlight';
import { createBrushData, type IntervalBlockMeta, type ParsedBlock } from './utils/dataUtils';
import { mergeDatasets, detectMergeWarnings, detectMergeBlockers, buildMergeName, commonValue, type MergePreview, type MergeSource } from './utils/mergeData';
import { downloadDatasetFile, downloadNativeFile } from './utils/nativeFormat';
import { type EnergyUnit, formatEnergyValue, suggestUnit } from './utils/energyUnits';
import { toDemandKW, formatDemandValue } from './utils/demandUnits';
import { aggregateWeatherData } from './utils/weatherData';
import { ROWS_PER_PAGE, BRUSH_POINTS, RATE_TOLERANCE_PERCENT, BLOCK_DAILY_THRESHOLD } from './constants';

// Hooks
import { useAnalysis } from './hooks/useAnalysis';
import { useWeather } from './hooks/useWeather';
import { useEnergyData, type IncomingFile } from './hooks/useEnergyData';
import { useChartProcessing } from './hooks/useChartProcessing';
import { useDatasetLibrary } from './hooks/useDatasetLibrary';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import { setReturnStateProvider } from './data/googleAuth';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { keyKind, type DatasetKey, type DatasetProvenance, type DatasetRecord } from './data/datasetStore';
import { driveStore } from './data/driveStore';
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
import { IncomingFileModal } from './components/common/IncomingFileModal';
import type { MergeActions, MergeDestination, MergeDestinationOption } from './components/common/MergeSheet';
import { GoogleAccountButton } from './components/common/GoogleAccountButton';

// Trailing delay on peak-schedule writes bound for Drive. The rate editor emits
// a change per keystroke and each Drive write re-uploads the whole dataset.
const DRIVE_SCHEDULE_DEBOUNCE_MS = 2000;

export default function App() {
  // UI State
  const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'analysis'>('analysis');
  // Slides one highlight between the view tabs instead of blinking it off one
  // and on the next. The bar only exists once a dataset is loaded; the hook
  // measures when its buttons attach.
  const {
    containerRef: tabStripRef, setItemRef: setTabRef, rect: tabHighlight,
  } = useSlidingHighlight<'chart' | 'table' | 'analysis'>(activeTab);
  const [resolution, setResolution] = useState<string>('RAW');
  const [page, setPage] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);
  const [metricMode, setMetricMode] = useState<MetricMode>('cost');
  const [temperatureUnit, setTemperatureUnit] = useState<'C' | 'F'>('F');

  // Saved datasets — this browser's history, plus the user's Drive once they
  // sign in. Every id below is a store-qualified DatasetKey.
  const auth = useGoogleAuth();
  const online = useOnlineStatus();
  const driveReady = auth.ready && online;
  const extraStores = useMemo(() => (driveReady ? [driveStore] : []), [driveReady]);
  const library = useDatasetLibrary(extraStores);
  const { entries: historyEntries, patchProvenance } = library;
  const [showRecentFiles, setShowRecentFiles] = useState(false);

  const openLibrary = useCallback(() => setShowRecentFiles(true), []);

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

  // Which saved dataset the open one came from — the entry that schedule edits
  // are written back to, in whichever store it lives. Set when a dataset is
  // saved or loaded, cleared whenever a different one starts loading.
  // `persistedSchedule` is the schedule that entry already holds, serialized, so
  // adopting an entry's own schedule on load does not immediately write it back.
  const datasetKeyRef = useRef<DatasetKey | null>(null);
  const persistedScheduleRef = useRef<string | null>(null);
  // The same value as state, because the toolbar's "Append to Drive" action has
  // to appear the moment a dataset is tracked — a ref read during render would
  // not re-render to show it.
  const [datasetKey, setDatasetKey] = useState<DatasetKey | null>(null);

  // Whether a picked file should be held for the add-or-replace prompt. Refs
  // because the upload pipeline is built above the state it depends on, and
  // both are only ever read at the moment a file is chosen. `holdNext` is set
  // by the explicit add actions, which know their target even when nothing is
  // open, and cleared by the ordinary pick — so a cancelled file dialog cannot
  // leave the next upload pointed at a dataset the user has moved on from.
  const canMergeRef = useRef(false);
  const holdNextUploadRef = useRef(false);

  const trackHistoryEntry = useCallback((key: DatasetKey | null, schedule?: PeakSchedule | null) => {
    datasetKeyRef.current = key;
    setDatasetKey(key);
    persistedScheduleRef.current = JSON.stringify(schedule ?? null);
  }, []);

  // Sign-in on a touch device navigates the whole tab out to Google, and the
  // open dataset lives in memory — so the key is handed to auth on the way out
  // and reloaded below on the way back. Registered once; the ref is read at the
  // moment of the redirect, not now.
  useEffect(() => {
    setReturnStateProvider(() => datasetKeyRef.current);
    return () => setReturnStateProvider(null);
  }, []);

  // A schedule edit bound for Drive, waiting out the debounce window.
  const pendingScheduleRef = useRef<{ key: DatasetKey; patch: DatasetProvenance } | null>(null);
  const scheduleTimerRef = useRef<number | null>(null);

  const flushScheduleWrite = useCallback(() => {
    if (scheduleTimerRef.current !== null) {
      window.clearTimeout(scheduleTimerRef.current);
      scheduleTimerRef.current = null;
    }
    const pending = pendingScheduleRef.current;
    if (!pending) return;
    pendingScheduleRef.current = null;
    void patchProvenance(pending.key, pending.patch);
  }, [patchProvenance]);

  // Closing the rate editor or leaving the page must not drop an edit that is
  // still inside the debounce window.
  useEffect(() => {
    window.addEventListener('beforeunload', flushScheduleWrite);
    return () => {
      window.removeEventListener('beforeunload', flushScheduleWrite);
      flushScheduleWrite();
    };
  }, [flushScheduleWrite]);

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
    incoming,
    dismissIncoming,
    adoptIncoming,
    handleFileUpload,
    handleSelectBlock,
    handleCancelBlockPicker,
    loadSampleData,
    loadFromHistory,
    renameLoaded,
    reset,
  } = useEnergyData({
    setResolution,
    // A picked file only raises the add-or-replace question when there is a
    // saved dataset to add it to. With nothing open, or with the demo (which
    // has no history row), it just loads. An "add to this dataset" action names
    // its own target and arms the one-shot flag instead.
    shouldHoldUpload: useCallback(
      () => holdNextUploadRef.current || canMergeRef.current,
      [],
    ),
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
    onDataLoaded: useCallback(async (name: string, data: DataPoint[], res: string, meta?: IntervalBlockMeta) => {
      const schedule = peakScheduleRef.current ?? undefined;
      const provenance: DatasetProvenance = {
        flowDirection: meta?.flowDirection,
        commodity: meta?.commodity,
        intervalLength: meta?.intervalLength,
        // Whatever schedule is in force when the file loads, so reopening the
        // entry brings its rate periods back with it.
        peakSchedule: schedule,
      };
      // Signing in is the answer to "where do my datasets live": Drive, not the
      // browser's five-slot recency cache. An import goes straight there rather
      // than landing locally and waiting to be moved. Local is the fallback —
      // signed out, or a Drive write that failed — so a failed upload still
      // leaves the file somewhere it can be reopened from.
      const saved =
        (driveReady ? await library.save('drive', name, data, res, provenance).catch(() => null) : null)
        ?? await library.save('local', name, data, res, provenance);
      trackHistoryEntry(saved?.key ?? null, schedule);
    }, [library, driveReady, trackHistoryEntry]),
    onPeakScheduleLoaded: applyPeakSchedule,
  });

  // The saved dataset the open one came from, when there is one.
  const openEntry = useMemo(
    () => historyEntries.find((e) => e.key === datasetKey) ?? null,
    [historyEntries, datasetKey],
  );

  // The dataset a held file is being added to. Null means "the one that's
  // open" — set to a key by the per-row action in the library, which can name a
  // dataset that isn't loaded at all.
  const [mergeTargetKey, setMergeTargetKey] = useState<DatasetKey | null>(null);
  const mergeTarget = useMemo(
    () => (mergeTargetKey ? historyEntries.find((e) => e.key === mergeTargetKey) ?? null : openEntry),
    [mergeTargetKey, historyEntries, openEntry],
  );
  // Read only when a file is picked, which is always after a commit. Gated on
  // the entry being listed, not just tracked: without a row to write back to
  // there is nothing to add a file to.
  useEffect(() => {
    canMergeRef.current = rawData !== null && openEntry !== null;
  }, [rawData, openEntry]);

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
    const key = datasetKeyRef.current;
    if (key == null) return;
    const serialized = JSON.stringify(peakSchedule ?? null);
    if (serialized === persistedScheduleRef.current) return;
    persistedScheduleRef.current = serialized;
    const patch: DatasetProvenance = { peakSchedule: peakSchedule ?? undefined };

    // Against IndexedDB the write is local and immediate. Against Drive it is
    // an HTTP request that rewrites the whole file body — the schedule lives
    // inside the native JSON — while the editor emits a change per keystroke,
    // so those writes trail behind by a beat.
    if (keyKind(key) !== 'drive') {
      void patchProvenance(key, patch);
      return;
    }
    pendingScheduleRef.current = { key, patch };
    if (scheduleTimerRef.current !== null) window.clearTimeout(scheduleTimerRef.current);
    scheduleTimerRef.current = window.setTimeout(flushScheduleWrite, DRIVE_SCHEDULE_DEBOUNCE_MS);
  }, [peakSchedule, patchProvenance, flushScheduleWrite]);

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

  // Once there are saved datasets — or an account signed in for them to arrive
  // in — the library is where loading starts, so "Load" opens it rather than
  // dropping straight back to a bare file picker. Picking a different file is
  // one click further in, from the library's own upload action.
  const hasLibrary = historyEntries.length > 0 || auth.ready;

  const openLibraryOrReset = useCallback(() => {
    if (historyEntries.length > 0 || auth.ready) { openLibrary(); return; }
    // Nothing saved and no account: straight back to the upload screen.
    // Dropping the dataset drops its schedule with it — the next one starts
    // from whatever it carries, not from this one.
    reset();
    applyPeakSchedule(null);
    trackHistoryEntry(null);
  }, [historyEntries.length, auth.ready, openLibrary, reset, applyPeakSchedule, trackHistoryEntry]);

  // Bring a stored entry into the app: its readings, the schedule it was saved
  // with, and the history row that later schedule edits are written back to.
  const adoptHistoryEntry = useCallback(({ meta, data }: DatasetRecord) => {
    loadFromHistory(data, meta.fileName, meta.resolution);
    if (meta.peakSchedule) applyPeakSchedule(meta.peakSchedule);
    trackHistoryEntry(meta.key, meta.peakSchedule);
    setShowRecentFiles(false);
  }, [loadFromHistory, applyPeakSchedule, trackHistoryEntry]);

  const handleLoadFromHistory = useCallback(async (key: DatasetKey) => {
    const entry = await library.load(key);
    if (entry) adoptHistoryEntry(entry);
  }, [library, adoptHistoryEntry]);

  // Back from a redirect sign-in: put the dataset that was open before the
  // navigation back on screen. Guarded because `handleLoadFromHistory` is not a
  // stable identity, and re-running this would yank the user off whatever they
  // had moved on to.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!auth.returnState || restoredRef.current) return;
    restoredRef.current = true;
    // A Drive-backed key needs the Drive store in the library, which arrives
    // with `driveReady` a beat after the session is written.
    if (auth.returnState.startsWith('drive:') && !driveReady) {
      restoredRef.current = false;
      return;
    }
    void handleLoadFromHistory(auth.returnState);
  }, [auth.returnState, driveReady, handleLoadFromHistory]);

  // Signing in is nearly always "get at my saved datasets", so a completed
  // sign-in — from the header, the empty state, anywhere — opens the library on
  // the account's files rather than leaving the user to click through to them.
  // Not on the return leg of a redirect that is restoring a dataset: the effect
  // above puts that back on screen and closes the modal again a beat later.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    // Cleared on sign-out, so signing back in during the same session opens it
    // again rather than being taken for the sign-in already handled.
    if (!auth.justSignedIn) { autoOpenedRef.current = false; return; }
    if (auth.returnState || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    openLibrary();
  }, [auth.justSignedIn, auth.returnState, openLibrary]);

  // Convert a stored file to the native .json: a compact, re-loadable copy of
  // the readings carrying whatever peak schedule that entry holds. Loading it is
  // the caller's choice — converting a file you are not switching to is a common
  // enough case that it stays the default.
  const handleDownloadFromHistory = useCallback(async (key: DatasetKey, opts: { load: boolean }) => {
    const entry = await library.load(key);
    if (!entry) return;
    downloadDatasetFile(entry.data, {
      fileName: entry.meta.fileName,
      resolution: entry.meta.resolution,
      peakSchedule: entry.meta.peakSchedule,
    });
    if (opts.load) adoptHistoryEntry(entry);
  }, [library, adoptHistoryEntry]);

  // Combine sources into the preview every merge confirm step renders from.
  // Sources are listed oldest-intent-first: on an overlapping interval the last
  // one wins, so a re-issued file supersedes the copy already held.
  const composePreview = useCallback(
    (sources: MergeSource[], resolutions: string[]): MergePreview => {
      const result = mergeDatasets(sources);
      // Keep the shared resolution when all sources agree; otherwise fall back
      // to the same RAW/DAILY threshold the upload pipeline uses.
      const distinct = new Set(resolutions);
      const resolution = distinct.size === 1
        ? resolutions[0]
        : (result.data.length > BLOCK_DAILY_THRESHOLD ? 'DAILY' : 'RAW');
      return {
        ...result,
        warnings: detectMergeWarnings(sources),
        blockers: detectMergeBlockers(sources),
        resolution,
        defaultName: buildMergeName(sources.map((s) => s.fileName)),
        flowDirection: commonValue(sources.map((s) => s.flowDirection)),
        commodity: commonValue(sources.map((s) => s.commodity)),
      };
    },
    [],
  );

  // Load the selected history entries, merge them, and assemble a preview for
  // the modal to confirm. Returns null if fewer than two entries resolve.
  const handleMergePreview = useCallback(async (keys: DatasetKey[]): Promise<MergePreview | null> => {
    const loaded = (await Promise.all(keys.map((key) => library.load(key))))
      .filter((e): e is DatasetRecord => e !== null);
    if (loaded.length < 2) return null;

    const sources: MergeSource[] = loaded.map(({ meta, data }) => ({
      fileName: meta.fileName,
      data,
      flowDirection: meta.flowDirection,
      commodity: meta.commodity,
      intervalLength: meta.intervalLength,
      peakSchedule: meta.peakSchedule,
    }));
    return composePreview(sources, loaded.map((e) => e.meta.resolution));
  }, [library, composePreview]);

  // Confirm a merge: load it into the app, persist it where the sheet said to,
  // and optionally download a re-loadable native .json copy. The destination is
  // one place, not several — a merged dataset saved to Drive lives in Drive, so
  // it does not also burn one of the five local recency slots.
  const handleMergeConfirm = useCallback(async (
    preview: MergePreview,
    name: string,
    actions: MergeActions,
  ) => {
    // Only what the merged sources themselves carried: the dataset that happens
    // to be open at merge time has no say over the new one's rate periods.
    const mergedSchedule = preview.peakSchedule ?? undefined;
    const provenance: DatasetProvenance = {
      isMerged: true,
      sources: preview.sources,
      flowDirection: preview.flowDirection,
      commodity: preview.commodity,
      peakSchedule: mergedSchedule,
    };

    // Persist first: a conflict on the in-place write must abort before the
    // merged dataset replaces what the user is looking at.
    let saved = null;
    const destination = actions.destination;
    if (destination.mode === 'update') {
      const target = historyEntries.find((e) => e.key === destination.key);
      saved = await library.replace(
        destination.key,
        preview.data,
        preview.resolution,
        provenance,
        destination.force ? undefined : { syncVersion: target?.syncVersion },
      );
    } else {
      saved = await library.save(
        destination.mode === 'new' ? 'drive' : 'local',
        name, preview.data, preview.resolution, provenance,
      );
    }

    if (actions.load) {
      loadFromHistory(preview.data, saved?.fileName ?? name, preview.resolution);
      // Whatever the sources carried, including nothing: a merge that defines no
      // rate periods must not leave the previous dataset's showing over it.
      applyPeakSchedule(mergedSchedule ?? null);
      trackHistoryEntry(saved?.key ?? null, mergedSchedule);
    }
    if (actions.download) {
      downloadNativeFile(preview.data, {
        fileName: name,
        resolution: preview.resolution,
        sources: preview.sources,
        peakSchedule: mergedSchedule,
      });
    }
  }, [loadFromHistory, library, historyEntries, applyPeakSchedule, trackHistoryEntry]);

  // ── Folding a picked file into a saved dataset ─────────────────────────────
  // Adding next month's file to a history you already keep is the routine job,
  // so it is reachable straight from the dataset it applies to: a row action in
  // the library, a toolbar action for the open dataset, and the prompt raised
  // by picking a file while one is open. All three land here. The combined
  // readings are written back over that dataset in place — in this browser or
  // in Drive, wherever it already lives — and then loaded from what was saved,
  // so the new file never becomes a separate entry to merge afterwards.

  // Which series of a multi-block incoming file to use. Tied to the file it was
  // chosen for, so the choice cannot outlive it.
  const [blockChoice, setBlockChoice] = useState<{ file: IncomingFile; index: number } | null>(null);

  const incomingBlock = useMemo<ParsedBlock | null>(() => {
    if (incoming?.status !== 'ready') return null;
    if (incoming.blocks.length === 1) return incoming.blocks[0];
    return blockChoice?.file === incoming ? incoming.blocks[blockChoice.index] : null;
  }, [incoming, blockChoice]);

  // 'merge' skips the add-or-replace question: the action that picked the file
  // has already answered it.
  const [incomingIntent, setIncomingIntent] = useState<'ask' | 'merge'>('ask');

  // The library's per-row action: this file, into that dataset, whether or not
  // it is the one on screen.
  const handleAddFileToDataset = useCallback((key: DatasetKey, e: React.ChangeEvent<HTMLInputElement>) => {
    setMergeTargetKey(key);
    setIncomingIntent('merge');
    holdNextUploadRef.current = true;
    handleFileUpload(e);
  }, [handleFileUpload]);

  // An ordinary file pick, which only raises the question when something is open.
  const handleUploadWithPrompt = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setMergeTargetKey(null);
    setIncomingIntent('ask');
    holdNextUploadRef.current = false;
    handleFileUpload(e);
  }, [handleFileUpload]);

  // The target dataset plus the held file, in that order — the newly picked
  // file is listed last so it wins any overlapping interval. Async because a
  // target that isn't the open dataset has to be read back from its store.
  const buildIncomingPreview = useCallback(async (): Promise<MergePreview | null> => {
    if (!incomingBlock || !mergeTarget || incoming?.status !== 'ready') return null;

    // The open dataset is already in memory; anything else costs a read, which
    // for a Drive target is a download.
    const isOpen = mergeTarget.key === datasetKey && (rawData?.length ?? 0) > 0;
    let targetData = isOpen ? rawData! : null;
    let targetSchedule = isOpen ? peakSchedule ?? undefined : mergeTarget.peakSchedule;
    if (!targetData) {
      const record = await library.load(mergeTarget.key);
      if (!record?.data.length) return null;
      targetData = record.data;
      targetSchedule = record.meta.peakSchedule;
    }

    const sources: MergeSource[] = [
      {
        fileName: mergeTarget.fileName,
        data: targetData,
        flowDirection: mergeTarget.flowDirection,
        commodity: mergeTarget.commodity,
        intervalLength: mergeTarget.intervalLength,
        peakSchedule: targetSchedule,
      },
      {
        fileName: incoming.fileName,
        data: incomingBlock.data,
        flowDirection: incomingBlock.meta.flowDirection,
        commodity: incomingBlock.meta.commodity,
        intervalLength: incomingBlock.meta.intervalLength,
        peakSchedule: incoming.peakSchedule,
      },
    ];
    const incomingResolution = incomingBlock.data.length > BLOCK_DAILY_THRESHOLD ? 'DAILY' : 'RAW';
    const preview = composePreview(sources, [mergeTarget.resolution, incomingResolution]);
    // Adding to a dataset keeps that dataset's name — the default destination
    // writes back over it, and the name only surfaces if the user picks a copy.
    return { ...preview, defaultName: mergeTarget.fileName };
  }, [incomingBlock, mergeTarget, incoming, datasetKey, rawData, peakSchedule, library, composePreview]);

  const incomingDestinations = useMemo<MergeDestinationOption[]>(() => {
    if (!mergeTarget) return [];
    const options: MergeDestinationOption[] = [{
      id: mergeTarget.key,
      label: mergeTarget.kind === 'drive'
        ? `Add to \u201C${mergeTarget.fileName}\u201D in Drive`
        : `Add to \u201C${mergeTarget.fileName}\u201D in this browser`,
      hint: mergeTarget.kind === 'drive'
        ? 'Writes the combined readings back over that file. Drive keeps the previous version in its own revision history.'
        : 'Writes the combined readings back over that entry, rather than using up another recent-files slot.',
      value: { mode: 'update', key: mergeTarget.key },
    }];
    if (driveReady) options.push({ id: 'new', label: 'Save as a new file in Drive', value: { mode: 'new' } });
    options.push({
      id: 'none',
      label: 'Save as a new entry in this browser',
      hint: `Leaves \u201C${mergeTarget.fileName}\u201D untouched.`,
      value: { mode: 'none' },
    });
    return options;
  }, [mergeTarget, driveReady]);

  const incomingDestination = useMemo<MergeDestination>(
    () => (mergeTarget ? { mode: 'update', key: mergeTarget.key } : { mode: 'none' }),
    [mergeTarget],
  );

  const closeIncoming = useCallback(() => {
    dismissIncoming();
    setBlockChoice(null);
    setIncomingIntent('ask');
    setMergeTargetKey(null);
  }, [dismissIncoming]);

  // "Open it on its own": drop the merge question and load the file the way an
  // upload always did.
  const replaceWithIncoming = useCallback(() => {
    adoptIncoming(incomingBlock ?? undefined);
    setBlockChoice(null);
    setIncomingIntent('ask');
    setMergeTargetKey(null);
  }, [adoptIncoming, incomingBlock]);

  // Retitle a saved dataset. The name is the only thing that changes, so the
  // dataset on screen keeps its readings and its rate periods — only the header
  // and the library row start calling it something else.
  const handleRenameDataset = useCallback(async (key: DatasetKey, name: string) => {
    const meta = await library.rename(key, name);
    if (datasetKeyRef.current === key) renameLoaded(meta.fileName);
  }, [library, renameLoaded]);

  // Move a dataset from this browser into the Drive folder. A move, not a copy:
  // once a dataset is in Drive that is where it lives, and leaving the browser
  // entry behind would list the same readings twice with no way to tell which
  // one later edits went to. Written first and dropped second, so a failed
  // upload leaves the browser copy exactly where it was.
  const handleMoveToDrive = useCallback(async (key: DatasetKey) => {
    const entry = await library.load(key);
    if (!entry) throw new Error('That dataset is no longer in this browser');
    const { meta, data } = entry;
    const saved = await library.save('drive', meta.fileName, data, meta.resolution, {
      flowDirection: meta.flowDirection,
      commodity: meta.commodity,
      intervalLength: meta.intervalLength,
      isMerged: meta.isMerged,
      sources: meta.sources,
      peakSchedule: meta.peakSchedule,
    });
    if (!saved) throw new Error('That dataset could not be saved to Drive');
    await library.remove(key);
    // Schedule edits and merge-backs follow the dataset to its new home.
    if (datasetKeyRef.current === key) trackHistoryEntry(saved.key, meta.peakSchedule);
  }, [library, trackHistoryEntry]);

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
                    v5
                  </a>
                </h1>
                {fileName && <p className="text-slate-500 text-xs font-mono truncate max-w-[180px] sm:max-w-[260px] mt-0.5">{fileName}</p>}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <GoogleAccountButton auth={auth} />
              {rawData && (
                <button
                  onClick={openLibraryOrReset}
                  title={hasLibrary
                    ? `Your datasets${historyEntries.length ? ` (${historyEntries.length})` : ''}`
                    : 'Load another file'}
                  className="flex items-center gap-2 text-sm font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 sm:px-4 h-[38px] rounded-lg transition-colors"
                >
                  {hasLibrary ? <History className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                  <span className="hidden sm:inline">Load</span>
                  {hasLibrary && historyEntries.length > 0 && (
                    <span className="text-xs font-medium text-emerald-400/70">{historyEntries.length}</span>
                  )}
                </button>
              )}
            </div>
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
                onUpload={handleUploadWithPrompt}
                onLoadSample={loadSampleData}
                onShowHistory={() => openLibrary()}
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
                      <div ref={tabStripRef} className="relative flex bg-sunken p-1 rounded-lg border border-line">
                        {tabHighlight && (
                          <div
                            aria-hidden
                            className={`${SLIDING_HIGHLIGHT_CLASS} rounded-md bg-emerald-500/12`}
                            style={highlightStyle(tabHighlight)}
                          />
                        )}
                        <TabButton ref={setTabRef('analysis')} active={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')} icon={<BarChart2 className="w-4 h-4" />}>Analysis</TabButton>
                        <TabButton ref={setTabRef('chart')} active={activeTab === 'chart'} onClick={() => setActiveTab('chart')} icon={<TrendingUp className="w-4 h-4" />}>Chart</TabButton>
                        <TabButton ref={setTabRef('table')} active={activeTab === 'table'} onClick={() => setActiveTab('table')} icon={<FileText className="w-4 h-4" />}>Data</TabButton>
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
        {/* A held file with several series needs one picked before anything can
            be asked about it — the same picker an ordinary upload uses. */}
        {incoming?.status === 'ready' && incoming.blocks.length > 1 && !incomingBlock && (
          <BlockPickerModal
            blocks={incoming.blocks}
            onSelect={(index) => setBlockChoice({ file: incoming, index })}
            onCancel={closeIncoming}
          />
        )}
        {incoming && !(incoming.status === 'ready' && incoming.blocks.length > 1 && !incomingBlock) && (
          <IncomingFileModal
            incoming={incoming}
            targetName={mergeTarget?.fileName ?? null}
            targetKind={mergeTarget?.kind ?? 'local'}
            targetIsOpen={mergeTarget != null && mergeTarget.key === datasetKey}
            intent={incomingIntent}
            buildPreview={buildIncomingPreview}
            destinations={incomingDestinations}
            initialDestination={incomingDestination}
            onMergeConfirm={handleMergeConfirm}
            onReplace={replaceWithIncoming}
            onDismiss={closeIncoming}
          />
        )}
        {showRecentFiles && (
          <RecentFilesModal
            entries={historyEntries}
            onLoad={handleLoadFromHistory}
            onUpload={handleUploadWithPrompt}
            onDelete={library.remove}
            onDownload={handleDownloadFromHistory}
            onClose={() => setShowRecentFiles(false)}
            onMergePreview={handleMergePreview}
            onMergeConfirm={handleMergeConfirm}
            onAddFile={handleAddFileToDataset}
            onRename={handleRenameDataset}
            driveAvailable={auth.ready}
            onMoveToDrive={handleMoveToDrive}
            offline={!online}
          />
        )}
      </div>
    </AnimatedBackground>
  );
}