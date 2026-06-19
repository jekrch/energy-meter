import React from 'react';

interface FilterChipProps {
    label: string;
    selected: boolean;
    onClick: () => void;
}

export const FilterChip = React.memo(function FilterChip({ label, selected, onClick }: FilterChipProps) {
    return (
        <button
            onClick={onClick}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${selected
                    ? 'bg-emerald-500/12 border-emerald-500/40 text-emerald-300'
                    : 'bg-surface-2 border-line-2 text-slate-400 hover:text-slate-200'
                }`}
        >
            {label}
        </button>
    );
});