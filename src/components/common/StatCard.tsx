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
    
    const isLongValue = value.length > 12;

    return (
        <div className="bg-slate-900 p-3 sm:p-4 md:p-5 rounded-xl shadow-sm border border-slate-800 flex items-start gap-3">
            
            <div className="p-2 md:p-3 bg-slate-800 rounded-lg shrink-0 border border-slate-700/50 self-start">
                {icon}
            </div>
            
        
            <div className="min-w-0 flex-1">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wide mb-0.5 truncate">
                    {label}
                </p>
                
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                    {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin text-emerald-400 my-0.5" />
                    ) : (
                        <span 
                            className={`
                                font-bold text-slate-100 break-words leading-snug
                                ${isLongValue ? 'text-sm sm:text-base md:text-lg' : 'text-base sm:text-lg md:text-xl'}
                            `}
                        >
                            {value}
                        </span>
                    )}
                    
                    {unit && (
                        <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
                            {unit}
                        </span>
                    )}
                </div>
                
                {sub && (
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        {sub}
                    </p>
                )}
            </div>
        </div>
    );
});