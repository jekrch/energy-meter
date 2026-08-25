import type { DataPoint } from '../types';
import { openDb, HISTORY_STORE } from './idb';
import {
  encodeKey, localId, normalizeDatasetName, stripUndefined,
  type DatasetMeta, type DatasetProvenance, type DatasetRecord, type DatasetStore,
} from './datasetStore';

// The dataset store that has always been here: a short IndexedDB history of
// recent uploads, capped so a browser's storage quota is never the reason an
// import fails. It is a recency cache, not a library — Drive is the library.

export const MAX_ENTRIES = 5;

// The stored row shape. Kept exactly as written by earlier versions (numeric
// autoIncrement `id`, readings inline) so existing history reads back unchanged.
interface HistoryRow extends DatasetProvenance {
  id: number;
  fileName: string;
  uploadedAt: number;
  startDate: number;
  endDate: number;
  recordCount: number;
  resolution: string;
  data: DataPoint[];
}

function toMeta(row: HistoryRow): DatasetMeta {
  const meta: DatasetMeta = { ...row, key: encodeKey('local', row.id), kind: 'local' };
  // The readings ride along in the row; a meta carries only the scalars the
  // library list renders from.
  delete (meta as Partial<HistoryRow>).data;
  delete (meta as Partial<HistoryRow>).id;
  return meta;
}

function readAll(): Promise<HistoryRow[]> {
  return openDb().then(
    (db) =>
      new Promise<HistoryRow[]>((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE, 'readonly');
        const req = tx.objectStore(HISTORY_STORE).getAll();
        req.onsuccess = () => resolve(req.result as HistoryRow[]);
        req.onerror = () => reject(req.error);
      }),
  );
}

function getRow(id: number): Promise<HistoryRow | null> {
  return openDb().then(
    (db) =>
      new Promise<HistoryRow | null>((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE, 'readonly');
        const req = tx.objectStore(HISTORY_STORE).get(id);
        req.onsuccess = () => resolve((req.result as HistoryRow | undefined) ?? null);
        req.onerror = () => reject(req.error);
      }),
  );
}

// Apply a patch onto a row in place. An explicitly `undefined` value clears the
// field — that is how a cleared peak schedule is removed rather than left behind
// at its old value.
function applyPatch(row: HistoryRow, patch: Partial<HistoryRow>): HistoryRow {
  const next = { ...row };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key as keyof HistoryRow];
    else (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

function mutate(id: number, patch: Partial<HistoryRow>): Promise<HistoryRow | null> {
  return openDb().then(
    (db) =>
      new Promise<HistoryRow | null>((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE, 'readwrite');
        const store = tx.objectStore(HISTORY_STORE);
        const req = store.get(id);
        let written: HistoryRow | null = null;
        req.onsuccess = () => {
          const existing = req.result as HistoryRow | undefined;
          // The row may have aged out of MAX_ENTRIES since it was loaded.
          if (!existing) return;
          written = applyPatch(existing, patch);
          store.put(written);
        };
        tx.oncomplete = () => resolve(written);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export const localStore: DatasetStore = {
  kind: 'local',

  async list() {
    try {
      const all = await readAll();
      return all.sort((a, b) => b.uploadedAt - a.uploadedAt).map(toMeta);
    } catch {
      // IndexedDB unavailable (private browsing, quota exceeded, etc.)
      return [];
    }
  },

  async load(key): Promise<DatasetRecord | null> {
    const id = localId(key);
    if (id == null) return null;
    try {
      const row = await getRow(id);
      return row ? { meta: toMeta(row), data: row.data } : null;
    } catch {
      return null;
    }
  },

  async save(fileName, data, resolution, provenance) {
    if (!data.length) return null;
    const row: Omit<HistoryRow, 'id'> = {
      fileName,
      uploadedAt: Date.now(),
      startDate: data[0].timestamp,
      endDate: data[data.length - 1].timestamp,
      recordCount: data.length,
      resolution,
      ...stripUndefined(provenance),
      data,
    };
    try {
      const db = await openDb();
      const id = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE, 'readwrite');
        const store = tx.objectStore(HISTORY_STORE);
        const addReq = store.add(row);
        let newId = 0;
        addReq.onsuccess = () => { newId = addReq.result as number; };
        // After add, getAll includes the new record (same transaction = a
        // consistent view), so eviction sees the true post-insert count.
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          const all = getAllReq.result as HistoryRow[];
          if (all.length > MAX_ENTRIES) {
            const sorted = [...all].sort((a, b) => a.uploadedAt - b.uploadedAt);
            for (let i = 0; i < all.length - MAX_ENTRIES; i++) store.delete(sorted[i].id);
          }
        };
        tx.oncomplete = () => resolve(newId);
        tx.onerror = () => reject(tx.error);
      });
      return toMeta({ ...row, id } as HistoryRow);
    } catch {
      return null;
    }
  },

  async replace(key, data, resolution, provenance) {
    const id = localId(key);
    if (id == null) throw new Error(`Not a local dataset: ${key}`);
    if (!data.length) throw new Error('Refusing to replace a dataset with no readings');
    const row = await mutate(id, {
      data,
      resolution,
      startDate: data[0].timestamp,
      endDate: data[data.length - 1].timestamp,
      recordCount: data.length,
      uploadedAt: Date.now(),
      ...stripUndefined(provenance),
    });
    if (!row) throw new Error('That dataset is no longer in this browser’s history');
    return toMeta(row);
  },

  // A name change touches one field of one row — the readings are not rewritten
  // and the entry keeps its place in the recency order.
  async rename(key, fileName) {
    const id = localId(key);
    if (id == null) throw new Error(`Not a local dataset: ${key}`);
    const cleaned = normalizeDatasetName(fileName);
    if (!cleaned) throw new Error('A dataset needs a name');
    const row = await mutate(id, { fileName: cleaned });
    if (!row) throw new Error('That dataset is no longer in this browser\u2019s history');
    return toMeta(row);
  },

  async patchProvenance(key, patch) {
    const id = localId(key);
    if (id == null) return;
    try {
      await mutate(id, patch);
    } catch {
      // IndexedDB unavailable
    }
  },

  async delete(key) {
    const id = localId(key);
    if (id == null) return;
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE, 'readwrite');
        tx.objectStore(HISTORY_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // IndexedDB unavailable
    }
  },
};
