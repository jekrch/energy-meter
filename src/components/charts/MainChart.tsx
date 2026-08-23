import React, { useCallback, useMemo } from 'react';
import {
    ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ResponsiveContainer
} from 'recharts';
import { CalendarClock, Loader2 } from 'lucide-react';
import type { DataPoint } from '../../types';
import { formatCostAxis } from '../../utils/formatters';
import { type EnergyUnit, formatEnergyAxis } from '../../utils/energyUnits';
import { formatDemandAxis } from '../../utils/demandUnits';
import { useTouchDevice, useTooltipControl } from '../../hooks/useTooltipControl';
import { ChartTooltip, type TooltipData } from '../common/ChartTooltip';
import { DownloadChartButton } from '../common/DownloadChartButton';
import { RESOLUTIONS, PEAK_COLORS, OFF_PEAK } from '../../types';
import type { PeakSchedule } from '../../types';
import {
    buildPeakIndex, buildBandRuns, classify, scheduleIsEmpty, peakBandGate, medianPointStep,
    PEAK_BAND_GATE_HINTS,
} from '../../utils/peakSchedule';

// Canonical definition lives in types/index.ts; re-exported here so existing
// imports (InsightsModal, AnalysisPanel) keep working unchanged.
export type { MetricMode } from '../../types';
import type { MetricMode } from '../../types';

// §8: axis tick text is mono (JetBrains Mono). Recharts takes this via the SVG
// tick props, not a Tailwind class. Module-level so it isn't reallocated per render.
const AXIS_TICK = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" };

// Peak bands sit behind the series, so they have to stay faint enough that the
// gradient fill still reads on top of them (§3: tints, never large fills).
const BAND_OPACITY = 0.12;

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
    peakSchedule?: PeakSchedule | null;
    showPeakBands?: boolean;
    // Lets the "needs Hourly" hint fix the problem it reports.
    setResolution?: (resolution: string) => void;
}

interface ChartDataPoint extends DataPoint {
    temperature?: number;
}

