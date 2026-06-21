import React, { useCallback, useState } from 'react';
import { Calendar, ZoomOut, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
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
    onPan: (direction: 1 | -1) => void;
}

export const DateRangeControls = React.memo(function DateRangeControls({
    viewRange, dataBounds, brushData, isZoomed, onViewChange, onZoomOut, onBrushChange, onPan
}: DateRangeControlsProps) {

    const canPanBack = viewRange.start !== null && dataBounds.start !== null && viewRange.start > dataBounds.start;
    const canPanForward = viewRange.end !== null && dataBounds.end !== null && viewRange.end < dataBounds.end;

    // Live timestamps shown in the date inputs while dragging the brush.
    // Kept local so the inputs track the drag without triggering filtering.
    const [previewRange, setPreviewRange] = useState<{ start: number; end: number } | null>(null);

    const handleBrushPreview = useCallback((start: number, end: number) => {
        setPreviewRange({ start, end });
    }, []);

    const handleBrushChange = useCallback((start: number, end: number) => {
        setPreviewRange(null);
        onBrushChange({ start, end });
    }, [onBrushChange]);

    const displayRange = previewRange ?? viewRange;

    return (
        <div className="bg-surface-2 rounded-2xl border border-line p-3 sm:p-4 flex flex-col gap-3 hover:border-white/30 transition-colors duration-150 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-header-line pb-2">
                <span className="text-slate-400 text-xs font-bold uppercase tracking-wider flex items-center gap-2 whitespace-nowrap h-8">
                    <Calendar className="w-4 h-4 text-slate-500 shrink-0" /> Date Range
                </span>
                <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => onPan(-1)}
                            disabled={!canPanBack}
                            aria-label="Move range backward"
                            title="Move range backward"
                            className="group flex items-center justify-center text-xs bg-surface-2 hover:bg-white/5 text-slate-300 hover:text-white h-7 w-7 rounded-md border border-line-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-surface-2 disabled:hover:text-slate-300"
                        >
                            <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                        </button>
                        <button
                            onClick={() => onPan(1)}
                            disabled={!canPanForward}
                            aria-label="Move range forward"
                            title="Move range forward"
                            className="group flex items-center justify-center text-xs bg-surface-2 hover:bg-white/5 text-slate-300 hover:text-white h-7 w-7 rounded-md border border-line-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-surface-2 disabled:hover:text-slate-300"
                        >
                            <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                        </button>
                    </div>
                    {isZoomed && (
                        <button
                            onClick={onZoomOut}
                            className="group flex items-center gap-1.5 text-xs bg-surface-2 hover:bg-white/5 text-slate-300 hover:text-white px-2.5 py-1 rounded-md border border-line-2 transition-colors shrink-0"
                        >
                            <ZoomOut className="w-3.5 h-3.5 group-hover:scale-90 transition-transform" /> Reset
                        </button>
                    )}
                </div>
            </div>

            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-10">
                {(['start', 'end'] as const).map(field => (
                    <div key={field} className="relative group w-full min-w-0">
                        <label className="absolute -top-2 left-2 px-1 bg-surface-2 text-[10px] text-slate-500 font-medium group-focus-within:text-emerald-500 transition-colors capitalize z-10">
                            {field}
                        </label>
                        <div className="w-full overflow-hidden rounded-md relative">
                            <input
                                id={`date-${field}`}
                                type="datetime-local"
                                style={{ colorScheme: 'dark' }}
                                value={formatDateTimeLocal(displayRange[field])}
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
                        onRangePreview={handleBrushPreview}
                    />
                </div>
            )}
        </div>
    );
});