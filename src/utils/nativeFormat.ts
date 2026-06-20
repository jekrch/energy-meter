import type { DataPoint } from '../types';
import type { IntervalBlockMeta, ParsedGreenButton } from './dataUtils';

// Native, lossless file format for the merge feature.
//
// Unlike the CSV/JSON export (which converts energy/cost into display units and
// formats timestamps as locale strings), this format preserves the internal
// `DataPoint` shape exactly — epoch-second timestamps, Wh energy, micro-dollar
// cost, and second durations — so a downloaded merged file re-loads through the
// normal upload pipeline as a pure pass-through with no unit guessing.
//
// `data` rows use short keys (t/v/c/d) to keep multi-year datasets small
// (a year of 15-minute readings is ~35k points).

export const NATIVE_FORMAT = 'energy-meter';
export const NATIVE_VERSION = 1;

export interface NativeSourceMeta {
  fileName: string;
  startDate: number;   // epoch seconds
  endDate: number;     // epoch seconds
  recordCount: number;
}

interface NativeRow {
  t: number;           // timestamp, epoch seconds
  v: number;           // value, Wh
  c: number;           // cost, micro-dollars
  d?: number;          // duration, seconds
}

interface NativeFile {
  format: string;
  version: number;
  fileName: string;
  createdAt: number;   // epoch ms
  resolution: string;
  sources: NativeSourceMeta[];
  data: NativeRow[];
}

export interface SerializeNativeOptions {
  fileName: string;
  resolution: string;
  sources: NativeSourceMeta[];
}

export function serializeNativeFile(data: DataPoint[], opts: SerializeNativeOptions): string {
  const payload: NativeFile = {
    format: NATIVE_FORMAT,
    version: NATIVE_VERSION,
    fileName: opts.fileName,
    createdAt: Date.now(),
    resolution: opts.resolution,
    sources: opts.sources,
    data: data.map((d) => {
      const row: NativeRow = { t: d.timestamp, v: d.value, c: d.cost };
      if (d.duration != null) row.d = d.duration;
      return row;
    }),
  };
  return JSON.stringify(payload);
}

// Attempt to parse a native energy-meter JSON file into the shared
// ParsedGreenButton shape so it flows through the existing single-block upload
// pipeline unchanged. Returns null on any mismatch — a regular `{...}` JSON file
// then falls through to the CSV parser harmlessly.
export function tryParseNativeJson(textData: string): ParsedGreenButton | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textData);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Partial<NativeFile>;
  if (obj.format !== NATIVE_FORMAT) return null;
  if (!Array.isArray(obj.data)) return null;

  const data: DataPoint[] = [];
  for (const row of obj.data) {
    if (!row || typeof row.t !== 'number' || typeof row.v !== 'number') return null;
    data.push({
      timestamp: row.t,
      value: row.v,
      cost: typeof row.c === 'number' ? row.c : 0,
      duration: typeof row.d === 'number' ? row.d : undefined,
    });
  }
  if (!data.length) return null;

  data.sort((a, b) => a.timestamp - b.timestamp);

  const first = data[0];
  const last = data[data.length - 1];
  let totalValue = 0;
  let totalCost = 0;
  for (const d of data) { totalValue += d.value; totalCost += d.cost; }

  const meta: IntervalBlockMeta = {
    id: 'native-0',
    flowDirectionLabel: 'Unknown flow',
    uomLabel: 'Wh',
    powerOfTenMultiplier: 0,
    commodityLabel: 'Electricity',
    intervalLength: first?.duration,
    startTimestamp: first?.timestamp ?? 0,
    endTimestamp: last?.timestamp ?? 0,
    readingCount: data.length,
    totalValue,
    totalCost,
    isCumulative: false,
  };

  return { blocks: [{ meta, data }] };
}

// Sanitize a user-supplied merge name into a safe filename fragment.
function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned || 'dataset';
}

// Build the native JSON and trigger a browser download (mirrors the blob /
// object-URL / anchor pattern used by ExportModal).
export function downloadNativeFile(data: DataPoint[], opts: SerializeNativeOptions): void {
  const json = serializeNativeFile(data, opts);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `energy-merged-${sanitizeFilename(opts.fileName)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
