import React, { useCallback } from 'react';
import { Calendar, ZoomOut, CalendarDays } from 'lucide-react';
import type { TimeRange } from '../../types';
import { formatDateTimeLocal } from '../../utils/formatters';
import { RangeBrush, type BrushDataPoint } from '../common/RangeBrush';

interface DateRangeControlsProps {
    viewRange: TimeRange;
    dataBounds: TimeRange;
    brushData: BrushDataPoint[];
    isZoomed: boolean;
    onViewChange: (field: 'start' | 'end', value: string) => void;
    onZoomOut: () => void;
    onBrushChange: (range: { start: number; end: number }) => void;
}

export const DateRangeControls = React.memo(function DateRangeControls({
    viewRange, dataBounds, brushData, isZoomed, onViewChange, onZoomOut, onBrushChange
}: DateRangeControlsProps) {

    const handleBrushChange = useCallback((start: number, end: number) => {
        onBrushChange({ start, end });
    }, [onBrushChange]);

    return (
        <div className="bg-surface rounded-2xl border border-line p-3 sm:p-4 flex flex-col gap-3 hover:border-line-2 transition-colors min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-header-line pb-2">
                <span className="text-slate-400 text-xs font-bold uppercase tracking-wider flex items-center gap-2 whitespace-nowrap h-8">
                    <Calendar className="w-4 h-4 text-slate-500 shrink-0" /> Date Range
                </span>
                {isZoomed && (
                    <button
                        onClick={onZoomOut}
                        className="group flex items-center gap-1.5 text-xs bg-surface-2 hover:bg-white/5 text-slate-300 hover:text-white px-2.5 py-1 rounded-md border border-line-2 transition-colors shrink-0"
                    >
                        <ZoomOut className="w-3.5 h-3.5 group-hover:scale-90 transition-transform" /> Reset
                    </button>
                )}
            </div>

            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-10">
                {(['start', 'end'] as const).map(field => (
                    <div key={field} className="relative group w-full min-w-0">
                        <label className="absolute -top-2 left-2 px-1 bg-surface text-[10px] text-slate-500 font-medium group-focus-within:text-emerald-500 transition-colors capitalize z-10">
                            {field}
                        </label>
                        <div className="w-full overflow-hidden rounded-md relative">
                            <input
                                id={`date-${field}`}
                                type="datetime-local"
                                style={{ colorScheme: 'dark' }}
                                value={formatDateTimeLocal(viewRange[field])}
                                onChange={(e) => onViewChange(field, e.target.value)}
                                className="appearance-none w-full max-w-full block m-0 min-w-0 bg-sunken border border-line rounded-md px-3 pr-10 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors shadow-inner box-border h-11 leading-[2.75rem]"
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

            {/* Range Brush */}
            {brushData.length > 0 && (
                <div className="pt-1 pb-5">
                    <RangeBrush
                        data={brushData}
                        viewStart={viewRange.start}
                        viewEnd={viewRange.end}
                        boundsStart={dataBounds.start}
                        boundsEnd={dataBounds.end}
                        onRangeChange={handleBrushChange}
                    />
                </div>
            )}
        </div>
    );
});