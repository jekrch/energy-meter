/// <reference types="bun-types" />
import { describe, it, expect, beforeEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { act } from 'react';
import { renderHook } from '../test/renderHook';
import { useDatasetLibrary } from './useDatasetLibrary';
import { localStore } from '../data/localStore';
import type {
  DatasetKey, DatasetMeta, DatasetProvenance, DatasetRecord, DatasetStore,
} from '../data/datasetStore';
import type { DataPoint } from '../types';

// The real localStore is left in place — mocking it would leak across bun's
// shared module registry into localStore's own tests — so the extra store is
// where the routing behavior is observed. Assertions filter to `drive` rows,
// or to this file's own local saves by name, so datasets left behind by other
// test files are not something these cases can trip over.

const data: DataPoint[] = [
  { timestamp: 1735689600, value: 400, cost: 5000, duration: 900 },
];

interface FakeDrive extends DatasetStore {
  rows: DatasetMeta[];
  calls: { op: string; args: unknown[] }[];
  listFails: boolean;
}

function driveMeta(id: string, fileName: string, uploadedAt: number): DatasetMeta {
  return {
    key: `drive:${id}`, kind: 'drive', fileName, uploadedAt,
    startDate: 0, endDate: 0, recordCount: 1, resolution: 'RAW',
  };
}

function makeDrive(rows: DatasetMeta[] = []): FakeDrive {
  const store: FakeDrive = {
    kind: 'drive',
    rows: [...rows],
    calls: [],
    listFails: false,
    async list() {
      this.calls.push({ op: 'list', args: [] });
      if (this.listFails) throw new Error('offline');
      return [...this.rows];
    },
    async load(key) {
      this.calls.push({ op: 'load', args: [key] });
      const meta = this.rows.find((r) => r.key === key);
      return meta ? ({ meta, data } as DatasetRecord) : null;
    },
    async save(name, d, resolution, provenance) {
      this.calls.push({ op: 'save', args: [name, d, resolution, provenance] });
      const meta = driveMeta(`new-${this.rows.length}`, name, 5000);
      this.rows.push(meta);
      return meta;
    },
    async replace(key, d, resolution, provenance, expect_) {
      this.calls.push({ op: 'replace', args: [key, d, resolution, provenance, expect_] });
      return this.rows.find((r) => r.key === key)!;
    },
    async patchProvenance(key, patch) {
      this.calls.push({ op: 'patchProvenance', args: [key, patch] });
    },
    async rename(key, fileName) {
      this.calls.push({ op: 'rename', args: [key, fileName] });
      const row = this.rows.find((r) => r.key === key)!;
      row.fileName = fileName;
      return row;
    },
    async delete(key) {
      this.calls.push({ op: 'delete', args: [key] });
      this.rows = this.rows.filter((r) => r.key !== key);
    },
  };
  return store;
}

/** Render with a stable `extraStores` array — the hook keys its effect on it. */
function renderLibrary(extras: DatasetStore[] = []) {
  const hook = renderHook(({ stores }) => useDatasetLibrary(stores), {
    initialProps: { stores: extras },
  });
  return hook;
}

// The listing awaits every store, and localStore's IndexedDB reads resolve on
// macrotask turns rather than microtasks — so draining the microtask queue is
// not enough to see the committed entries.
async function settle() {
  await act(async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const driveRows = (entries: DatasetMeta[]) => entries.filter((e) => e.kind === 'drive');

beforeEach(() => { /* each case names its own datasets */ });

describe('useDatasetLibrary', () => {
  it('lists on mount', async () => {
    const drive = makeDrive([driveMeta('a', 'cloud.json', 1000)]);
    const { result } = renderLibrary([drive]);
    await settle();
    expect(driveRows(result.current.entries).map((e) => e.fileName)).toEqual(['cloud.json']);
  });

  it('lists local datasets alongside the extra stores', async () => {
    const meta = await localStore.save('lib-local-a.csv', data, 'RAW');
    const drive = makeDrive([driveMeta('a', 'cloud.json', 1000)]);
    const { result } = renderLibrary([drive]);
    await settle();

    const keys = result.current.entries.map((e) => e.key);
    expect(keys).toContain(meta!.key);
    expect(keys).toContain('drive:a');
  });

  it('sorts the merged listing newest first, across stores', async () => {
    const drive = makeDrive([
      driveMeta('old', 'old.json', 1_000),
      driveMeta('new', 'new.json', 9_000),
      driveMeta('mid', 'mid.json', 5_000),
    ]);
    const { result } = renderLibrary([drive]);
    await settle();
    expect(driveRows(result.current.entries).map((e) => e.fileName))
      .toEqual(['new.json', 'mid.json', 'old.json']);
  });

  it('keeps the other stores listed when one store fails', async () => {
    // Drive while signed out or offline must not empty the whole library.
    const meta = await localStore.save('lib-survivor.csv', data, 'RAW');
    const drive = makeDrive([driveMeta('a', 'cloud.json', 1000)]);
    drive.listFails = true;

    const { result } = renderLibrary([drive]);
    await settle();
    expect(result.current.entries.map((e) => e.key)).toContain(meta!.key);
    expect(driveRows(result.current.entries)).toHaveLength(0);
  });

  it('clears the loading flag once the listing settles', async () => {
    const drive = makeDrive();
    const { result } = renderLibrary([drive]);
    await settle();
    expect(result.current.loading).toBe(false);
  });

  it('clears the loading flag even when a store rejects', async () => {
    const drive = makeDrive();
    drive.listFails = true;
    const { result } = renderLibrary([drive]);
    await settle();
    expect(result.current.loading).toBe(false);
  });

  it('re-lists when the set of stores changes, as on sign-in', async () => {
    const drive = makeDrive([driveMeta('a', 'cloud.json', 1000)]);
    const { result, rerender } = renderLibrary([]);
    await settle();
    expect(driveRows(result.current.entries)).toHaveLength(0);

    rerender({ stores: [drive] });
    await settle();
    expect(driveRows(result.current.entries)).toHaveLength(1);

    // ...and signing out takes them away again.
    rerender({ stores: [] });
    await settle();
    expect(driveRows(result.current.entries)).toHaveLength(0);
  });

  it('routes load to the store named by the key', async () => {
    const drive = makeDrive([driveMeta('a', 'cloud.json', 1000)]);
    const { result } = renderLibrary([drive]);
    await settle();

    const record = await result.current.load('drive:a');
    expect(record?.meta.fileName).toBe('cloud.json');
    expect(drive.calls.some((c) => c.op === 'load')).toBe(true);
  });

  it('resolves load to null when no store owns the key', async () => {
    const { result } = renderLibrary([]);
    await settle();
    // No drive store is registered, and a malformed key names no store at all.
    expect(await result.current.load('drive:a')).toBeNull();
    expect(await result.current.load('nonsense')).toBeNull();
  });

  it('saves through the named store and re-lists', async () => {
    const drive = makeDrive();
    const { result } = renderLibrary([drive]);
    await settle();

    let meta: DatasetMeta | null = null;
    await act(async () => { meta = await result.current.save('drive', 'new.json', data, 'RAW'); });
    expect(meta!.fileName).toBe('new.json');
    expect(driveRows(result.current.entries).map((e) => e.fileName)).toEqual(['new.json']);
  });

  it('passes provenance through on save', async () => {
    const drive = makeDrive();
    const { result } = renderLibrary([drive]);
    await settle();

    const provenance: DatasetProvenance = { isMerged: true, intervalLength: 900 };
    await act(async () => { await result.current.save('drive', 'm.json', data, 'RAW', provenance); });
    const call = drive.calls.find((c) => c.op === 'save')!;
    expect(call.args[3]).toEqual(provenance);
  });

  it('returns null from save when the requested store is not registered', async () => {
    const { result } = renderLibrary([]);
    await settle();
    expect(await result.current.save('drive', 'x.json', data, 'RAW')).toBeNull();
  });

  it('forwards the conflict expectation on replace', async () => {
    const drive = makeDrive([driveMeta('a', 'cloud.json', 1000)]);
    const { result } = renderLibrary([drive]);
    await settle();

    await act(async () => {
      await result.current.replace('drive:a', data, 'RAW', undefined, { syncVersion: '7' });
    });
    const call = drive.calls.find((c) => c.op === 'replace')!;
    expect(call.args[0]).toBe('drive:a');
    expect(call.args[4]).toEqual({ syncVersion: '7' });
  });

  it('rejects replace for a key no store owns', async () => {
    const { result } = renderLibrary([]);
    await settle();
    await expect(result.current.replace('drive:a', data, 'RAW'))
      .rejects.toThrow('No store for dataset drive:a');
  });

  it('routes patchProvenance and re-lists', async () => {
    const drive = makeDrive([driveMeta('a', 'cloud.json', 1000)]);
    const { result } = renderLibrary([drive]);
    await settle();
    drive.calls.length = 0;

    await act(async () => { await result.current.patchProvenance('drive:a', { isMerged: true }); });
    expect(drive.calls.map((c) => c.op)).toEqual(['patchProvenance', 'list']);
  });

  it('silently no-ops patchProvenance for an unowned key', async () => {
    const { result } = renderLibrary([]);
    await settle();
    await expect(result.current.patchProvenance('drive:a', { isMerged: true })).resolves.toBeUndefined();
  });

  it('renames through the owning store and reflects it in the listing', async () => {
    const drive = makeDrive([driveMeta('a', 'cloud.json', 1000)]);
    const { result } = renderLibrary([drive]);
    await settle();

    await act(async () => { await result.current.rename('drive:a', 'renamed.json'); });
    expect(driveRows(result.current.entries).map((e) => e.fileName)).toEqual(['renamed.json']);
  });

  it('rejects rename for a key no store owns', async () => {
    const { result } = renderLibrary([]);
    await settle();
    await expect(result.current.rename('drive:a', 'x')).rejects.toThrow('No store for dataset');
  });

  it('removes through the owning store and drops the row', async () => {
    const drive = makeDrive([driveMeta('a', 'cloud.json', 1000)]);
    const { result } = renderLibrary([drive]);
    await settle();

    await act(async () => { await result.current.remove('drive:a'); });
    expect(driveRows(result.current.entries)).toHaveLength(0);
  });

  it('silently no-ops remove for an unowned key', async () => {
    const { result } = renderLibrary([]);
    await settle();
    await expect(result.current.remove('drive:a')).resolves.toBeUndefined();
  });

  it('keeps a stable object identity across renders that change nothing', async () => {
    // App effects depend on the library object; re-identifying it every render
    // would re-run the debounced schedule write-back continuously.
    const drive = makeDrive();
    const stores: DatasetStore[] = [drive];
    const { result, rerender } = renderLibrary(stores);
    await settle();

    const first = result.current;
    rerender({ stores });
    expect(result.current).toBe(first);
  });

  it('re-identifies once the entries actually change', async () => {
    const drive = makeDrive();
    const { result } = renderLibrary([drive]);
    await settle();
    const first = result.current;

    await act(async () => { await result.current.save('drive', 'later.json', data, 'RAW'); });
    expect(result.current).not.toBe(first);
  });

  it('routes a local key to the local store even with a drive store present', async () => {
    const saved = await localStore.save('lib-routing.csv', data, 'RAW');
    const drive = makeDrive();
    const { result } = renderLibrary([drive]);
    await settle();

    const record = await result.current.load(saved!.key as DatasetKey);
    expect(record?.meta.fileName).toBe('lib-routing.csv');
    expect(drive.calls.some((c) => c.op === 'load')).toBe(false);
  });
});
