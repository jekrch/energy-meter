import React from 'react';
import type { DataPoint } from '../../types';
import { formatCost } from '../../utils/formatters';


interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: DataPoint & { label?: string } }>;
    resolution?: string;
}

export const CustomTooltip = React.memo(function CustomTooltip({ active, payload, resolution }: CustomTooltipProps) {
    if (active && payload?.length) {
        const data = payload[0].payload;
        const hasCost = typeof data.cost === 'number' && data.cost > 0;
        
        return (
            <div className="bg-slate-800 p-3 shadow-xl border border-slate-700 rounded-lg min-w-[140px]">
                <p className="text-slate-400 text-xs font-semibold mb-2">
                    {data.fullDate || data.label}
                </p>
                
                {/* Energy */}
                <p className="text-amber-200 font-bold text-lg">
                    {data.value.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Wh</span>
                </p>
                
                {/* Cost */}
                {hasCost && (
                    <p className="text-emerald-400 font-semibold text-base mt-1">
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