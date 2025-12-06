import React, { useMemo } from 'react';
import {
    ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Loader2 } from 'lucide-react';
import type { DataPoint } from '../../types';
import { formatCost, formatCostAxis } from '../../utils/formatters';
import { type EnergyUnit, formatEnergyValue, formatEnergyAxis } from '../../utils/energyUnits';

export type MetricMode = 'energy' | 'cost';

interface MainChartProps {
    data: DataPoint[];
    resolution: string;
    isProcessing: boolean;
    spansMultipleDays: boolean;
    metricMode: MetricMode;
    energyUnit: EnergyUnit;
    weatherData?: Map<number, number>;
    showWeather?: boolean;
    temperatureUnit?: 'C' | 'F';
}

interface ChartDataPoint extends DataPoint {
    temperature?: number;
}

interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: ChartDataPoint & { label?: string } }>;
    resolution?: string;
    metricMode: MetricMode;
    energyUnit: EnergyUnit;
    showWeather?: boolean;
    temperatureUnit?: 'C' | 'F';
}

const formatTemp = (temp: number, unit: 'C' | 'F') => {
    if (unit === 'F') return `${Math.round(temp * 9/5 + 32)}°F`;
    return `${Math.round(temp)}°C`;
};

const CustomTooltip = React.memo(function CustomTooltip({ 
    active, payload, resolution, metricMode, energyUnit, showWeather, temperatureUnit = 'F'
}: CustomTooltipProps) {
    if (active && payload?.length) {
        const data = payload[0].payload;
        const hasCost = typeof data.cost === 'number' && data.cost > 0;
        const hasTemp = showWeather && typeof data.temperature === 'number';
        
        return (
            <div className="bg-slate-800 p-3 shadow-xl border border-slate-700 rounded-lg min-w-[140px]">
                <p className="text-slate-400 text-xs font-semibold mb-2">
                    {data.fullDate || data.label}
                </p>
                <p className={`font-bold ${metricMode === 'energy' ? 'text-amber-400 text-lg' : 'text-slate-400 text-sm'}`}>
                    {formatEnergyValue(data.value, energyUnit)}{' '}
                    <span className="text-xs text-slate-500 font-normal">{energyUnit}</span>
                </p>
                {hasCost && (
                    <p className={`font-semibold mt-1 ${metricMode === 'cost' ? 'text-emerald-400 text-lg' : 'text-slate-400 text-sm'}`}>
                        {formatCost(data.cost)}
                    </p>
                )}
                {hasTemp && (
                    <p className="text-sky-400 font-medium mt-1.5 text-sm">
                        {formatTemp(data.temperature!, temperatureUnit)}
                        <span className="text-xs text-slate-500 font-normal ml-1">avg temp</span>
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
    data, resolution, isProcessing, spansMultipleDays, metricMode, energyUnit,
    weatherData, showWeather = false, temperatureUnit = 'F'
}: MainChartProps) {
    const chartColor = metricMode === 'energy' ? '#f59e0b' : '#10b981';
    const gradientId = metricMode === 'energy' ? 'colorEnergy' : 'colorCost';
    
    const yAxisFormatter = metricMode === 'energy' 
        ? (val: number) => formatEnergyAxis(val, energyUnit)
        : formatCostAxis;

    // Merge weather data with chart data
    const chartDataWithWeather: ChartDataPoint[] = useMemo(() => {
        if (!showWeather || !weatherData?.size) return data;
        
        return data.map(point => {
            let temp: number | undefined;
            
            if (resolution === 'RAW' || resolution === 'HOURLY') {
                const hourTs = Math.floor(point.timestamp / 3600) * 3600;
                temp = weatherData.get(hourTs);
            } else if (resolution === 'DAILY') {
                const date = new Date(point.timestamp * 1000);
                const dayTs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
                temp = weatherData.get(dayTs);
            } else {
                const date = new Date(point.timestamp * 1000);
                const monthTs = new Date(date.getFullYear(), date.getMonth(), 1).getTime() / 1000;
                temp = weatherData.get(monthTs);
            }
            
            return { ...point, temperature: temp };
        });
    }, [data, weatherData, showWeather, resolution]);

    // Calculate temperature axis bounds
    const tempDomain = useMemo(() => {
        if (!showWeather || !weatherData?.size) return [0, 40];
        const temps = Array.from(weatherData.values());
        const min = Math.min(...temps);
        const max = Math.max(...temps);
        const padding = (max - min) * 0.1 || 5;
        return [Math.floor(min - padding), Math.ceil(max + padding)];
    }, [weatherData, showWeather]);

    const tempAxisFormatter = (val: number) => {
        if (temperatureUnit === 'F') return `${Math.round(val * 9/5 + 32)}°`;
        return `${Math.round(val)}°`;
    };

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
                    <ComposedChart data={chartDataWithWeather} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
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
                            tickFormatter={(val) => (resolution === 'RAW' || resolution === 'HOURLY') 
                                ? (spansMultipleDays ? val : val.split(', ')[1] || val) 
                                : val}
                        />
                        <YAxis
                            yAxisId="primary"
                            stroke="#94a3b8"
                            fontSize={10}
                            tickLine={true}
                            axisLine={false}
                            tickFormatter={yAxisFormatter}
                            width={50}
                        />
                        {showWeather && weatherData?.size && (
                            <YAxis
                                yAxisId="temperature"
                                orientation="right"
                                stroke="#38bdf8"
                                fontSize={10}
                                tickLine={true}
                                axisLine={false}
                                tickFormatter={tempAxisFormatter}
                                domain={tempDomain}
                                width={25}
                            />
                        )}
                        <Tooltip content={
                            <CustomTooltip 
                                resolution={resolution} 
                                metricMode={metricMode} 
                                energyUnit={energyUnit}
                                showWeather={showWeather}
                                temperatureUnit={temperatureUnit}
                            />
                        } />
                        <Area
                            yAxisId="primary"
                            type="monotone"
                            dataKey={metricMode === 'energy' ? 'value' : 'cost'}
                            stroke={chartColor}
                            strokeWidth={2}
                            fillOpacity={1}
                            fill={`url(#${gradientId})`}
                            animationDuration={300}
                            isAnimationActive={data.length < 500}
                        />
                        {showWeather && weatherData?.size && (
                            <Line
                                yAxisId="temperature"
                                type="monotone"
                                dataKey="temperature"
                                stroke="#38bdf8"
                                strokeWidth={2}
                                dot={false}
                                animationDuration={300}
                                isAnimationActive={data.length < 500}
                                connectNulls
                            />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
});