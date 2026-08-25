import type { DataPoint, PeakSchedule } from '../types';
import type { MergeSourceMeta } from '../utils/mergeData';

// A dataset is a saved set of readings plus the provenance needed to reopen it,
// merge it, and draw a row for it. Two backends implement the same interface:
// the browser's IndexedDB history (`localStore`) and the user's Google Drive
// (`driveStore`). Both are listed side by side rather than behind a mode switch
// — merging a just-uploaded local file into a saved cloud one is the point of
// the Drive feature, and a mode switch would make that impossible.

export type StoreKind = 'local' | 'drive';

// Stable, store-qualified identity. Local ids are IndexedDB autoIncrement
// numbers; Drive ids are opaque file-id strings — a single string key keeps
// every call site (modal selection sets, merge id lists, the schedule
// write-back ref in App) from having to care which.
export type DatasetKey = string; // `local:12` | `drive:1AbC...`

// Optional provenance carried alongside the readings. All optional so rows that
// predate a field read back as `undefined` with no migration.
export interface DatasetProvenance {
  flowDirection?: number;        // ESPI flow direction, for merge compatibility
  commodity?: number;            // ESPI commodity, for merge compatibility
  intervalLength?: number;       // seconds per reading
  isMerged?: boolean;            // produced by the merge feature — badge it
  sources?: MergeSourceMeta[];   // provenance of a merged entry
  peakSchedule?: PeakSchedule;   // the TOU schedule in force for this dataset
}

export interface DatasetMeta extends DatasetProvenance {
  key: DatasetKey;
  kind: StoreKind;
  fileName: string;
  uploadedAt: number;      // Drive: modifiedTime as epoch ms
  startDate: number;       // epoch seconds
  endDate: number;         // epoch seconds
  recordCount: number;
  resolution: string;
  // Drive's per-file `version`, captured at load. Passed back on `replace` so a
  // write can refuse to clobber an edit made from another device.
  syncVersion?: string;
}

export interface DatasetRecord {
  meta: DatasetMeta;
  data: DataPoint[];
}

/** Thrown by `replace` when the stored dataset moved on since it was loaded. */
export class DatasetConflictError extends Error {
  readonly key: DatasetKey;

  constructor(key: DatasetKey, message = 'This dataset changed since you opened it') {
    super(message);
    this.name = 'DatasetConflictError';
    this.key = key;
  }
}

export interface DatasetStore {
  kind: StoreKind;
  list(): Promise<DatasetMeta[]>;
  load(key: DatasetKey): Promise<DatasetRecord | null>;
  /** Create a new dataset. Null when the backing store is unavailable. */
  save(
    name: string,
    data: DataPoint[],
    resolution: string,
    provenance?: DatasetProvenance,
  ): Promise<DatasetMeta | null>;
  /** Overwrite an existing dataset's readings in place (the merge-back path). */
  replace(
    key: DatasetKey,
    data: DataPoint[],
    resolution: string,
    provenance?: DatasetProvenance,
    expect?: { syncVersion?: string },
  ): Promise<DatasetMeta>;
  /** Patch provenance only, leaving the readings untouched. */
  patchProvenance(key: DatasetKey, patch: DatasetProvenance): Promise<void>;
  /** Give a dataset a new display name, leaving its readings untouched. */
  rename(key: DatasetKey, fileName: string): Promise<DatasetMeta>;
  delete(key: DatasetKey): Promise<void>;
}

// Long enough for a descriptive name ("Home electricity 2021–2025"), short
// enough to stay legible in a library row and to survive a round trip through
// a Drive file name.
export const MAX_DATASET_NAME = 120;

/**
 * A display name in the form the stores keep it: trimmed, with runs of
 * whitespace (a paste from a spreadsheet cell, say) collapsed, and capped.
 * Returns null when nothing usable is left — callers reject the rename rather
 * than storing a blank a user can no longer tell apart.
 */
export function normalizeDatasetName(name: string): string | null {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_DATASET_NAME ? cleaned.slice(0, MAX_DATASET_NAME).trim() : cleaned;
}

export function encodeKey(kind: StoreKind, id: string | number): DatasetKey {
  return `${kind}:${id}`;
}

export interface ParsedKey {
  kind: StoreKind;
  id: string;
}

// Only the first colon separates the two halves: Drive file ids are opaque and
// a future id containing one must still round-trip.
export function decodeKey(key: DatasetKey | null | undefined): ParsedKey | null {
  if (!key) return null;
  const split = key.indexOf(':');
  if (split <= 0) return null;
  const kind = key.slice(0, split);
  const id = key.slice(split + 1);
  if (!id) return null;
  if (kind !== 'local' && kind !== 'drive') return null;
  return { kind, id };
}

export function keyKind(key: DatasetKey | null | undefined): StoreKind | null {
  return decodeKey(key)?.kind ?? null;
}

/** The numeric IndexedDB id behind a `local:` key, or null for anything else. */
export function localId(key: DatasetKey | null | undefined): number | null {
  const parsed = decodeKey(key);
  if (!parsed || parsed.kind !== 'local') return null;
  const id = Number(parsed.id);
  return Number.isInteger(id) ? id : null;
}

/** The Drive file id behind a `drive:` key, or null for anything else. */
export function driveId(key: DatasetKey | null | undefined): string | null {
  const parsed = decodeKey(key);
  return parsed && parsed.kind === 'drive' ? parsed.id : null;
}

// Drop undefined-valued keys so optional provenance never bloats stored rows.
export function stripUndefined(obj?: DatasetProvenance): DatasetProvenance {
  if (!obj) return {};
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
