import React from 'react';
import { Calendar, ZoomOut, ZoomIn } from 'lucide-react';
import type { TimeRange } from '../../types';
import { formatDateTimeLocal } from '../../utils/formatters';

interface DateRangeControlsProps {
    viewRange: TimeRange;
    selection: TimeRange;
    isZoomed: boolean;
    isSelectionSubset: boolean;
    onViewChange: (field: 'start' | 'end', value: string) => void;
    onSelectionChange: (field: 'start' | 'end', value: string) => void;
    onZoomOut: () => void;
    onZoomToSelection: () => void;
    onResetSelection: () => void;
}

export const DateRangeControls = React.memo(function DateRangeControls({
    viewRange, selection, isZoomed, isSelectionSubset,
    onViewChange, onSelectionChange, onZoomOut, onZoomToSelection, onResetSelection
}: DateRangeControlsProps) {
    
    // Shared class for the input grid to ensure consistent responsive behavior
    // 1 col on mobile, 2 cols on tablet, back to 1 col when layout splits (lg), back to 2 cols on wide screens (xl)
    const adaptiveGridClass = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3 relative z-10";

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">

            {/* View Range */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-3 sm:p-4 flex flex-col gap-3 shadow-sm hover:border-slate-700 transition-colors min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/50 pb-2">
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-wider flex items-center gap-2 whitespace-nowrap">
                        <Calendar className="w-4 h-4 text-slate-500 shrink-0" /> View Range
                    </span>
                    {isZoomed && (
                        <button onClick={onZoomOut} className="group flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2.5 py-1 rounded-md border border-slate-700 transition-all shrink-0">
                            <ZoomOut className="w-3.5 h-3.5 group-hover:scale-90 transition-transform" /> Reset
                        </button>
                    )}
                </div>
                
                <div className={adaptiveGridClass}>
                    {['start', 'end'].map(field => (
                        <div key={field} className="relative group">
                            <label className="absolute -top-2 left-2 px-1 bg-slate-900 text-[10px] text-slate-500 font-medium group-focus-within:text-emerald-500 transition-colors capitalize z-10">
                                {field}
                            </label>
                            <input
                                type="datetime-local"
                                style={{ colorScheme: 'dark' }}
                                value={formatDateTimeLocal(viewRange[field as 'start' | 'end'])}
                                onChange={(e) => onViewChange(field as 'start' | 'end', e.target.value)}
                                className="w-full min-w-0 bg-slate-950/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-inner"
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Selection Range */}
            <div className="bg-emerald-950/20 rounded-xl border border-emerald-900/50 p-3 sm:p-4 flex flex-col gap-3 shadow-sm relative overflow-hidden group/panel min-w-0">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-3xl rounded-full -mr-10 -mt-10 pointer-events-none"></div>
                
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-900/30 pb-2 relative z-10">
                    <span className="text-emerald-500/80 text-xs font-bold uppercase tracking-wider flex items-center gap-2 whitespace-nowrap">
                        <ZoomIn className="w-4 h-4 shrink-0" /> Selection
                    </span>
                    
                    <div className="flex items-center gap-2 shrink-0">
                        {isSelectionSubset && (
                            <>
                                <button onClick={onResetSelection} className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 transition-colors">
                                    Clear
                                </button>
                                <button onClick={onZoomToSelection} className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-md shadow-lg shadow-emerald-900/20 transition-all hover:shadow-emerald-900/40">
                                    <ZoomIn className="w-3.5 h-3.5" /> Zoom
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div className={adaptiveGridClass}>
                    {['start', 'end'].map(field => (
                        <div key={field} className="relative group">
                            
                            <label className="absolute -top-2 left-2 px-1 bg-slate-950/80 backdrop-blur text-[10px] text-emerald-600/70 font-medium group-focus-within:text-emerald-400 transition-colors capitalize z-10">
                                {field}
                            </label>
                            <input
                                type="datetime-local"
                                style={{ colorScheme: 'dark' }}
                                value={formatDateTimeLocal(selection[field as 'start' | 'end'])}
                                onChange={(e) => onSelectionChange(field as 'start' | 'end', e.target.value)}
                                className="w-full min-w-0 bg-slate-950/50 border border-emerald-900/50 rounded-lg px-3 py-2 text-sm text-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/80 transition-all shadow-inner"
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});