import { useCallback } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { downloadCsv } from '../../utils/chartDataExport';

interface DownloadChartDataButtonProps {
    /** Builds the CSV on click, so the rows are only serialized when asked for. */
    buildCsv: () => string;
    /** Download file name (without extension). */
    fileName: string;
    disabled?: boolean;
    className?: string;
}

// Sibling of DownloadChartButton: downloads the values behind the chart as CSV.
export function DownloadChartDataButton({ buildCsv, fileName, disabled = false, className = '' }: DownloadChartDataButtonProps) {
    const handleClick = useCallback(() => {
        downloadCsv(buildCsv(), fileName);
    }, [buildCsv, fileName]);

    return (
        <button
            onClick={handleClick}
            disabled={disabled}
            title="Download chart data as CSV"
            aria-label="Download chart data as CSV"
            className={`flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors disabled:opacity-50 disabled:pointer-events-none ${className}`}
        >
            <FileSpreadsheet className="w-4 h-4" />
        </button>
    );
}
