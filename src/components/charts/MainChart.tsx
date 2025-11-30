import React, { useRef, useCallback } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { formatAxisValue } from '../../utils/formatters';
import type { DataPoint, TimeRange } from '../../types';
import { CustomTooltip } from '../common/CustomTooltip';

interface MainChartProps {
    data: DataPoint[];
    resolution: string;
    isProcessing: boolean;
    spansMultipleDays: boolean;
    selection: TimeRange;
    isSelectionSubset: boolean;
    onSelectionChange: (range: { start: number; end: number }) => void;
}

export const MainChart = React.memo(function MainChart({
    data,
    resolution,
    isProcessing,
    spansMultipleDays,
    selection,
    isSelectionSubset,
    onSelectionChange
}: MainChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = React.useState(false);
    const [dragAnchor, setDragAnchor] = React.useState<number | null>(null);
    const [dragCurrent, setDragCurrent] = React.useState<number | null>(null);

    // Helper to find data point from mouse X coordinate
    const getTimestampFromMouseX = useCallback((clientX: number): number | null => {
        if (!chartContainerRef.current || !data.length) return null;
        const rect = chartContainerRef.current.getBoundingClientRect();
        const padding = { left: 55, right: 20 };
        const chartWidth = rect.width - padding.left - padding.right;
        const relativeX = clientX - rect.left - padding.left;
        const ratio = Math.max(0, Math.min(1, relativeX / chartWidth));
        const index = Math.round(ratio * (data.length - 1));
        return data[index]?.timestamp ?? null;
    }, [data]);

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        const ts = getTimestampFromMouseX(e.clientX);
        if (ts !== null) {
            setDragging(true);
            setDragAnchor(ts);
            setDragCurrent(ts);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }
    }, [getTimestampFromMouseX]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (dragging) {
            const ts = getTimestampFromMouseX(e.clientX);
            if (ts !== null) setDragCurrent(ts);
        }
    }, [dragging, getTimestampFromMouseX]);

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
        if (dragging && dragAnchor !== null && dragCurrent !== null && dragAnchor !== dragCurrent) {
            onSelectionChange({
                start: Math.min(dragAnchor, dragCurrent),
                end: Math.max(dragAnchor, dragCurrent)
            });
        }
        setDragging(false);
        setDragAnchor(null);
        setDragCurrent(null);
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { }
    }, [dragging, dragAnchor, dragCurrent, onSelectionChange]);

    // Helpers for ReferenceArea rendering
    const getSelectionLabel = (ts: number | null, findFirst: boolean) => {
        if (ts === null || !data.length) return undefined;
        if (findFirst) {
            const found = data.find(d => d.timestamp >= ts);
            return found?.fullDate;
        } else {
            for (let i = data.length - 1; i >= 0; i--) {
                if (data[i].timestamp <= ts) return data[i].fullDate;
            }
            return data[data.length - 1]?.fullDate;
        }
    };

    const getDragLabel = (isStart: boolean) => {
        if (!dragging || dragAnchor === null || dragCurrent === null) return undefined;
        const ts = isStart ? Math.min(dragAnchor, dragCurrent) : Math.max(dragAnchor, dragCurrent);
        return getSelectionLabel(ts, isStart);
    };

    return (
        <div
            ref={chartContainerRef}
            className="chart-container absolute inset-0 p-4 pb-2 select-none touch-none min-h-[300px]"
            tabIndex={-1}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            style={{ cursor: dragging ? 'col-resize' : 'crosshair' }}
        >
            {isProcessing && (
                <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10">
                    <div className="flex items-center gap-3 bg-slate-800 px-4 py-3 rounded-lg border border-slate-700">
                        <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                        <span className="text-slate-300 text-sm">Processing data...</span>
                    </div>
                </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                    <defs>
                        <linearGradient id="colorUsage" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                    <XAxis
                        dataKey="fullDate"
                        stroke="#94a3b8"
                        fontSize={10}
                        tickLine={true}
                        axisLine={false}
                        minTickGap={40}
                        tickFormatter={(val) => (resolution === 'RAW' || resolution === 'HOURLY') ? (spansMultipleDays ? val : val.split(', ')[1] || val) : val}
                    />
                    <YAxis
                        stroke="#94a3b8"
                        fontSize={10}
                        tickLine={true}
                        axisLine={false}
                        tickFormatter={formatAxisValue}
                        width={45}
                    />
                    <Tooltip content={<CustomTooltip resolution={resolution} />} />

                    {dragging && getDragLabel(true) && getDragLabel(false) && (
                        <ReferenceArea
                            x1={getDragLabel(true)}
                            x2={getDragLabel(false)}
                            fill="#10b981"
                            fillOpacity={0.3}
                            stroke="#10b981"
                            strokeWidth={2}
                        />
                    )}

                    {!dragging && isSelectionSubset && getSelectionLabel(selection.start, true) && getSelectionLabel(selection.end, false) && (
                        <ReferenceArea
                            x1={getSelectionLabel(selection.start, true)}
                            x2={getSelectionLabel(selection.end, false)}
                            fill="#10b981"
                            fillOpacity={0.2}
                            stroke="#10b981"
                            strokeOpacity={0.6}
                            strokeDasharray="4 2"
                        />
                    )}

                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#10b981"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorUsage)"
                        animationDuration={300}
                        isAnimationActive={data.length < 500}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
});