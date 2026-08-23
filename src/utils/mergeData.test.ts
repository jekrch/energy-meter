/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { mergeDatasets, detectMergeWarnings, detectMergeBlockers, buildMergeName, commonValue, type MergeSource } from './mergeData';
import type { DataPoint, PeakSchedule } from '../types';

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

  it('reports no gaps for contiguous sources', () => {
    const a: MergeSource = { fileName: 'a', data: pts(1000, 3) };
    const b: MergeSource = { fileName: 'b', data: pts(1000 + 3 * 3600, 3) };
    expect(mergeDatasets([a, b]).gapCount).toBe(0);
  });

  it('counts a gap between non-contiguous sources without synthesizing points', () => {
    const a: MergeSource = { fileName: 'a', data: pts(1000, 3, 3600) };
    // Starts 10 hours after a ends -> a clear hole in the hourly timeline.
    const b: MergeSource = { fileName: 'b', data: pts(1000 + 13 * 3600, 3, 3600) };
    const result = mergeDatasets([a, b]);
    expect(result.data).toHaveLength(6); // no fill data added
    expect(result.gapCount).toBe(1);
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

describe('detectMergeBlockers', () => {
  it('returns no blockers when provenance is absent (legacy v1 rows)', () => {
    const a: MergeSource = { fileName: 'a', data: pts(1000, 5) };
    const b: MergeSource = { fileName: 'b', data: pts(50000, 5) };
    expect(detectMergeBlockers([a, b])).toEqual([]);
  });

  it('returns no blockers when flow direction and commodity agree', () => {
    const a: MergeSource = { fileName: 'a', data: pts(1000, 5), flowDirection: 1, commodity: 1 };
    const b: MergeSource = { fileName: 'b', data: pts(50000, 5), flowDirection: 1, commodity: 1 };
    expect(detectMergeBlockers([a, b])).toEqual([]);
  });

  it('blocks merging different flow directions', () => {
    const delivered: MergeSource = { fileName: 'd', data: pts(1000, 5), flowDirection: 1 };
    const received: MergeSource = { fileName: 'r', data: pts(50000, 5), flowDirection: 19 };
    const blockers = detectMergeBlockers([delivered, received]);
    expect(blockers.some((b) => /flow direction/i.test(b))).toBe(true);
  });

  it('blocks merging different commodities', () => {
    const elec: MergeSource = { fileName: 'e', data: pts(1000, 5), commodity: 1 };
    const gas: MergeSource = { fileName: 'g', data: pts(50000, 5), commodity: 7 };
    const blockers = detectMergeBlockers([elec, gas]);
    expect(blockers.some((b) => /commodit/i.test(b))).toBe(true);
  });
});

describe('commonValue', () => {
  it('returns the shared value when all defined entries agree', () => {
    expect(commonValue([1, 1, undefined])).toBe(1);
  });
  it('returns undefined when entries disagree', () => {
    expect(commonValue([1, 19])).toBeUndefined();
  });
  it('returns undefined when nothing is defined', () => {
    expect(commonValue([undefined, undefined])).toBeUndefined();
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

describe('peak schedule across a merge', () => {
  const sched = (hours: number, label: string): PeakSchedule => ({
    version: 1,
    periods: [{
      id: 'p1', name: 'On-Peak', colorKey: 'red',
      rules: [{ hourRanges: [{ start: 14, end: hours }], daysOfWeek: [1, 2, 3, 4, 5], months: [] }],
    }],
    observeHolidays: true,
    holidayRules: ['independence'],
    extraHolidays: [],
    label,
  });

  const withSchedule = (fileName: string, peakSchedule?: PeakSchedule): MergeSource =>
    ({ fileName, data: pts(1000, 3), ...(peakSchedule ? { peakSchedule } : {}) });

  it('carries the first source schedule onto the merged result', () => {
    const result = mergeDatasets([withSchedule('a', sched(18, 'A')), withSchedule('b', sched(20, 'B'))]);
    expect(result.peakSchedule?.label).toBe('A');
  });

  it('skips past sources that have no schedule, or an empty one', () => {
    const empty: PeakSchedule = { ...sched(18, 'Empty'), periods: [] };
    const result = mergeDatasets([withSchedule('a'), withSchedule('b', empty), withSchedule('c', sched(20, 'C'))]);
    expect(result.peakSchedule?.label).toBe('C');
  });

  it('leaves the field undefined when no source has one', () => {
    expect(mergeDatasets([withSchedule('a'), withSchedule('b')]).peakSchedule).toBeUndefined();
  });

  it('warns — but does not block — when the sources disagree', () => {
    const sources = [withSchedule('a', sched(18, 'A')), withSchedule('b', sched(20, 'B'))];
    expect(detectMergeWarnings(sources).some(w => w.includes('peak rate schedules'))).toBe(true);
    expect(detectMergeBlockers(sources)).toEqual([]);
  });

  it('stays quiet when the schedules differ only in name', () => {
    const sources = [withSchedule('a', sched(18, 'A')), withSchedule('b', sched(18, 'Same rules, other name'))];
    expect(detectMergeWarnings(sources).some(w => w.includes('peak rate schedules'))).toBe(false);
  });

  it('stays quiet when only one source carries a schedule', () => {
    const sources = [withSchedule('a', sched(18, 'A')), withSchedule('b')];
    expect(detectMergeWarnings(sources).some(w => w.includes('peak rate schedules'))).toBe(false);
  });
});
