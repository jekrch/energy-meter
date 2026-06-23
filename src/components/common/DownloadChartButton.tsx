import { useCallback, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { exportChartAsImage, findChartSvg, chartFileName } from '../../utils/chartExport';

interface DownloadChartButtonProps {
    /** Ref to the element that wraps the Recharts chart. */
    containerRef: React.RefObject<HTMLDivElement | null>;
    /** Descriptive header drawn at the top of the exported image. */
    title: string;
    /** Optional second header line (e.g. active filters). */
    subtitle?: string;
    className?: string;
}

// Small icon button that exports the nearest chart <svg> as a PNG with a
// descriptive header. Disabled while no chart is mounted or an export is running.
export function DownloadChartButton({ containerRef, title, subtitle, className = '' }: DownloadChartButtonProps) {
    const [busy, setBusy] = useState(false);

    const handleClick = useCallback(async () => {
        const svg = findChartSvg(containerRef.current);
        if (!svg) return;
        setBusy(true);
        try {
            await exportChartAsImage(svg, { title, subtitle, fileName: chartFileName(title) });
        } catch (err) {
            console.error('Chart export failed', err);
        } finally {
            setBusy(false);
        }
    }, [containerRef, title, subtitle]);

    return (
        <button
            onClick={handleClick}
            disabled={busy}
            title="Download chart as image"
            aria-label="Download chart as image"
            className={`flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors disabled:opacity-50 disabled:pointer-events-none ${className}`}
        >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        </button>
    );
}
