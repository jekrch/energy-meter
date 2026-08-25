/// <reference types="bun-types" />
import { describe, it, expect, beforeEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { indexedDbCache, loadWithCache, type DatasetCache } from './driveCache';

function stubCache(seed: Record<string, { modifiedTime: string; json: unknown }> = {}) {
  const store = new Map(Object.entries(seed));
  const calls = { get: 0, set: 0 };
  const cache: DatasetCache = {
    async get(id) { calls.get++; return store.get(id) ?? null; },
    async set(id, entry) { calls.set++; store.set(id, entry); },
    async prune() {},
    async clear() { store.clear(); },
  };
  return { cache, store, calls };
}

describe('loadWithCache', () => {
  it('serves a cached copy whose stamp matches what Drive reports', async () => {
    const { cache } = stubCache({ f1: { modifiedTime: 't1', json: 'cached' } });
    let downloads = 0;
    const out = await loadWithCache('f1', 't1', cache, async () => { downloads++; return 'fresh'; });
    expect(out).toBe('cached');
    expect(downloads).toBe(0);
  });

  it('re-downloads when the file changed out of band', async () => {
    const { cache, store } = stubCache({ f1: { modifiedTime: 't1', json: 'stale' } });
    const out = await loadWithCache('f1', 't2', cache, async () => 'fresh');
    expect(out).toBe('fresh');
    expect(store.get('f1')).toEqual({ modifiedTime: 't2', json: 'fresh' });
  });

  it('downloads and caches on a miss', async () => {
    const { cache, store } = stubCache();
    expect(await loadWithCache('f1', 't1', cache, async () => 'fresh')).toBe('fresh');
    expect(store.get('f1')!.json).toBe('fresh');
  });

  it('never serves or stores a copy it cannot prove current', async () => {
    // No modifiedTime — the listing did not report one, so freshness is unknown.
    const { cache, store, calls } = stubCache({ f1: { modifiedTime: 't1', json: 'cached' } });
    expect(await loadWithCache('f1', undefined, cache, async () => 'fresh')).toBe('fresh');
    expect(calls.get).toBe(0);
    expect(store.get('f1')!.json).toBe('cached');
  });

  it('falls back to the download when the cache itself fails', async () => {
    const cache: DatasetCache = {
      async get() { throw new Error('IndexedDB gone'); },
      async set() { throw new Error('IndexedDB gone'); },
      async prune() {},
      async clear() {},
    };
    expect(await loadWithCache('f1', 't1', cache, async () => 'fresh')).toBe('fresh');
  });
});

describe('indexedDbCache', () => {
  beforeEach(async () => { await indexedDbCache.clear(); });

  it('stores and reads back an entry', async () => {
    await indexedDbCache.set('f1', { modifiedTime: 't1', json: { a: 1 } });
    expect(await indexedDbCache.get('f1')).toEqual({ modifiedTime: 't1', json: { a: 1 } });
  });

  it('returns null for an unknown file', async () => {
    expect(await indexedDbCache.get('missing')).toBeNull();
  });

  it('prunes entries for files that are no longer in the folder', async () => {
    await indexedDbCache.set('keep', { modifiedTime: 't', json: 1 });
    await indexedDbCache.set('gone', { modifiedTime: 't', json: 2 });
    await indexedDbCache.prune(['keep']);
    expect(await indexedDbCache.get('keep')).not.toBeNull();
    expect(await indexedDbCache.get('gone')).toBeNull();
  });
});
