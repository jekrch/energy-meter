/// <reference types="bun-types" />
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { act } from 'react';
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

// The aggregation yields between chunks through requestAnimationFrame (there is
// no requestIdleCallback under happy-dom), and happy-dom's own rAF ticks on a
// real ~16ms+ frame clock. Collapsing it to a macrotask keeps these cases fast
// and, more importantly, deterministic — otherwise a run's completion is a race
// against whatever wall-clock budget the test allowed.
const realRaf = globalThis.requestAnimationFrame;
beforeAll(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number
  ) as typeof requestAnimationFrame;
});
afterAll(() => { globalThis.requestAnimationFrame = realRaf; });

// Every hook rendered here is torn down after its case. A hook left mounted
// keeps its debounce and chunk timers running into later cases, where they
// commit state outside any act() — which React reports as a warning and which
// makes one case's leftovers another case's flake.
const mounted: { unmount: () => void }[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

// Settling is a poll (see settleIdle), and a timer that fires in the gap
// between two ticks commits outside any act() scope. That is unavoidable when
// waiting on timer-driven work whose completion has to be observed from
// outside, and it is not something a test can act() its way around — so this
// one message is dropped while every other console.error still surfaces.
const realConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('was not wrapped in act')) return;
    realConsoleError(...args);
  };
});
afterAll(() => { console.error = realConsoleError; });

const runAnalysis = async (peakSchedule: PeakSchedule | null) => {
  const view = renderHook(() => useAnalysis('analysis', data, 'dayOfWeek', peakSchedule));
  mounted.push(view);
  // The aggregation is chunked and scheduled off the main thread.
  await advanceTime(250);
  return view.result.current;
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


// Beyond the peak split, the hook owns tab gating, the filter pipeline, and the
// staleness guard that keeps a superseded run from committing over a newer one.
// `data` above is seven days of hourly readings from Mon Jun 9 2025.

type Filters = ReturnType<typeof useAnalysis>['filters'];

function renderAnalysis(
  tab = 'analysis',
  points: DataPoint[] = data,
  groupBy: 'dayOfWeek' | 'month' | 'hour' = 'dayOfWeek',
) {
  const view = renderHook(
    ({ t, d, g }) => useAnalysis(t, d, g, null),
    { initialProps: { t: tab, d: points, g: groupBy } },
  );
  mounted.push(view);
  return view;
}

type Handle = { current: ReturnType<typeof useAnalysis> };

// A filter change can kick off more than one run — the day/month sets take
// effect at once while the hour ranges go through a debounce — so waiting a
// fixed number of milliseconds is a race. Wait for the hook to actually go
// quiet instead: `isProcessing` false continuously for longer than the debounce
// window, which means nothing is in flight and nothing is about to be.
// `idleMs` is how long "quiet" has to last to count. Mounting and rerendering
// start their run immediately, so a short window is enough; a filter change may
// have a debounced hour-range update still to come, and the debounce is 150ms
// or 300ms depending on the device profile the module picked up at import.
// Each tick is its own act() scope: React only commits when a scope exits, so
// polling from inside one scope would read a `result.current` that never
// changes.
async function settleIdle(result: Handle, idleMs = 100, budgetMs = 4000) {
  const step = 25;
  const idleNeeded = Math.ceil(idleMs / step);
  let idle = 0;
  for (let waited = 0; waited < budgetMs; waited += step) {
    await advanceTime(step);
    idle = result.current.isProcessing ? 0 : idle + 1;
    if (idle >= idleNeeded) return;
  }
  throw new Error('analysis never settled');
}

/** Apply a filter change and let the debounce plus the chunked passes settle. */
async function applyFilters(result: Handle, patch: Partial<Filters>) {
  act(() => { result.current.setFilters((f) => ({ ...f, ...patch })); });
  await settleIdle(result, 400);
}

const totalOf = (rows: { value: number }[]) => rows.reduce((n, r) => n + r.value, 0);

describe('useAnalysis tab gating', () => {
  it('computes nothing while another tab is showing', async () => {
    const { result } = renderAnalysis('table');
    await settleIdle(result);
    expect(result.current.results.timeline).toEqual([]);
    expect(result.current.results.averages).toEqual([]);
  });

  it('computes as soon as the analysis tab becomes active', async () => {
    const { result, rerender } = renderAnalysis('table');
    await settleIdle(result);

    rerender({ t: 'analysis', d: data, g: 'dayOfWeek' });
    await settleIdle(result);
    expect(result.current.results.timeline.length).toBeGreaterThan(0);
  });

  it('never enters the processing state for a hidden tab', async () => {
    const { result } = renderAnalysis('table');
    await settleIdle(result);
    expect(result.current.isProcessing).toBe(false);
  });
});

describe('useAnalysis with no data', () => {
  it('reports empty results rather than throwing', async () => {
    const { result } = renderAnalysis('analysis', []);
    await settleIdle(result);
    expect(result.current.results).toEqual({ filtered: [], averages: [], timeline: [] });
  });

  it('empties the results when the dataset is cleared', async () => {
    const { result, rerender } = renderAnalysis();
    await settleIdle(result);
    expect(result.current.results.timeline.length).toBeGreaterThan(0);

    rerender({ t: 'analysis', d: [], g: 'dayOfWeek' });
    await settleIdle(result);
    expect(result.current.results.timeline).toEqual([]);
  });

  it('reports nothing as sampled', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    expect(result.current.isDataSampled).toBe(false);
    expect(result.current.originalCount).toBe(data.length);
    expect(result.current.sampledCount).toBe(data.length);
  });
});

