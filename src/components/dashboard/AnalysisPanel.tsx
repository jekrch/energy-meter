import React, { useCallback, useState, useMemo } from 'react';
import {
    ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { Calendar, CalendarDays, Loader2, Thermometer } from 'lucide-react';
import { HourRangeFilter } from '../common/HourRangeFilter';
import { FilterChip } from '../common/FilterChip';
import { TempRangeSlider, celsiusToFahrenheit, fahrenheitToCelsius } from '../common/TempRangeSlider';
import { DAYS_OF_WEEK, MONTHS, type AnalysisFilters, type DataPoint } from '../../types';
import { formatCostAxis } from '../../utils/formatters';
import type { MetricMode } from '../charts/MainChart';
import { type EnergyUnit, formatEnergyAxis } from '../../utils/energyUnits';
import { useTouchDevice, useTooltipControl } from '../../hooks/useTooltipControl';
import { useDebouncedValue } from '../../hooks/useDebounceValue';
import { ChartTooltip, type TooltipData } from '../common/ChartTooltip';

interface AnalysisPanelProps {
    filters: AnalysisFilters;
    setFilters: React.Dispatch<React.SetStateAction<AnalysisFilters>>;
    groupBy: 'dayOfWeek' | 'month' | 'hour';
    setGroupBy: (g: 'dayOfWeek' | 'month' | 'hour') => void;
    analysisView: 'averages' | 'timeline';
    setAnalysisView: (v: 'averages' | 'timeline') => void;
    results: { filtered: DataPoint[]; averages: any[]; timeline: any[] };
    isProcessing: boolean;
    autoZoom: boolean;
    setAutoZoom: React.Dispatch<React.SetStateAction<boolean>>;
    analysisDomain: [number, number];
    metricMode: MetricMode;
    viewRange?: { start: number | null; end: number | null };
    energyUnit: EnergyUnit;
    weatherData?: Map<number, number>;
    showWeather?: boolean;
    temperatureUnit?: 'C' | 'F';
}

function isPeriodComplete(periodData: any, viewStart: number, viewEnd: number): boolean {
    if (periodData.periodStart === undefined || periodData.periodEnd === undefined) return true;
    return viewStart <= periodData.periodStart && viewEnd >= periodData.periodEnd;
}

export const AnalysisPanel = React.memo(function AnalysisPanel({
    filters, setFilters, groupBy, setGroupBy, analysisView, setAnalysisView,
    results, isProcessing, autoZoom, setAutoZoom, analysisDomain, metricMode,
    viewRange, energyUnit, weatherData, showWeather = false, temperatureUnit = 'F'
}: AnalysisPanelProps) {

    const [tempFilter, setTempFilter] = useState<{ min: number | null; max: number | null }>({
        min: null, max: null
    });
    const [userHasSetTempFilter, setUserHasSetTempFilter] = useState(false);

    // Debounce temp filter values to prevent mobile crashes
    // The 200ms delay gives the UI time to breathe between expensive computations
    const debouncedTempMin = useDebouncedValue(tempFilter.min, 200);
    const debouncedTempMax = useDebouncedValue(tempFilter.max, 200);

    // Track if we're waiting for debounce to settle
    const isTempDebouncing = tempFilter.min !== debouncedTempMin || tempFilter.max !== debouncedTempMax;

    autoZoom = autoZoom;
    React.useEffect(() => {
        setGroupBy('month');
        setAnalysisView('timeline');
        setAutoZoom(true);
    }, []);

    const isTouchDevice = useTouchDevice();
    const { activeIndex, tooltipRef, chartContainerRef, handleChartClick } = useTooltipControl(isTouchDevice);

    const chartColor = metricMode === 'energy' ? '#f59e0b' : '#10b981';
    const incompleteColor = '#64748b';
    const yAxisFormatter = metricMode === 'energy'
        ? (val: number) => formatEnergyAxis(val, energyUnit)
        : formatCostAxis;

    const timeline = results.timeline;

    // Step 1: Add weather data to timeline
    const timelineWithWeather = React.useMemo(() => {
        if (!showWeather || !weatherData?.size) return timeline;
        return timeline.map(item => ({
            ...item,
            temperature: typeof item.timestamp === 'number' ? weatherData.get(item.timestamp) : undefined
        }));
    }, [timeline, weatherData, showWeather]);

    // Step 2: Calculate temp bounds
    const tempBoundsCelsius = useMemo(() => {
        if (!showWeather || !weatherData?.size) return null;
        const temps = timelineWithWeather
            .map(d => d.temperature)
            .filter((t): t is number => t !== undefined);
        if (temps.length === 0) return null;
        return { min: Math.min(...temps), max: Math.max(...temps) };
    }, [timelineWithWeather, showWeather, weatherData]);

    const tempBoundsDisplay = useMemo(() => {
        if (!tempBoundsCelsius) return null;
        if (temperatureUnit === 'F') {
            return {
                min: Math.floor(celsiusToFahrenheit(tempBoundsCelsius.min)),
                max: Math.ceil(celsiusToFahrenheit(tempBoundsCelsius.max))
            };
        }
        return { min: Math.floor(tempBoundsCelsius.min), max: Math.ceil(tempBoundsCelsius.max) };
    }, [tempBoundsCelsius, temperatureUnit]);

    // Reset temp filter when unit changes
    React.useEffect(() => {
        if (tempBoundsDisplay) {
            setTempFilter({ min: null, max: null });
            setUserHasSetTempFilter(false);
        }
    }, [temperatureUnit]);

    // Use DEBOUNCED values to determine if filter is active
    const isTempFilterActive = useMemo(() => {
        if (!userHasSetTempFilter) return false;
        if (!tempBoundsDisplay || debouncedTempMin === null || debouncedTempMax === null) return false;
        return debouncedTempMin > tempBoundsDisplay.min || debouncedTempMax < tempBoundsDisplay.max;
    }, [debouncedTempMin, debouncedTempMax, tempBoundsDisplay, userHasSetTempFilter]);

    // Step 3: Filter timeline by temperature using DEBOUNCED values
    const timelineFilteredByTemp = useMemo(() => {
        if (!isTempFilterActive || debouncedTempMin === null || debouncedTempMax === null) return timelineWithWeather;
        const filterMinC = temperatureUnit === 'F' ? fahrenheitToCelsius(debouncedTempMin) : debouncedTempMin;
        const filterMaxC = temperatureUnit === 'F' ? fahrenheitToCelsius(debouncedTempMax) : debouncedTempMax;
        return timelineWithWeather.filter(d => {
            if (d.temperature === undefined) return false;
            return d.temperature >= filterMinC && d.temperature <= filterMaxC;
        });
    }, [timelineWithWeather, debouncedTempMin, debouncedTempMax, temperatureUnit, isTempFilterActive]);

    // Step 4: Group temp-filtered timeline by category key
    const timelineFilteredByCategoryKey = React.useMemo(() => {
        const map = new Map<number, typeof timelineFilteredByTemp>();
        for (const item of timelineFilteredByTemp) {
            const key = item.categoryKey;
            if (key === undefined) continue;
            let arr = map.get(key);
            if (!arr) { arr = []; map.set(key, arr); }
            arr.push(item);
        }
        return map;
    }, [timelineFilteredByTemp]);

    // Step 5: Compute averages from temp-filtered timeline
    const computedAverages = React.useMemo(() => {
        return results.averages.map(avg => {
            const categoryItems = timelineFilteredByCategoryKey.get(avg.key) || [];
            const completeItems = (!viewRange?.start || !viewRange?.end)
                ? categoryItems
                : categoryItems.filter(item => isPeriodComplete(item, viewRange.start!, viewRange.end!));

            if (completeItems.length === 0) {
                return { ...avg, average: 0, avgCost: 0, count: 0, isIncomplete: true, temperature: undefined };
            }
            let sum = 0, costSum = 0, tempSum = 0, tempCount = 0;
            for (const item of completeItems) {
                sum += item.value;
                costSum += item.cost;
                if (item.temperature !== undefined) {
                    tempSum += item.temperature;
                    tempCount++;
                }
            }
            return {
                ...avg,
                average: Math.round(sum / completeItems.length),
                avgCost: Math.round(costSum / completeItems.length),
                count: completeItems.length,
                isIncomplete: false,
                temperature: tempCount > 0 ? tempSum / tempCount : undefined
            };
        });
    }, [results.averages, timelineFilteredByCategoryKey, viewRange]);

    // Step 6: Final chart data
    const chartData = React.useMemo(() => {
        return analysisView === 'averages' ? computedAverages : timelineFilteredByTemp;
    }, [analysisView, computedAverages, timelineFilteredByTemp]);

    const getTooltipData = useCallback((d: any): TooltipData | null => {
        const energyVal = analysisView === 'averages' ? d.average : d.value;
        const costVal = analysisView === 'averages' ? d.avgCost : d.cost;
        const periodName = groupBy === 'month' ? 'months' : groupBy === 'dayOfWeek' ? 'days' : 'hours';
        const isPartial = !!(analysisView === 'timeline' && viewRange?.start && viewRange?.end && !isPeriodComplete(d, viewRange.start, viewRange.end));
        const hasNoCompleteData = analysisView === 'averages' && (d.isIncomplete || d.count === 0);
        return {
            label: analysisView === 'averages' ? d.label : d.fullDate, energyValue: energyVal, costValue: costVal,
            temperature: d.temperature, count: d.count,
            countLabel: analysisView === 'averages' ? `${d.count} complete ${periodName} averaged` : `${d.count?.toLocaleString()} readings`,
            isPartial, noCompleteData: hasNoCompleteData, periodName
        };
    }, [analysisView, groupBy, viewRange]);

    const getDataKey = () => analysisView === 'averages' ? (metricMode === 'energy' ? 'average' : 'avgCost') : (metricMode === 'energy' ? 'value' : 'cost');

    const getBarColor = (entry: any): string => {
        if (analysisView === 'averages') return (entry.isIncomplete || entry.count === 0) ? '#334155' : chartColor;
        if (viewRange?.start && viewRange?.end && !isPeriodComplete(entry, viewRange.start, viewRange.end)) return incompleteColor;
        return chartColor;
    };

    const toggleDay = (day: number) => setFilters(prev => ({ ...prev, daysOfWeek: prev.daysOfWeek.includes(day) ? prev.daysOfWeek.filter(d => d !== day) : [...prev.daysOfWeek, day].sort() }));
    const toggleMonth = (month: number) => setFilters(prev => ({ ...prev, months: prev.months.includes(month) ? prev.months.filter(m => m !== month) : [...prev.months, month].sort() }));
    const setWeekdays = () => setFilters(prev => ({ ...prev, daysOfWeek: [1, 2, 3, 4, 5] }));
    const setWeekends = () => setFilters(prev => ({ ...prev, daysOfWeek: [0, 6] }));
    const clearDays = () => setFilters(prev => ({ ...prev, daysOfWeek: [] }));
    const clearMonths = () => setFilters(prev => ({ ...prev, months: [] }));

    const resetTempFilter = () => {
        setTempFilter({ min: null, max: null });
        setUserHasSetTempFilter(false);
    };

    const handleTempFilterChange = (min: number, max: number) => {
        // If user sets full range (or beyond), treat as "no filter" to track bounds
        // This prevents bounds expansion from creating unintended filters
        if (tempBoundsDisplay && min <= tempBoundsDisplay.min && max >= tempBoundsDisplay.max) {
            setTempFilter({ min: null, max: null });
            setUserHasSetTempFilter(false);
        } else {
            setTempFilter({ min, max });
            setUserHasSetTempFilter(true);
        }
    };

    // Include debouncing state in processing indicator
    const isFilterProcessing = isProcessing || isTempDebouncing;
    const hasActiveFilters = filters.daysOfWeek.length > 0 || filters.months.length > 0 || filters.hourStart > 0 || filters.hourEnd < 23 || isTempFilterActive;

    const incompletePeriods = React.useMemo(() => {
        if (analysisView !== 'timeline' || !viewRange?.start || !viewRange?.end) return 0;
        return timelineFilteredByTemp.filter(item => !isPeriodComplete(item, viewRange.start!, viewRange.end!)).length;
    }, [timelineFilteredByTemp, viewRange, analysisView]);

    const tempDomain = React.useMemo(() => {
        if (!showWeather || !weatherData?.size) return [0, 40];
        const temps = Array.from(weatherData.values());
        const min = Math.min(...temps), max = Math.max(...temps);
        const padding = (max - min) * 0.1 || 5;
        return [Math.floor(min - padding), Math.ceil(max + padding)];
    }, [weatherData, showWeather]);

    const tempAxisFormatter = (val: number) => temperatureUnit === 'F' ? `${Math.round(val * 9 / 5 + 32)}°` : `${Math.round(val)}°`;

    return (
        <div className="flex flex-col h-full">
            <div className="h-64 sm:h-80 flex-shrink-0 p-4 relative" ref={chartContainerRef}>
                {isFilterProcessing && (
                    <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center z-10">
                        <div className="flex items-center gap-3 bg-slate-800 px-4 py-3 rounded-lg border border-slate-700">
                            <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                            <span className="text-slate-300 text-sm">Processing...</span>
                        </div>
                    </div>
                )}
                {!isFilterProcessing && chartData.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                        <span className="text-sm">No data matches the current filters</span>
                        {isTempFilterActive && (
                            <button onClick={resetTempFilter} className="text-xs text-sky-400 hover:text-sky-300 transition-colors">Reset temperature filter</button>
                        )}
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }} onClick={handleChartClick}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                            <XAxis dataKey={analysisView === 'averages' ? "label" : "fullDate"} stroke="#94a3b8" fontSize={10} tickLine={analysisView === 'timeline'} axisLine={false} minTickGap={40} />
                            <YAxis yAxisId="primary" stroke="#94a3b8" fontSize={10} tickLine={true} axisLine={false} tickFormatter={yAxisFormatter} width={50} domain={analysisDomain} />
                            {showWeather && weatherData?.size && (
                                <YAxis yAxisId="temperature" orientation="right" stroke="#38bdf8" fontSize={10} tickLine={true} axisLine={false} tickFormatter={tempAxisFormatter} domain={tempDomain} width={20} />
                            )}
                            <Tooltip content={(props) => (<ChartTooltip {...props} isTouchDevice={isTouchDevice} activeIndex={activeIndex} tooltipRef={tooltipRef} metricMode={metricMode} energyUnit={energyUnit} showWeather={showWeather} temperatureUnit={temperatureUnit} getTooltipData={getTooltipData} />)} {...(isTouchDevice ? { active: activeIndex !== null } : {})} />
                            <Bar yAxisId="primary" dataKey={getDataKey()} fill={chartColor} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={getBarColor(entry)} />)}
                            </Bar>
                            {showWeather && weatherData?.size && (
                                <Line yAxisId="temperature" type="monotone" dataKey="temperature" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                )}
            </div>

            <div className="flex-1 border-t border-slate-800 p-4 space-y-5 overflow-y-auto">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/50">
                            {(['hour', 'dayOfWeek', 'month'] as const).map(g => (
                                <button key={g} onClick={() => setGroupBy(g)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${groupBy === g ? 'bg-slate-700 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
                                    {g === 'hour' ? 'Hour' : g === 'dayOfWeek' ? 'Day' : 'Month'}
                                </button>
                            ))}
                        </div>
                        <div className="hidden sm:block w-px h-5 bg-slate-700/50" />
                        <div className="flex bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/50">
                            <button onClick={() => setAnalysisView('timeline')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${analysisView === 'timeline' ? 'bg-slate-700 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>Timeline</button>
                            <button onClick={() => setAnalysisView('averages')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${analysisView === 'averages' ? 'bg-slate-700 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>Avg</button>
                        </div>
                        <div className="flex-1 min-w-0" />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 px-0.5">
                        <span>{isFilterProcessing ? (<span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin text-emerald-400" />Processing...</span>) : (<>{results.filtered.length.toLocaleString()} readings{hasActiveFilters && <span className="text-slate-600"> (filtered)</span>}</>)}</span>
                        {!isFilterProcessing && analysisView === 'timeline' && (
                            <span className="text-slate-600">{chartData.length} {groupBy === 'month' ? 'months' : groupBy === 'dayOfWeek' ? 'days' : 'hours'}{incompletePeriods > 0 && (<span className="text-amber-500/70"> · {incompletePeriods} partial</span>)}</span>
                        )}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">Filter Data</div>

                    {showWeather && tempBoundsDisplay && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-slate-400 text-xs font-medium"><Thermometer className="w-3.5 h-3.5" /><span>Temperature</span></div>
                                {isTempFilterActive && (<button onClick={resetTempFilter} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Reset</button>)}
                            </div>
                            <TempRangeSlider min={tempBoundsDisplay.min} max={tempBoundsDisplay.max} valueMin={tempFilter.min ?? tempBoundsDisplay.min} valueMax={tempFilter.max ?? tempBoundsDisplay.max} onChange={handleTempFilterChange} unit={temperatureUnit} />
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-slate-400 text-xs font-medium"><CalendarDays className="w-3.5 h-3.5" /><span>Days of Week</span></div>
                            <div className="flex items-center gap-2">
                                <button onClick={setWeekdays} className="text-xs text-emerald-400/80 hover:text-emerald-400 transition-colors">Weekdays</button>
                                <span className="text-slate-700">·</span>
                                <button onClick={setWeekends} className="text-xs text-emerald-400/80 hover:text-emerald-400 transition-colors">Weekends</button>
                                {filters.daysOfWeek.length > 0 && (<><span className="text-slate-700">·</span><button onClick={clearDays} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Clear</button></>)}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">{DAYS_OF_WEEK.map((day, i) => (<FilterChip key={day} label={day} selected={filters.daysOfWeek.includes(i)} onClick={() => toggleDay(i)} />))}</div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-slate-400 text-xs font-medium"><Calendar className="w-3.5 h-3.5" /><span>Months</span></div>
                            {filters.months.length > 0 && (<button onClick={clearMonths} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Clear</button>)}
                        </div>
                        <div className="flex flex-wrap gap-1.5">{MONTHS.map((month, i) => (<FilterChip key={month} label={month} selected={filters.months.includes(i)} onClick={() => toggleMonth(i)} />))}</div>
                    </div>

                    <div className="space-y-2 mb-6"><HourRangeFilter hourStart={filters.hourStart} hourEnd={filters.hourEnd} onChange={(start, end) => setFilters(prev => ({ ...prev, hourStart: start, hourEnd: end }))} /></div>
                </div>
            </div>
        </div>
    );
});