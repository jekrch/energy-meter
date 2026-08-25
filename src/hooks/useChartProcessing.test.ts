/// <reference types="bun-types" />
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../test/renderHook';
import { useChartProcessing } from './useChartProcessing';
import { MAX_CHART_POINTS, MIN_LOADING_TIME } from '../constants';
import type { DataPoint } from '../types';

// happy-dom has no rAF loop of its own tied to a compositor; the hook defers
// its work through one, so the tests just need to let real timers run.
const realRaf = globalThis.requestAnimationFrame;

function series(n: number, step = 3600, start = Date.UTC(2024, 0, 1) / 1000): DataPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: start + i * step,
    value: 100 + (i % 50),
    cost: 1200 + (i % 50),
    duration: step,
  }));
}

/** Wait past the hook's minimum-loading floor, flushing effects. */
async function settle(extra = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, MIN_LOADING_TIME + extra));
  });
}

beforeEach(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number
  ) as typeof requestAnimationFrame;
});
afterEach(() => { globalThis.requestAnimationFrame = realRaf; });

const render = (data: DataPoint[], resolution: string) =>
  renderHook(({ d, r }) => useChartProcessing(d, r), { initialProps: { d: data, r: resolution } });

describe('useChartProcessing', () => {
  it('starts empty and idle', () => {
    const { result } = render([], 'DAILY');
    expect(result.current.aggregatedData).toEqual([]);
    expect(result.current.chartData).toEqual([]);
    expect(result.current.isProcessing).toBe(false);
  });

  it('never enters the processing state for an empty series', async () => {
    const { result } = render([], 'DAILY');
    await settle();
    expect(result.current.isProcessing).toBe(false);
  });

  it('shows the spinner while work is in flight', async () => {
    const { result } = render(series(500), 'DAILY');
    // The effect flips the flag synchronously, before rAF defers the work.
    expect(result.current.isProcessing).toBe(true);
    await settle();
    expect(result.current.isProcessing).toBe(false);
  });

  it('produces aggregated points and clears the spinner', async () => {
    const { result } = render(series(48), 'HOURLY');
    await settle();
    expect(result.current.aggregatedData.length).toBeGreaterThan(0);
    expect(result.current.isProcessing).toBe(false);
  });

  it('holds the spinner for the minimum loading time even on a trivial dataset', async () => {
    // Without the floor, a fast aggregation flashes the spinner for a frame.
    const { result } = render(series(4), 'DAILY');
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(result.current.isProcessing).toBe(true);
    await settle();
    expect(result.current.isProcessing).toBe(false);
  });

  it('rolls readings up into daily buckets', async () => {
    // Three full days of hourly readings.
    const { result } = render(series(72), 'DAILY');
    await settle();
    expect(result.current.aggregatedData.length).toBeLessThanOrEqual(4);
    expect(result.current.aggregatedData.length).toBeGreaterThan(0);
  });

  it('re-runs when the resolution changes', async () => {
    const { result, rerender } = render(series(72), 'HOURLY');
    await settle();
    const hourly = result.current.aggregatedData.length;

    rerender({ d: series(72), r: 'DAILY' });
    await settle();
    expect(result.current.aggregatedData.length).toBeLessThan(hourly);
  });

  it('caps the series at MAX_CHART_POINTS before enriching it', async () => {
    // The iOS memory guard: a huge RAW view must never materialize a full
    // enriched copy of every reading.
    const { result } = render(series(MAX_CHART_POINTS * 3, 900), 'RAW');
    await settle();
    expect(result.current.aggregatedData.length).toBeLessThanOrEqual(MAX_CHART_POINTS);
  });

  it('keeps chartData within the cap as a second safety net', async () => {
    const { result } = render(series(MAX_CHART_POINTS * 3, 900), 'RAW');
    await settle();
    expect(result.current.chartData.length).toBeLessThanOrEqual(MAX_CHART_POINTS);
  });

  it('leaves an already-small series untouched by the downsample', async () => {
    const { result } = render(series(20), 'HOURLY');
    await settle();
    expect(result.current.chartData).toEqual(result.current.aggregatedData);
  });

  it('resets to empty when the data goes away', async () => {
    const { result, rerender } = render(series(48), 'HOURLY');
    await settle();
    expect(result.current.aggregatedData.length).toBeGreaterThan(0);

    rerender({ d: [], r: 'HOURLY' });
    expect(result.current.aggregatedData).toEqual([]);
  });

  it('discards a superseded run rather than letting it overwrite the newer one', async () => {
    const big = series(400, 900);
    const small = series(24);
    const { result, rerender } = render(big, 'RAW');
    // Swap the input before the first run can commit.
    rerender({ d: small, r: 'DAILY' });
    await settle();

    // The DAILY rollup of one day is a single bucket; the stale RAW result
    // would have been far larger.
    expect(result.current.aggregatedData.length).toBeLessThan(10);
  });

  it('does not commit results after unmount', async () => {
    const { result, unmount } = render(series(200, 900), 'RAW');
    unmount();
    await settle();
    expect(result.current.aggregatedData).toEqual([]);
  });
});