export const MainChart = React.memo(function MainChart({
    data, resolution, isProcessing, spansMultipleDays, metricMode, energyUnit,
    weatherData, showWeather = false, temperatureUnit = 'F',
    peakSchedule = null, showPeakBands = false, setResolution
}: MainChartProps) {
    const isTouchDevice = useTouchDevice();
    const { activeIndex, tooltipRef, chartContainerRef, handleChartClick } = useTooltipControl(isTouchDevice);

    const chartColor = metricMode === 'energy' ? '#f59e0b' : metricMode === 'demand' ? '#8b5cf6' : '#10b981';
    const gradientId = metricMode === 'energy' ? 'colorEnergy' : metricMode === 'demand' ? 'colorDemand' : 'colorCost';

    const yAxisFormatter = metricMode === 'energy'
        ? (val: number) => formatEnergyAxis(val, energyUnit)
        : metricMode === 'demand'
        ? formatDemandAxis
        : formatCostAxis;

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

    const tempDomain = useMemo(() => {
        if (!showWeather || !weatherData?.size) return [0, 40];
        // O(n) min/max — Math.min(...arr) spreads every hourly temp as an
        // argument, which blows the call stack / crashes iOS on long ranges.
        let min = Infinity;
        let max = -Infinity;
        for (const t of weatherData.values()) {
            if (t < min) min = t;
            if (t > max) max = t;
        }
        const padding = (max - min) * 0.1 || 5;
        return [Math.floor(min - padding), Math.ceil(max + padding)];
    }, [weatherData, showWeather]);

    // --- Peak rate bands -----------------------------------------------------
    // Bands are derived from the *rendered* series rather than raw timestamps:
    // the XAxis is a category axis keyed on `fullDate`, so a ReferenceArea has
    // to name exact category values.
    const peakIndex = useMemo(() => {
        if (!showPeakBands || !peakSchedule || scheduleIsEmpty(peakSchedule)) return null;
        return buildPeakIndex(peakSchedule);
    }, [showPeakBands, peakSchedule]);

    const bandGate = useMemo(() => {
        if (!peakIndex || chartDataWithWeather.length < 2) return 'ok' as const;
        const span = chartDataWithWeather[chartDataWithWeather.length - 1].timestamp
            - chartDataWithWeather[0].timestamp;
        return peakBandGate(resolution, medianPointStep(chartDataWithWeather), span);
    }, [peakIndex, chartDataWithWeather, resolution]);

    const bandRuns = useMemo(() => {
        if (!peakIndex || bandGate !== 'ok') return [];
        return buildBandRuns(chartDataWithWeather, peakIndex);
    }, [peakIndex, bandGate, chartDataWithWeather]);

    const periodColors = useMemo(
        () => (peakSchedule?.periods ?? []).map(p => PEAK_COLORS[p.colorKey]),
        [peakSchedule],
    );

    // Only the periods that actually shade something in the current view.
    const bandLegend = useMemo(() => {
        if (!peakSchedule || !bandRuns.length) return [];
        const seen = new Set<number>();
        const legend: { periodIdx: number; name: string; color: string }[] = [];
        for (const run of bandRuns) {
            if (seen.has(run.periodIdx)) continue;
            seen.add(run.periodIdx);
            const period = peakSchedule.periods[run.periodIdx];
            // Names are user-supplied and may repeat, so the index is the key.
            if (period) legend.push({ periodIdx: run.periodIdx, name: period.name, color: periodColors[run.periodIdx] });
        }
        return legend;
    }, [bandRuns, peakSchedule, periodColors]);

    const bandHint = peakIndex && bandGate !== 'ok' ? PEAK_BAND_GATE_HINTS[bandGate] : null;
    // The resolution case is one click away from being fixed; the density case
    // needs the user to narrow the date range, which lives outside this chart.
    const canFixBandGate = bandGate === 'resolution' && !!setResolution;

    const getTooltipData = useCallback((d: ChartDataPoint & { label?: string }): TooltipData => {
        const periodIdx = peakIndex && bandGate === 'ok' ? classify(d.timestamp, peakIndex) : OFF_PEAK;
        const period = periodIdx === OFF_PEAK ? undefined : peakSchedule?.periods[periodIdx];
        return {
            label: d.fullDate || d.label || '',
            energyValue: d.value,
            costValue: d.cost,
            demandValue: d.demand,
            temperature: d.temperature,
            peakPeriod: period ? { name: period.name, color: PEAK_COLORS[period.colorKey] } : undefined,
            // Demand buckets show the peak, not a sum — suppress the "aggregated total" note.
            showAggregatedNote: metricMode !== 'demand' && resolution !== 'RAW' && resolution !== 'HOURLY'
        };
    }, [resolution, metricMode, peakIndex, bandGate, peakSchedule]);

    const tempAxisFormatter = (val: number) => {
        if (temperatureUnit === 'F') return `${Math.round(val * 9 / 5 + 32)}°`;
        return `${Math.round(val)}°`;
    };

    const metricLabel = metricMode === 'energy' ? 'Energy' : metricMode === 'demand' ? 'Peak demand' : 'Cost';
    const exportTitle = `${metricLabel} over time`;
    const exportSubtitle = RESOLUTIONS[resolution]?.label;

    return (
        <div className="absolute inset-0 flex flex-col min-h-[300px]">
            <div
                className="flex-1 p-4 relative"
                ref={chartContainerRef}
            >
                {!isProcessing && data.length > 0 && (
                    <div className="absolute top-2 right-2 z-20">
                        <DownloadChartButton
                            containerRef={chartContainerRef}
                            title={exportTitle}
                            subtitle={exportSubtitle}
                        />
                    </div>
                )}
                {bandHint && !isProcessing && (
                    /* Right-bounded so it never slides under the download button. */
                    <div className="absolute top-2 left-4 right-12 z-20 flex">
                        <button
                            type="button"
                            onClick={canFixBandGate ? () => setResolution!('HOURLY') : undefined}
                            className={`flex items-center gap-1.5 min-w-0 max-w-full px-2 py-1 rounded-md text-xs font-medium bg-amber-500/12 text-amber-300 border border-amber-500/25 ${
                                canFixBandGate ? 'hover:bg-amber-500/20 transition-colors' : 'cursor-default'
                            }`}
                        >
                            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{bandHint}</span>
                            {canFixBandGate && <span className="text-amber-400/70 shrink-0">switch</span>}
                        </button>
                    </div>
                )}
                {isProcessing && (
                    <div className="absolute inset-0 bg-base/50 flex items-center justify-center z-10 pointer-events-none">
                        <div className="flex items-center gap-3 bg-surface-2 px-4 py-3 rounded-lg border border-line-2">
                            <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                            <span className="text-slate-300 text-sm">Processing data...</span>
                        </div>
                    </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={chartDataWithWeather}
                        margin={{ top: 10, right: 10, left: -10, bottom: 5 }}
                        onClick={handleChartClick}
                        stackOffset="sign"
                    >
                        <defs>
                            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={chartColor} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#475569" />
                        {bandRuns.map((run) => (
                            <ReferenceArea
                                key={`${run.periodIdx}-${run.x1}`}
                                yAxisId="primary"
                                x1={run.x1}
                                x2={run.x2}
                                fill={periodColors[run.periodIdx]}
                                fillOpacity={BAND_OPACITY}
                                strokeOpacity={0}
                                ifOverflow="hidden"
                            />
                        ))}
                        <XAxis
                            dataKey="fullDate"
                            stroke="#94a3b8"
                            fontSize={10}
                            tick={AXIS_TICK}
                            tickLine={true}
                            axisLine={false}
                            minTickGap={40}
                            tickFormatter={(val) => (resolution === 'RAW' || resolution === 'HOURLY')
                                ? (spansMultipleDays ? val : val.split(' ')[1] || val)
                                : val}
                        />
                        <YAxis
                            yAxisId="primary"
                            stroke="#94a3b8"
                            fontSize={10}
                            tick={AXIS_TICK}
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
                                tick={AXIS_TICK}
                                tickLine={true}
                                axisLine={false}
                                tickFormatter={tempAxisFormatter}
                                domain={tempDomain}
                                width={25}
                            />
                        )}
                        <Tooltip
                            offset={28}
                            allowEscapeViewBox={{ x: true }}
                            content={(props) => (
                                <ChartTooltip
                                    {...props}
                                    isTouchDevice={isTouchDevice}
                                    activeIndex={activeIndex}
                                    tooltipRef={tooltipRef}
                                    metricMode={metricMode}
                                    energyUnit={energyUnit}
                                    showWeather={showWeather}
                                    temperatureUnit={temperatureUnit}
                                    getTooltipData={getTooltipData}
                                />
                            )}
                            {...(isTouchDevice ? { active: activeIndex !== null } : {})}
                        />
                        <Area
                            yAxisId="primary"
                            type="monotone"
                            dataKey={metricMode === 'energy' ? 'value' : metricMode === 'demand' ? 'demand' : 'cost'}
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

            {bandLegend.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap px-4 pb-2 -mt-1 text-xs">
                    {bandLegend.map(({ periodIdx, name, color }) => (
                        <span key={periodIdx} className="flex items-center gap-1.5 text-slate-400">
                            <span
                                className="w-2.5 h-2.5 rounded-sm"
                                style={{ backgroundColor: color, opacity: 0.55 }}
                            />
                            {name}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
});