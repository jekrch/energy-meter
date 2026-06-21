import React, { useState, useCallback, useRef } from 'react';
import { Clock, Sun, Moon, Sunrise, Sunset, Plus, X } from 'lucide-react';
import { type HourRange, isHourInRange, isHourFilterActive } from '../../types';

interface HourRangeFilterProps {
  ranges: HourRange[];
  onChange: (ranges: HourRange[]) => void;
}

// How many independent windows the user can stack
const MAX_RANGES = 2;
const FULL_DAY: HourRange = { start: 0, end: 23 };

type DragType = 'start' | 'end' | 'range' | 'track' | null;

interface DragValues {
  start: number;
  end: number;
}

const formatHour = (h: number): string => {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  if (h < 12) return `${h}a`;
  return `${h - 12}p`;
};

const formatHourFull = (h: number): string => {
  if (h === 0) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
};

const presets = [
  { label: 'Morning', icon: Sunrise, start: 6, end: 11 },
  { label: 'Afternoon', icon: Sun, start: 12, end: 17 },
  { label: 'Evening', icon: Sunset, start: 18, end: 21 },
  { label: 'Night', icon: Moon, start: 22, end: 5 },
] as const;

// Shortest distance between two hours around the 24h clock
const cyclicDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b);
  return Math.min(d, 24 - d);
};

interface RangeSliderProps {
  range: HourRange;
  onChange: (range: HourRange) => void;
}

// A single editable hour window: slider with two handles plus the hour-block
// strip. Supports windows that wrap past midnight (start > end).
function RangeSlider({ range, onChange }: RangeSliderProps) {
  // Local state for live dragging - only commits on release
  const [localStart, setLocalStart] = useState(range.start);
  const [localEnd, setLocalEnd] = useState(range.end);
  const [isDragging, setIsDragging] = useState<DragType>(null);
  const [dragStartPos, setDragStartPos] = useState<number | null>(null);
  const [dragStartValues, setDragStartValues] = useState<DragValues | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Sync local state when props change (e.g., preset applied / external reset)
  React.useEffect(() => {
    if (!isDragging) {
      setLocalStart(range.start);
      setLocalEnd(range.end);
    }
  }, [range.start, range.end, isDragging]);

  const isWrapped = localStart > localEnd;
  const startPct = (localStart / 23) * 100;
  const endPct = (localEnd / 23) * 100;

  // The active range may be one bar, or two bars when it wraps past midnight
  const segments = isWrapped
    ? [
        { left: startPct, width: 100 - startPct },
        { left: 0, width: endPct },
      ]
    : [{ left: startPct, width: endPct - startPct }];

  const getHourFromPosition = useCallback((clientX: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    return Math.round(pct * 23);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, type: DragType) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsDragging(type);
    setDragStartPos(e.clientX);
    setDragStartValues({ start: localStart, end: localEnd });

    if (type === 'track') {
      // Move whichever handle is closer (around the clock) to the click
      const hour = getHourFromPosition(e.clientX);
      if (cyclicDistance(hour, localStart) <= cyclicDistance(hour, localEnd)) {
        setLocalStart(hour);
      } else {
        setLocalEnd(hour);
      }
    }
  }, [localStart, localEnd, getHourFromPosition]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging || !dragStartValues || dragStartPos === null) return;

    const hour = getHourFromPosition(e.clientX);

    if (isDragging === 'start') {
      // No clamping against end - crossing it simply wraps past midnight
      setLocalStart(hour);
    } else if (isDragging === 'end') {
      setLocalEnd(hour);
    } else if (isDragging === 'range') {
      // Shift both handles around the 24h clock, preserving the span
      const delta = hour - getHourFromPosition(dragStartPos);
      const newStart = ((dragStartValues.start + delta) % 24 + 24) % 24;
      const newEnd = ((dragStartValues.end + delta) % 24 + 24) % 24;
      setLocalStart(newStart);
      setLocalEnd(newEnd);
    }
  }, [isDragging, dragStartPos, dragStartValues, getHourFromPosition]);

  const handlePointerUp = useCallback(() => {
    // Commit changes only on release
    if (isDragging && (localStart !== range.start || localEnd !== range.end)) {
      onChange({ start: localStart, end: localEnd });
    }
    setIsDragging(null);
    setDragStartPos(null);
    setDragStartValues(null);
  }, [isDragging, localStart, localEnd, range.start, range.end, onChange]);

  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
    }
  }, [isDragging, handlePointerMove, handlePointerUp]);

  return (
    <>
      {/* Range Slider */}
      <div className="relative pt-1 pb-5 touch-none select-none overflow-hidden">
        <div
          ref={trackRef}
          className="relative h-8 mx-2 flex items-center cursor-pointer"
          onPointerDown={(e) => handlePointerDown(e, 'track')}
        >
          {/* Background track */}
          <div className="absolute inset-x-0 h-2 bg-sunken rounded-full" />

          {/* Active range bar - one segment, or two when wrapping past midnight */}
          {segments.map((seg, i) => (
            <div
              key={i}
              className={`absolute h-2 transition-colors ${
                isWrapped ? '' : 'rounded-full'
              } ${
                isDragging === 'range' ? 'bg-emerald-400' : 'bg-emerald-500/70'
              } cursor-grab active:cursor-grabbing`}
              style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                handlePointerDown(e, 'range');
              }}
            />
          ))}

          {/* Start handle - large hit area with small visible circle */}
          <div
            className={`absolute w-10 h-10 flex items-center justify-center cursor-grab ${
              isDragging === 'start' ? 'cursor-grabbing' : ''
            }`}
            style={{ left: `${startPct}%`, transform: 'translateX(-50%)' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              handlePointerDown(e, 'start');
            }}
          >
            <div className={`w-4 h-4 rounded-full bg-white shadow-lg border-2 transition-transform ${
              isDragging === 'start' ? 'border-emerald-400 scale-125' : 'border-emerald-500'
            }`} />
          </div>

          {/* End handle - large hit area with small visible circle */}
          <div
            className={`absolute w-10 h-10 flex items-center justify-center cursor-grab ${
              isDragging === 'end' ? 'cursor-grabbing' : ''
            }`}
            style={{ left: `${endPct}%`, transform: 'translateX(-50%)' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              handlePointerDown(e, 'end');
            }}
          >
            <div className={`w-4 h-4 rounded-full bg-white shadow-lg border-2 transition-transform ${
              isDragging === 'end' ? 'border-emerald-400 scale-125' : 'border-emerald-500'
            }`} />
          </div>
        </div>

        {/* Hour tick labels */}
        <div className="absolute left-0 right-0 bottom-0 flex justify-between">
          {[0, 6, 12, 18, 23].map((h) => (
            <span
              key={h}
              className={`text-xs transition-colors ${
                isHourInRange(h, localStart, localEnd) ? 'text-slate-400' : 'text-slate-600'
              }`}
            >
              {formatHour(h)}
            </span>
          ))}
        </div>
      </div>

      {/* Visual hour blocks */}
      <div className="flex gap-px">
        {Array.from({ length: 24 }, (_, h) => {
          const inRange = isHourInRange(h, localStart, localEnd);
          return (
            <button
              key={h}
              onClick={() => {
                // Move whichever endpoint is closer (around the clock) to the
                // clicked hour - this naturally extends or shrinks the range,
                // and lets it wrap past midnight.
                let newStart = localStart;
                let newEnd = localEnd;
                if (cyclicDistance(h, localStart) <= cyclicDistance(h, localEnd)) {
                  newStart = h;
                } else {
                  newEnd = h;
                }

                setLocalStart(newStart);
                setLocalEnd(newEnd);
                onChange({ start: newStart, end: newEnd });
              }}
              className={`flex-1 h-5 rounded-sm transition-colors ${
                inRange
                  ? 'bg-emerald-500/40 hover:bg-emerald-500/60'
                  : 'bg-sunken hover:bg-white/5'
              }`}
              title={formatHourFull(h)}
            />
          );
        })}
      </div>
    </>
  );
}

