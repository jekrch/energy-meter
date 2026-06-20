import { useState, useEffect, useCallback } from 'react';
import type { DataPoint } from '../types';
import type { MergeSourceMeta } from '../utils/mergeData';

// Schema-v2 provenance fields. All optional so v1 rows (which predate them)
// read back as `undefined` with no migration beyond the version bump.
export interface FileHistoryProvenance {
  flowDirection?: number;        // ESPI flow direction, for merge compatibility
  commodity?: number;            // ESPI commodity, for merge compatibility
  intervalLength?: number;       // seconds per reading
  isMerged?: boolean;            // produced by the merge feature — badge it
  sources?: MergeSourceMeta[];   // provenance of a merged entry
}

export interface FileHistoryEntry extends FileHistoryProvenance {
  id: number;
  fileName: string;
  uploadedAt: number;
  startDate: number;
  endDate: number;
  recordCount: number;
  resolution: string;
  data: DataPoint[];
}

export type FileHistoryMeta = Omit<FileHistoryEntry, 'data'>;

const DB_NAME = 'energy-meter';
const STORE_NAME = 'file-history';
// v2: added optional provenance fields (flowDirection/commodity/intervalLength/
// isMerged/sources). The upgrade is a no-op — new fields default to undefined on
// existing rows — but the version bump lets the browser run onupgradeneeded.
const DB_VERSION = 2;
const MAX_ENTRIES = 5;

// Drop undefined-valued keys so optional provenance never bloats stored rows.
function stripUndefined(obj?: FileHistoryProvenance): FileHistoryProvenance {
  if (!obj) return {};
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  );
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function useFileHistory() {
  const [entries, setEntries] = useState<FileHistoryMeta[]>([]);

  const refresh = useCallback(async () => {
    try {
      const db = await openDB();
      const all = await new Promise<FileHistoryEntry[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      setEntries(
        all
          .sort((a, b) => b.uploadedAt - a.uploadedAt)
          .map(({ data: _d, ...rest }) => rest),
      );
    } catch {
      // IndexedDB unavailable (private browsing, storage quota exceeded, etc.)
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveEntry = useCallback(async (
    fileName: string,
    data: DataPoint[],
    resolution: string,
    provenance?: FileHistoryProvenance,
  ) => {
    if (!data.length) return;
    try {
      const db = await openDB();
      const entry: Omit<FileHistoryEntry, 'id'> = {
        fileName,
        uploadedAt: Date.now(),
        startDate: data[0].timestamp,
        endDate: data[data.length - 1].timestamp,
        recordCount: data.length,
        resolution,
        ...stripUndefined(provenance),
        data,
      };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.add(entry);
        // After add, getAll will include the new record (same transaction = consistent view)
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          const all: FileHistoryEntry[] = getAllReq.result;
          if (all.length > MAX_ENTRIES) {
            const sorted = [...all].sort((a, b) => a.uploadedAt - b.uploadedAt);
            for (let i = 0; i < all.length - MAX_ENTRIES; i++) {
              store.delete(sorted[i].id);
            }
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      await refresh();
    } catch {
      // IndexedDB unavailable
    }
  }, [refresh]);

  const loadEntry = useCallback(async (id: number): Promise<FileHistoryEntry | null> => {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }, []);

  const deleteEntry = useCallback(async (id: number) => {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      await refresh();
    } catch {
      // IndexedDB unavailable
    }
  }, [refresh]);

  return { entries, saveEntry, loadEntry, deleteEntry };
}
