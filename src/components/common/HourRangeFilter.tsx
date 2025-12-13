import React, { useState, useCallback, useRef } from 'react';
import { Clock, Sun, Moon, Sunrise, Sunset } from 'lucide-react';

interface HourRangeFilterProps {
  hourStart: number;
  hourEnd: number;
  onChange: (start: number, end: number) => void;
}

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
  { label: 'Night', icon: Moon, start: 22, end: 23 },
] as const;

export function HourRangeFilter({ hourStart, hourEnd, onChange }: HourRangeFilterProps) {
  // Local state for live dragging - only commits on release
  const [localStart, setLocalStart] = useState(hourStart);
  const [localEnd, setLocalEnd] = useState(hourEnd);
  const [isDragging, setIsDragging] = useState<DragType>(null);
  const [dragStartPos, setDragStartPos] = useState<number | null>(null);
  const [dragStartValues, setDragStartValues] = useState<DragValues | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Sync local state when props change (e.g., external reset)
  React.useEffect(() => {
    if (!isDragging) {
      setLocalStart(hourStart);
      setLocalEnd(hourEnd);
    }
  }, [hourStart, hourEnd, isDragging]);

  const isFiltered = localStart > 0 || localEnd < 23;
  const rangeWidth = ((localEnd - localStart) / 23) * 100;
  const rangeLeft = (localStart / 23) * 100;

  const applyPreset = (start: number, end: number) => {
    setLocalStart(start);
    setLocalEnd(end);
    onChange(start, end);
  };

  const reset = () => {
    setLocalStart(0);
    setLocalEnd(23);
    onChange(0, 23);
  };

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
      const hour = getHourFromPosition(e.clientX);
      const distToStart = Math.abs(hour - localStart);
      const distToEnd = Math.abs(hour - localEnd);
      if (distToStart < distToEnd) {
        setLocalStart(Math.min(hour, localEnd));
      } else {
        setLocalEnd(Math.max(hour, localStart));
      }
    }
  }, [localStart, localEnd, getHourFromPosition]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging || !dragStartValues || dragStartPos === null) return;
    
    const hour = getHourFromPosition(e.clientX);
    
    if (isDragging === 'start') {
      setLocalStart(Math.min(hour, localEnd));
    } else if (isDragging === 'end') {
      setLocalEnd(Math.max(hour, localStart));
    } else if (isDragging === 'range') {
      const delta = hour - getHourFromPosition(dragStartPos);
      const rangeSize = dragStartValues.end - dragStartValues.start;
      const newStart = Math.max(0, Math.min(23 - rangeSize, dragStartValues.start + delta));
      const newEnd = newStart + rangeSize;
      setLocalStart(newStart);
      setLocalEnd(newEnd);
    }
  }, [isDragging, dragStartPos, dragStartValues, localStart, localEnd, getHourFromPosition]);

  const handlePointerUp = useCallback(() => {
    // Commit changes only on release
    if (isDragging && (localStart !== hourStart || localEnd !== hourEnd)) {
      onChange(localStart, localEnd);
    }
    setIsDragging(null);
    setDragStartPos(null);
    setDragStartValues(null);
  }, [isDragging, localStart, localEnd, hourStart, hourEnd, onChange]);

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
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400 text-xs font-medium">Hours</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${isFiltered ? 'text-emerald-400' : 'text-slate-500'}`}>
            {isFiltered ? `${formatHourFull(localStart)} – ${formatHourFull(localEnd)}` : 'All day'}
          </span>
          {isFiltered && (
            <button 
              onClick={reset}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Quick Presets */}
      <div className="flex gap-1.5">
        {presets.map(({ label, icon: Icon, start, end }) => {
          const isActive = hourStart === start && hourEnd === end;
          return (
            <button
              key={label}
              onClick={() => applyPreset(start, end)}
              className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
                isActive 
                  ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30' 
                  : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-slate-300'
              }`}
            >
              <Icon className="w-3 h-3" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Range Slider */}
      <div className="relative pt-1 pb-5 touch-none select-none overflow-hidden">
        <div 
          ref={trackRef}
          className="relative h-8 mx-2 flex items-center cursor-pointer"
          onPointerDown={(e) => handlePointerDown(e, 'track')}
        >
          {/* Background track */}
          <div className="absolute inset-x-0 h-2 bg-slate-800 rounded-full" />
          
          {/* Active range bar */}
          <div 
            className={`absolute h-2 rounded-full transition-colors ${
              isDragging === 'range' ? 'bg-emerald-400' : 'bg-emerald-500/70'
            } cursor-grab active:cursor-grabbing`}
            style={{ left: `${rangeLeft}%`, width: `${rangeWidth}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              handlePointerDown(e, 'range');
            }}
          />
          
          {/* Start handle - large hit area with small visible circle */}
          <div 
            className={`absolute w-10 h-10 flex items-center justify-center cursor-grab ${
              isDragging === 'start' ? 'cursor-grabbing' : ''
            }`}
            style={{ left: `${rangeLeft}%`, transform: 'translateX(-50%)' }}
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
            style={{ left: `${rangeLeft + rangeWidth}%`, transform: 'translateX(-50%)' }}
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
                h >= localStart && h <= localEnd ? 'text-slate-400' : 'text-slate-600'
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
          const inRange = h >= localStart && h <= localEnd;
          return (
            <button
              key={h}
              onClick={() => {
                let newStart = localStart;
                let newEnd = localEnd;
                if (h < localStart) newStart = h;
                else if (h > localEnd) newEnd = h;
                else if (h === localStart && localStart < localEnd) newStart = h + 1;
                else if (h === localEnd && localEnd > localStart) newEnd = h - 1;
                
                setLocalStart(newStart);
                setLocalEnd(newEnd);
                onChange(newStart, newEnd);
              }}
              className={`flex-1 h-5 rounded-sm transition-all ${
                inRange 
                  ? 'bg-emerald-500/40 hover:bg-emerald-500/60' 
                  : 'bg-slate-800/50 hover:bg-slate-700/50'
              }`}
              title={formatHourFull(h)}
            />
          );
        })}
      </div>
    </div>
  );
}