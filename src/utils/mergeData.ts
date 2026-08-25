import type { DataPoint, PeakSchedule } from '../types';
import { scheduleFingerprint } from './peakSchedule';

// Combine two or more previously-loaded datasets into a single continuous
// history. The main hazard is overlapping intervals: if a user merges a "Jan"
// file with a "Dec–Jan" file, the shared days appear twice and would
// double-count totals. We de-duplicate by timestamp (last-listed source wins)
// and report how many collisions happened so the UI can surface it.

export interface MergeSource {
  fileName: string;
  data: DataPoint[];
  // Optional provenance persisted with history entries (schema v2). When present
  // on every source these enable real compatibility checks; when absent (older
  // v1 rows) we fall back to the magnitude/interval heuristics below.
  flowDirection?: number;
  commodity?: number;
  intervalLength?: number;
  // The peak rate schedule stored with this source, if any.
  peakSchedule?: PeakSchedule;
}

export interface MergeSourceMeta {
  fileName: string;
  startDate: number;   // epoch seconds
  endDate: number;     // epoch seconds
  recordCount: number;
}

export interface MergeResult {
  data: DataPoint[];
  overlapCount: number;            // intervals that collided and were deduped
  gapCount: number;                // boundaries where readings are missing
  sources: MergeSourceMeta[];
  // The first source schedule that defines any period. A merged range may span
  // a tariff change, so this is a starting point, not an authoritative answer —
  // see the differing-schedule warning below.
  peakSchedule?: PeakSchedule;
}

// A merge result enriched with everything the preview/confirm UI needs.
export interface MergePreview extends MergeResult {
  warnings: string[];   // non-blocking heuristic concerns
  blockers: string[];   // true incompatibilities — merge should be prevented
  resolution: string;
  defaultName: string;
  // Provenance carried onto the merged entry when every source agrees, so the
  // result stays compatible for future re-merges. Undefined when sources differ
  // or lack the metadata.
  flowDirection?: number;
  commodity?: number;
}

// The single defined value shared by every source, or undefined if they
// disagree or none is defined.
export function commonValue(values: (number | undefined)[]): number | undefined {
  const unique = distinct(values);
  return unique.length === 1 ? unique[0] : undefined;
}

// Strip a file extension for a friendlier default merge name.
function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || fileName;
}

// Build a default merge name like "Jan + Feb (merged)" or, for many files,
// "Jan + 3 more (merged)".
export function buildMergeName(fileNames: string[]): string {
  const names = fileNames.map(baseName);
  if (names.length === 0) return 'Merged data';
  if (names.length <= 2) return `${names.join(' + ')} (merged)`;
  return `${names[0]} + ${names.length - 1} more (merged)`;
}

export function mergeDatasets(sources: MergeSource[]): MergeResult {
  // Tag each point with its source order so ties break in favour of the
  // later-listed source after sorting.
  const tagged: { point: DataPoint; order: number }[] = [];
  sources.forEach((source, order) => {
    for (const point of source.data) tagged.push({ point, order });
  });

  tagged.sort((a, b) => a.point.timestamp - b.point.timestamp || a.order - b.order);

  const data: DataPoint[] = [];
  let overlapCount = 0;
  for (const { point } of tagged) {
    const prev = data[data.length - 1];
    if (prev && prev.timestamp === point.timestamp) {
      // Collision: keep the later reading (last-source-wins) and count it.
      data[data.length - 1] = point;
      overlapCount++;
    } else {
      data.push(point);
    }
  }

  const gapCount = countGaps(data);

  const sourceMeta: MergeSourceMeta[] = sources.map((source) => {
    let start = Infinity;
    let end = -Infinity;
    for (const p of source.data) {
      if (p.timestamp < start) start = p.timestamp;
      if (p.timestamp > end) end = p.timestamp;
    }
    return {
      fileName: source.fileName,
      startDate: Number.isFinite(start) ? start : 0,
      endDate: Number.isFinite(end) ? end : 0,
      recordCount: source.data.length,
    };
  });

  const peakSchedule = sources.find(s => s.peakSchedule?.periods.length)?.peakSchedule;

  return { data, overlapCount, gapCount, sources: sourceMeta, ...(peakSchedule ? { peakSchedule } : {}) };
}

