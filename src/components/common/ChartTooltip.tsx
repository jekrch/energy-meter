import React from 'react';
import { formatCost } from '../../utils/formatters';
import { type EnergyUnit, formatEnergyValue } from '../../utils/energyUnits';
import { formatDemandValue } from '../../utils/demandUnits';
import type { MetricMode } from '../../types';
const formatTemp = (temp: number, unit: 'C' | 'F') => {
    if (unit === 'F') return `${Math.round(temp * 9 / 5 + 32)}°F`;
    return `${Math.round(temp)}°C`;
};

export interface TooltipData {
    label: string;
    energyValue: number;
    costValue?: number;
    demandValue?: number;
    temperature?: number;
    count?: number;
    countLabel?: string;
    isIncomplete?: boolean;
    isPartial?: boolean;
    noCompleteData?: boolean;
    periodName?: string;
    showAggregatedNote?: boolean;
}

interface ChartTooltipProps {
    active?: boolean;
    payload?: readonly any[];
    isTouchDevice: boolean;
    activeIndex: number | null;
    tooltipRef: React.RefObject<HTMLDivElement | null>;
    metricMode: MetricMode;
    energyUnit: EnergyUnit;
    showWeather: boolean;
    temperatureUnit: 'C' | 'F';
    getTooltipData: (payload: any) => TooltipData | null;
}

export const ChartTooltip = React.memo(function ChartTooltip({
    active,
    payload,
    isTouchDevice,
    activeIndex,
    tooltipRef,
    metricMode,
    energyUnit,
    showWeather,
    temperatureUnit,
    getTooltipData
}: ChartTooltipProps) {
    // On touch devices, only show if we have an activeIndex set
    if (isTouchDevice && activeIndex === null) return null;

    if (!active || !payload?.length) return null;

    const data = getTooltipData(payload[0].payload);
    if (!data) return null;

    const hasCost = typeof data.costValue === 'number' && data.costValue > 0;
    const hasDemand = typeof data.demandValue === 'number';
    const hasTemp = showWeather && typeof data.temperature === 'number';

    return (
        <div
            ref={tooltipRef}
            className="bg-surface-2 p-3 shadow-float border border-line-2 rounded-lg min-w-[150px] opacity-95"
        >
            <p className="text-slate-400 text-xs font-semibold mb-2">
                {data.label}
                {data.isPartial && <span className="ml-2 text-slate-500 font-normal">(partial)</span>}
            </p>

            {data.noCompleteData ? (
                <p className="text-slate-500 text-sm italic">
                    No complete {data.periodName} in range
                </p>
            ) : (
                <>
                    <p className={`font-mono font-bold slashed-zero tabular-nums ${metricMode === 'energy' ? 'text-amber-400 text-lg' : 'text-slate-400 text-sm'}`}>
                        {formatEnergyValue(data.energyValue, energyUnit)}{' '}
                        <span className="text-xs text-slate-500 font-normal">{energyUnit}</span>
                    </p>

                    {hasDemand && (
                        <p className={`font-mono font-semibold mt-1 slashed-zero tabular-nums ${metricMode === 'demand' ? 'text-violet-400 text-lg' : 'text-slate-400 text-sm'}`}>
                            {formatDemandValue(data.demandValue!)}{' '}
                            <span className="text-xs text-slate-500 font-normal">kW</span>
                        </p>
                    )}

                    {hasCost && (
                        <p className={`font-mono font-semibold mt-1 slashed-zero tabular-nums ${metricMode === 'cost' ? 'text-emerald-400 text-lg' : 'text-slate-400 text-sm'}`}>
                            {formatCost(data.costValue!)}
                        </p>
                    )}

                    {hasTemp && (
                        <p className="text-sky-400 font-mono font-medium mt-1.5 text-sm slashed-zero tabular-nums">
                            {formatTemp(data.temperature!, temperatureUnit)}
                            <span className="text-xs text-slate-500 font-normal ml-1">avg temp</span>
                        </p>
                    )}

                    {data.countLabel && (
                        <p className="text-xs text-slate-500 mt-2">{data.countLabel}</p>
                    )}

                    {data.showAggregatedNote && (
                        <p className="text-xs text-slate-500 mt-2 italic">Aggregated total</p>
                    )}
                </>
            )}

            {data.isPartial && (
                <p className="text-xs text-slate-500 mt-1 italic">
                    Partial period — not fully in range
                </p>
            )}
        </div>
    );
});