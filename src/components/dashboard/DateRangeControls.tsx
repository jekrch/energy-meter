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
    /** Returns false when the value was refused (it would invert the range). */
    onViewChange: (field: 'start' | 'end', value: string) => boolean;
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

    // A picked value that would put start at or after end, held unapplied.
    // Chrome's picker commits on every month step, so walking the end date back
    // past the start passes through such values; showing them here (flagged)
    // lets the walk continue to a valid date. Tied to the range it was refused
    // against, so any change to the range (brush, pan, reset) drops it.
    const [refused, setRefused] = useState<{ field: 'start' | 'end'; value: string; against: TimeRange } | null>(null);
    const draft = refused && refused.against === viewRange ? refused : null;

    const handleInput = (field: 'start' | 'end', value: string) => {
        // An empty value is a half-edited field, not a date to apply or hold.
        if (!value) return;
        setRefused(onViewChange(field, value) ? null : { field, value, against: viewRange });
    };

    const inputValue = (field: 'start' | 'end') => {
        if (previewRange) return formatDateTimeLocal(previewRange[field]);
        if (draft?.field === field) return draft.value;
        return formatDateTimeLocal(viewRange[field]);
    };

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
                                value={inputValue(field)}
                                onChange={(e) => handleInput(field, e.target.value)}
                                aria-invalid={draft?.field === field || undefined}
                                aria-describedby={draft?.field === field ? 'date-range-error' : undefined}
                                className={`appearance-none w-full max-w-full block m-0 min-w-0 bg-sunken border rounded-md px-3 pr-10 text-sm text-slate-200 focus:outline-none focus:ring-2 transition-colors shadow-inner box-border h-11 leading-[2.75rem] ${draft?.field === field
                                    ? 'border-red-500/60 focus:ring-red-500/20 focus:border-red-500'
                                    : 'border-line focus:ring-emerald-500/20 focus:border-emerald-500'}`}
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

            {draft && (
                <p id="date-range-error" role="status" className="-mt-1 text-[11px] text-red-400">
                    {draft.field === 'end' ? 'End must be after start' : 'Start must be before end'} — not applied yet.
                </p>
            )}

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