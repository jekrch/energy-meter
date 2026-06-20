/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { mergeDatasets, detectMergeWarnings, buildMergeName, type MergeSource } from './mergeData';
import type { DataPoint } from '../types';

const pts = (start: number, count: number, step = 3600, value = 100): DataPoint[] =>
  Array.from({ length: count }, (_, i) => ({
    timestamp: start + i * step,
    value,
    cost: value * 12,
    duration: step,
  }));

describe('mergeDatasets', () => {
  it('concatenates two non-overlapping datasets into a sorted result', () => {
    const a: MergeSource = { fileName: 'a', data: pts(1000, 3) };
    const b: MergeSource = { fileName: 'b', data: pts(1000 + 3 * 3600, 3) };
    const result = mergeDatasets([a, b]);

    expect(result.data).toHaveLength(6);
    expect(result.overlapCount).toBe(0);
    for (let i = 1; i < result.data.length; i++) {
      expect(result.data[i].timestamp).toBeGreaterThan(result.data[i - 1].timestamp);
    }
  });

  it('sorts an out-of-order source array ascending', () => {
    const a: MergeSource = { fileName: 'later', data: pts(1000 + 5 * 3600, 3) };
    const b: MergeSource = { fileName: 'earlier', data: pts(1000, 3) };
    const result = mergeDatasets([a, b]);

    const timestamps = result.data.map((d) => d.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((x, y) => x - y));
  });

  it('de-duplicates overlapping intervals and counts them without double-counting totals', () => {
    // b shares 2 intervals with a (the last two of a == first two of b).
    const a: MergeSource = { fileName: 'a', data: pts(1000, 4, 3600, 100) };
    const b: MergeSource = { fileName: 'b', data: pts(1000 + 2 * 3600, 4, 3600, 200) };
    const result = mergeDatasets([a, b]);

    // 4 + 4 = 8 points, 2 collide -> 6 unique timestamps.
    expect(result.data).toHaveLength(6);
    expect(result.overlapCount).toBe(2);
    // No duplicate timestamps remain.
    const unique = new Set(result.data.map((d) => d.timestamp));
    expect(unique.size).toBe(6);
  });

  it('last-listed source wins on a timestamp collision', () => {
    const a: MergeSource = { fileName: 'a', data: [{ timestamp: 1000, value: 100, cost: 1200 }] };
    const b: MergeSource = { fileName: 'b', data: [{ timestamp: 1000, value: 999, cost: 9999 }] };
    const result = mergeDatasets([a, b]);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].value).toBe(999);
    expect(result.overlapCount).toBe(1);
  });

  it('reports per-source provenance metadata', () => {
    const a: MergeSource = { fileName: 'jan.xml', data: pts(1000, 3) };
    const b: MergeSource = { fileName: 'feb.xml', data: pts(1000 + 3 * 3600, 5) };
    const result = mergeDatasets([a, b]);

    expect(result.sources).toEqual([
      { fileName: 'jan.xml', startDate: 1000, endDate: 1000 + 2 * 3600, recordCount: 3 },
      { fileName: 'feb.xml', startDate: 1000 + 3 * 3600, endDate: 1000 + 7 * 3600, recordCount: 5 },
    ]);
  });
});

describe('detectMergeWarnings', () => {
  it('returns no warnings for homogeneous sources', () => {
    const a: MergeSource = { fileName: 'a', data: pts(1000, 10, 3600, 100) };
    const b: MergeSource = { fileName: 'b', data: pts(50000, 10, 3600, 110) };
    expect(detectMergeWarnings([a, b])).toEqual([]);
  });

  it('warns on very different reading intervals', () => {
    const hourly: MergeSource = { fileName: 'h', data: pts(1000, 10, 3600, 100) };
    const daily: MergeSource = { fileName: 'd', data: pts(50000, 10, 86400, 100) };
    const warnings = detectMergeWarnings([hourly, daily]);
    expect(warnings.some((w) => /interval/i.test(w))).toBe(true);
  });

  it('warns on very different usage magnitudes', () => {
    const small: MergeSource = { fileName: 's', data: pts(1000, 10, 3600, 10) };
    const large: MergeSource = { fileName: 'l', data: pts(50000, 10, 3600, 5000) };
    const warnings = detectMergeWarnings([small, large]);
    expect(warnings.some((w) => /magnitude/i.test(w))).toBe(true);
  });
});

describe('buildMergeName', () => {
  it('joins two base names', () => {
    expect(buildMergeName(['Jan.xml', 'Feb.xml'])).toBe('Jan + Feb (merged)');
  });

  it('summarizes many files', () => {
    expect(buildMergeName(['Jan.xml', 'Feb.xml', 'Mar.xml', 'Apr.xml'])).toBe('Jan + 3 more (merged)');
  });
});
