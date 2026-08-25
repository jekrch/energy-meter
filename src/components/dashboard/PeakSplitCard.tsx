import React, { useMemo } from 'react';
import { CalendarClock } from 'lucide-react';
import { OFF_PEAK, PEAK_COLORS, type DataPoint, type PeakColorKey, type PeakSchedule } from '../../types';
import { computePeakSplit } from '../../utils/peakSchedule';
import { describeSchedule } from '../../utils/peakScheduleFormat';
import { formatEnergyValue, type EnergyUnit } from '../../utils/energyUnits';
import { formatDemandValue } from '../../utils/demandUnits';
import { formatCost, formatShortDate } from '../../utils/formatters';

// How the loaded range splits across the user's rate periods. "% of usage during
// peak" is the figure a TOU schedule is usually consulted for, so it leads.
//
// Energy and cost are sums; demand is a maximum. Commercial and industrial
// tariffs bill demand per rate period — the highest single interval that landed
// *inside* the on-peak window, not the highest of the month — so the peak column
// is the number those bills are actually built from.
//
// Unlike the chart bands this is not gated on resolution: the split is computed
// from the raw readings in view, not from the aggregated series.

interface PeakSplitCardProps {
    data: DataPoint[];
    schedule: PeakSchedule;
    energyUnit: EnergyUnit;
}

const OFF_PEAK_COLOR = '#475569'; // slate-600 — the unshaded remainder

export const PeakSplitCard = React.memo(function PeakSplitCard({
    data, schedule, energyUnit,
}: PeakSplitCardProps) {
    const split = useMemo(() => computePeakSplit(data, schedule), [data, schedule]);

    // Periods that never matched a reading would render as empty rows; drop them
    // but always keep off-peak, which is the baseline the rest is measured against.
    const rows = split.filter(entry => entry.readings > 0 || entry.periodIdx === OFF_PEAK);
    const peakEntries = split.filter(entry => entry.periodIdx !== OFF_PEAK);
    const onPeakShare = peakEntries.reduce((sum, entry) => sum + entry.energyShare, 0);
    // The highest interval in any peak period — what a demand charge assessed on
    // peak hours would bill. Tiers are separate charges, so the per-row figures
    // below stay the authoritative ones; this is the headline.
    const onPeakDemand = peakEntries.reduce(
        (max, entry) => (entry.maxDemand > max.maxDemand ? entry : max),
        peakEntries[0] ?? null,
    );

    if (!data.length) return null;

    const colorOf = (colorKey: PeakColorKey | null) =>
        colorKey ? PEAK_COLORS[colorKey] : OFF_PEAK_COLOR;

    // "6/10/25, 3:00 PM" — only ever a tooltip, so the row stays one line.
    const whenLabel = (ts: number) => {
        const d = new Date(ts * 1000);
        return `${formatShortDate(d)}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    };

    return (
        <div className="bg-surface-2 rounded-2xl border border-line hover:border-white/30 transition-colors duration-150 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-header-line flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="bg-red-400/10 border border-red-400/25 p-1.5 rounded-lg shrink-0">
                        <CalendarClock className="w-4 h-4 text-red-400" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-100">Peak Rate Split</h3>
                        <p className="text-xs text-slate-500 truncate">{describeSchedule(schedule)}</p>
                    </div>
                </div>

                {/* Summary Stats */}
                <div className="flex items-center gap-4 text-xs shrink-0">
                    <div className="text-left sm:text-right">
                        <span className="text-slate-500">On-Peak Usage</span>
                        <p className="text-red-400 font-mono slashed-zero tabular-nums font-medium">
                            {(onPeakShare * 100).toFixed(1)}%
                        </p>
                    </div>
                    {onPeakDemand && onPeakDemand.maxDemand > 0 && (
                        <div className="text-left sm:text-right" title={`${onPeakDemand.name}: ${whenLabel(onPeakDemand.maxDemandTs)}`}>
                            <span className="text-slate-500">On-Peak Demand</span>
                            <p className="text-red-400 font-mono slashed-zero tabular-nums font-medium">
                                {formatDemandValue(onPeakDemand.maxDemand)}
                                <span className="text-slate-500 font-normal ml-1">kW</span>
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
                <div className="flex h-2 rounded-full overflow-hidden bg-sunken">
                    {rows.map(entry => (
                        <div
                            key={entry.periodIdx}
                            title={`${entry.name}: ${(entry.energyShare * 100).toFixed(1)}%`}
                            style={{ width: `${entry.energyShare * 100}%`, backgroundColor: colorOf(entry.colorKey) }}
                        />
                    ))}
                </div>

                <div className="space-y-1.5">
                    {rows.map(entry => (
                        <div
                            key={entry.periodIdx}
                            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-sunken border border-line-2 text-xs"
                        >
                            <span
                                className="w-2.5 h-2.5 rounded-sm shrink-0"
                                style={{ backgroundColor: colorOf(entry.colorKey) }}
                            />
                            <span className="text-slate-300 truncate">{entry.name}</span>
                            <div className="flex-1 min-w-0" />
                            <span className="font-mono slashed-zero tabular-nums font-medium text-slate-300 whitespace-nowrap">
                                {formatEnergyValue(entry.energy, energyUnit)}
                                <span className="text-slate-500 font-normal ml-1">{energyUnit}</span>
                            </span>
                            {/* Max, not a sum — the interval a demand charge would bill. */}
                            <span
                                className="font-mono slashed-zero tabular-nums font-medium text-slate-300 w-20 text-right whitespace-nowrap"
                                title={entry.maxDemand > 0
                                    ? `Highest demand in ${entry.name}: ${whenLabel(entry.maxDemandTs)}`
                                    : undefined}
                            >
                                {entry.maxDemand > 0 ? (
                                    <>
                                        {formatDemandValue(entry.maxDemand)}
                                        <span className="text-slate-500 font-normal ml-1">kW</span>
                                    </>
                                ) : (
                                    <span className="text-slate-600">—</span>
                                )}
                            </span>
                            <span className="font-mono slashed-zero tabular-nums font-medium text-emerald-400 w-20 text-right">
                                {formatCost(entry.cost)}
                            </span>
                            <span className="font-mono slashed-zero tabular-nums text-slate-500 w-12 text-right">
                                {(entry.energyShare * 100).toFixed(1)}%
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});
