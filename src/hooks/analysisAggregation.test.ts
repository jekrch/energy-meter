/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { aggregateBuckets, finalizeBuckets } from './analysisAggregation';
import { DAYS_OF_WEEK, MONTHS, HOURS } from '../types';
import type { DataPoint } from '../types';

// 2024-01-01 00:00:00 UTC is a Monday. Tests construct timestamps from local
// Date() to match the production code (which also uses local getDay/getHours),
// so assertions are kept timezone-independent.
const at = (y: number, mo: number, d: number, h = 0): number =>
  Math.floor(new Date(y, mo, d, h).getTime() / 1000);

const point = (timestamp: number, value: number, cost: number): DataPoint => ({
  timestamp,
  value,
  cost,
});

const demandPoint = (timestamp: number, value: number, duration: number): DataPoint => ({
  timestamp,
  value,
  cost: 0,
  duration,
});

const HOUR_LABELS = HOURS.map(h => `${h}:00`);

describe('aggregateBuckets', () => {
  it('merges readings that fall in the same hour bucket', () => {
    const ts = at(2024, 0, 1, 9);
    const data = [point(ts, 100, 10), point(ts + 600, 50, 5), point(ts + 1200, 25, 2)];

    const map = aggregateBuckets(data, 'hour');
    expect(map.size).toBe(1);

    const bucket = [...map.values()][0];
    expect(bucket.sum).toBe(175);
    expect(bucket.costSum).toBe(17);
    expect(bucket.count).toBe(3);
    expect(bucket.categoryKey).toBe(9); // 9am
  });

  it('separates readings into distinct day buckets but shares categoryKey by weekday', () => {
    const mon = at(2024, 0, 1, 12); // Monday
    const nextMon = at(2024, 0, 8, 12); // Monday a week later
    const map = aggregateBuckets([point(mon, 10, 1), point(nextMon, 20, 2)], 'dayOfWeek');

    expect(map.size).toBe(2);
    const cats = [...map.values()].map(b => b.categoryKey);
    expect(cats[0]).toBe(cats[1]); // both Mondays
    expect(cats[0]).toBe(new Date(mon * 1000).getDay());
  });

  it('treats cost as 0 when a reading has no cost', () => {
    const ts = at(2024, 2, 15, 3);
    const map = aggregateBuckets([{ timestamp: ts, value: 40 } as DataPoint], 'month');
    const bucket = [...map.values()][0];
    expect(bucket.sum).toBe(40);
    expect(bucket.costSum).toBe(0);
  });

  it('tracks demandMax as the peak per-reading demand in a bucket', () => {
    const ts = at(2024, 0, 1, 9);
    // 15-min readings (×4): 1000→4kW, 2500→10kW (peak), 500→2kW
    const data = [
      demandPoint(ts, 1000, 900),
      demandPoint(ts + 600, 2500, 900),
      demandPoint(ts + 1200, 500, 900),
    ];
    const bucket = [...aggregateBuckets(data, 'hour').values()][0];
    expect(bucket.demandMax).toBe(10);
  });
});

describe('finalizeBuckets', () => {
  it('sorts the timeline ascending by period timestamp', () => {
    const later = at(2024, 5, 10, 0);
    const earlier = at(2024, 0, 10, 0);
    const map = aggregateBuckets([point(later, 5, 1), point(earlier, 7, 1)], 'month');

    const { timeline } = finalizeBuckets(map, 12, MONTHS);
    expect(timeline.length).toBe(2);
    expect(timeline[0].timestamp).toBeLessThan(timeline[1].timestamp);
    expect(timeline[0].value).toBe(7); // the earlier reading sorts first
  });

  it('averages per-period sums into each category slot', () => {
    // Two Mondays in the same weekday category: sums 100 and 200 → average 150.
    const mon1 = at(2024, 0, 1, 8);
    const mon2 = at(2024, 0, 8, 8);
    const map = aggregateBuckets(
      [point(mon1, 60, 6), point(mon1 + 600, 40, 4), point(mon2, 200, 20)],
      'dayOfWeek',
    );

    const { averages } = finalizeBuckets(map, 7, DAYS_OF_WEEK);
    expect(averages.length).toBe(7);

    const mondayIdx = new Date(mon1 * 1000).getDay();
    const monday = averages[mondayIdx];
    expect(monday.count).toBe(2); // two day-periods
    expect(monday.average).toBe(150); // (100 + 200) / 2
    expect(monday.avgCost).toBe(15); // (10 + 20) / 2

    // every other weekday slot is empty
    const empty = averages.filter((_, i) => i !== mondayIdx);
    expect(empty.every(a => a.count === 0 && a.average === 0)).toBe(true);
  });

  it('averages each period\'s peak demand into the category slot (average-of-peaks)', () => {
    // Two Mondays. Each day-period peaks at a different per-reading demand:
    //   Mon 1: 1000 Wh @15min → 4 kW, plus 2000 Wh @15min → 8 kW (peak = 8)
    //   Mon 2: 3000 Wh @15min → 12 kW (peak = 12)
    // Average of the two peaks = (8 + 12) / 2 = 10 kW.
    const mon1 = at(2024, 0, 1, 8);
    const mon2 = at(2024, 0, 8, 8);
    const map = aggregateBuckets(
      [demandPoint(mon1, 1000, 900), demandPoint(mon1 + 600, 2000, 900), demandPoint(mon2, 3000, 900)],
      'dayOfWeek',
    );

    const { averages, timeline } = finalizeBuckets(map, 7, DAYS_OF_WEEK);
    const mondayIdx = new Date(mon1 * 1000).getDay();
    expect(averages[mondayIdx].demand).toBe(10);

    // Each timeline period carries its own peak.
    const peaks = timeline.map(t => t.demand).sort((a, b) => a - b);
    expect(peaks).toEqual([8, 12]);
  });

  it('produces one zeroed slot per group for an empty dataset', () => {
    const { averages, timeline } = finalizeBuckets(new Map(), 24, HOUR_LABELS);
    expect(timeline).toEqual([]);
    expect(averages.length).toBe(24);
    expect(averages.every(a => a.average === 0 && a.count === 0)).toBe(true);
    expect(averages[5].label).toBe('5:00');
  });
});
