import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import {
    Calendar, Clock, CalendarDays, Maximize2, Minimize2, Loader2
} from 'lucide-react';

import { formatAxisValue } from '../../utils/formatters';
import { FilterChip } from '../common/FilterChip';
import { DAYS_OF_WEEK, MONTHS, type AnalysisFilters, type DataPoint } from '../../types';

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
}

export const AnalysisPanel = React.memo(function AnalysisPanel({
    filters, setFilters, groupBy, setGroupBy, analysisView, setAnalysisView,
    results, isProcessing, autoZoom, setAutoZoom, analysisDomain
}: AnalysisPanelProps) {

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
    const resetHours = () => setFilters(prev => ({ ...prev, hourStart: 0, hourEnd: 23 }));

    const hasActiveFilters = filters.daysOfWeek.length > 0 || filters.months.length > 0 || filters.hourStart > 0 || filters.hourEnd < 23;

    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden">
            {/* Controls Header */}
            <div className="p-4 border-b border-slate-800 space-y-4 overflow-auto">

                {/* Day Filters */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-400 text-xs font-medium w-16 flex items-center gap-1"><CalendarDays className="w-3 h-3" />Days:</span>
                    {DAYS_OF_WEEK.map((day, i) => (
                        <FilterChip key={day} label={day} selected={filters.daysOfWeek.includes(i)} onClick={() => toggleDay(i)} />
                    ))}
                    <span className="text-slate-600 mx-1">|</span>
                    <button onClick={setWeekdays} className="text-xs text-emerald-400 hover:text-emerald-300">Weekdays</button>
                    <button onClick={setWeekends} className="text-xs text-emerald-400 hover:text-emerald-300">Weekends</button>
                    {filters.daysOfWeek.length > 0 && <button onClick={clearDays} className="text-xs text-slate-500 hover:text-slate-300">Clear</button>}
                </div>

                {/* Month Filters */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-400 text-xs font-medium w-16 flex items-center gap-1"><Calendar className="w-3 h-3" />Months:</span>
                    {MONTHS.map((month, i) => (
                        <FilterChip key={month} label={month} selected={filters.months.includes(i)} onClick={() => toggleMonth(i)} />
                    ))}
                    {filters.months.length > 0 && <button onClick={clearMonths} className="text-xs text-slate-500 hover:text-slate-300 ml-2">Clear</button>}
                </div>

                {/* Hour Filters */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-400 text-xs font-medium w-16 flex items-center gap-1"><Clock className="w-3 h-3" />Hours:</span>
                    <input
                        type="range" min={0} max={23} value={filters.hourStart}
                        onChange={e => setFilters(prev => ({ ...prev, hourStart: Math.min(parseInt(e.target.value), prev.hourEnd) }))}
                        className="w-20 accent-emerald-500"
                    />
                    <span className="text-slate-300 text-xs font-mono w-12">{filters.hourStart}:00</span>
                    <span className="text-slate-500">to</span>
                    <input
                        type="range" min={0} max={23} value={filters.hourEnd}
                        onChange={e => setFilters(prev => ({ ...prev, hourEnd: Math.max(parseInt(e.target.value), prev.hourStart) }))}
                        className="w-20 accent-emerald-500"
                    />
                    <span className="text-slate-300 text-xs font-mono w-12">{filters.hourEnd}:00</span>
                    {(filters.hourStart > 0 || filters.hourEnd < 23) && <button onClick={resetHours} className="text-xs text-slate-500 hover:text-slate-300">Reset</button>}
                </div>

                {/* View Controls */}
                <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-800">
                    <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-xs font-medium">Group by:</span>
                        <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700/50">
                            {(['hour', 'dayOfWeek', 'month'] as const).map(g => (
                                <button key={g} onClick={() => setGroupBy(g)} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${groupBy === g ? 'bg-slate-700 text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}>
                                    {g === 'hour' ? 'Hour' : g === 'dayOfWeek' ? 'Day' : 'Month'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-xs font-medium">View:</span>
                        <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700/50">
                            <button onClick={() => setAnalysisView('averages')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${analysisView === 'averages' ? 'bg-slate-700 text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}>Averages</button>
                            <button onClick={() => setAnalysisView('timeline')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${analysisView === 'timeline' ? 'bg-slate-700 text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}>Timeline</button>
                        </div>
                    </div>
                    <button
                        onClick={() => setAutoZoom(prev => !prev)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all border border-transparent ${autoZoom ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800/50' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
                    >
                        {autoZoom ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                        {autoZoom ? 'Fit: Auto' : 'Fit: Global'}
                    </button>

                    <span className="text-slate-500 text-xs ml-auto flex items-center gap-2">
                        {isProcessing ? (
                            <><Loader2 className="w-3 h-3 animate-spin text-emerald-400" />Processing...</>
                        ) : (
                            <>
                                {results.filtered.length.toLocaleString()} readings {hasActiveFilters && ' filtered'}
                                {analysisView === 'timeline' && ` → ${results.timeline.length} ${groupBy === 'month' ? 'months' : groupBy === 'dayOfWeek' ? 'days' : 'hours'}`}
                            </>
                        )}
                    </span>
                </div>
            </div>

            {/* Chart Area */}
            <div className="flex-1 p-4 relative">
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
                            data={analysisView === 'averages' ? results.averages : results.timeline}
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
                                axisLine={false} tickFormatter={formatAxisValue} width={45} domain={analysisDomain}
                            />
                            <Tooltip content={({ active, payload }) => {
                                if (active && payload?.length) {
                                    const d = payload[0].payload;
                                    return (
                                        <div className="bg-slate-800 p-3 shadow-xl border border-slate-700 rounded-lg">
                                            <p className="text-slate-400 text-xs font-semibold mb-1">{analysisView === 'averages' ? d.label : d.fullDate}</p>
                                            <p className="text-emerald-400 font-bold text-lg">{analysisView === 'averages' ? d.average.toLocaleString() : d.value.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Wh avg</span></p>
                                            <p className="text-xs text-slate-500 mt-1">{d.count.toLocaleString()} readings</p>
                                        </div>
                                    );
                                }
                                return null;
                            }} />
                            <Bar
                                dataKey={analysisView === 'averages' ? "average" : "value"}
                                fill="#10b981"
                                radius={[4, 4, 0, 0]}
                                isAnimationActive={false}
                            >
                                {analysisView === 'averages' && results.averages.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.count > 0 ? '#10b981' : '#334155'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
});