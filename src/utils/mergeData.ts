import type { DataPoint } from '../types';

// Combine two or more previously-loaded datasets into a single continuous
// history. The main hazard is overlapping intervals: if a user merges a "Jan"
// file with a "Dec–Jan" file, the shared days appear twice and would
// double-count totals. We de-duplicate by timestamp (last-listed source wins)
// and report how many collisions happened so the UI can surface it.

export interface MergeSource {
  fileName: string;
  data: DataPoint[];
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
  sources: MergeSourceMeta[];
}

// A merge result enriched with everything the preview/confirm UI needs.
export interface MergePreview extends MergeResult {
  warnings: string[];
  resolution: string;
  defaultName: string;
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

  return { data, overlapCount, sources: sourceMeta };
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
      warnings.push('These files use different reading intervals — they may not line up cleanly.');
    }
  }

  const magnitudes = sources.map((s) => medianValue(s.data)).filter((x): x is number => x != null);
  if (magnitudes.length >= 2) {
    const min = Math.min(...magnitudes);
    const max = Math.max(...magnitudes);
    if (min > 0 && max / min >= 20) {
      warnings.push('These files have very different usage magnitudes — they may be different meters or flow directions.');
    }
  }

  return warnings;
}
