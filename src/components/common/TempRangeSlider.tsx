import React, { useState, useCallback } from 'react';

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

export const TempRangeSlider = React.memo(function TempRangeSlider({
    min, max, valueMin, valueMax, onChange
}: TempRangeSliderProps) {
    // Local state for dragging - only commits on release
    const [localMin, setLocalMin] = useState<number | null>(null);
    const [localMax, setLocalMax] = useState<number | null>(null);
    
    const displayMin = localMin ?? valueMin;
    const displayMax = localMax ?? valueMax;
    
    const range = max - min || 1;
    const leftPercent = ((displayMin - min) / range) * 100;
    const rightPercent = ((displayMax - min) / range) * 100;
    
    const formatTemp = (val: number) => `${Math.round(val)}°`;
    
    const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newMin = parseFloat(e.target.value);
        setLocalMin(Math.min(newMin, displayMax - 1));
    };
    
    const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newMax = parseFloat(e.target.value);
        setLocalMax(Math.max(newMax, displayMin + 1));
    };
    
    const commitChanges = useCallback(() => {
        const finalMin = localMin ?? valueMin;
        const finalMax = localMax ?? valueMax;
        if (localMin !== null || localMax !== null) {
            onChange(finalMin, finalMax);
        }
        setLocalMin(null);
        setLocalMax(null);
    }, [localMin, localMax, valueMin, valueMax, onChange]);

    const isFullRange = displayMin <= min && displayMax >= max;

    const sliderClasses = `absolute inset-0 w-full appearance-none bg-transparent pointer-events-none z-10
        [&::-webkit-slider-thumb]:pointer-events-auto
        [&::-webkit-slider-thumb]:appearance-none
        [&::-webkit-slider-thumb]:w-4
        [&::-webkit-slider-thumb]:h-4
        [&::-webkit-slider-thumb]:rounded-full
        [&::-webkit-slider-thumb]:bg-slate-200
        [&::-webkit-slider-thumb]:border-2
        [&::-webkit-slider-thumb]:border-slate-400
        [&::-webkit-slider-thumb]:shadow-md
        [&::-webkit-slider-thumb]:cursor-grab
        [&::-webkit-slider-thumb]:active:cursor-grabbing
        [&::-webkit-slider-thumb]:hover:bg-white
        [&::-webkit-slider-thumb]:hover:border-slate-300
        [&::-webkit-slider-thumb]:transition-colors
        [&::-moz-range-thumb]:pointer-events-auto
        [&::-moz-range-thumb]:appearance-none
        [&::-moz-range-thumb]:w-4
        [&::-moz-range-thumb]:h-4
        [&::-moz-range-thumb]:rounded-full
        [&::-moz-range-thumb]:bg-slate-200
        [&::-moz-range-thumb]:border-2
        [&::-moz-range-thumb]:border-slate-400
        [&::-moz-range-thumb]:cursor-grab
        [&::-moz-range-thumb]:border-0`;

    return (
        <div className="relative pt-1">
            <div className="relative h-4 flex items-center">
                <div 
                    className="absolute inset-x-0 h-1.5 rounded-full"
                    style={{ background: 'linear-gradient(90deg, #0ea5e9 0%, #f97316 100%)' }}
                />
                <div 
                    className="absolute left-0 h-1.5 rounded-l-full bg-slate-900/70 transition-all"
                    style={{ width: `${leftPercent}%` }}
                />
                <div 
                    className="absolute right-0 h-1.5 rounded-r-full bg-slate-900/70 transition-all"
                    style={{ width: `${100 - rightPercent}%` }}
                />
                
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={1}
                    value={displayMin}
                    onChange={handleMinChange}
                    onMouseUp={commitChanges}
                    onTouchEnd={commitChanges}
                    className={sliderClasses}
                />
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={1}
                    value={displayMax}
                    onChange={handleMaxChange}
                    onMouseUp={commitChanges}
                    onTouchEnd={commitChanges}
                    className={sliderClasses}
                />
            </div>
            
            <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-slate-500 tabular-nums">{formatTemp(min)}</span>
                {!isFullRange && (
                    <span className="text-[11px] text-slate-300 tabular-nums">
                        {formatTemp(displayMin)} – {formatTemp(displayMax)}
                    </span>
                )}
                <span className="text-[10px] text-slate-500 tabular-nums">{formatTemp(max)}</span>
            </div>
        </div>
    );
});

export { celsiusToFahrenheit, fahrenheitToCelsius };