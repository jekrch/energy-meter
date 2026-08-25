/// <reference types="bun-types" />
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import '../test/happyDom';
import { chartFileName, exportChartAsImage, findChartSvg } from './chartExport';

// happy-dom has no canvas rasterizer and will not load a data: URL into an
// Image, so both are replaced with recording stand-ins. That is the point of
// the exercise: the assertions are about the commands the exporter issues —
// layout geometry, header text, the download it triggers — not about pixels.

type Cmd = { op: string; args: unknown[] };

interface CtxStub {
  cmds: Cmd[];
  fillStyle: string;
  font: string;
  textBaseline: string;
}

let ctx: CtxStub | null;
let canvases: HTMLCanvasElement[] = [];
let blobOut: Blob | null;
let imageShouldFail = false;
let createdUrls: string[] = [];
let revokedUrls: string[] = [];
let clicked: { download: string; href: string }[] = [];

const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToBlob = HTMLCanvasElement.prototype.toBlob;
const realImage = globalThis.Image;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

function makeCtx(): CtxStub {
  const cmds: Cmd[] = [];
  const record = (op: string) => (...args: unknown[]) => { cmds.push({ op, args }); };
  return {
    cmds,
    fillStyle: '',
    font: '',
    textBaseline: '',
    scale: record('scale'),
    fillRect: record('fillRect'),
    drawImage: record('drawImage'),
    fillText(this: { fillStyle: string; font: string }, ...args: unknown[]) {
      // Style is mutable state on the context; snapshot it with the call so a
      // test can tell the title band from the footer.
      cmds.push({ op: 'fillText', args: [...args, this.fillStyle, this.font] });
    },
    measureText: (t: string) => ({ width: String(t).length * 6 }),
  } as unknown as CtxStub;
}

/** An <svg> whose measured box is fixed, since happy-dom lays nothing out. */
function svgOfSize(width: number, height: number): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('class', 'recharts-surface');
  el.getBoundingClientRect = () => ({ width, height, x: 0, y: 0, top: 0, left: 0,
    right: width, bottom: height, toJSON: () => ({}) }) as DOMRect;
  return el;
}

const cmd = (op: string) => ctx!.cmds.filter((c) => c.op === op);

beforeEach(() => {
  ctx = makeCtx();
  canvases = [];
  blobOut = new Blob(['png'], { type: 'image/png' });
  imageShouldFail = false;
  createdUrls = [];
  revokedUrls = [];
  clicked = [];

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    canvases.push(this);
    return ctx as unknown as CanvasRenderingContext2D | null;
  } as typeof HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    queueMicrotask(() => cb(blobOut));
  } as typeof HTMLCanvasElement.prototype.toBlob;

  class ImageStub {
    width = 0;
    height = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    #src = '';
    get src() { return this.#src; }
    set src(v: string) {
      this.#src = v;
      queueMicrotask(() => (imageShouldFail ? this.onerror?.() : this.onload?.()));
    }
  }
  (globalThis as { Image: unknown }).Image = ImageStub;

  URL.createObjectURL = ((b: Blob) => {
    const u = `blob:stub/${createdUrls.length}`;
    void b;
    createdUrls.push(u);
    return u;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((u: string) => { revokedUrls.push(u); }) as typeof URL.revokeObjectURL;

  // Anchors are appended to the body and clicked; intercept before navigation.
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  };
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  HTMLCanvasElement.prototype.toBlob = realToBlob;
  (globalThis as { Image: unknown }).Image = realImage;
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  document.body.innerHTML = '';
});

describe('chartFileName', () => {
  it('slugifies a title behind the energy- prefix', () => {
    expect(chartFileName('Average cost by hour')).toBe('energy-average-cost-by-hour');
  });

  it('collapses runs of punctuation into a single hyphen', () => {
    expect(chartFileName('Cost ($) — by  hour!!')).toBe('energy-cost-by-hour');
  });

  it('trims leading and trailing hyphens left by stripped characters', () => {
    expect(chartFileName('  ***Peak***  ')).toBe('energy-peak');
  });

  it('falls back to "chart" when nothing survives slugification', () => {
    expect(chartFileName('***')).toBe('energy-chart');
    expect(chartFileName('')).toBe('energy-chart');
  });

  it('caps the slug so the name cannot overrun a filesystem limit', () => {
    const slug = chartFileName('a'.repeat(200)).replace('energy-', '');
    expect(slug.length).toBe(60);
  });

  it('applies the length cap last, so a cut landing on a separator keeps it', () => {
    // Documents current behavior: the trim runs before slice(0, 60), so a
    // title cut mid-separator keeps a trailing hyphen. Harmless in a file
    // name, but it means the cap — not the trim — has the last word.
    expect(chartFileName(`${'a'.repeat(59)} tail`)).toBe(`energy-${'a'.repeat(59)}-`);
  });
});

describe('findChartSvg', () => {
  it('finds the Recharts surface inside a wrapper', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div><svg class="recharts-surface"></svg></div>';
    expect(findChartSvg(host)).not.toBeNull();
  });

  it('ignores svgs that are not the chart surface', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg class="icon"></svg>';
    expect(findChartSvg(host)).toBeNull();
  });

  it('returns null for a null container rather than throwing', () => {
    expect(findChartSvg(null)).toBeNull();
  });
});