// Count boundaries in a sorted, deduped series where at least one interval is
// missing — i.e. the step to the next reading is meaningfully larger than the
// dataset's typical interval. Used to tell the user the merged timeline has
// holes (we never synthesise fill data). Returns the number of gap locations,
// not the number of missing intervals.
function countGaps(data: DataPoint[]): number {
  const typical = medianInterval(data);
  if (typical == null) return 0;
  let gaps = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i].timestamp - data[i - 1].timestamp > typical * 1.5) gaps++;
  }
  return gaps;
}

// Median gap between consecutive (sorted) readings — used as a cheap interval
// length proxy for the heterogeneity heuristic.
function medianInterval(data: DataPoint[]): number | null {
  if (data.length < 2) return null;
  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].timestamp - sorted[i - 1].timestamp);
  gaps.sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)];
  return mid > 0 ? mid : null;
}

function medianValue(data: DataPoint[]): number | null {
  if (!data.length) return null;
  const values = data.map((d) => d.value).sort((a, b) => a - b);
  const mid = values[Math.floor(values.length / 2)];
  return mid > 0 ? mid : null;
}

// Phase 1 guardrail: history entries don't store flow direction / commodity, so
// we can only warn heuristically. Merging is only safe across the same
// meter/commodity/flow direction; wildly different interval lengths or value
// magnitudes suggest the user is mixing incompatible series. Non-blocking.
export function detectMergeWarnings(sources: MergeSource[]): string[] {
  const warnings: string[] = [];

  const intervals = sources.map((s) => medianInterval(s.data)).filter((x): x is number => x != null);
  if (intervals.length >= 2) {
    const min = Math.min(...intervals);
    const max = Math.max(...intervals);
    if (min > 0 && max / min >= 4) {
      warnings.push('These files use different reading intervals and may not line up cleanly.');
    }
  }

  const magnitudes = sources.map((s) => medianValue(s.data)).filter((x): x is number => x != null);
  if (magnitudes.length >= 2) {
    const min = Math.min(...magnitudes);
    const max = Math.max(...magnitudes);
    if (min > 0 && max / min >= 20) {
      warnings.push('These files have very different usage magnitudes. They may be different meters or flow directions.');
    }
  }

  // A warning rather than a blocker: the merged range may genuinely straddle a
  // tariff change, in which case neither schedule is wrong for the whole span.
  const fingerprints = new Set(
    sources
      .map((s) => s.peakSchedule)
      .filter((s): s is PeakSchedule => (s?.periods.length ?? 0) > 0)
      .map(scheduleFingerprint),
  );
  if (fingerprints.size > 1) {
    warnings.push('These files carry different peak rate schedules. The merged file keeps the first one.');
  }

  return warnings;
}

// Collect distinct defined values for a numeric provenance field across sources.
function distinct(values: (number | undefined)[]): number[] {
  return [...new Set(values.filter((v): v is number => v != null))];
}

// Phase 2 guardrail: once history entries persist flow direction / commodity
// (schema v2), we can detect *true* incompatibilities rather than guessing.
// Merging a "delivered" series with a "received" series, or electricity with
// gas, produces nonsense — so these are blockers, not warnings. Sources missing
// the metadata (legacy v1 rows) are simply skipped here and left to the
// heuristic warnings.
export function detectMergeBlockers(sources: MergeSource[]): string[] {
  const blockers: string[] = [];

  if (distinct(sources.map((s) => s.flowDirection)).length > 1) {
    blockers.push('These files record different flow directions (e.g. delivered vs. received). Merging them would mix unrelated readings.');
  }

  if (distinct(sources.map((s) => s.commodity)).length > 1) {
    blockers.push('These files record different commodities (e.g. electricity vs. gas) and cannot be combined.');
  }

  return blockers;
}
