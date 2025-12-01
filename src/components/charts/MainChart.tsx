import React, { useRef, useCallback } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { formatAxisValue } from '../../utils/formatters';
import type { DataPoint } from '../../types';
import { formatCost, formatCostAxis } from '../../utils/formatters';

export type MetricMode = 'energy' | 'cost';

interface MainChartProps {
    data: DataPoint[];
    resolution: string;
    isProcessing: boolean;
    spansMultipleDays: boolean;
    onSelectionChange: (range: { start: number; end: number }) => void;
    metricMode: MetricMode;
}

// Tooltip with cost support
interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: DataPoint & { label?: string } }>;
    resolution?: string;
    metricMode: MetricMode;
}

const CustomTooltip = React.memo(function CustomTooltip({ active, payload, resolution, metricMode }: CustomTooltipProps) {
    if (active && payload?.length) {
        const data = payload[0].payload;
        const hasCost = typeof data.cost === 'number' && data.cost > 0;
        
        return (
            <div className="bg-slate-800 p-3 shadow-xl border border-slate-700 rounded-lg min-w-[140px]">
                <p className="text-slate-400 text-xs font-semibold mb-2">
                    {data.fullDate || data.label}
                </p>
                
                {/* Energy - primary when in energy mode */}
                <p className={`font-bold ${metricMode === 'energy' ? 'text-amber-400 text-lg' : 'text-slate-400 text-sm'}`}>
                    {data.value.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Wh</span>
                </p>
                
                {/* Cost - primary when in cost mode */}
                {hasCost && (
                    <p className={`font-semibold mt-1 ${metricMode === 'cost' ? 'text-emerald-400 text-lg' : 'text-slate-400 text-sm'}`}>
                        {formatCost(data.cost)}
                    </p>
                )}
                
                {resolution && resolution !== 'RAW' && resolution !== 'HOURLY' && (
                    <p className="text-xs text-slate-500 mt-2 italic">Aggregated total</p>
                )}
            </div>
        );
    }
    return null;
});

export const MainChart = React.memo(function MainChart({
    data,
    resolution,
    isProcessing,
    spansMultipleDays,
    onSelectionChange,
    metricMode
}: MainChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = React.useState(false);
    const [dragAnchor, setDragAnchor] = React.useState<number | null>(null);
    const [dragCurrent, setDragCurrent] = React.useState<number | null>(null);

    // Chart colors based on metric mode
    const chartColor = metricMode === 'energy' ? '#f59e0b' : '#10b981'; // amber for energy, emerald for cost
    const gradientId = metricMode === 'energy' ? 'colorEnergy' : 'colorCost';

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

    // Helper for drag ReferenceArea label
    const getDragLabel = (isStart: boolean): string | undefined => {
        if (!dragging || dragAnchor === null || dragCurrent === null || !data.length) return undefined;
        const ts = isStart ? Math.min(dragAnchor, dragCurrent) : Math.max(dragAnchor, dragCurrent);
        
        if (isStart) {
            const found = data.find(d => d.timestamp >= ts);
            return found?.fullDate;
        } else {
            for (let i = data.length - 1; i >= 0; i--) {
                if (data[i].timestamp <= ts) return data[i].fullDate;
            }
            return data[data.length - 1]?.fullDate;
        }
    };

    // Axis formatter based on mode
    const yAxisFormatter = metricMode === 'energy' ? formatAxisValue : formatCostAxis;

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
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={chartColor} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
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
                        tickFormatter={yAxisFormatter}
                        width={50}
                    />
                    <Tooltip content={<CustomTooltip resolution={resolution} metricMode={metricMode} />} />

                    {/* Show ReferenceArea only while actively dragging */}
                    {dragging && getDragLabel(true) && getDragLabel(false) && (
                        <ReferenceArea
                            x1={getDragLabel(true)}
                            x2={getDragLabel(false)}
                            fill={chartColor}
                            fillOpacity={0.3}
                            stroke={chartColor}
                            strokeWidth={2}
                        />
                    )}

                    <Area
                        type="monotone"
                        dataKey={metricMode === 'energy' ? 'value' : 'cost'}
                        stroke={chartColor}
                        strokeWidth={2}
                        fillOpacity={1}
                        fill={`url(#${gradientId})`}
                        animationDuration={300}
                        isAnimationActive={data.length < 500}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
});