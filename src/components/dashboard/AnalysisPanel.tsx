import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import {
    Calendar, CalendarDays, Maximize2, Minimize2, Loader2
} from 'lucide-react';
import { HourRangeFilter } from '../common/HourRangeFilter';
import { formatAxisValue } from '../../utils/formatters';
import { FilterChip } from '../common/FilterChip';
import { DAYS_OF_WEEK, MONTHS, type AnalysisFilters, type DataPoint } from '../../types';
import { formatCost, formatCostAxis } from '../../utils/formatters';
import type { MetricMode } from '../charts/MainChart';

interface AnalysisPanelProps {
    filters: AnalysisFilters;
    setFilters: React.Dispatch<React.SetStateAction<AnalysisFilters>>;
    groupBy: 'dayOfWeek' | 'month' | 'hour';
    setGroupBy: (g: 'dayOfWeek' | 'month' | 'hour') => void;
    analysisView: 'averages' | 'timeline';
    setAnalysisView: (v: 'averages' | 'timeline') => void;
    results: {
        filtered: DataPoint[];
        averages: any[];
        timeline: any[];
    };
    isProcessing: boolean;
    autoZoom: boolean;
    setAutoZoom: React.Dispatch<React.SetStateAction<boolean>>;
    analysisDomain: [number, number];
    metricMode: MetricMode;
    viewRange?: { start: number | null; end: number | null };
}

// Check if a time period is complete within the view range
function isPeriodComplete(
    periodData: any,
    viewStart: number,
    viewEnd: number
): boolean {
    // For averages view, we can't really determine completeness the same way
    // since it's aggregating across multiple instances of the same period
    // We'll only mark timeline items as incomplete

    if (!periodData.periodStart || !periodData.periodEnd) {
        return true; // No period bounds = assume complete (averages view)
    }

    const periodStart = periodData.periodStart;
    const periodEnd = periodData.periodEnd;

    // Period is complete if view range fully contains it
    return viewStart <= periodStart && viewEnd >= periodEnd;
}

// Add period bounds to timeline data for completeness checking
function addPeriodBounds(
    data: any[],
    groupBy: 'dayOfWeek' | 'month' | 'hour'
): any[] {
    return data.map(item => {
        // Timeline items have timestamp (unix seconds) representing the start of the period
        if (typeof item.timestamp !== 'number') return item;

        const date = new Date(item.timestamp * 1000);
        let periodStart: number;
        let periodEnd: number;

        if (groupBy === 'hour') {
            // Hour period: timestamp is already the hour start
            periodStart = item.timestamp;
            periodEnd = periodStart + 3600 - 1; // 1 hour minus 1 second
        } else if (groupBy === 'dayOfWeek') {
            // Day period: timestamp is start of day
            periodStart = item.timestamp;
            periodEnd = periodStart + 86400 - 1; // 24 hours minus 1 second
        } else if (groupBy === 'month') {
            // Month period: timestamp is 1st of month, need to find last second of month
            periodStart = item.timestamp;
            const year = date.getFullYear();
            const month = date.getMonth();
            // Last day of month at 23:59:59
            const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
            periodEnd = Math.floor(monthEnd.getTime() / 1000);
        } else {
            return item;
        }

        return { ...item, periodStart, periodEnd };
    });
}

