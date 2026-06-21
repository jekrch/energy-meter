import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { formatShortDate, formatCost } from '../../utils/formatters';
import { type EnergyUnit, formatEnergyValue } from '../../utils/energyUnits';
import type { DataPoint } from '../../types';

export type SortField = 'timestamp' | 'value' | 'cost' | 'duration';
export type SortDirection = 'asc' | 'desc';

interface TableViewProps {
    data: DataPoint[];
    page: number;
    setPage: React.Dispatch<React.SetStateAction<number>>;
    rowsPerPage: number;
    isSelectionSubset: boolean;
    energyUnit: EnergyUnit;
    sortField: SortField;
    setSortField: React.Dispatch<React.SetStateAction<SortField>>;
    sortDirection: SortDirection;
    setSortDirection: React.Dispatch<React.SetStateAction<SortDirection>>;
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    const hrs = seconds / 3600;
    return hrs % 1 === 0 ? `${hrs}h` : `${hrs.toFixed(1)}h`;
}

function formatDateTime(timestamp: number): string {
    const d = new Date(timestamp * 1000);
    return `${formatShortDate(d)} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

interface SortHeaderProps {
    label: string;
    field: SortField;
    currentSort: SortField;
    direction: SortDirection;
    onSort: (field: SortField) => void;
    align?: 'left' | 'right';
}

function SortHeader({ label, field, currentSort, direction, onSort, align = 'left' }: SortHeaderProps) {
    const isActive = currentSort === field;
    return (
        <th
            className={`px-4 py-3 bg-sunken cursor-pointer hover:bg-white/5 select-none transition-colors ${align === 'right' ? 'text-right' : ''}`}
            onClick={() => onSort(field)}
        >
            <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
                <span>{label}</span>
                <span className={`transition-colors ${isActive ? 'text-emerald-400' : 'text-slate-600'}`}>
                    {isActive ? (
                        direction === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                        <ChevronsUpDown className="w-3.5 h-3.5" />
                    )}
                </span>
            </div>
        </th>
    );
}

export const TableView = React.memo(function TableView({
    data, page, setPage, rowsPerPage, isSelectionSubset, energyUnit,
    sortField, setSortField, sortDirection, setSortDirection
}: TableViewProps) {
    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection(field === 'timestamp' ? 'asc' : 'desc');
        }
        setPage(1);
    };

    const sortedData = useMemo(() => {
        const sorted = [...data].sort((a, b) => {
            let aVal: number, bVal: number;
            switch (sortField) {
                case 'timestamp': aVal = a.timestamp; bVal = b.timestamp; break;
                case 'value': aVal = a.value; bVal = b.value; break;
                case 'cost': aVal = a.cost ?? 0; bVal = b.cost ?? 0; break;
                case 'duration': aVal = a.duration ?? 0; bVal = b.duration ?? 0; break;
                default: return 0;
            }
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });
        return sorted;
    }, [data, sortField, sortDirection]);

    const totalPages = Math.ceil(sortedData.length / rowsPerPage);

    const tableData = useMemo(() => {
        const start = (page - 1) * rowsPerPage;
        return sortedData.slice(start, start + rowsPerPage);
    }, [sortedData, page, rowsPerPage]);

    const hasCost = data.some(d => typeof d.cost === 'number' && d.cost > 0);
    const hasDuration = data.some(d => typeof d.duration === 'number' && d.duration > 0);

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-400 uppercase bg-sunken border-b border-line sticky top-0 z-10">
                        <tr>
                            <SortHeader label="Date/Time" field="timestamp" currentSort={sortField} direction={sortDirection} onSort={handleSort} />
                            {hasDuration && (
                                <SortHeader label="Interval" field="duration" currentSort={sortField} direction={sortDirection} onSort={handleSort} align="right" />
                            )}
                            <SortHeader label={`Energy (${energyUnit})`} field="value" currentSort={sortField} direction={sortDirection} onSort={handleSort} align="right" />
                            {hasCost && (
                                <SortHeader label="Cost" field="cost" currentSort={sortField} direction={sortDirection} onSort={handleSort} align="right" />
                            )}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-header-line">
                        {tableData.map((row, idx) => (
                            <tr key={idx} className="bg-surface hover:bg-white/5 transition-colors">
                                <td className="px-4 py-3 font-medium text-slate-300 whitespace-nowrap">
                                    {formatDateTime(row.timestamp)}
                                </td>
                                {hasDuration && (
                                    <td className="px-4 py-3 text-right text-slate-500 font-mono text-xs tabular-nums">
                                        {row.duration ? formatDuration(row.duration) : '—'}
                                    </td>
                                )}
                                <td className="px-4 py-3 text-right font-mono text-amber-400 tabular-nums">
                                    {formatEnergyValue(row.value, energyUnit)}
                                </td>
                                {hasCost && (
                                    <td className="px-4 py-3 text-right font-mono text-emerald-400 tabular-nums">
                                        {row.cost ? formatCost(row.cost) : '—'}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="border-t border-header-line p-4 bg-surface flex items-center justify-between text-sm">
                <span className="text-slate-500 text-xs">
                    {sortedData.length > 0
                        ? `${((page - 1) * rowsPerPage) + 1}–${Math.min(page * rowsPerPage, sortedData.length)} of ${sortedData.length.toLocaleString()}`
                        : 'No data'
                    }
                    {isSelectionSubset && ' (filtered)'}
                </span>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="p-2 hover:bg-white/5 text-slate-400 hover:text-emerald-400 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-medium text-slate-300 text-xs tabular-nums">
                        {page}/{totalPages || 1}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages || totalPages === 0}
                        className="p-2 hover:bg-white/5 text-slate-400 hover:text-emerald-400 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
});