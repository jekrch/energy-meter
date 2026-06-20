import { useState, useMemo, useEffect, useCallback } from 'react';
import { Zap, Plug, FileText, BarChart2, TrendingUp, Activity, AlertCircle, DollarSign, ChevronRight, LightbulbIcon, Gauge, Upload, History } from 'lucide-react';
import { ExportModal } from './components/export/ExportModal';

// Types and Utilities
import { type TimeRange, type MetricMode } from './types';
import { formatCost, toDollars, formatShortDate, parseDateTimeLocal } from './utils/formatters';
import { createBrushData, type IntervalBlockMeta } from './utils/dataUtils';
import { mergeDatasets, detectMergeWarnings, detectMergeBlockers, buildMergeName, commonValue, type MergePreview, type MergeSource } from './utils/mergeData';
import { downloadNativeFile } from './utils/nativeFormat';
import { type EnergyUnit, formatEnergyValue, suggestUnit } from './utils/energyUnits';
import { toDemandKW, formatDemandValue } from './utils/demandUnits';
import { aggregateWeatherData } from './utils/weatherData';
import { ROWS_PER_PAGE, BRUSH_POINTS, RATE_TOLERANCE_PERCENT, BLOCK_DAILY_THRESHOLD } from './constants';

// Hooks
import { useAnalysis } from './hooks/useAnalysis';
import { useWeather } from './hooks/useWeather';
import { useEnergyData } from './hooks/useEnergyData';
import { useChartProcessing } from './hooks/useChartProcessing';
import { useFileHistory } from './hooks/useFileHistory';

// Components
import { StatCard } from './components/common/StatCard';
import { TabButton } from './components/common/TabButton';
import { PulseLoader, LoadingOverlay, StatusChip } from './components/common/PulseLoader';
import { UploadSection } from './components/dashboard/UploadSection';
import { DateRangeControls } from './components/dashboard/DateRangeControls';
import { MainChart } from './components/charts/MainChart';
import { AnalysisPanel } from './components/dashboard/AnalysisPanel';
import { TableView } from './components/dashboard/TableView';
import { ChartToolbar } from './components/dashboard/ChartToolbar';
import { InsightsModal, type InsightPreset } from './components/common/InsightsModal';
import { RateChangesCard } from './components/dashboard/RateChangesCard';
import type { BrushDataPoint } from './components/common/RangeBrush';
import { AnimatedBackground } from './components/common/AnimatedBackground';
import { BlockPickerModal } from './components/common/BlockPickerModal';
import { RecentFilesModal } from './components/common/RecentFilesModal';

