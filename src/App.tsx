import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Zap, Plug, FileText, BarChart2, TrendingUp, Activity, AlertCircle, DollarSign } from 'lucide-react';

// Types and Utilities
import { type DataPoint, type TimeRange, type MetricMode, RESOLUTIONS } from './types';
import { formatCost, toDollars } from './utils/formatters';
import { formatShortDate, parseDateTimeLocal } from './utils/formatters';
import { processDataAsync, parseGreenButtonXML, generateSampleData, downsampleLTTB, createBrushData } from './utils/dataUtils';

// Hooks
import { useAnalysis } from './hooks/useAnalysis';

// Components
import { StatCard } from './components/common/StatCard';
import { TabButton } from './components/common/TabButton';
import { PulseLoader, LoadingOverlay, StatusChip } from './components/common/PulseLoader';
import { UploadSection } from './components/dashboard/UploadSection';
import { DateRangeControls } from './components/dashboard/DateRangeControls';
import { MainChart } from './components/charts/MainChart';
import { AnalysisPanel } from './components/dashboard/AnalysisPanel';
import { TableView } from './components/dashboard/TableView';
import type { BrushDataPoint } from './components/common/RangeBrush';
import { AnimatedBackground } from './components/common/AnimatedBackground';

const ROWS_PER_PAGE = 50;
const MAX_CHART_POINTS = 800;

