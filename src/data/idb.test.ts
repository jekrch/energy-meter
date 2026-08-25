/// <reference types="bun-types" />
import { describe, it, expect, afterEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { DB_NAME, DRIVE_CACHE_STORE, HISTORY_STORE, openDb } from './idb';

// The module memoizes one connection for the whole process, and bun shares its
// registry across test files — so once any open succeeds, the failure branches
// are unreachable through the shared instance. One cache-busted copy is loaded
// for them instead. It is a single copy reused by every failure case, which
// works because a rejected open clears the memo (the last case here is exactly
// that guarantee).
//
// Known reporting artifact: `bun test --coverage` collapses this second
// specifier back onto `src/data/idb.ts` and reports the isolated copy's
// counters, so idb.ts's line percentage reads far lower than what these tests
// actually exercise. The number is wrong, not the coverage — do not "fix" it by
// deleting the cases below.
type IdbModule = typeof import('./idb');
let failing: IdbModule;
// Held in a variable so TypeScript treats it as a dynamic specifier: the query
// suffix is what makes bun load a second copy, and there is no module on disk
// at that exact path for tsc to resolve.
const ISOLATED = './idb.ts?isolated';
const freshIdb = async (): Promise<IdbModule> => {
  failing ??= (await import(ISOLATED)) as IdbModule;
  return failing;
};

const realIndexedDB = globalThis.indexedDB;
afterEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: realIndexedDB, configurable: true, writable: true,
  });
});

function setIndexedDB(value: unknown) {
  Object.defineProperty(globalThis, 'indexedDB', {
    value, configurable: true, writable: true,
  });
}

describe('openDb', () => {
  it('opens the shared database', async () => {
    const db = await openDb();
    expect(db.name).toBe(DB_NAME);
  });

  it('creates both stores the app depends on', async () => {
    const db = await openDb();
    expect(db.objectStoreNames.contains(HISTORY_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(DRIVE_CACHE_STORE)).toBe(true);
  });

  it('gives the history store an auto-incrementing id key', async () => {
    const db = await openDb();
    const store = db.transaction(HISTORY_STORE, 'readonly').objectStore(HISTORY_STORE);
    expect(store.keyPath).toBe('id');
    expect(store.autoIncrement).toBe(true);
  });

  it('gives the drive cache an out-of-line key, so callers supply their own', async () => {
    const db = await openDb();
    const store = db.transaction(DRIVE_CACHE_STORE, 'readonly').objectStore(DRIVE_CACHE_STORE);
    expect(store.keyPath).toBeNull();
    expect(store.autoIncrement).toBe(false);
  });

  it('hands every caller the same connection rather than racing two opens', async () => {
    const [a, b] = await Promise.all([openDb(), openDb()]);
    expect(a).toBe(b);
    expect(await openDb()).toBe(a);
  });

  it('keeps both stores usable through the one handle', async () => {
    const db = await openDb();
    const tx = db.transaction([HISTORY_STORE, DRIVE_CACHE_STORE], 'readwrite');
    tx.objectStore(DRIVE_CACHE_STORE).put({ bytes: 1 }, 'k');
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const read = await new Promise((resolve) => {
      const req = db.transaction(DRIVE_CACHE_STORE, 'readonly')
        .objectStore(DRIVE_CACHE_STORE).get('k');
      req.onsuccess = () => resolve(req.result);
    });
    expect(read).toEqual({ bytes: 1 });
  });
});

describe('openDb when IndexedDB is unavailable', () => {
  it('rejects rather than throwing synchronously when there is no indexedDB', async () => {
    setIndexedDB(undefined);
    const { openDb: fresh } = await freshIdb();
    await expect(fresh()).rejects.toThrow('IndexedDB unavailable');
  });

  it('rejects when open() itself throws, as in a locked-down profile', async () => {
    setIndexedDB({ open: () => { throw new Error('SecurityError: storage disabled'); } });
    const { openDb: fresh } = await freshIdb();
    await expect(fresh()).rejects.toThrow('storage disabled');
  });

  it('normalizes a non-Error thrown by open()', async () => {
    setIndexedDB({ open: () => { throw 'nope'; } });
    const { openDb: fresh } = await freshIdb();
    await expect(fresh()).rejects.toThrow('IndexedDB unavailable');
  });

  it('rejects when the open request errors', async () => {
    setIndexedDB({
      open: () => {
        const req: Record<string, unknown> = { error: new Error('version conflict') };
        queueMicrotask(() => (req.onerror as () => void)?.());
        return req;
      },
    });
    const { openDb: fresh } = await freshIdb();
    await expect(fresh()).rejects.toThrow('version conflict');
  });

  it('supplies a message when the failed request carries no error', async () => {
    setIndexedDB({
      open: () => {
        const req: Record<string, unknown> = { error: null };
        queueMicrotask(() => (req.onerror as () => void)?.());
        return req;
      },
    });
    const { openDb: fresh } = await freshIdb();
    await expect(fresh()).rejects.toThrow('IndexedDB open failed');
  });

  it('does not poison later attempts after a failed open', async () => {
    setIndexedDB(undefined);
    const { openDb: fresh } = await freshIdb();
    await expect(fresh()).rejects.toThrow();

    // Storage comes back (the tab leaves a prerender, the user exits private
    // browsing); the memoized rejection must not be what the next caller gets.
    setIndexedDB(realIndexedDB);
    const db = await fresh();
    expect(db.name).toBe(DB_NAME);
  });
});
