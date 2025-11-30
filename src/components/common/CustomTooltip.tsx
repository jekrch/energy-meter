import React from 'react';
import type { DataPoint } from '../../types';

interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: DataPoint & { label?: string } }>;
    resolution?: string;
}

export const CustomTooltip = React.memo(function CustomTooltip({ active, payload, resolution }: CustomTooltipProps) {
    if (active && payload?.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-slate-800 p-3 shadow-xl border border-slate-700 rounded-lg">
                <p className="text-slate-400 text-xs font-semibold mb-1">{data.fullDate || data.label}</p>
                <p className="text-emerald-400 font-bold text-lg">
                    {data.value.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Wh</span>
                </p>
                {resolution && resolution !== 'RAW' && resolution !== 'HOURLY' && (
                    <p className="text-xs text-slate-500 mt-1 italic">Aggregated total</p>
                )}
            </div>
        );
    }
    return null;
});