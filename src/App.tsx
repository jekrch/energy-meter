import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Zap, Plug, FileText, BarChart2, TrendingUp, Filter, Loader2, Activity, AlertCircle, Calendar } from 'lucide-react';

// Types and Utilities
import { type DataPoint, type TimeRange, RESOLUTIONS } from './types';
import { formatShortDate, parseDateTimeLocal } from './utils/formatters';
import { processDataAsync, parseGreenButtonXML, generateSampleData, downsampleLTTB } from './utils/dataUtils';

// Hooks
import { useAnalysis } from './hooks/useAnalysis';

// Components
import { StatCard } from './components/common/StatCard';
import { TabButton } from './components/common/TabButton';
import { UploadSection } from './components/dashboard/UploadSection';
import { DateRangeControls } from './components/dashboard/DateRangeControls';
import { MainChart } from './components/charts/MainChart';
import { AnalysisPanel } from './components/dashboard/AnalysisPanel';
import { TableView } from './components/dashboard/TableView';

const ROWS_PER_PAGE = 50;
const MAX_CHART_POINTS = 800;

export default function App() {
  const [rawData, setRawData] = useState<DataPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // UI State
  const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'analysis'>('chart');
  const [resolution, setResolution] = useState<string>('RAW');
  const [page, setPage] = useState(1);

  // Time/Selection State
  const [dataBounds, setDataBounds] = useState<TimeRange>({ start: null, end: null });
  const [viewRange, setViewRange] = useState<TimeRange>({ start: null, end: null });
  const [selection, setSelection] = useState<TimeRange>({ start: null, end: null });

  // Analysis State
  const [groupBy, setGroupBy] = useState<'dayOfWeek' | 'month' | 'hour'>('hour');
  const [analysisView, setAnalysisView] = useState<'averages' | 'timeline'>('averages');
  const [autoZoom, setAutoZoom] = useState(false);

  // Processing Refs (State for the main chart aggregation)
  const [aggregatedData, setAggregatedData] = useState<DataPoint[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(0);

  // --- Effects & Data Logic ---

  // 1. Initialize bounds when data loads
  useEffect(() => {
    if (rawData && rawData.length > 0) {
      const bounds = { start: rawData[0].timestamp, end: rawData[rawData.length - 1].timestamp };
      setDataBounds(bounds);
      setViewRange(bounds);
      setSelection(bounds);
    }
  }, [rawData]);

  // 2. Filter data for View (Zooming) and Selection (Analysis)
  const viewData = useMemo(() => {
    if (!rawData || !viewRange.start || !viewRange.end) return rawData || [];
    return rawData.filter(d => d.timestamp >= viewRange.start! && d.timestamp <= viewRange.end!);
  }, [rawData, viewRange]);

  const selectionData = useMemo(() => {
    if (!rawData || !selection.start || !selection.end) return [];
    return rawData.filter(d => d.timestamp >= selection.start! && d.timestamp <= selection.end!);
  }, [rawData, selection]);

  // 3. Hook: Complex Analysis Logic (Filtering by day/hour/month)
  const {
    filters: analysisFilters,
    setFilters: setAnalysisFilters,
    results: analysisResults,
    isProcessing: analysisProcessing
  } = useAnalysis(activeTab, selectionData, groupBy);

  // 4. Async Processing for Main Chart (Aggregation/Resolution changes)
  useEffect(() => {
    const currentProcess = ++processingRef.current;
    if (!viewData.length) { setAggregatedData([]); return; }
    setIsProcessing(true);
    processDataAsync(viewData, resolution).then(result => {
      if (currentProcess === processingRef.current) {
        setAggregatedData(result);
        setIsProcessing(false);
      }
    });
  }, [viewData, resolution]);

  // 5. Downsampling for performance (LTTB Algorithm)
  const chartData = useMemo(() => downsampleLTTB(aggregatedData, MAX_CHART_POINTS), [aggregatedData]);

  // 6. Computed Stats
  const spansMultipleDays = useMemo(() => {
    if (chartData.length < 2) return false;
    return new Date(chartData[0].timestamp * 1000).toDateString() !== new Date(chartData[chartData.length - 1].timestamp * 1000).toDateString();
  }, [chartData]);

  const stats = useMemo(() => {
    if (!selectionData.length) return null;
    const total = selectionData.reduce((a, c) => a + c.value, 0);
    return {
      total: total.toLocaleString(),
      average: Math.round(total / selectionData.length).toLocaleString(),
      peak: Math.max(...selectionData.map(d => d.value)).toLocaleString(),
      readings: selectionData.length,
      range: `${formatShortDate(new Date(selectionData[0].timestamp * 1000))} – ${formatShortDate(new Date(selectionData[selectionData.length - 1].timestamp * 1000))}`
    };
  }, [selectionData]);

  const yAxisMax = useMemo(() => {
    if (!rawData?.length) return 1000;
    const max = Math.max(...rawData.map(d => d.value));
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / magnitude) * magnitude;
  }, [rawData]);

  const currentAnalysisMax = useMemo(() => {
    const data = analysisView === 'averages' ? analysisResults.averages : analysisResults.timeline;
    const key = analysisView === 'averages' ? 'average' : 'value';
    if (!data.length) return 0;
    return Math.max(...data.map(d => d[key]));
  }, [analysisResults, analysisView]);

  const analysisDomain = useMemo((): [number, number] => {
    if (autoZoom) return [0, Math.ceil(currentAnalysisMax * 1.1)];
    return [0, yAxisMax];
  }, [autoZoom, currentAnalysisMax, yAxisMax]);

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
    setTimeout(() => { setRawData(generateSampleData()); setResolution('HOURLY'); setLoading(false); }, 300);
  };

  const handleViewInput = (field: 'start' | 'end', value: string) => {
    const ts = parseDateTimeLocal(value);
    if (ts) { setViewRange(prev => ({ ...prev, [field]: ts })); setPage(1); }
  };

  const handleSelectionInput = (field: 'start' | 'end', value: string) => {
    const ts = parseDateTimeLocal(value);
    if (ts && dataBounds.start !== null && dataBounds.end !== null) {
      const clamped = Math.max(dataBounds.start, Math.min(dataBounds.end, ts));
      setSelection(prev => ({ ...prev, [field]: clamped }));
      setPage(1);
    }
  };

  const isZoomed = dataBounds.start !== null && (viewRange.start !== dataBounds.start || viewRange.end !== dataBounds.end);
  const isSelectionSubset = selection.start !== null && dataBounds.start !== null && (selection.start !== dataBounds.start || selection.end !== dataBounds.end);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/10 p-2 rounded-lg"><Plug className="w-6 h-6 text-emerald-500" /></div>
            <div>
              <h1 className="text-lg md:text-xl font-bold">GB Energy Meter</h1>
              {fileName && <p className="text-slate-400 text-xs font-medium truncate max-w-[200px]">{fileName}</p>}
            </div>
          </div>
          {rawData && <button onClick={() => { setRawData(null); setFileName(null); setError(null); }} className="text-sm bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 px-4 py-2 rounded transition-colors">Upload</button>}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {!rawData ? (
          /* Empty State / Upload */
          <UploadSection
            onUpload={handleFileUpload}
            onLoadSample={loadSampleData}
            loading={loading}
            error={error}
          />
        ) : (
          stats && (
            <div className="space-y-6">
              {/* Top Stats Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={<Zap className="w-5 h-5 text-amber-400" />} label={isSelectionSubset ? "Selection Total" : "Total"} value={stats.total} unit="Wh" />
                <StatCard icon={<Activity className="w-5 h-5 text-blue-400" />} label="Avg/Interval" value={stats.average} unit="Wh" />
                <StatCard icon={<AlertCircle className="w-5 h-5 text-red-400" />} label="Peak" value={stats.peak} unit="Wh" />
                <StatCard icon={<Calendar className="w-5 h-5 text-purple-400" />} label="Range" value={stats.range} sub={`${stats.readings} readings`} />
              </div>

              {/* Date Controls (View Range & Selection Range) */}
              <DateRangeControls
                viewRange={viewRange}
                selection={selection}
                isZoomed={isZoomed}
                isSelectionSubset={isSelectionSubset}
                onViewChange={handleViewInput}
                onSelectionChange={handleSelectionInput}
                onZoomOut={() => { setViewRange({ start: dataBounds.start, end: dataBounds.end }); setPage(1); }}
                onZoomToSelection={() => { if (selection.start && selection.end) { setViewRange({ start: selection.start, end: selection.end }); setPage(1); } }}
                onResetSelection={() => { if (dataBounds.start && dataBounds.end) setSelection({ start: dataBounds.start, end: dataBounds.end }); }}
              />

              {/* Main Tabbed Interface */}
              <div className="bg-slate-900 rounded-xl shadow-sm border border-slate-800 overflow-hidden flex flex-col h-[600px]">

                {/* Tab Header & Action Bar */}
                <div className="border-b border-slate-800 px-4 md:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <h3 className="font-bold text-lg text-slate-200">Usage</h3>
                    <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700/50">
                      <TabButton active={activeTab === 'chart'} onClick={() => setActiveTab('chart')} icon={<BarChart2 className="w-4 h-4" />}>Chart</TabButton>
                      <TabButton active={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')} icon={<TrendingUp className="w-4 h-4" />}>Analysis</TabButton>
                      <TabButton active={activeTab === 'table'} onClick={() => setActiveTab('table')} icon={<FileText className="w-4 h-4" />}>Data</TabButton>
                    </div>
                  </div>

                  {activeTab === 'chart' && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Filter className="w-4 h-4 text-slate-500" />
                      <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700/50">
                        {Object.keys(RESOLUTIONS).map((key) => (
                          <button key={key} onClick={() => setResolution(key)} className={`px-2 md:px-3 py-1 text-xs font-semibold rounded-md transition-all ${resolution === key ? 'bg-slate-700 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}>{RESOLUTIONS[key].label.split(' ')[0]}</button>
                        ))}
                      </div>
                      <span className="text-slate-500 text-xs flex items-center gap-1">({chartData.length} pts) • Drag to select {isProcessing && <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />}</span>
                    </div>
                  )}
                </div>

                {/* Tab Content Areas */}
                <div className="flex-1 min-h-0 relative">
                  {activeTab === 'chart' && (
                    <MainChart
                      data={chartData}
                      resolution={resolution}
                      isProcessing={isProcessing}
                      spansMultipleDays={spansMultipleDays}
                      selection={selection}
                      isSelectionSubset={isSelectionSubset}
                      onSelectionChange={(range) => { setSelection({ start: range.start, end: range.end }); setPage(1); }}
                    />
                  )}

                  {activeTab === 'analysis' && (
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
                    />
                  )}

                  {activeTab === 'table' && (
                    <TableView
                      data={selectionData}
                      page={page}
                      setPage={setPage}
                      rowsPerPage={ROWS_PER_PAGE}
                      isSelectionSubset={isSelectionSubset}
                    />
                  )}
                </div>
              </div>
            </div>
          )
        )}
      </main>
    </div>
  );
}