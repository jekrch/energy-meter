import React from 'react';
import { Loader2 } from 'lucide-react';

interface StatCardProps {
    icon: React.ReactElement;
    label: string;
    value: string;
    unit?: string;
    sub?: string;
    loading?: boolean;
}

export const StatCard = React.memo(function StatCard({ icon, label, value, unit, sub, loading }: StatCardProps) {
    return (
        <div className="bg-slate-900 p-4 md:p-5 rounded-xl shadow-sm border border-slate-800 flex items-start gap-3">
            <div className="p-2 md:p-3 bg-slate-800 rounded-lg shrink-0 border border-slate-700/50">{icon}</div>
            <div className="min-w-0">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wide mb-0.5">{label}</p>
                <div className="flex flex-wrap items-baseline gap-x-1 line-clamp-3">
                    {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                    ) : (
                        <span className="text-lg md:text-xl font-bold text-slate-100">{value}</span>
                    )}
                    {unit && <span className="text-xs text-slate-500 font-medium">{unit}</span>}
                </div>
                {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
            </div>
        </div>
    );
});