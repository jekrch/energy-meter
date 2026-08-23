/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { renderHook, advanceTime } from '../test/renderHook';
import { useAnalysis } from './useAnalysis';
import { newPeriod } from '../utils/peakScheduleFormat';
import type { DataPoint, PeakSchedule } from '../types';

// The peak split reaches the analysis chart through this hook. When it does not,
// every stacked segment reads zero and the chart renders blank — so these assert
// the wiring end to end rather than trusting analysisAggregation alone.

const schedule: PeakSchedule = {
  version: 1,
  periods: [newPeriod('Period 1', 'red')],   // weekdays 2p–7p, all year
  observeHolidays: true,
  holidayRules: [],
  extraHolidays: [],
};

// Seven days of hourly readings from Mon Jun 9 2025, local time.
const data: DataPoint[] = Array.from({ length: 7 * 24 }, (_, i) => ({
  timestamp: new Date(2025, 5, 9).getTime() / 1000 + i * 3600,
  value: 100,
  cost: 1200,
  duration: 3600,
}));

const runAnalysis = async (peakSchedule: PeakSchedule | null) => {
  const { result } = renderHook(() => useAnalysis('analysis', data, 'dayOfWeek', peakSchedule));
  // The aggregation is chunked and scheduled off the main thread.
  await advanceTime(250);
  return result.current;
};

describe('useAnalysis peak split', () => {
  it('surfaces a per-period split on the timeline when given a schedule', async () => {
    const { results } = await runAnalysis(schedule);
    expect(results.timeline.length).toBeGreaterThan(0);

    const weekday = results.timeline.find(t => new Date(t.timestamp * 1000).getDay() === 3)!;
    // 2p–7p inclusive is five hourly readings of the day's twenty-four.
    expect(weekday.periodValues).toEqual([500, 1900]);
    expect(weekday.periodCosts).toEqual([6000, 22800]);
  });

  it('gives every row a slot per period plus one for off-peak', async () => {
    const { results } = await runAnalysis(schedule);
    for (const row of results.timeline) {
      expect(row.periodValues).toHaveLength(schedule.periods.length + 1);
      expect(row.periodCosts).toHaveLength(schedule.periods.length + 1);
    }
  });

  it('keeps each split summing to that row own total', async () => {
    const { results } = await runAnalysis(schedule);
    for (const row of results.timeline) {
      expect(row.periodValues!.reduce((a, b) => a + b, 0)).toBe(row.value);
      expect(row.periodCosts!.reduce((a, b) => a + b, 0)).toBe(row.cost);
    }
  });

  it('splits the averages too, on the same denominator as the total', async () => {
    const { results } = await runAnalysis(schedule);
    for (const avg of results.averages) {
      if (!avg.count) continue;
      expect(avg.periodAverages).toHaveLength(2);
      expect(avg.periodAverages!.reduce((a, b) => a + b, 0)).toBe(avg.average);
    }
  });

  it('puts a weekend day entirely in the off-peak slot', async () => {
    const { results } = await runAnalysis(schedule);
    const saturday = results.timeline.find(t => new Date(t.timestamp * 1000).getDay() === 6)!;
    expect(saturday.periodValues![0]).toBe(0);
    expect(saturday.periodValues![1]).toBe(saturday.value);
  });

  it('omits the split entirely when no schedule is passed', async () => {
    const { results } = await runAnalysis(null);
    expect(results.timeline.length).toBeGreaterThan(0);
    for (const row of results.timeline) expect(row.periodValues).toBeUndefined();
    for (const avg of results.averages) expect(avg.periodAverages).toBeUndefined();
  });
});