export const AnalysisPanel = React.memo(function AnalysisPanel({
    filters, setFilters, groupBy, setGroupBy, analysisView, setAnalysisView,
    results, isProcessing, autoZoom, setAutoZoom, analysisDomain, metricMode,
    viewRange
}: AnalysisPanelProps) {

    // --- ENFORCE DEFAULTS ON MOUNT ---
    React.useEffect(() => {
        setGroupBy('month');
        setAnalysisView('timeline');
        setAutoZoom(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Chart colors based on metric mode
    const chartColor = metricMode === 'energy' ? '#f59e0b' : '#10b981';
    const incompleteColor = '#64748b'; // slate-500 for incomplete periods
    const yAxisFormatter = metricMode === 'energy' ? formatAxisValue : formatCostAxis;

    // Process timeline data with period bounds (always compute for both views)
    const timelineWithBounds = React.useMemo(() => {
        return addPeriodBounds(results.timeline, groupBy);
    }, [results.timeline, groupBy]);

    // Filter averages to exclude incomplete periods
    const filteredAverages = React.useMemo(() => {
        if (!viewRange?.start || !viewRange?.end) return results.averages;

        // Get the set of complete period category keys
        const completePeriodsByCategory = new Map<number, { values: number[]; costs: number[] }>();

        for (const item of timelineWithBounds) {
            if (isPeriodComplete(item, viewRange.start, viewRange.end)) {
                // Extract category key from the period
                const date = new Date(item.timestamp * 1000);
                const categoryKey = groupBy === 'dayOfWeek'
                    ? date.getDay()
                    : groupBy === 'month'
                        ? date.getMonth()
                        : date.getHours();

                if (!completePeriodsByCategory.has(categoryKey)) {
                    completePeriodsByCategory.set(categoryKey, { values: [], costs: [] });
                }
                const category = completePeriodsByCategory.get(categoryKey)!;
                category.values.push(item.value);
                category.costs.push(item.cost);
            }
        }

        // Rebuild averages using only complete periods
        return results.averages.map(avg => {
            const completeData = completePeriodsByCategory.get(avg.key);
            if (!completeData || completeData.values.length === 0) {
                return { ...avg, average: 0, avgCost: 0, count: 0, isIncomplete: true };
            }

            const average = Math.round(
                completeData.values.reduce((a, b) => a + b, 0) / completeData.values.length
            );
            const avgCost = Math.round(
                completeData.costs.reduce((a, b) => a + b, 0) / completeData.costs.length
            );

            return {
                ...avg,
                average,
                avgCost,
                count: completeData.values.length,
                isIncomplete: false
            };
        });
    }, [results.averages, timelineWithBounds, viewRange, groupBy]);

    // Determine which data key to use based on view and metric mode
    const getDataKey = () => {
        if (analysisView === 'averages') {
            return metricMode === 'energy' ? 'average' : 'avgCost';
        }
        return metricMode === 'energy' ? 'value' : 'cost';
    };

    // Get bar color based on completeness
    const getBarColor = (entry: any): string => {
        // Averages view - gray if no complete periods contributed
        if (analysisView === 'averages') {
            if (entry.isIncomplete || entry.count === 0) {
                return '#334155'; // slate-800, same as "no data"
            }
            return chartColor;
        }

        // Timeline view - check completeness
        if (viewRange?.start && viewRange?.end) {
            const isComplete = isPeriodComplete(entry, viewRange.start, viewRange.end);
            if (!isComplete) {
                return incompleteColor;
            }
        }

        return chartColor;
    };

    // Handlers for filters
    const toggleDay = (day: number) => {
        setFilters(prev => ({
            ...prev,
            daysOfWeek: prev.daysOfWeek.includes(day)
                ? prev.daysOfWeek.filter(d => d !== day)
                : [...prev.daysOfWeek, day].sort()
        }));
    };

    const toggleMonth = (month: number) => {
        setFilters(prev => ({
            ...prev,
            months: prev.months.includes(month)
                ? prev.months.filter(m => m !== month)
                : [...prev.months, month].sort()
        }));
    };

    const setWeekdays = () => setFilters(prev => ({ ...prev, daysOfWeek: [1, 2, 3, 4, 5] }));
    const setWeekends = () => setFilters(prev => ({ ...prev, daysOfWeek: [0, 6] }));
    const clearDays = () => setFilters(prev => ({ ...prev, daysOfWeek: [] }));
    const clearMonths = () => setFilters(prev => ({ ...prev, months: [] }));

    const hasActiveFilters = filters.daysOfWeek.length > 0 || filters.months.length > 0 || filters.hourStart > 0 || filters.hourEnd < 23;

    // Count incomplete periods for status display
    const incompletePeriods = React.useMemo(() => {
        if (analysisView !== 'timeline' || !viewRange?.start || !viewRange?.end) return 0;
        return timelineWithBounds.filter(
            item => !isPeriodComplete(item, viewRange.start!, viewRange.end!)
        ).length;
    }, [timelineWithBounds, groupBy, viewRange, analysisView]);

    const chartData = analysisView === 'averages' ? filteredAverages : timelineWithBounds;

    return (
        <div className="flex flex-col h-full">
            {/* Chart Area - minimum 40% height on mobile */}
            <div className="h-64 sm:h-80 flex-shrink-0 p-4 relative">
                {isProcessing && (
                    <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center z-10">
                        <div className="flex items-center gap-3 bg-slate-800 px-4 py-3 rounded-lg border border-slate-700">
                            <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                            <span className="text-slate-300 text-sm">Processing...</span>
                        </div>
                    </div>
                )}

                {!isProcessing && results.filtered.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-slate-500">No data matches the current filters</div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={chartData}
                            margin={{ top: 10, right: 10, left: -10, bottom: 5 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                            <XAxis
                                dataKey={analysisView === 'averages' ? "label" : "fullDate"}
                                stroke="#94a3b8" fontSize={10} tickLine={analysisView === 'timeline'}
                                axisLine={false} minTickGap={40}
                            />
                            <YAxis
                                stroke="#94a3b8" fontSize={10} tickLine={true}
                                axisLine={false} tickFormatter={yAxisFormatter} width={50} domain={analysisDomain}
                            />
                            <Tooltip content={({ active, payload }) => {
                                if (active && payload?.length) {
                                    const d = payload[0].payload;
                                    const energyVal = analysisView === 'averages' ? d.average : d.value;
                                    const costVal = analysisView === 'averages' ? d.avgCost : d.cost;
                                    const hasCost = typeof costVal === 'number' && costVal > 0;

                                    const energyLabel = analysisView === 'averages' ? 'Wh avg' : 'Wh total';
                                    const costLabel = analysisView === 'averages' ? 'avg' : 'total';

                                    // Different count label based on view
                                    const periodName = groupBy === 'month' ? 'months' : groupBy === 'dayOfWeek' ? 'days' : 'hours';
                                    const countLabel = analysisView === 'averages'
                                        ? `${d.count} complete ${periodName} averaged`
                                        : `${d.count.toLocaleString()} readings`;

                                    // Check if this period is incomplete (timeline) or has no data (averages)
                                    const isIncomplete = analysisView === 'timeline' &&
                                        viewRange?.start && viewRange?.end &&
                                        !isPeriodComplete(d, viewRange.start, viewRange.end);

                                    const hasNoCompleteData = analysisView === 'averages' && (d.isIncomplete || d.count === 0);

                                    return (
                                        <div className="bg-slate-800 p-3 shadow-xl border border-slate-700 rounded-lg min-w-[150px]">
                                            <p className="text-slate-400 text-xs font-semibold mb-2">
                                                {analysisView === 'averages' ? d.label : d.fullDate}
                                                {isIncomplete && (
                                                    <span className="ml-2 text-slate-500 font-normal">(partial)</span>
                                                )}
                                            </p>

                                            {hasNoCompleteData ? (
                                                <p className="text-slate-500 text-sm italic">
                                                    No complete {periodName} in range
                                                </p>
                                            ) : (
                                                <>
                                                    <p className={`font-bold ${metricMode === 'energy' ? 'text-amber-400 text-lg' : 'text-slate-400 text-sm'}`}>
                                                        {energyVal.toLocaleString()} <span className="text-xs text-slate-500 font-normal">{energyLabel}</span>
                                                    </p>

                                                    {hasCost && (
                                                        <p className={`font-semibold mt-1 ${metricMode === 'cost' ? 'text-emerald-400 text-lg' : 'text-slate-400 text-sm'}`}>
                                                            {formatCost(costVal)} <span className="text-xs text-slate-500 font-normal">{costLabel}</span>
                                                        </p>
                                                    )}

                                                    <p className="text-xs text-slate-500 mt-2">{countLabel}</p>
                                                </>
                                            )}

                                            {isIncomplete && (
                                                <p className="text-xs text-slate-500 mt-1 italic">
                                                    Partial period — not fully in view range
                                                </p>
                                            )}
                                        </div>
                                    );
                                }
                                return null;
                            }} />
                            <Bar
                                dataKey={getDataKey()}
                                fill={chartColor}
                                radius={[4, 4, 0, 0]}
                                isAnimationActive={false}
                            >
                                {chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={getBarColor(entry)} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* Controls Footer */}
            <div className="flex-1 border-t border-slate-800 p-4 space-y-5">

                {/* Chart Options Row */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Group By */}
                        <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700/50">
                            {(['hour', 'dayOfWeek', 'month'] as const).map(g => (
                                <button
                                    key={g}
                                    onClick={() => setGroupBy(g)}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${groupBy === g
                                        ? 'bg-slate-700 text-emerald-400'
                                        : 'text-slate-400 hover:text-slate-200'
                                        }`}
                                >
                                    {g === 'hour' ? 'Hour' : g === 'dayOfWeek' ? 'Day' : 'Month'}
                                </button>
                            ))}
                        </div>

                        {/* View Toggle */}
                        <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700/50">
                            <button
                                onClick={() => setAnalysisView('timeline')}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${analysisView === 'timeline'
                                    ? 'bg-slate-700 text-emerald-400'
                                    : 'text-slate-400 hover:text-slate-200'
                                    }`}
                            >
                                Timeline
                            </button>
                            <button
                                onClick={() => setAnalysisView('averages')}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${analysisView === 'averages'
                                    ? 'bg-slate-700 text-emerald-400'
                                    : 'text-slate-400 hover:text-slate-200'
                                    }`}
                            >
                                Averages
                            </button>
                        </div>

                        {/* Auto Zoom */}
                        <button
                            onClick={() => setAutoZoom(prev => !prev)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${autoZoom
                                ? 'bg-emerald-900/40 text-emerald-400 ring-1 ring-emerald-800/50'
                                : 'bg-slate-800 text-slate-400 hover:text-slate-200 ring-1 ring-slate-700/50'
                                }`}
                        >
                            {autoZoom ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                            {autoZoom ? 'Auto Fit' : 'Full Scale'}
                        </button>
                    </div>

                    {/* Status - right aligned on desktop, below on mobile */}
                    <div className="text-slate-500 text-xs sm:ml-auto flex items-center gap-2">
                        {isProcessing ? (
                            <>
                                <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                                <span>Processing...</span>
                            </>
                        ) : (
                            <span>
                                {results.filtered.length.toLocaleString()} readings
                                {hasActiveFilters && ' (filtered)'}
                                {analysisView === 'timeline' && (
                                    <span className="text-slate-600">
                                        {` → ${results.timeline.length} ${groupBy === 'month' ? 'mo' : groupBy === 'dayOfWeek' ? 'days' : 'hrs'}`}
                                        {incompletePeriods > 0 && ` (${incompletePeriods} partial)`}
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                </div>

                {/* Filters Section */}
                <div className="space-y-4">
                    <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                        Filter Data
                    </div>

                    {/* Days Filter */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-slate-400 text-xs font-medium">
                                <CalendarDays className="w-3.5 h-3.5" />
                                <span>Days of Week</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={setWeekdays}
                                    className="text-xs text-emerald-400/80 hover:text-emerald-400 transition-colors"
                                >
                                    Weekdays
                                </button>
                                <span className="text-slate-700">·</span>
                                <button
                                    onClick={setWeekends}
                                    className="text-xs text-emerald-400/80 hover:text-emerald-400 transition-colors"
                                >
                                    Weekends
                                </button>
                                {filters.daysOfWeek.length > 0 && (
                                    <>
                                        <span className="text-slate-700">·</span>
                                        <button
                                            onClick={clearDays}
                                            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                                        >
                                            Clear
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {DAYS_OF_WEEK.map((day, i) => (
                                <FilterChip
                                    key={day}
                                    label={day}
                                    selected={filters.daysOfWeek.includes(i)}
                                    onClick={() => toggleDay(i)}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Months Filter */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-slate-400 text-xs font-medium">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>Months</span>
                            </div>
                            {filters.months.length > 0 && (
                                <button
                                    onClick={clearMonths}
                                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {MONTHS.map((month, i) => (
                                <FilterChip
                                    key={month}
                                    label={month}
                                    selected={filters.months.includes(i)}
                                    onClick={() => toggleMonth(i)}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Hours Filter */}
                    <div className="space-y-2">
                        <HourRangeFilter
                            hourStart={filters.hourStart}
                            hourEnd={filters.hourEnd}
                            onChange={(start, end) => setFilters(prev => ({
                                ...prev,
                                hourStart: start,
                                hourEnd: end
                            }))}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
});