/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import 'fake-indexeddb/auto';
import { act } from 'react';
import { renderHook } from '../test/renderHook';
import { useFileHistory } from './useFileHistory';
import type { DataPoint, PeakSchedule } from '../types';

const data: DataPoint[] = [
  { timestamp: 1735689600, value: 412, cost: 5100, duration: 900 },
  { timestamp: 1735690500, value: 388, cost: 4800, duration: 900 },
];

const schedule: PeakSchedule = {
  version: 1,
  periods: [{
    id: 'p1',
    name: 'On-Peak',
    colorKey: 'red',
    rules: [{ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [1, 2, 3, 4, 5], months: [] }],
  }],
  observeHolidays: true,
  holidayRules: [],
  extraHolidays: [],
};

// The tests share one database: deleting it between cases would block on the
// connections the hook leaves open. Each case saves at most one entry, staying
// under MAX_ENTRIES, and asserts against the id it just got back.
const mount = () => renderHook(() => useFileHistory());

describe('useFileHistory — updating a stored entry', () => {
  it('returns the new entry id from saveEntry', async () => {
    const { result } = mount();
    let id: number | null = null;
    await act(async () => { id = await result.current.saveEntry('meter.csv', data, 'RAW'); });
    expect(typeof id).toBe('number');
    expect(result.current.entries).toHaveLength(1);
  });

  it('writes a peak schedule onto an entry saved without one', async () => {
    const { result } = mount();
    let id: number | null = null;
    await act(async () => { id = await result.current.saveEntry('meter.csv', data, 'RAW'); });
    await act(async () => { await result.current.updateEntry(id!, { peakSchedule: schedule }); });

    const entry = await result.current.loadEntry(id!);
    expect(entry!.peakSchedule).toEqual(schedule);
    // The readings are untouched by a provenance patch.
    expect(entry!.data).toEqual(data);
  });

  it('clears the schedule when the patch value is undefined', async () => {
    const { result } = mount();
    let id: number | null = null;
    await act(async () => { id = await result.current.saveEntry('meter.csv', data, 'RAW', { peakSchedule: schedule }); });
    await act(async () => { await result.current.updateEntry(id!, { peakSchedule: undefined }); });

    const entry = await result.current.loadEntry(id!);
    expect('peakSchedule' in entry!).toBe(false);
  });

  it('leaves other provenance fields alone', async () => {
    const { result } = mount();
    let id: number | null = null;
    await act(async () => {
      id = await result.current.saveEntry('meter.csv', data, 'RAW', { intervalLength: 900, isMerged: true });
    });
    await act(async () => { await result.current.updateEntry(id!, { peakSchedule: schedule }); });

    const entry = await result.current.loadEntry(id!);
    expect(entry!.intervalLength).toBe(900);
    expect(entry!.isMerged).toBe(true);
  });

  it('is a no-op for an id that has aged out of history', async () => {
    const { result } = mount();
    let id: number | null = null;
    await act(async () => { id = await result.current.saveEntry('meter.csv', data, 'RAW'); });
    const count = result.current.entries.length;

    await act(async () => { await result.current.updateEntry(id! + 10_000, { peakSchedule: schedule }); });
    expect(result.current.entries).toHaveLength(count);
    expect((await result.current.loadEntry(id!))!.peakSchedule).toBeUndefined();
  });
});
