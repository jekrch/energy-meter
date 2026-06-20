import React from 'react';
import { Loader2 } from 'lucide-react';

interface StatCardProps {
    icon: React.ReactElement;
    label: string;
    value: string;
    unit?: string;
    sub?: string;
    /** Leading token of the sub line, rendered in the accent color (e.g. a date or key figure). */
    subHighlight?: string;
    loading?: boolean;
    /** Tailwind bg utility for the left accent bar, e.g. "bg-emerald-400" */
    accent?: string;
}

/**
 * Maps the accent rail color to a matching tinted icon chip (subtle fill + border)
 * plus the accent text color used to highlight a key figure in the sub line.
 * Full class names are listed statically so Tailwind's JIT picks them up.
 */
const accentStyles: Record<string, { bg: string; border: string; text: string }> = {
    'bg-emerald-400': { bg: 'bg-emerald-400/10', border: 'border-emerald-400/25', text: 'text-emerald-400' },
    'bg-amber-400': { bg: 'bg-amber-400/10', border: 'border-amber-400/25', text: 'text-amber-400' },
    'bg-violet-400': { bg: 'bg-violet-400/10', border: 'border-violet-400/25', text: 'text-violet-400' },
    'bg-blue-400': { bg: 'bg-blue-400/10', border: 'border-blue-400/25', text: 'text-blue-400' },
    'bg-red-400': { bg: 'bg-red-400/10', border: 'border-red-400/25', text: 'text-red-400' },
    // Neutral: for semantically-neutral KPIs (Total, Avg) so color stays reserved for meaning.
    'bg-slate-500': { bg: 'bg-slate-500/10', border: 'border-slate-500/20', text: 'text-slate-400' },
};

export const StatCard = React.memo(function StatCard({ icon, label, value, unit, sub, subHighlight, loading, accent = 'bg-emerald-400' }: StatCardProps) {

    const isLongValue = value.length > 12;
    const style = accentStyles[accent] ?? { bg: 'bg-sunken', border: 'border-line-2', text: 'text-slate-400' };

    return (
        <div className="relative bg-surface-2 border border-line-2 hover:border-white/30 transition-colors duration-150 rounded-xl p-3 sm:p-3.5 overflow-hidden">

            {/* Accent rail — kept as a soft hairline so color reads as punctuation, not decoration */}
            <div className={`absolute left-0 top-0 bottom-0 w-0.5 rounded-r opacity-60 ${accent}`} />

            <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
                <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-md ${style.bg} border ${style.border} flex items-center justify-center shrink-0`}>
                    {icon}
                </div>
                <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 truncate">
                    {label}
                </p>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-1.5">
                {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-emerald-400 my-0.5" />
                ) : (
                    <span
                        className={`
                            font-mono font-bold text-slate-50 tracking-tight wrap-break-word leading-tight slashed-zero tabular-nums
                            ${isLongValue ? 'text-base sm:text-lg md:text-xl' : 'text-lg sm:text-xl'}
                        `}
                    >
                        {value}
                    </span>
                )}

                {unit && (
                    <span className="text-xs text-slate-400 font-medium whitespace-nowrap">
                        {unit}
                    </span>
                )}
            </div>

            {(sub || subHighlight) && (
                <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 leading-relaxed truncate">
                    {subHighlight && (
                        <span className={`font-semibold ${style.text}`}>{subHighlight}</span>
                    )}
                    {subHighlight && sub ? ' ' : ''}
                    {sub}
                </p>
            )}
        </div>
    );
});
