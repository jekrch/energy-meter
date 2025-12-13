import React, { useState, useCallback, useRef, useMemo } from 'react';

const celsiusToFahrenheit = (c: number) => c * 9 / 5 + 32;
const fahrenheitToCelsius = (f: number) => (f - 32) * 5 / 9;

interface TempRangeSliderProps {
    min: number;
    max: number;
    valueMin: number;
    valueMax: number;
    onChange: (min: number, max: number) => void;
    unit: 'C' | 'F';
}

type DragTarget = 'min' | 'max' | 'range' | null;

export const TempRangeSlider = React.memo(function TempRangeSlider({
    min, max, valueMin, valueMax, onChange
}: TempRangeSliderProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const [dragTarget, setDragTarget] = useState<DragTarget>(null);
    const [localMin, setLocalMin] = useState<number | null>(null);
    const [localMax, setLocalMax] = useState<number | null>(null);
    const dragStartRef = useRef<{ x: number; min: number; max: number } | null>(null);
    
    const displayMin = localMin ?? valueMin;
    const displayMax = localMax ?? valueMax;
    
    const range = max - min || 1;
    const leftPercent = ((displayMin - min) / range) * 100;
    const rightPercent = ((displayMax - min) / range) * 100;
    
    const formatTemp = (val: number) => `${Math.round(val)}°`;

    const getValueFromPosition = useCallback((clientX: number): number => {
        if (!trackRef.current) return min;
        const rect = trackRef.current.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return Math.round(min + percent * range);
    }, [min, range]);

    const handlePointerDown = useCallback((e: React.PointerEvent, target: DragTarget) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDragTarget(target);
        dragStartRef.current = { x: e.clientX, min: displayMin, max: displayMax };
        
        if (target === 'min' || target === 'max') {
            const newValue = getValueFromPosition(e.clientX);
            if (target === 'min') {
                setLocalMin(Math.min(newValue, displayMax - 1));
            } else {
                setLocalMax(Math.max(newValue, displayMin + 1));
            }
        }
    }, [displayMin, displayMax, getValueFromPosition]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragTarget || !dragStartRef.current) return;
        
        if (dragTarget === 'range') {
            const delta = e.clientX - dragStartRef.current.x;
            if (!trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            const valueDelta = Math.round((delta / rect.width) * range);
            
            const originalSpan = dragStartRef.current.max - dragStartRef.current.min;
            let newMin = dragStartRef.current.min + valueDelta;
            let newMax = dragStartRef.current.max + valueDelta;
            
            // Clamp to bounds while preserving span
            if (newMin < min) {
                newMin = min;
                newMax = min + originalSpan;
            }
            if (newMax > max) {
                newMax = max;
                newMin = max - originalSpan;
            }
            
            setLocalMin(newMin);
            setLocalMax(newMax);
        } else {
            const newValue = getValueFromPosition(e.clientX);
            if (dragTarget === 'min') {
                setLocalMin(Math.min(newValue, displayMax - 1));
            } else if (dragTarget === 'max') {
                setLocalMax(Math.max(newValue, displayMin + 1));
            }
        }
    }, [dragTarget, displayMin, displayMax, getValueFromPosition, min, max, range]);

    const handlePointerUp = useCallback(() => {
        if (dragTarget && (localMin !== null || localMax !== null)) {
            onChange(localMin ?? valueMin, localMax ?? valueMax);
        }
        setDragTarget(null);
        setLocalMin(null);
        setLocalMax(null);
        dragStartRef.current = null;
    }, [dragTarget, localMin, localMax, valueMin, valueMax, onChange]);

    const isFullRange = displayMin <= min && displayMax >= max;
    const isDragging = dragTarget !== null;

    // Generate tick marks similar to hour slider
    const ticks = useMemo(() => {
        const range = max - min;
        // Choose a nice interval based on range
        let interval: number;
        if (range <= 20) interval = 5;
        else if (range <= 50) interval = 10;
        else if (range <= 100) interval = 20;
        else interval = 25;
        
        const result: number[] = [];
        const firstTick = Math.ceil(min / interval) * interval;
        for (let t = firstTick; t <= max; t += interval) {
            result.push(t);
        }
        // Always include min and max
        if (result[0] !== min) result.unshift(min);
        if (result[result.length - 1] !== max) result.push(max);
        return result;
    }, [min, max]);

    return (
        <div className="relative pt-5 pb-5 select-none touch-none overflow-hidden">
            {/* Selected range indicator - above slider */}
            <div className="absolute top-0 left-0 right-0 flex justify-center">
                {!isFullRange ? (
                    <span className="text-[11px] text-slate-300 tabular-nums">
                        {formatTemp(displayMin)} – {formatTemp(displayMax)}
                    </span>
                ) : (
                    <span className="text-[11px] text-slate-500">All temperatures</span>
                )}
            </div>
            {/* Track container with larger hit area */}
            <div 
                ref={trackRef}
                className="relative h-8 mx-2 flex items-center"
            >
                {/* Background track */}
                <div 
                    className="absolute inset-x-0 h-2 rounded-full"
                    style={{ background: 'linear-gradient(90deg, #0ea5e9 0%, #f97316 100%)' }}
                />
                
                {/* Left mask */}
                <div 
                    className="absolute left-0 h-2 rounded-l-full bg-slate-900/80 transition-[width] duration-75"
                    style={{ width: `${leftPercent}%` }}
                />
                
                {/* Right mask */}
                <div 
                    className="absolute right-0 h-2 rounded-r-full bg-slate-900/80 transition-[width] duration-75"
                    style={{ width: `${100 - rightPercent}%` }}
                />
                
                {/* Draggable range area */}
                <div
                    className={`absolute h-8 cursor-grab ${isDragging && dragTarget === 'range' ? 'cursor-grabbing' : ''}`}
                    style={{ 
                        left: `${leftPercent}%`, 
                        width: `${rightPercent - leftPercent}%`,
                    }}
                    onPointerDown={(e) => handlePointerDown(e, 'range')}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                />
                
                {/* Min thumb - large hit area with smaller visible circle */}
                <div
                    className={`absolute -translate-x-1/2 w-10 h-10 flex items-center justify-center
                        cursor-grab ${isDragging && dragTarget === 'min' ? 'cursor-grabbing' : ''}`}
                    style={{ left: `${leftPercent}%` }}
                    onPointerDown={(e) => handlePointerDown(e, 'min')}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                >
                    <div className={`w-4 h-4 rounded-full bg-slate-100 border-2 border-slate-400 shadow-lg
                        transition-transform
                        ${isDragging && dragTarget === 'min' ? 'scale-110 border-slate-300 bg-white' : ''}`} 
                    />
                </div>
                
                {/* Max thumb - large hit area with smaller visible circle */}
                <div
                    className={`absolute -translate-x-1/2 w-10 h-10 flex items-center justify-center
                        cursor-grab ${isDragging && dragTarget === 'max' ? 'cursor-grabbing' : ''}`}
                    style={{ left: `${rightPercent}%` }}
                    onPointerDown={(e) => handlePointerDown(e, 'max')}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                >
                    <div className={`w-4 h-4 rounded-full bg-slate-100 border-2 border-slate-400 shadow-lg
                        transition-transform
                        ${isDragging && dragTarget === 'max' ? 'scale-110 border-slate-300 bg-white' : ''}`} 
                    />
                </div>
            </div>
            
            {/* Tick labels */}
            <div className="absolute left-0 right-0 bottom-0 flex justify-between px-0.5">
                {ticks.map((t, i) => (
                    <span 
                        key={t} 
                        className={`text-[10px] tabular-nums transition-colors ${
                            t >= displayMin && t <= displayMax ? 'text-slate-400' : 'text-slate-600'
                        } ${i === 0 ? 'text-left' : i === ticks.length - 1 ? 'text-right' : 'text-center'}`}
                    >
                        {formatTemp(t)}
                    </span>
                ))}
            </div>
        </div>
    );
});

export { celsiusToFahrenheit, fahrenheitToCelsius };