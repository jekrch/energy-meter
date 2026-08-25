/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import 'fake-indexeddb/auto';
import { localStore, MAX_ENTRIES } from './localStore';
import { decodeKey } from './datasetStore';
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

// The cases share one database — deleting it between them would block on the
// open connection the store keeps — so each asserts against the key it just got
// back rather than against the contents of the whole list.
const save = async (name = 'meter.csv', provenance?: Parameters<typeof localStore.save>[3]) => {
  const meta = await localStore.save(name, data, 'RAW', provenance);
  expect(meta).not.toBeNull();
  return meta!;
};

describe('localStore — identity', () => {
  it('returns a store-qualified key for a saved dataset', async () => {
    const meta = await save();
    const parsed = decodeKey(meta.key)!;
    expect(parsed.kind).toBe('local');
    expect(Number.isInteger(Number(parsed.id))).toBe(true);
    expect(meta.kind).toBe('local');
    expect(meta.recordCount).toBe(2);
    expect(meta.startDate).toBe(data[0].timestamp);
    expect(meta.endDate).toBe(data[1].timestamp);
  });

  it('ignores keys belonging to another store', async () => {
    expect(await localStore.load('drive:abc')).toBeNull();
    // A no-op rather than a throw: the caller routes by key, but a stale key
    // from a signed-out Drive session must not break the schedule write-back.
    await localStore.patchProvenance('drive:abc', { peakSchedule: schedule });
    await localStore.delete('drive:abc');
  });
});

describe('localStore — patching provenance', () => {
  it('writes a peak schedule onto a dataset saved without one', async () => {
    const meta = await save();
    await localStore.patchProvenance(meta.key, { peakSchedule: schedule });

    const entry = await localStore.load(meta.key);
    expect(entry!.meta.peakSchedule).toEqual(schedule);
    // The readings are untouched by a provenance patch.
    expect(entry!.data).toEqual(data);
  });

  it('clears the schedule when the patch value is undefined', async () => {
    const meta = await save('meter.csv', { peakSchedule: schedule });
    await localStore.patchProvenance(meta.key, { peakSchedule: undefined });

    const entry = await localStore.load(meta.key);
    expect('peakSchedule' in entry!.meta).toBe(false);
  });

  it('leaves other provenance fields alone', async () => {
    const meta = await save('meter.csv', { intervalLength: 900, isMerged: true });
    await localStore.patchProvenance(meta.key, { peakSchedule: schedule });

    const entry = await localStore.load(meta.key);
    expect(entry!.meta.intervalLength).toBe(900);
    expect(entry!.meta.isMerged).toBe(true);
  });

  it('is a no-op for a dataset that has aged out of history', async () => {
    const meta = await save();
    const stale = `local:${Number(decodeKey(meta.key)!.id) + 10_000}`;

    await localStore.patchProvenance(stale, { peakSchedule: schedule });
    expect(await localStore.load(stale)).toBeNull();
    expect((await localStore.load(meta.key))!.meta.peakSchedule).toBeUndefined();
  });
});

describe('localStore — replacing readings', () => {
  it('overwrites the readings in place, keeping the key and name', async () => {
    const meta = await save('january.csv');
    const extended = [...data, { timestamp: 1735691400, value: 500, cost: 6000, duration: 900 }];

    const next = await localStore.replace(meta.key, extended, 'DAILY', { isMerged: true });
    expect(next.key).toBe(meta.key);
    expect(next.fileName).toBe('january.csv');
    expect(next.recordCount).toBe(3);
    expect(next.resolution).toBe('DAILY');

    const entry = await localStore.load(meta.key);
    expect(entry!.data).toEqual(extended);
    expect(entry!.meta.isMerged).toBe(true);
  });

  it('refuses to replace a dataset that is no longer stored', async () => {
    const meta = await save();
    const stale = `local:${Number(decodeKey(meta.key)!.id) + 20_000}`;
    await expect(localStore.replace(stale, data, 'RAW')).rejects.toThrow();
  });
});

describe('localStore — renaming', () => {
  it('retitles a dataset without touching its readings', async () => {
    const meta = await save('meter (1).csv', { peakSchedule: schedule });

    const next = await localStore.rename(meta.key, '  Home   electricity  ');
    expect(next.key).toBe(meta.key);
    expect(next.fileName).toBe('Home electricity');

    const entry = await localStore.load(meta.key);
    expect(entry!.data).toEqual(data);
    expect(entry!.meta.fileName).toBe('Home electricity');
    expect(entry!.meta.peakSchedule).toEqual(schedule);
  });

  it('refuses a name with nothing in it', async () => {
    const meta = await save('keeper.csv');
    await expect(localStore.rename(meta.key, '   ')).rejects.toThrow();
    expect((await localStore.load(meta.key))!.meta.fileName).toBe('keeper.csv');
  });

  it('refuses to rename a dataset that is no longer stored', async () => {
    const meta = await save();
    const stale = `local:${Number(decodeKey(meta.key)!.id) + 30_000}`;
    await expect(localStore.rename(stale, 'anything')).rejects.toThrow();
  });
});

describe('localStore — capacity', () => {
  it(`evicts the oldest datasets beyond MAX_ENTRIES`, async () => {
    // Distinct uploadedAt values: eviction sorts by it, and two saves inside the
    // same millisecond would make which one goes an arbitrary choice.
    const keys: string[] = [];
    for (let i = 0; i < MAX_ENTRIES + 2; i++) {
      keys.push((await save(`file-${i}.csv`)).key);
      await new Promise((r) => setTimeout(r, 2));
    }

    const listed = await localStore.list();
    expect(listed).toHaveLength(MAX_ENTRIES);
    // Newest first, and the two oldest of this batch are gone.
    expect(listed.map((e) => e.key)).toEqual(keys.slice(-MAX_ENTRIES).reverse());
    expect(await localStore.load(keys[0])).toBeNull();
  });
});

describe('localStore — deleting', () => {
  it('removes a dataset', async () => {
    const meta = await save('doomed.csv');
    await localStore.delete(meta.key);
    expect(await localStore.load(meta.key)).toBeNull();
  });
});
