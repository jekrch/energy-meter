import React from 'react';
import { Calendar, ZoomOut, CalendarDays } from 'lucide-react';
import type { TimeRange } from '../../types';
import { formatDateTimeLocal } from '../../utils/formatters';

interface DateRangeControlsProps {
    viewRange: TimeRange;
    isZoomed: boolean;
    onViewChange: (field: 'start' | 'end', value: string) => void;
    onZoomOut: () => void;
}

export const DateRangeControls = React.memo(function DateRangeControls({
    viewRange, isZoomed, onViewChange, onZoomOut
}: DateRangeControlsProps) {
    return (
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-3 sm:p-4 flex flex-col gap-3 shadow-sm hover:border-slate-700 transition-colors min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/50 pb-2">
                <span className="text-slate-400 text-xs font-bold uppercase tracking-wider flex items-center gap-2 whitespace-nowrap h-8">
                    <Calendar className="w-4 h-4 text-slate-500 shrink-0" /> Date Range
                </span>
                {isZoomed && (
                    <button 
                        onClick={onZoomOut} 
                        className="group flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2.5 py-1 rounded-md border border-slate-700 transition-all shrink-0"
                    >
                        <ZoomOut className="w-3.5 h-3.5 group-hover:scale-90 transition-transform" /> Reset
                    </button>
                )}
            </div>
            
            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-10">
                {(['start', 'end'] as const).map(field => (
                    <div key={field} className="relative group w-full min-w-0">
                        <label className="absolute -top-2 left-2 px-1 bg-slate-900 text-[10px] text-slate-500 font-medium group-focus-within:text-emerald-500 transition-colors capitalize z-10">
                            {field}
                        </label>
                        <div className="w-full overflow-hidden rounded-lg relative">
                            <input
                                id={`date-${field}`}
                                type="datetime-local"
                                style={{ colorScheme: 'dark' }}
                                value={formatDateTimeLocal(viewRange[field])}
                                onChange={(e) => onViewChange(field, e.target.value)}
                                className="appearance-none w-full max-w-full block m-0 min-w-0 bg-slate-950/50 border border-slate-700/50 rounded-lg px-3 py-2 pr-10 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-inner box-border h-11"
                            />
                            <CalendarDays 
                                className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 hover:text-slate-300 cursor-pointer transition-colors" 
                                onClick={() => {
                                    const input = document.getElementById(`date-${field}`) as HTMLInputElement;
                                    input?.showPicker?.();
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});