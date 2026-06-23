// Exports a Recharts chart as a PNG image with a descriptive header band.
//
// Recharts renders a plain <svg>, so we serialize it, rasterize it through an
// <Image>, then composite it onto a canvas beneath a title/subtitle header that
// matches the app's dark theme. No external dependency required.

const BG = '#182133';        // --color-surface-2 (panel background)
const TITLE_COLOR = '#e2e8f0';   // slate-200
const SUBTITLE_COLOR = '#94a3b8'; // slate-400
const FOOTER_COLOR = '#64748b';  // slate-500

const SANS = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";

export interface ChartExportOptions {
    /** Descriptive header, e.g. "Average cost by hour". */
    title: string;
    /** Optional second line, e.g. active filters. */
    subtitle?: string;
    /** Download file name (without extension). */
    fileName: string;
    /** Pixel density multiplier for a crisp image. Defaults to 2. */
    scale?: number;
}

/**
 * Serialize a chart's <svg>, draw it onto a canvas under a descriptive header,
 * and trigger a PNG download.
 */
export async function exportChartAsImage(
    svg: SVGSVGElement,
    options: ChartExportOptions
): Promise<void> {
    const { title, subtitle, fileName, scale = 2 } = options;

    const rect = svg.getBoundingClientRect();
    const chartW = Math.max(1, Math.round(rect.width));
    const chartH = Math.max(1, Math.round(rect.height));

    // Clone so we can pin explicit dimensions without disturbing the live chart.
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', String(chartW));
    clone.setAttribute('height', String(chartH));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const svgString = new XMLSerializer().serializeToString(clone);
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

    const img = new Image();
    img.width = chartW;
    img.height = chartH;
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to rasterize chart SVG'));
        img.src = svgUrl;
    });

    const padX = 24;
    const padTop = 22;
    const headerH = subtitle ? 56 : 38;
    const footerH = 30;

    const cssW = chartW + padX * 2;
    const cssH = padTop + headerH + chartH + footerH;

    const canvas = document.createElement('canvas');
    canvas.width = cssW * scale;
    canvas.height = cssH * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.scale(scale, scale);

    // Background
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cssW, cssH);

    // Title
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = TITLE_COLOR;
    ctx.font = `600 16px ${SANS}`;
    ctx.fillText(title, padX, padTop + 14);

    // Subtitle (filters)
    if (subtitle) {
        ctx.fillStyle = SUBTITLE_COLOR;
        ctx.font = `13px ${SANS}`;
        ctx.fillText(subtitle, padX, padTop + 36);
    }

    // Chart
    ctx.drawImage(img, padX, padTop + headerH, chartW, chartH);

    // Footer attribution + date
    ctx.fillStyle = FOOTER_COLOR;
    ctx.font = `11px ${SANS}`;
    const stamp = new Date().toLocaleDateString();
    ctx.fillText('gbmeter.com', padX, cssH - 11);
    const stampW = ctx.measureText(stamp).width;
    ctx.fillText(stamp, cssW - padX - stampW, cssH - 11);

    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) throw new Error('Failed to encode PNG');

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Find the chart <svg> within a container (Recharts wraps it in a div). */
export function findChartSvg(container: HTMLElement | null): SVGSVGElement | null {
    return container?.querySelector('svg.recharts-surface') ?? null;
}

/** Build a filesystem-safe file name from a title. */
export function chartFileName(title: string): string {
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'chart';
    return `energy-${slug}`;
}
