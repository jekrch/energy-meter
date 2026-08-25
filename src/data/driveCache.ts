import { openDb, DRIVE_CACHE_STORE } from './idb';

/**
 * Persistent cache of downloaded Drive datasets, keyed by fileId and validated
 * against the `modifiedTime` the folder listing already reports — so freshness
 * costs no extra request. Reopening a multi-megabyte dataset becomes an
 * IndexedDB read and zero network; only files edited out of band (from another
 * device) are re-fetched.
 *
 * Every operation degrades to a no-op when IndexedDB is unavailable (private
 * browsing, storage lockdowns), and loads simply fall through to Drive.
 */

export interface CachedDataset<T = unknown> {
  modifiedTime: string;
  json: T;
}

export interface DatasetCache {
  get(fileId: string): Promise<CachedDataset | null>;
  set(fileId: string, entry: CachedDataset): Promise<void>;
  /** Drop entries for fileIds no longer present (deleted or renamed files). */
  prune(keepFileIds: Iterable<string>): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Serve `fileId` from `cache` when the cached copy's `modifiedTime` matches
 * what Drive currently reports; otherwise download, store, and return. A
 * missing `modifiedTime` — the listing didn't report one — always misses and is
 * never cached, so a copy that can't be proven current is never served. Cache
 * read/write failures fall back to the download.
 */
export async function loadWithCache<T>(
  fileId: string,
  modifiedTime: string | undefined,
  cache: DatasetCache,
  download: (fileId: string) => Promise<T>,
): Promise<T> {
  if (modifiedTime) {
    const cached = await cache.get(fileId).catch(() => null);
    if (cached && cached.modifiedTime === modifiedTime) return cached.json as T;
  }
  const json = await download(fileId);
  if (modifiedTime) await cache.set(fileId, { modifiedTime, json }).catch(() => {});
  return json;
}

/** Run one request against the cache store; resolves null on any failure. */
function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        try {
          const req = run(db.transaction(DRIVE_CACHE_STORE, mode).objectStore(DRIVE_CACHE_STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
    () => null,
  );
}

export const indexedDbCache: DatasetCache = {
  async get(fileId) {
    return (await tx<CachedDataset>('readonly', (s) => s.get(fileId))) ?? null;
  },
  async set(fileId, entry) {
    await tx('readwrite', (s) => s.put(entry, fileId));
  },
  async prune(keepFileIds) {
    const keep = new Set(keepFileIds);
    const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    if (!keys) return;
    for (const key of keys) {
      if (!keep.has(key as string)) await tx('readwrite', (s) => s.delete(key));
    }
  },
  async clear() {
    await tx('readwrite', (s) => s.clear());
  },
};
