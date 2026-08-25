import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { DataPoint } from '../types';
import { localStore } from '../data/localStore';
import {
  keyKind,
  type DatasetKey, type DatasetMeta, type DatasetProvenance,
  type DatasetRecord, type DatasetStore, type StoreKind,
} from '../data/datasetStore';

// The app's view of every saved dataset, wherever it lives. Stores are queried
// independently so one being unavailable — Drive while signed out or offline —
// leaves the others listed rather than emptying the library.

export interface DatasetLibrary {
  entries: DatasetMeta[];
  /** True while any store's listing is in flight. */
  loading: boolean;
  refresh: () => Promise<void>;
  load: (key: DatasetKey) => Promise<DatasetRecord | null>;
  save: (
    kind: StoreKind,
    name: string,
    data: DataPoint[],
    resolution: string,
    provenance?: DatasetProvenance,
  ) => Promise<DatasetMeta | null>;
  replace: (
    key: DatasetKey,
    data: DataPoint[],
    resolution: string,
    provenance?: DatasetProvenance,
    expect?: { syncVersion?: string },
  ) => Promise<DatasetMeta>;
  patchProvenance: (key: DatasetKey, patch: DatasetProvenance) => Promise<void>;
  /** Give a dataset a new display name, wherever it lives. */
  rename: (key: DatasetKey, fileName: string) => Promise<DatasetMeta>;
  remove: (key: DatasetKey) => Promise<void>;
}

export function useDatasetLibrary(extraStores: DatasetStore[] = []): DatasetLibrary {
  const [entries, setEntries] = useState<DatasetMeta[]>([]);
  const [loading, setLoading] = useState(false);

  const stores = useMemo<DatasetStore[]>(
    () => [localStore, ...extraStores],
    [extraStores],
  );
  // Read by the mutation helpers, which must route to the right store without
  // re-identifying every callback each time the store list changes.
  const storesRef = useRef(stores);
  storesRef.current = stores;

  const storeFor = useCallback((key: DatasetKey): DatasetStore | null => {
    const kind = keyKind(key);
    return storesRef.current.find((s) => s.kind === kind) ?? null;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const lists = await Promise.all(
        storesRef.current.map((s) => s.list().catch(() => [] as DatasetMeta[])),
      );
      setEntries(lists.flat().sort((a, b) => b.uploadedAt - a.uploadedAt));
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-list whenever the set of stores changes — signing in adds Drive's
  // datasets to the library, signing out takes them away again.
  useEffect(() => { void refresh(); }, [refresh, stores]);

  const load = useCallback(
    (key: DatasetKey) => storeFor(key)?.load(key) ?? Promise.resolve(null),
    [storeFor],
  );

  const save = useCallback(async (
    kind: StoreKind,
    name: string,
    data: DataPoint[],
    resolution: string,
    provenance?: DatasetProvenance,
  ) => {
    const store = storesRef.current.find((s) => s.kind === kind);
    if (!store) return null;
    const meta = await store.save(name, data, resolution, provenance);
    await refresh();
    return meta;
  }, [refresh]);

  const replace = useCallback(async (
    key: DatasetKey,
    data: DataPoint[],
    resolution: string,
    provenance?: DatasetProvenance,
    expect?: { syncVersion?: string },
  ) => {
    const store = storeFor(key);
    if (!store) throw new Error(`No store for dataset ${key}`);
    const meta = await store.replace(key, data, resolution, provenance, expect);
    await refresh();
    return meta;
  }, [storeFor, refresh]);

  const patchProvenance = useCallback(async (key: DatasetKey, patch: DatasetProvenance) => {
    const store = storeFor(key);
    if (!store) return;
    await store.patchProvenance(key, patch);
    await refresh();
  }, [storeFor, refresh]);

  const rename = useCallback(async (key: DatasetKey, fileName: string) => {
    const store = storeFor(key);
    if (!store) throw new Error(`No store for dataset ${key}`);
    const meta = await store.rename(key, fileName);
    await refresh();
    return meta;
  }, [storeFor, refresh]);

  const remove = useCallback(async (key: DatasetKey) => {
    const store = storeFor(key);
    if (!store) return;
    await store.delete(key);
    await refresh();
  }, [storeFor, refresh]);

  // Memoized so effects in App that depend on the library — the debounced
  // schedule write-back in particular — re-run when its contents change rather
  // than on every render.
  return useMemo(
    () => ({ entries, loading, refresh, load, save, replace, patchProvenance, rename, remove }),
    [entries, loading, refresh, load, save, replace, patchProvenance, rename, remove],
  );
}
