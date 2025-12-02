import React from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
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
    metricMode: MetricMode;
}

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
                <p className={`font-bold ${metricMode === 'energy' ? 'text-amber-400 text-lg' : 'text-slate-400 text-sm'}`}>
                    {data.value.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Wh</span>
                </p>
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
    metricMode
}: MainChartProps) {
    const chartColor = metricMode === 'energy' ? '#f59e0b' : '#10b981';
    const gradientId = metricMode === 'energy' ? 'colorEnergy' : 'colorCost';
    const yAxisFormatter = metricMode === 'energy' ? formatAxisValue : formatCostAxis;

    return (
        <div className="absolute inset-0 flex flex-col min-h-[300px]">
            <div className="flex-1 p-4 relative">
                {isProcessing && (
                    <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10 pointer-events-none">
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
        </div>
    );
});