export function HourRangeFilter({ ranges, onChange }: HourRangeFilterProps) {
  // Always render at least one window so there is something to edit
  const effectiveRanges = ranges.length > 0 ? ranges : [FULL_DAY];
  const isFiltered = isHourFilterActive(effectiveRanges);

  const updateRange = (index: number, next: HourRange) => {
    onChange(effectiveRanges.map((r, i) => (i === index ? next : r)));
  };

  // Presets replace everything with a single window
  const applyPreset = (start: number, end: number) => onChange([{ start, end }]);

  const reset = () => onChange([{ ...FULL_DAY }]);

  const addRange = () => onChange([...effectiveRanges, { start: 18, end: 21 }]);

  const removeRange = (index: number) => {
    const next = effectiveRanges.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [{ ...FULL_DAY }]);
  };

  const isPresetActive = (start: number, end: number) =>
    effectiveRanges.length === 1 &&
    effectiveRanges[0].start === start &&
    effectiveRanges[0].end === end;

  const summary = isFiltered
    ? effectiveRanges
        .map((r) => `${formatHourFull(r.start)} – ${formatHourFull(r.end)}`)
        .join(', ')
    : 'All day';

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-300">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-sm font-medium">Hours</span>
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs font-medium truncate ${isFiltered ? 'text-emerald-400' : 'text-slate-500'}`}>
            {summary}
          </span>
          {isFiltered && (
            <button
              onClick={reset}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors shrink-0"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Quick Presets */}
      <div className="flex gap-1.5">
        {presets.map(({ label, icon: Icon, start, end }) => {
          const isActive = isPresetActive(start, end);
          return (
            <button
              key={label}
              onClick={() => applyPreset(start, end)}
              className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                  : 'bg-sunken text-slate-400 hover:bg-white/5 hover:text-slate-300'
              }`}
            >
              <Icon className="w-3 h-3" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>

      {/* One editor per window */}
      {effectiveRanges.map((range, i) => (
        <div
          key={i}
          className={i > 0 ? 'pt-2 border-t border-white/5' : ''}
        >
          {effectiveRanges.length > 1 && (
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500">Range {i + 1}</span>
              <button
                onClick={() => removeRange(i)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                title="Remove this range"
              >
                <X className="w-3 h-3" />
                Remove
              </button>
            </div>
          )}
          <RangeSlider range={range} onChange={(next) => updateRange(i, next)} />
        </div>
      ))}

      {/* Add a second window */}
      {effectiveRanges.length < MAX_RANGES && (
        <button
          onClick={addRange}
          className="flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium bg-sunken text-slate-400 hover:bg-white/5 hover:text-slate-300 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add time range
        </button>
      )}
    </div>
  );
}