describe('exportChartAsImage', () => {
  const opts = { title: 'Average cost by hour', fileName: 'energy-avg' };

  it('triggers a PNG download named after the option', async () => {
    await exportChartAsImage(svgOfSize(600, 300), opts);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('energy-avg.png');
  });

  it('revokes the object URL it handed to the anchor', async () => {
    await exportChartAsImage(svgOfSize(600, 300), opts);
    expect(createdUrls).toHaveLength(1);
    expect(revokedUrls).toEqual(createdUrls);
  });

  it('removes the anchor from the document afterwards', async () => {
    await exportChartAsImage(svgOfSize(600, 300), opts);
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('sizes the canvas to the chart plus padding, times the scale factor', async () => {
    await exportChartAsImage(svgOfSize(600, 300), { ...opts, scale: 2 });
    // cssW = 600 + 24*2 = 648; cssH = 22 + 38 (no subtitle) + 300 + 30 = 390
    expect(canvases[0].width).toBe(648 * 2);
    expect(canvases[0].height).toBe(390 * 2);
    expect(cmd('scale')[0].args).toEqual([2, 2]);
  });

  it('defaults to 2x density when no scale is given', async () => {
    await exportChartAsImage(svgOfSize(100, 50), opts);
    expect(cmd('scale')[0].args).toEqual([2, 2]);
  });

  it('honours an explicit scale', async () => {
    await exportChartAsImage(svgOfSize(100, 50), { ...opts, scale: 3 });
    expect(cmd('scale')[0].args).toEqual([3, 3]);
    expect(canvases[0].width).toBe((100 + 48) * 3);
  });

  it('reserves a taller header band when a subtitle is present', async () => {
    await exportChartAsImage(svgOfSize(600, 300), { ...opts, subtitle: 'Weekdays only', scale: 1 });
    // headerH grows 38 -> 56, so the canvas gains exactly 18 css px.
    expect(canvases[0].height).toBe(408);
    // ...and the chart is drawn that much further down.
    expect(cmd('drawImage')[0].args.slice(1)).toEqual([24, 78, 600, 300]);
  });

  it('draws the chart below the header when there is no subtitle', async () => {
    await exportChartAsImage(svgOfSize(600, 300), { ...opts, scale: 1 });
    expect(cmd('drawImage')[0].args.slice(1)).toEqual([24, 60, 600, 300]);
  });

  it('writes the title, and the subtitle only when supplied', async () => {
    await exportChartAsImage(svgOfSize(600, 300), opts);
    const texts = cmd('fillText').map((c) => c.args[0]);
    expect(texts).toContain('Average cost by hour');
    expect(texts).not.toContain('Weekdays only');

    ctx = makeCtx();
    await exportChartAsImage(svgOfSize(600, 300), { ...opts, subtitle: 'Weekdays only' });
    expect(cmd('fillText').map((c) => c.args[0])).toContain('Weekdays only');
  });

  it('stamps the attribution and a date in the footer', async () => {
    await exportChartAsImage(svgOfSize(600, 300), { ...opts, scale: 1 });
    // fillText is recorded as [text, x, y, fillStyle, font].
    const footer = cmd('fillText').filter((c) => c.args[3] === '#64748b');
    expect(footer.map((c) => c.args[0])).toContain('gbmeter.com');
    // Both footer strings sit on the same baseline, 11px off the bottom.
    expect(new Set(footer.map((c) => c.args[2]))).toEqual(new Set([390 - 11]));
  });

  it('right-aligns the date stamp against the measured text width', async () => {
    await exportChartAsImage(svgOfSize(600, 300), { ...opts, scale: 1 });
    const footer = cmd('fillText').filter((c) => c.args[3] === '#64748b');
    const stamp = footer.find((c) => c.args[0] !== 'gbmeter.com')!;
    const width = String(stamp.args[0]).length * 6;
    expect(stamp.args[1]).toBe(648 - 24 - width);
  });

  it('paints the panel background over the whole canvas first', async () => {
    await exportChartAsImage(svgOfSize(600, 300), { ...opts, scale: 1 });
    expect(cmd('fillRect')[0].args).toEqual([0, 0, 648, 390]);
    expect(ctx!.cmds[1].op).toBe('fillRect'); // right after scale()
  });

  it('pins explicit dimensions on the clone without touching the live chart', async () => {
    const svg = svgOfSize(640, 320);
    await exportChartAsImage(svg, opts);
    expect(svg.getAttribute('width')).toBeNull();
    expect(svg.getAttribute('height')).toBeNull();
  });

  it('never asks for a zero-sized canvas from an unlaid-out chart', async () => {
    await exportChartAsImage(svgOfSize(0, 0), { ...opts, scale: 1 });
    // Both dimensions floor at 1, so the canvas keeps only the chrome plus 1px.
    expect(canvases[0].width).toBe(1 + 48);
  });

  it('rounds fractional layout measurements', async () => {
    await exportChartAsImage(svgOfSize(600.4, 299.6), { ...opts, scale: 1 });
    expect(cmd('drawImage')[0].args.slice(3)).toEqual([600, 300]);
  });

  it('rejects when the SVG cannot be rasterized', async () => {
    imageShouldFail = true;
    await expect(exportChartAsImage(svgOfSize(600, 300), opts))
      .rejects.toThrow('Failed to rasterize chart SVG');
    expect(clicked).toHaveLength(0);
  });

  it('rejects when no 2D context is available', async () => {
    ctx = null;
    await expect(exportChartAsImage(svgOfSize(600, 300), opts))
      .rejects.toThrow('Canvas 2D context unavailable');
  });

  it('rejects when the canvas cannot encode a PNG', async () => {
    blobOut = null;
    await expect(exportChartAsImage(svgOfSize(600, 300), opts))
      .rejects.toThrow('Failed to encode PNG');
    expect(clicked).toHaveLength(0);
  });
});