describe('useAnalysis grouping', () => {
  it('gives every day of the week an average row', async () => {
    const { result } = renderAnalysis('analysis', data, 'dayOfWeek');
    await settleIdle(result);
    expect(result.current.results.averages).toHaveLength(7);
  });

  it('gives every hour of the day an average row', async () => {
    const { result } = renderAnalysis('analysis', data, 'hour');
    await settleIdle(result);
    expect(result.current.results.averages).toHaveLength(24);
  });

  it('gives every month an average row', async () => {
    const { result } = renderAnalysis('analysis', data, 'month');
    await settleIdle(result);
    expect(result.current.results.averages).toHaveLength(12);
  });

  it('labels hourly rows as clock times', async () => {
    const { result } = renderAnalysis('analysis', data, 'hour');
    await settleIdle(result);
    const labels = result.current.results.averages.map((a) => a.label);
    expect(labels).toHaveLength(24);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(24);
  });

  it('labels day rows with weekday names', async () => {
    const { result } = renderAnalysis('analysis', data, 'dayOfWeek');
    await settleIdle(result);
    expect(result.current.results.averages.map((a) => a.label))
      .toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('recomputes when the grouping changes', async () => {
    const { result, rerender } = renderAnalysis('analysis', data, 'dayOfWeek');
    await settleIdle(result);
    expect(result.current.results.averages).toHaveLength(7);

    rerender({ t: 'analysis', d: data, g: 'hour' });
    await settleIdle(result);
    expect(result.current.results.averages).toHaveLength(24);
  });

  it('conserves the dataset total across every grouping', async () => {
    // Seven days of 100 Wh readings, whichever way they are bucketed.
    for (const g of ['dayOfWeek', 'hour', 'month'] as const) {
      const { result } = renderAnalysis('analysis', data, g);
      await settleIdle(result);
      expect(totalOf(result.current.results.timeline)).toBe(7 * 24 * 100);
    }
  });

  it('leaves no split on the buckets when there is no schedule', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    expect(result.current.results.timeline.every((t) => t.periodValues === undefined)).toBe(true);
  });
});

describe('useAnalysis filters', () => {
  it('starts unfiltered, covering the whole day', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    expect(result.current.filters).toEqual({
      daysOfWeek: [], months: [], hourRanges: [{ start: 0, end: 23 }],
    });
    // The unfiltered fast path skips the filter pass and reports the whole
    // working set as the filtered result.
    expect(result.current.results.filtered).toHaveLength(data.length);
  });

  it('keeps only the selected days of the week', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    await applyFilters(result, { daysOfWeek: [3] }); // Wednesday

    const kept = result.current.results.filtered;
    expect(kept).toHaveLength(24);
    expect(kept.every((d) => new Date(d.timestamp * 1000).getDay() === 3)).toBe(true);
  });

  it('keeps only the selected months', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    await applyFilters(result, { months: [5] }); // June — the whole fixture
    expect(result.current.results.filtered).toHaveLength(data.length);

    await applyFilters(result, { months: [0] }); // January — none of it
    expect(result.current.results.filtered).toHaveLength(0);
  });

  it('keeps only the selected hours', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    await applyFilters(result, { hourRanges: [{ start: 9, end: 11 }] });

    const kept = result.current.results.filtered;
    expect(kept).toHaveLength(7 * 3); // three hours a day, seven days
    expect(kept.every((d) => {
      const h = new Date(d.timestamp * 1000).getHours();
      return h >= 9 && h <= 11;
    })).toBe(true);
  });

  it('ANDs the three dimensions together', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    await applyFilters(result, {
      daysOfWeek: [3], months: [5], hourRanges: [{ start: 14, end: 16 }],
    });
    expect(result.current.results.filtered).toHaveLength(3);
  });

  it('reflects the filter in the aggregated totals, not just the raw rows', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    await applyFilters(result, { daysOfWeek: [3] });
    expect(totalOf(result.current.results.timeline)).toBe(24 * 100);
  });

  it('yields no buckets when the filter excludes everything', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    await applyFilters(result, { months: [0] });
    expect(result.current.results.timeline).toEqual([]);
  });

  it('returns to the unfiltered fast path when the filter is cleared', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    await applyFilters(result, { daysOfWeek: [3] });
    expect(result.current.results.filtered).toHaveLength(24);

    await applyFilters(result, { daysOfWeek: [], hourRanges: [{ start: 0, end: 23 }] });
    expect(result.current.results.filtered).toHaveLength(data.length);
    expect(totalOf(result.current.results.timeline)).toBe(7 * 24 * 100);
  });

  it('handles an hour range that wraps past midnight', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    await applyFilters(result, { hourRanges: [{ start: 22, end: 1 }] });

    const hours = new Set(result.current.results.filtered
      .map((d) => new Date(d.timestamp * 1000).getHours()));
    expect([...hours].sort((a, b) => a - b)).toEqual([0, 1, 22, 23]);
  });

  it('keeps a stable setFilters identity across renders', async () => {
    const { result, rerender } = renderAnalysis();
    await settleIdle(result);
    const setFilters = result.current.setFilters;

    rerender({ t: 'analysis', d: data, g: 'dayOfWeek' });
    expect(result.current.setFilters).toBe(setFilters);
  });
});

describe('useAnalysis staleness', () => {
  it('commits only the newest run when the inputs change mid-flight', async () => {
    const { result, rerender } = renderAnalysis('analysis', data, 'dayOfWeek');
    // Swap the grouping before the first pass can finish.
    rerender({ t: 'analysis', d: data, g: 'hour' });
    await settleIdle(result);

    expect(result.current.results.averages).toHaveLength(24);
    expect(result.current.isProcessing).toBe(false);
  });

  it('settles out of the processing state once a run completes', async () => {
    const { result } = renderAnalysis();
    await settleIdle(result);
    expect(result.current.isProcessing).toBe(false);
  });

  it('does not commit results after unmount', async () => {
    // Nothing to wait for going idle here — the hook is gone; the point is
    // that the in-flight run does not write into the unmounted tree.
    const view = renderAnalysis();
    const { result } = view;
    mounted.pop();
    view.unmount();
    await advanceTime(400);
    expect(result.current.results.timeline).toEqual([]);
  });
});
