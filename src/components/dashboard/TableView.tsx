import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatShortDate } from '../../utils/formatters';
import type { DataPoint } from '../../types';

interface TableViewProps {
    data: DataPoint[];
    page: number;
    setPage: React.Dispatch<React.SetStateAction<number>>;
    rowsPerPage: number;
    isSelectionSubset: boolean;
}

export const TableView = React.memo(function TableView({
    data, page, setPage, rowsPerPage, isSelectionSubset
}: TableViewProps) {

    const totalPages = Math.ceil(data.length / rowsPerPage);

    const tableData = React.useMemo(() => {
        const start = (page - 1) * rowsPerPage;
        return data.slice(start, start + rowsPerPage).map(d => {
            const dateObj = new Date(d.timestamp * 1000);
            return {
                ...d,
                date: formatShortDate(dateObj),
                time: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
        });
    }, [data, page, rowsPerPage]);

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-400 uppercase bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-3 bg-slate-800">Date</th>
                            <th className="px-6 py-3 bg-slate-800">Time</th>
                            <th className="px-6 py-3 bg-slate-800 text-right">Value (Wh)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {tableData.map((row, idx) => (
                            <tr key={idx} className="bg-slate-900 hover:bg-slate-800/80 transition-colors">
                                <td className="px-6 py-3 font-medium text-slate-300">{row.date}</td>
                                <td className="px-6 py-3 text-slate-400">{row.time}</td>
                                <td className="px-6 py-3 text-right font-mono text-emerald-400">{row.value}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="border-t border-slate-800 p-4 bg-slate-900 flex items-center justify-between text-sm">
                <span className="text-slate-500 text-xs">
                    {data.length > 0
                        ? `${((page - 1) * rowsPerPage) + 1}–${Math.min(page * rowsPerPage, data.length)} of ${data.length}`
                        : 'No data'
                    }
                    {isSelectionSubset && ' (selection)'}
                </span>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="p-2 hover:bg-slate-800 text-slate-400 hover:text-emerald-400 rounded disabled:opacity-30"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-medium text-slate-300 text-xs">{page}/{totalPages || 1}</span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages || totalPages === 0}
                        className="p-2 hover:bg-slate-800 text-slate-400 hover:text-emerald-400 rounded disabled:opacity-30"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
});