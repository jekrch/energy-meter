// One IndexedDB database backs both local stores: the dataset history that has
// always lived here, and the Drive download cache. They share a connection so
// two modules can never race `indexedDB.open` at different versions.

export const DB_NAME = 'energy-meter';
export const HISTORY_STORE = 'file-history';
export const DRIVE_CACHE_STORE = 'drive-cache';

// v2: added optional provenance (flowDirection/commodity/intervalLength/
// isMerged/sources). v3: added peakSchedule. v4: added the `drive-cache` store.
// The first two upgrades are no-ops — new fields default to undefined on
// existing rows — but the version bump lets the browser run onupgradeneeded.
const DB_VERSION = 4;

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * The shared database handle. Rejects when IndexedDB is unavailable (private
 * browsing, storage lockdowns, prerender); callers treat that as "no history"
 * rather than an error worth surfacing.
 */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err instanceof Error ? err : new Error('IndexedDB unavailable'));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        db.createObjectStore(HISTORY_STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(DRIVE_CACHE_STORE)) {
        db.createObjectStore(DRIVE_CACHE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  // A failed open should not poison every later attempt.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}
