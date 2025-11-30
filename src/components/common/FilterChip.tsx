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
            className={`px-2 py-1 text-xs font-medium rounded transition-all ${selected
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
                }`}
        >
            {label}
        </button>
    );
});