export default function App() {
  const [rawData, setRawData] = useState<DataPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // UI State
  const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'analysis'>('analysis');
  const [resolution, setResolution] = useState<string>('RAW');
  const [page, setPage] = useState(1);
  const [metricMode, setMetricMode] = useState<MetricMode>('energy');

  // Time State
  const [dataBounds, setDataBounds] = useState<TimeRange>({ start: null, end: null });
  const [viewRange, setViewRange] = useState<TimeRange>({ start: null, end: null });

  // Analysis State
  const [groupBy, setGroupBy] = useState<'dayOfWeek' | 'month' | 'hour'>('hour');
  const [analysisView, setAnalysisView] = useState<'averages' | 'timeline'>('averages');
  const [autoZoom, setAutoZoom] = useState(false);

  // Processing Refs
  const [aggregatedData, setAggregatedData] = useState<DataPoint[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(0);

  const [brushData, setBrushData] = useState<BrushDataPoint[]>([]);


  // --- Effects & Data Logic ---

  // 1. Initialize bounds when data loads
  useEffect(() => {
    if (rawData && rawData.length > 0) {
      const bounds = { start: rawData[0].timestamp, end: rawData[rawData.length - 1].timestamp };
      setDataBounds(bounds);
      setViewRange(bounds);

      // Create brush overview data once (200 points max - very lightweight)
      setBrushData(createBrushData(rawData, 200));
    }
  }, [rawData]);

  // 2. Filter data for current view
  const viewData = useMemo(() => {
    if (!rawData || !viewRange.start || !viewRange.end) return rawData || [];
    return rawData.filter(d => d.timestamp >= viewRange.start! && d.timestamp <= viewRange.end!);
  }, [rawData, viewRange]);

  // 3. Hook: Complex Analysis Logic
  const {
    filters: analysisFilters,
    setFilters: setAnalysisFilters,
    results: analysisResults,
    isProcessing: analysisProcessing
  } = useAnalysis(activeTab, viewData, groupBy);

  // 4. Async Processing for Main Chart
  useEffect(() => {
    const currentProcess = ++processingRef.current;
    if (!viewData.length) { setAggregatedData([]); return; }

    setIsProcessing(true);

    requestAnimationFrame(() => {
      const startTime = Date.now();
      const MIN_LOADING_TIME = 300;

      processDataAsync(viewData, resolution).then(result => {
        if (currentProcess === processingRef.current) {
          const elapsed = Date.now() - startTime;
          const remainingTime = Math.max(0, MIN_LOADING_TIME - elapsed);

          setTimeout(() => {
            if (currentProcess === processingRef.current) {
              setAggregatedData(result);
              setIsProcessing(false);
            }
          }, remainingTime);
        }
      });
    });
  }, [viewData, resolution]);

  // 5. Downsampling for performance
  const chartData = useMemo(() => downsampleLTTB(aggregatedData, MAX_CHART_POINTS), [aggregatedData]);

  // 6. Computed Stats
  const spansMultipleDays = useMemo(() => {
    if (chartData.length < 2) return false;
    return new Date(chartData[0].timestamp * 1000).toDateString() !== new Date(chartData[chartData.length - 1].timestamp * 1000).toDateString();
  }, [chartData]);

  const stats = useMemo(() => {
    if (!viewData.length) return null;

    const totalValue = viewData.reduce((a, c) => a + c.value, 0);
    const totalCost = viewData.reduce((a, c) => a + (c.cost ?? 0), 0);

    // Aggregate by day to find peak day
    const dailyTotals = new Map<string, { value: number; cost: number; date: Date }>();
    for (const d of viewData) {
      const date = new Date(d.timestamp * 1000);
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const existing = dailyTotals.get(dayKey);
      if (existing) {
        existing.value += d.value;
        existing.cost += d.cost ?? 0;
      } else {
        dailyTotals.set(dayKey, {
          value: d.value,
          cost: d.cost ?? 0,
          date: new Date(date.getFullYear(), date.getMonth(), date.getDate())
        });
      }
    }

    // Find peak day
    let peakDay = { value: 0, cost: 0, date: new Date() };
    for (const day of dailyTotals.values()) {
      if (day.value > peakDay.value) {
        peakDay = day;
      }
    }

    // Calculate effective rate (cost per kWh)
    const totalKwh = totalValue / 1000000; // mWh -> kWh
    const totalDollars = toDollars(totalCost);
    const effectiveRate = totalKwh > 0 ? totalDollars / totalKwh : 0;

    // Calculate average daily usage/cost
    const numDays = dailyTotals.size;
    const avgDailyValue = numDays > 0 ? Math.round(totalValue / numDays) : 0;
    const avgDailyCost = numDays > 0 ? Math.round(totalCost / numDays) : 0;

    return {
      total: totalValue.toLocaleString(),
      totalCost: formatCost(totalCost),
      average: avgDailyValue.toLocaleString(),
      avgCost: formatCost(avgDailyCost),
      peak: peakDay.value.toLocaleString(),
      peakCost: formatCost(peakDay.cost),
      peakDate: formatShortDate(peakDay.date),
      readings: viewData.length,
      numDays,
      range: `${formatShortDate(new Date(viewData[0].timestamp * 1000))} – ${formatShortDate(new Date(viewData[viewData.length - 1].timestamp * 1000))}`,
      effectiveRate: `${effectiveRate.toFixed(3)}/kWh`
    };
  }, [viewData]);

  const yAxisMax = useMemo(() => {
    if (!rawData?.length) return 1000;
    const max = Math.max(...rawData.map(d => d.value));
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / magnitude) * magnitude;
  }, [rawData]);

  const yAxisMaxCost = useMemo(() => {
    if (!rawData?.length) return 100000;
    const max = Math.max(...rawData.map(d => d.cost ?? 0));
    if (max === 0) return 100000;
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / magnitude) * magnitude;
  }, [rawData]);

  const currentAnalysisMax = useMemo(() => {
    const data = analysisView === 'averages' ? analysisResults.averages : analysisResults.timeline;
    if (!data.length) return 0;

    if (metricMode === 'energy') {
      const key = analysisView === 'averages' ? 'average' : 'value';
      return Math.max(...data.map(d => d[key] || 0));
    } else {
      const key = analysisView === 'averages' ? 'avgCost' : 'cost';
      return Math.max(...data.map(d => d[key] || 0));
    }
  }, [analysisResults, analysisView, metricMode]);

  const analysisDomain = useMemo((): [number, number] => {
    if (autoZoom) return [0, Math.ceil(currentAnalysisMax * 1.1)];
    return [0, metricMode === 'energy' ? yAxisMax : yAxisMaxCost];
  }, [autoZoom, currentAnalysisMax, yAxisMax, yAxisMaxCost, metricMode]);

  const isZoomed = dataBounds.start !== null && (viewRange.start !== dataBounds.start || viewRange.end !== dataBounds.end);

  // --- Handlers ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setError(null); setFileName(file.name); setPage(1);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const result = parseGreenButtonXML(ev.target?.result as string);
        setRawData(result);
        setResolution(result.length > 2000 ? 'DAILY' : 'RAW');
      } catch (err) { setError(err instanceof Error ? err.message : 'Error'); setRawData(null); }
      finally { setLoading(false); }
    };
    reader.readAsText(file);
  };

  const loadSampleData = () => {
    setLoading(true); setFileName("sample_5000pts.xml"); setError(null); setPage(1);
    setTimeout(() => { setRawData(generateSampleData()); setResolution('DAILY'); setLoading(false); }, 300);
  };

  const handleViewInput = (field: 'start' | 'end', value: string) => {
    const ts = parseDateTimeLocal(value);
    if (ts && dataBounds.start !== null && dataBounds.end !== null) {
      const clamped = Math.max(dataBounds.start, Math.min(dataBounds.end, ts));
      setViewRange(prev => ({ ...prev, [field]: clamped }));
      setPage(1);
    }
  };

  const handleZoomOut = () => {
    setViewRange({ start: dataBounds.start, end: dataBounds.end });
    setPage(1);
  };

  const handleChartSelection = (range: { start: number; end: number }) => {
    setViewRange({ start: range.start, end: range.end });
    setPage(1);
  };

  return (
    <AnimatedBackground>
    <div className="min-h-screen bg-slate-950x text-slate-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/10 p-2 rounded-lg"><Plug className="w-6 h-6 text-emerald-500" /></div>
            <div>
              <h1 className="text-lg md:text-xl font-bold"><span className="text-emerald-500">GB</span> Energy Meter</h1>
              {fileName && <p className="text-slate-400 text-xs font-medium truncate max-w-[200px]">{fileName}</p>}
            </div>
          </div>
          {rawData && <button onClick={() => { setRawData(null); setFileName(null); setError(null); }} className="text-sm bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 px-4 py-2 rounded transition-colors">Upload</button>}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 pb-8 pt-4">
        {/* Upload State */}
        {!rawData ? (
          loading ? (
            <div className="flex items-center justify-center min-h-[60vh]">
              <PulseLoader
                variant="energy"
                size="lg"
                message="Parsing Green Button XML..."
                subMessage="Extracting energy readings"
              />
            </div>
          ) : (
            <UploadSection
              onUpload={handleFileUpload}
              onLoadSample={loadSampleData}
              loading={loading}
              error={error}
            />
          )
        ) : (
          stats && (
            <div className="space-y-4">
              {/* Top Stats Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={<Zap className="w-5 h-5 text-amber-400" />} label={isZoomed ? "View Total" : "Total"} value={stats.total} unit="Wh" sub={stats.totalCost} />
                <StatCard icon={<DollarSign className="w-5 h-5 text-emerald-400" />} label="Total Cost" value={stats.totalCost} sub={stats.effectiveRate} />
                <StatCard icon={<Activity className="w-5 h-5 text-blue-400" />} label="Avg/Day" value={stats.average} unit="Wh" sub={stats.avgCost} />
                <StatCard icon={<AlertCircle className="w-5 h-5 text-red-400" />} label="Peak Day" value={stats.peak} unit="Wh" sub={`${stats.peakDate} • ${stats.peakCost}`} />
              </div>

              {/* Date Controls */}
              <DateRangeControls
                viewRange={viewRange}
                dataBounds={dataBounds}
                brushData={brushData}
                isZoomed={isZoomed}
                onViewChange={handleViewInput}
                onZoomOut={handleZoomOut}
                onBrushChange={handleChartSelection}
              />

              {/* Main Tabbed Interface */}
              <div className="bg-slate-900 rounded-md shadow-sm border border-slate-800 overflow-hidden flex flex-col min-h-[600px]">

                {/* Tab Header & Action Bar */}
                <div className="border-b border-slate-800 px-4 md:px-6 py-3">
                  <div className="flex items-center gap-3 flex-wrap">

                    {/* Tabs */}
                    <div className="flex bg-slate-800/80 p-1 rounded-lg border border-slate-700/50">
                      <TabButton active={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')} icon={<BarChart2 className="w-4 h-4" />}>Analysis</TabButton>
                      <TabButton active={activeTab === 'chart'} onClick={() => setActiveTab('chart')} icon={<TrendingUp className="w-4 h-4" />}>Chart</TabButton>
                      <TabButton active={activeTab === 'table'} onClick={() => setActiveTab('table')} icon={<FileText className="w-4 h-4" />}>Data</TabButton>
                    </div>

                    {/* Metric Toggle - show for chart and analysis */}
                    {(activeTab === 'chart' || activeTab === 'analysis') && (
                      <>
                        <div className="hidden sm:block w-px h-5 bg-slate-700/60" />
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium hidden md:inline">Metric</span>
                          <div className="flex bg-slate-800/80 p-0.5 rounded-md border border-slate-700/50">
                            <button
                              onClick={() => setMetricMode('energy')}
                              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-all ${metricMode === 'energy'
                                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border border-transparent'
                                }`}
                            >
                              <Zap className="w-3 h-3" />
                              <span className="hidden sm:inline">Energy</span>
                            </button>
                            <button
                              onClick={() => setMetricMode('cost')}
                              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-all ${metricMode === 'cost'
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border border-transparent'
                                }`}
                            >
                              <DollarSign className="w-3 h-3" />
                              <span className="hidden sm:inline">Cost</span>
                            </button>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Chart-specific controls */}
                    {activeTab === 'chart' && (
                      <>
                        <div className="hidden sm:block w-px h-5 bg-slate-700/60" />
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium hidden md:inline">Resolution</span>
                          <div className="flex bg-slate-800/80 p-0.5 rounded-md border border-slate-700/50">
                            {Object.keys(RESOLUTIONS).map((key) => (
                              <button
                                key={key}
                                onClick={() => setResolution(key)}
                                className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${resolution === key
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 border border-transparent'
                                  }`}
                              >
                                {RESOLUTIONS[key].label.split(' ')[0]}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-auto sm:ml-0">
                          <StatusChip loading={isProcessing} count={chartData.length} />
                        </div>
                      </>
                    )}

                    {activeTab === 'analysis' && (
                      <>
                        <div className="hidden sm:block w-px h-5 bg-slate-700/60" />
                        <StatusChip
                          loading={analysisProcessing}
                          count={0}
                          label={groupBy === 'hour' ? '24h view' : groupBy === 'dayOfWeek' ? '7d view' : '12mo view'}
                        />
                      </>
                    )}

                    {activeTab === 'table' && (
                      <>
                        <div className="hidden sm:block w-px h-5 bg-slate-700/60" />
                        <StatusChip loading={false} count={viewData.length} label={`${viewData.length.toLocaleString()} rows`} />
                      </>
                    )}

                  </div>
                </div>

                {/* Tab Content Areas */}
                <div className="flex-1 relative min-h-[300px]">
                  {activeTab === 'chart' && (
                    <>
                      <LoadingOverlay
                        visible={isProcessing}
                        variant="chart"
                        size="md"
                        message="Aggregating data..."
                        subMessage={`Processing ${viewData.length.toLocaleString()} readings`}
                      />
                      <MainChart
                        data={chartData}
                        resolution={resolution}
                        isProcessing={isProcessing}
                        spansMultipleDays={spansMultipleDays}
                        metricMode={metricMode}
                      />
                    </>
                  )}

                  {activeTab === 'analysis' && (
                    <div className="min-h-[600px]">
                      <LoadingOverlay
                        visible={analysisProcessing}
                        variant="analysis"
                        size="md"
                        message="Analyzing patterns..."
                        subMessage="Calculating averages and trends"
                      />
                      <AnalysisPanel
                        filters={analysisFilters}
                        setFilters={setAnalysisFilters}
                        groupBy={groupBy}
                        setGroupBy={setGroupBy}
                        analysisView={analysisView}
                        setAnalysisView={setAnalysisView}
                        results={analysisResults}
                        isProcessing={analysisProcessing}
                        autoZoom={autoZoom}
                        setAutoZoom={setAutoZoom}
                        analysisDomain={analysisDomain}
                        metricMode={metricMode}
                        viewRange={viewRange}
                      />
                    </div>
                  )}

                  {activeTab === 'table' && (
                    <TableView
                      data={viewData}
                      page={page}
                      setPage={setPage}
                      rowsPerPage={ROWS_PER_PAGE}
                      isSelectionSubset={isZoomed}
                    />
                  )}
                </div>
              </div>
            </div>
          )
        )}
      </main>
    </div>
    </AnimatedBackground>
  );
}