export default function App() {
  // UI State
  const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'analysis'>('analysis');
  const [resolution, setResolution] = useState<string>('RAW');
  const [page, setPage] = useState(1);
  const [metricMode, setMetricMode] = useState<MetricMode>('cost');
  const [temperatureUnit, setTemperatureUnit] = useState<'C' | 'F'>('F');

  // File history (IndexedDB)
  const { entries: historyEntries, saveEntry, loadEntry, deleteEntry } = useFileHistory();
  const [showRecentFiles, setShowRecentFiles] = useState(false);

  // Dataset, upload pipeline, and data bounds
  const {
    rawData,
    loading,
    error,
    fileName,
    pendingBlocks,
    dataBounds,
    handleFileUpload,
    handleSelectBlock,
    handleCancelBlockPicker,
    loadSampleData,
    loadFromHistory,
    reset,
  } = useEnergyData({
    setResolution,
    onLoadStart: () => setPage(1),
    onDataLoaded: useCallback((name: string, data: Parameters<typeof saveEntry>[1], res: string, meta?: IntervalBlockMeta) => {
      saveEntry(name, data, res, meta && {
        flowDirection: meta.flowDirection,
        commodity: meta.commodity,
        intervalLength: meta.intervalLength,
      });
    }, [saveEntry]),
  });

  // Time State
  const [viewRange, setViewRange] = useState<TimeRange>({ start: null, end: null });

  // Analysis State
  const [groupBy, setGroupBy] = useState<'dayOfWeek' | 'month' | 'hour'>('hour');
  const [analysisView, setAnalysisView] = useState<'averages' | 'timeline'>('averages');
  const [autoZoom, setAutoZoom] = useState(false);

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
  } = useAnalysis(activeTab, viewData, groupBy);

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

    return {
      total: formatEnergyValue(totalValue, energyUnit), totalCost: formatCost(totalCost),
      average: formatEnergyValue(avgDailyValue, energyUnit), avgCost: formatCost(avgDailyCost),
      peak: formatEnergyValue(peakDay.value, energyUnit), peakCost: formatCost(peakDay.cost),
      peakDate: formatShortDate(peakDay.date), readings: viewData.length, numDays,
      range: `${formatShortDate(new Date(viewData[0].timestamp * 1000))} – ${formatShortDate(new Date(viewData[viewData.length - 1].timestamp * 1000))}`,
      effectiveRate: `$${effectiveRate.toFixed(3)}/kWh`, unit: energyUnit,
      peakDemand: formatDemandValue(peakDemand), avgDemand: formatDemandValue(avgDemand),
      peakDemandDate: `${formatShortDate(peakDemandDateObj)}, ${peakDemandDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
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

  const currentAnalysisMax = useMemo(() => {
    if (analysisView === 'averages') {
      const data = analysisResults.averages;
      if (!data.length) return 0;
      return Math.max(...data.map(d => (metricMode === 'energy' ? d.average : metricMode === 'demand' ? d.demand : d.avgCost) || 0));
    }
    const data = analysisResults.timeline;
    if (!data.length) return 0;
    return Math.max(...data.map(d => (metricMode === 'energy' ? d.value : metricMode === 'demand' ? d.demand : d.cost) || 0));
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
  const handleChartSelection = (range: { start: number; end: number }) => { setViewRange({ start: range.start, end: range.end }); setPage(1); };

  const handleSelectInsight = useCallback((preset: InsightPreset) => {
    setActiveTab('analysis');
    setAnalysisFilters({
      daysOfWeek: preset.filters.daysOfWeek ?? [],
      months: preset.filters.months ?? [],
      hourStart: preset.filters.hourStart ?? 0,
      hourEnd: preset.filters.hourEnd ?? 23,
    });
    setGroupBy(preset.groupBy);
    setAnalysisView(preset.analysisView);
    if (preset.metricMode) {
      setMetricMode(preset.metricMode);
    }
  }, [setAnalysisFilters]);

  const showChartControls = activeTab === 'chart' || activeTab === 'analysis';

  const handleLoadFromHistory = useCallback(async (id: number) => {
    const entry = await loadEntry(id);
    if (entry) {
      loadFromHistory(entry.data, entry.fileName, entry.resolution);
      setShowRecentFiles(false);
    }
  }, [loadEntry, loadFromHistory]);

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
    if (actions.load) {
      loadFromHistory(preview.data, name, preview.resolution);
      saveEntry(name, preview.data, preview.resolution, {
        isMerged: true,
        sources: preview.sources,
        flowDirection: preview.flowDirection,
        commodity: preview.commodity,
      });
    }
    if (actions.download) {
      downloadNativeFile(preview.data, {
        fileName: name,
        resolution: preview.resolution,
        sources: preview.sources,
      });
    }
  }, [loadFromHistory, saveEntry]);

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
                    v3
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
                    <span className="text-xs font-medium">{historyEntries.length}</span>
                  </button>
                )}
                <button onClick={reset} className="flex items-center gap-2 text-sm font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 sm:px-4 py-2 rounded-lg transition-colors">
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
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <StatCard accent="bg-slate-500" icon={<Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />} label={isZoomed ? "View Total" : "Total"} value={stats.total} unit={stats.unit} subHighlight={stats.avgDemand} sub="kW avg" />
                  <StatCard accent="bg-emerald-400" icon={<DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />} label="Total Cost" value={stats.totalCost} subHighlight={stats.effectiveRate} sub="effective rate" />
                  {metricMode === 'demand' ? (
                    <StatCard accent="bg-slate-500" icon={<Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />} label="Avg Demand" value={stats.avgDemand} unit="kW" subHighlight={stats.avgCost} sub="avg cost" />
                  ) : (
                    <StatCard accent="bg-slate-500" icon={<Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />} label="Avg/Day" value={stats.average} unit={stats.unit} subHighlight={stats.avgCost} sub="avg cost" />
                  )}
                  {metricMode === 'demand' ? (
                    <StatCard accent="bg-red-400" icon={<Gauge className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-400" />} label="Peak Demand" value={stats.peakDemand} unit="kW" subHighlight={stats.peakDemandDate} />
                  ) : (
                    <StatCard accent="bg-red-400" icon={<AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-400" />} label="Peak Day" value={stats.peak} unit={stats.unit} subHighlight={stats.peakDate} sub={`• ${stats.peakCost}`} />
                  )}
                </div>

                <DateRangeControls viewRange={viewRange} dataBounds={dataBounds} brushData={brushData} isZoomed={isZoomed} onViewChange={handleViewInput} onZoomOut={handleZoomOut} onBrushChange={handleChartSelection} />

                <InsightsModal onSelectInsight={handleSelectInsight}>
                  {(openModal) => (
                    <button
                      onClick={openModal}
                      className="w-full group bg-linear-to-r from-surface-2 from-60% to-amber-950/40 hover:to-amber-900/50 border border-amber-900/40 hover:border-amber-500/40 rounded-2xl p-3.5 sm:p-5 transition-colors duration-300"
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

                <div className="bg-surface-2 rounded-2xl border border-line hover:border-white/30 transition-colors duration-150 overflow-hidden flex flex-col min-h-[600px]">
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
                      />
                    )}
                  </div>

                  <div className="flex-1 relative min-h-[300px]">
                    {activeTab === 'chart' && (
                      <>
                        <LoadingOverlay visible={isProcessing} variant="chart" size="md" message="Aggregating data..." subMessage={`Processing ${viewData.length.toLocaleString()} readings`} />
                        <MainChart data={chartData} resolution={resolution} isProcessing={isProcessing} spansMultipleDays={spansMultipleDays} metricMode={metricMode} energyUnit={energyUnit} weatherData={weatherDataMap} showWeather={weather.enabled} temperatureUnit={temperatureUnit} />
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
                          autoZoom={autoZoom}
                          setAutoZoom={setAutoZoom}
                          analysisDomain={analysisDomain}
                          metricMode={metricMode}
                          viewRange={viewRange}
                          energyUnit={energyUnit}
                          weatherData={analysisWeatherMap}
                          showWeather={weather.enabled}
                          temperatureUnit={temperatureUnit}
                        />
                      </div>
                    )}

                    {activeTab === 'table' && (
                      <TableView data={viewData} page={page} setPage={setPage} rowsPerPage={ROWS_PER_PAGE} isSelectionSubset={isZoomed} energyUnit={energyUnit} />
                    )}
                  </div>
                </div>

                {/* Rate Changes Card */}
                <RateChangesCard data={viewData} tolerancePercent={RATE_TOLERANCE_PERCENT} />
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
            onClose={() => setShowRecentFiles(false)}
            onMergePreview={handleMergePreview}
            onMergeConfirm={handleMergeConfirm}
          />
        )}
      </div>
    </AnimatedBackground>
  );
}