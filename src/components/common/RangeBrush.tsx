import React, { useRef, useCallback, useMemo, useState } from 'react';
import { formatShortDate } from '../../utils/formatters';

export interface BrushDataPoint {
    timestamp: number;
    value: number;
}

interface RangeBrushProps {
    data: BrushDataPoint[];
    viewStart: number | null;
    viewEnd: number | null;
    boundsStart: number | null;
    boundsEnd: number | null;
    onRangeChange: (start: number, end: number) => void;
}

export const RangeBrush = React.memo(function RangeBrush({ 
    data, viewStart, viewEnd, boundsStart, boundsEnd, onRangeChange 
}: RangeBrushProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef<'left' | 'right' | 'middle' | null>(null);
    const dragStartRef = useRef<{ x: number; leftPct: number; rightPct: number }>({ x: 0, leftPct: 0, rightPct: 100 });

    const [localLeft, setLocalLeft] = useState<number | null>(null);
    const [localRight, setLocalRight] = useState<number | null>(null);

    const propPcts = useMemo(() => {
        if (!boundsStart || !boundsEnd || boundsStart === boundsEnd) {
            return { leftPct: 0, rightPct: 100 };
        }
        const range = boundsEnd - boundsStart;
        const left = viewStart ? ((viewStart - boundsStart) / range) * 100 : 0;
        const right = viewEnd ? ((viewEnd - boundsStart) / range) * 100 : 100;
        return { 
            leftPct: Math.max(0, Math.min(100, left)), 
            rightPct: Math.max(0, Math.min(100, right)) 
        };
    }, [viewStart, viewEnd, boundsStart, boundsEnd]);

    const leftPct = localLeft !== null ? localLeft : propPcts.leftPct;
    const rightPct = localRight !== null ? localRight : propPcts.rightPct;

    const pctToTimestamp = useCallback((pct: number): number => {
        if (!boundsStart || !boundsEnd) return 0;
        const range = boundsEnd - boundsStart;
        return boundsStart + (pct / 100) * range;
    }, [boundsStart, boundsEnd]);

    const handlePointerDown = useCallback((e: React.PointerEvent, handle: 'left' | 'right' | 'middle') => {
        e.preventDefault();
        e.stopPropagation();
        draggingRef.current = handle;
        dragStartRef.current = { x: e.clientX, leftPct, rightPct };
        setLocalLeft(leftPct);
        setLocalRight(rightPct);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, [leftPct, rightPct]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!draggingRef.current || !containerRef.current) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const deltaX = e.clientX - dragStartRef.current.x;
        const deltaPct = (deltaX / rect.width) * 100;

        let newLeft = dragStartRef.current.leftPct;
        let newRight = dragStartRef.current.rightPct;

        if (draggingRef.current === 'left') {
            newLeft = Math.max(0, Math.min(newRight - 2, dragStartRef.current.leftPct + deltaPct));
        } else if (draggingRef.current === 'right') {
            newRight = Math.max(newLeft + 2, Math.min(100, dragStartRef.current.rightPct + deltaPct));
        } else if (draggingRef.current === 'middle') {
            const width = dragStartRef.current.rightPct - dragStartRef.current.leftPct;
            newLeft = dragStartRef.current.leftPct + deltaPct;
            newRight = dragStartRef.current.rightPct + deltaPct;
            
            if (newLeft < 0) { newLeft = 0; newRight = width; }
            if (newRight > 100) { newRight = 100; newLeft = 100 - width; }
        }

        setLocalLeft(newLeft);
        setLocalRight(newRight);
    }, []);

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
        if (draggingRef.current && localLeft !== null && localRight !== null) {
            const start = pctToTimestamp(localLeft);
            const end = pctToTimestamp(localRight);
            onRangeChange(start, end);
        }
        
        draggingRef.current = null;
        setLocalLeft(null);
        setLocalRight(null);
        
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    }, [localLeft, localRight, pctToTimestamp, onRangeChange]);

    const sparklinePath = useMemo(() => {
        if (!data.length) return '';
        const maxVal = Math.max(...data.map(d => d.value)) || 1;
        const points = data.map((d, i) => {
            const x = (i / (data.length - 1)) * 100;
            const y = 100 - (d.value / maxVal) * 80;
            return `${x},${y}`;
        });
        return `M${points.join(' L')}`;
    }, [data]);

    return (
        <div 
            ref={containerRef}
            className="relative h-12 bg-slate-950/50 border border-slate-700/50 rounded-md select-none touch-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
        >
            {/* Sparkline background */}
            <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                <path d={sparklinePath} fill="none" stroke="#334155" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>

            {/* Dimmed areas outside selection */}
            <div 
                className="absolute top-0 bottom-0 left-0 bg-slate-950/70 rounded-l-md"
                style={{ width: `${leftPct}%` }}
            />
            <div 
                className="absolute top-0 bottom-0 right-0 bg-slate-950/70 rounded-r-md"
                style={{ width: `${100 - rightPct}%` }}
            />

            {/* Selection area (draggable middle) */}
            <div
                className="absolute top-0 bottom-0 cursor-grab active:cursor-grabbing"
                style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
                onPointerDown={(e) => handlePointerDown(e, 'middle')}
            >
                <div className="absolute inset-0 border-t-2 border-b-2 border-emerald-500/50" />
            </div>

            {/* Left handle */}
            <div
                className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize z-10 group"
                style={{ left: `${leftPct}%` }}
                onPointerDown={(e) => handlePointerDown(e, 'left')}
            >
                <div className="absolute top-1 bottom-1 left-1/2 -translate-x-1/2 w-1.5 rounded-full bg-emerald-500 group-hover:bg-emerald-400 transition-colors" />
            </div>

            {/* Right handle */}
            <div
                className="absolute top-0 bottom-0 w-3 -mr-1.5 cursor-ew-resize z-10 group"
                style={{ right: `${100 - rightPct}%` }}
                onPointerDown={(e) => handlePointerDown(e, 'right')}
            >
                <div className="absolute top-1 bottom-1 left-1/2 -translate-x-1/2 w-1.5 rounded-full bg-emerald-500 group-hover:bg-emerald-400 transition-colors" />
            </div>

            {/* Date labels */}
            <div className="absolute -bottom-5 left-1 text-[10px] text-slate-500">
                {boundsStart ? formatShortDate(new Date(boundsStart * 1000)) : ''}
            </div>
            <div className="absolute -bottom-5 right-1 text-[10px] text-slate-500">
                {boundsEnd ? formatShortDate(new Date(boundsEnd * 1000)) : ''}
            </div>
        </div>
    );
});