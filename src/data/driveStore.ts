import type { DataPoint } from '../types';
import { sanitizePeakSchedule } from '../utils/peakSchedule';
import {
  readNativeFile, sanitizeFilename, serializeNativeFile, type NativeSourceMeta,
} from '../utils/nativeFormat';
import { DRIVE_FOLDER_NAME } from './config';
import {
  createFile, downloadBlob, ensureFolder, findFolder, folderUrl, getFileMeta,
  listFiles, quote, trashFile, updateFile, type DriveFile, type DriveFileMetadata,
} from './driveClient';
import { indexedDbCache, loadWithCache } from './driveCache';
import { onAuthReset } from './googleAuth';
import {
  DatasetConflictError, driveId, encodeKey, normalizeDatasetName,
  type DatasetMeta, type DatasetProvenance, type DatasetRecord, type DatasetStore,
} from './datasetStore';

/**
 * A `DatasetStore` over one visible folder in the user's Google Drive. A cloud
 * dataset is just one native `.json.gz` file: the wire format already exists,
 * so this layer is storage and metadata only — no schema, no server-side merge.
 *
 * The scalar metadata the library list renders from (`start`/`end`/`count`/
 * `resolution` and the merge-compatibility provenance) is mirrored into Drive's
 * per-file `appProperties`, so one `files.list` renders the whole library
 * without downloading a byte of readings. Everything that doesn't fit — the
 * `sources[]` and the full `peakSchedule` — stays inside the file body and
 * arrives when the dataset is actually loaded. The listing is therefore a
 * derived cache of facts the file itself owns and can never disagree in a way
 * that matters.
 */

// ── appProperties ↔ DatasetMeta ──────────────────────────────────────────────
// Drive allows 100 properties per file and 124 bytes per key+value pair —
// counting the key and the value together, and rejecting the whole write with a
// 403 if any pair is over. Epoch seconds and short keys keep every scalar well
// inside one pair; the display name is the only value that can realistically
// reach the cap, and a merged name built from several source filenames reaches
// it easily.
const P = {
  fileName: 'emFileName',
  nameCut: 'emNameCut',
  start: 'emStart',
  end: 'emEnd',
  count: 'emCount',
  resolution: 'emResolution',
  flow: 'emFlow',
  commodity: 'emCommodity',
  interval: 'emInterval',
  merged: 'emMerged',
  schedule: 'emSchedule',
  gzip: 'emGzip',
} as const;

function num(props: Record<string, string> | undefined, key: string): number | undefined {
  const raw = props?.[key];
  if (raw == null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

const PROPERTY_LIMIT_BYTES = 124;
const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Shorten a property value so the key and value together fit Drive's 124-byte
 * cap. Trimmed one code point at a time, so a multi-byte character is never cut
 * in half, and marked with an ellipsis so the list does not silently claim a
 * dataset is called something it isn't. Nothing is lost by this: the full name
 * lives in the file body, and `emNameCut` tells an in-place rewrite to go and
 * fetch it rather than baking the short form in.
 */
export function fitProperty(key: string, value: string): string {
  const budget = PROPERTY_LIMIT_BYTES - byteLength(key);
  if (budget <= 0) return '';
  if (byteLength(value) <= budget) return value;

  const ellipsis = '…';
  const target = budget - byteLength(ellipsis);
  let out = '';
  let used = 0;
  for (const char of value) {
    const size = byteLength(char);
    if (used + size > target) break;
    out += char;
    used += size;
  }
  return out + ellipsis;
}

function put(target: Record<string, string>, key: string, value: number | string | undefined) {
  if (value === undefined || value === null || value === '') return;
  target[key] = fitProperty(key, String(value));
}

export function buildAppProperties(
  fileName: string,
  data: readonly DataPoint[],
  resolution: string,
  provenance: DatasetProvenance | undefined,
  gzipped: boolean,
): Record<string, string> {
  const props: Record<string, string> = {};
  put(props, P.fileName, fileName);
  if (fileName && props[P.fileName] !== fileName) props[P.nameCut] = '1';
  put(props, P.start, data[0]?.timestamp ?? 0);
  put(props, P.end, data[data.length - 1]?.timestamp ?? 0);
  put(props, P.count, data.length);
  put(props, P.resolution, resolution);
  put(props, P.flow, provenance?.flowDirection);
  put(props, P.commodity, provenance?.commodity);
  put(props, P.interval, provenance?.intervalLength);
  if (provenance?.isMerged) props[P.merged] = '1';
  if (provenance?.peakSchedule) props[P.schedule] = '1';
  if (gzipped) props[P.gzip] = '1';
  return props;
}

/** The display name a Drive file currently holds, for in-place rewrites. */
function displayName(file: DriveFile): string {
  return file.appProperties?.[P.fileName] || file.name.replace(/\.json(\.gz)?$/i, '');
}

/**
 * Turn one Drive file into a library row. Written to degrade rather than throw:
 * a file hand-dropped into the folder has no `appProperties` at all, and a
 * hand-edited one may have nonsense in them. A row with `recordCount === 0` is
 * one whose scalars are unknown until it is opened — the UI renders it without
 * a date range rather than inventing one.
 */
export function toDatasetMeta(file: DriveFile): DatasetMeta {
  const props = file.appProperties;
  return {
    key: encodeKey('drive', file.id),
    kind: 'drive',
    fileName: displayName(file),
    uploadedAt: file.modifiedTime ? Date.parse(file.modifiedTime) || 0 : 0,
    startDate: num(props, P.start) ?? 0,
    endDate: num(props, P.end) ?? 0,
    recordCount: num(props, P.count) ?? 0,
    resolution: props?.[P.resolution] || 'RAW',
    flowDirection: num(props, P.flow),
    commodity: num(props, P.commodity),
    intervalLength: num(props, P.interval),
    ...(props?.[P.merged] === '1' ? { isMerged: true } : {}),
    ...(file.version ? { syncVersion: file.version } : {}),
  };
}

// ── Compression ──────────────────────────────────────────────────────────────
// A year of 15-minute readings is ~2 MB of native JSON and five years ~10 MB,
// above the 5 MB ceiling documented for `uploadType=multipart`. Repetitive
// numeric JSON gzips to well under a tenth of that, which keeps the simple
// multipart upload viable for any realistic dataset and makes loads fast.

const MULTIPART_LIMIT = 5 * 1024 * 1024;

export function canCompress(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

async function compress(text: string): Promise<Blob> {
  const source = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(source).arrayBuffer()], { type: 'application/gzip' });
}

async function decompress(blob: Blob): Promise<string> {
  const source = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(source).text();
}

/** Gzip magic bytes. Trusted over `emGzip`, which a hand-dropped file lacks. */
async function isGzipped(blob: Blob): Promise<boolean> {
  if (blob.size < 2) return false;
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  return head[0] === 0x1f && head[1] === 0x8b;
}

async function readBody(blob: Blob): Promise<string> {
  return (await isGzipped(blob)) ? decompress(blob) : blob.text();
}

interface EncodedBody {
  blob: Blob;
  gzipped: boolean;
  extension: string;
}

async function encodeBody(json: string): Promise<EncodedBody> {
  if (canCompress()) {
    return { blob: await compress(json), gzipped: true, extension: '.json.gz' };
  }
  // No CompressionStream: the 5 MB multipart ceiling becomes the real limit,
  // and surfacing it is better than a truncated upload.
  const blob = new Blob([json], { type: 'application/json' });
  if (blob.size > MULTIPART_LIMIT) {
    throw new Error(
      'This dataset is too large to save to Drive from this browser. Try a browser with compression support (Chrome, Edge, Firefox, or Safari 16.4+).',
    );
  }
  return { blob, gzipped: false, extension: '.json' };
}

// ── Folder bootstrap ─────────────────────────────────────────────────────────

let folderPromise: Promise<string> | null = null;

export function getFolderId(): Promise<string> {
  if (!folderPromise) {
    folderPromise = ensureFolder(DRIVE_FOLDER_NAME);
    folderPromise.catch(() => { folderPromise = null; });
  }
  return folderPromise;
}

export async function getFolderUrl(): Promise<string> {
  return folderUrl(await getFolderId());
}

// What the most recent listing reported, so `load` can validate the cache and
// build a row without a second metadata request.
const listed = new Map<string, DriveFile>();

/**
 * Forget everything tied to the signed-in account. The cached bodies go with
 * it: they are full copies of that account's readings, nothing else in the
 * browser distinguishes one account's file ids from another's, and a listing
 * that would prune them only runs if the same account signs back in — so
 * without this they would sit on disk indefinitely after sign-out.
 *
 * Awaitable for tests; callers on the sign-out path ignore the promise, and
 * the in-memory state is dropped synchronously before the first await either
 * way.
 */
export async function resetDriveState(): Promise<void> {
  folderPromise = null;
  listed.clear();
  await indexedDbCache.clear().catch(() => {});
}

// Registered once, at import: sign-out and a refresh that came back as a
// different Google account both end the session, and neither can be allowed to
// leave this account's folder id or cached readings behind.
onAuthReset(() => { void resetDriveState(); });

// ── Write serialization ──────────────────────────────────────────────────────
// A merge-back and a debounced schedule write-back must not interleave their
// read-modify-write cycles, so every mutation runs through one chain.

let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = writeChain.then(op, op);
  writeChain = run.catch(() => {});
  return run;
}

// ── Store ────────────────────────────────────────────────────────────────────

const LIST_FIELDS = 'id,name,mimeType,size,modifiedTime,version,appProperties';

async function fetchBody(fileId: string): Promise<string> {
  return readBody(await downloadBlob(fileId));
}

function sourcesFor(provenance: DatasetProvenance | undefined, fileName: string, data: readonly DataPoint[]): NativeSourceMeta[] {
  if (provenance?.sources?.length) return provenance.sources;
  return [{
    fileName,
    startDate: data[0]?.timestamp ?? 0,
    endDate: data[data.length - 1]?.timestamp ?? 0,
    recordCount: data.length,
  }];
}

async function writeDataset(
  fileId: string | null,
  fileName: string,
  data: DataPoint[],
  resolution: string,
  provenance: DatasetProvenance | undefined,
): Promise<DatasetMeta> {
  const json = serializeNativeFile(data, {
    fileName,
    resolution,
    sources: sourcesFor(provenance, fileName, data),
    peakSchedule: provenance?.peakSchedule,
  });
  const { blob, gzipped, extension } = await encodeBody(json);
  const metadata: DriveFileMetadata = {
    name: `${sanitizeFilename(fileName)}${extension}`,
    mimeType: gzipped ? 'application/gzip' : 'application/json',
    appProperties: buildAppProperties(fileName, data, resolution, provenance, gzipped),
  };

  const file = fileId
    ? await updateFile(fileId, metadata, blob)
    : await createFile({ ...metadata, parents: [await getFolderId()] }, blob);

  listed.set(file.id, file);
  // The body just written is the freshest copy there is — seed the cache with
  // it rather than making the next open re-download what this device produced.
  if (file.modifiedTime) {
    await indexedDbCache.set(file.id, { modifiedTime: file.modifiedTime, json }).catch(() => {});
  }
  return toDatasetMeta(file);
}

/**
 * Re-read a file's server-side state before overwriting it, and refuse when it
 * moved on since the caller loaded it. Two devices can hold the same dataset
 * open; a clobbered five-year merged history is not a cheap loss. Drive keeps
 * revisions of its own, so an overwrite the user *does* confirm stays
 * recoverable from Drive's UI.
 */
async function fetchForWrite(
  key: string,
  fileId: string,
  expected: string | undefined,
): Promise<DriveFile> {
  const current = await getFileMeta(fileId, LIST_FIELDS);
  listed.set(fileId, current);
  if (expected && current.version && current.version !== expected) {
    throw new DatasetConflictError(
      key,
      'This dataset changed in Drive since you opened it, possibly from another device.',
    );
  }
  return current;
}

export const driveStore: DatasetStore = {
  kind: 'drive',

  async list() {
    const folderId = await getFolderId();
    const files = await listFiles(
      `${quote(folderId)} in parents and trashed=false and mimeType!=${quote('application/vnd.google-apps.folder')}`,
      LIST_FIELDS,
    );
    listed.clear();
    for (const f of files) listed.set(f.id, f);
    // Drop cached bodies for files that are no longer there.
    void indexedDbCache.prune(files.map((f) => f.id)).catch(() => {});
    return files.map(toDatasetMeta);
  },

  async load(key): Promise<DatasetRecord | null> {
    const fileId = driveId(key);
    if (!fileId) return null;

    // A dataset opened without a fresh listing (a stale library, a load that
    // follows a write from another tab) still needs a freshness stamp to
    // validate the cache against.
    let file = listed.get(fileId);
    if (!file) {
      file = await getFileMeta(fileId, LIST_FIELDS);
      listed.set(fileId, file);
    }

    const text = await loadWithCache(fileId, file.modifiedTime, indexedDbCache, fetchBody);
    const parsed = readNativeFile(text);
    if (!parsed) return null;

    // The listing's scalars describe the same file, but the body is the source
    // of truth for everything it carries — sources and schedule included.
    const meta = toDatasetMeta(file);
    return {
      meta: {
        ...meta,
        fileName: parsed.fileName || meta.fileName || 'dataset',
        resolution: parsed.resolution || meta.resolution,
        startDate: parsed.data[0].timestamp,
        endDate: parsed.data[parsed.data.length - 1].timestamp,
        recordCount: parsed.data.length,
        ...(parsed.sources.length > 1 ? { isMerged: true, sources: parsed.sources } : {}),
        ...(parsed.peakSchedule ? { peakSchedule: parsed.peakSchedule } : {}),
      },
      data: parsed.data,
    };
  },

  async save(name, data, resolution, provenance) {
    if (!data.length) return null;
    return enqueue(() => writeDataset(null, name, data, resolution, provenance));
  },

  async replace(key, data, resolution, provenance, expect) {
    const fileId = driveId(key);
    if (!fileId) throw new Error(`Not a Drive dataset: ${key}`);
    if (!data.length) throw new Error('Refusing to replace a dataset with no readings');
    return enqueue(async () => {
      const current = await fetchForWrite(key, fileId, expect?.syncVersion);
      // The file keeps its name: an in-place merge-back appends to a dataset
      // the user already named, and renaming it would orphan the row they were
      // just looking at. When the listing only holds a shortened copy of that
      // name, recover the original from the body — usually a cache hit — rather
      // than letting each rewrite bake in another ellipsis.
      let name = displayName(current);
      if (current.appProperties?.[P.nameCut] === '1') {
        const existing = await driveStore.load(key);
        if (existing?.meta.fileName) name = existing.meta.fileName;
      }
      return writeDataset(fileId, name, data, resolution, provenance);
    });
  },

  /**
   * Rename a cloud dataset. The display name lives in three places that have to
   * agree — Drive's own file name, the `emFileName` property the listing reads,
   * and the `fileName` inside the body that `load` trusts over both — so this
   * is a full rewrite rather than a metadata patch. A metadata-only rename
   * would show the new name in the library and the old one the moment the
   * dataset was opened.
   */
  async rename(key, fileName) {
    const fileId = driveId(key);
    if (!fileId) throw new Error(`Not a Drive dataset: ${key}`);
    const cleaned = normalizeDatasetName(fileName);
    if (!cleaned) throw new Error('A dataset needs a name');
    return enqueue(async () => {
      const current = await driveStore.load(key);
      if (!current) throw new Error('That dataset is no longer in your Drive folder');
      return writeDataset(fileId, cleaned, current.data, current.meta.resolution, current.meta);
    });
  },

  // The peak schedule lives inside the file body, so patching it means
  // rewriting the whole dataset — which is why App debounces these writes.
  async patchProvenance(key, patch) {
    const fileId = driveId(key);
    if (!fileId) return;
    await enqueue(async () => {
      const current = await driveStore.load(key);
      if (!current) return;
      const next: DatasetProvenance = { ...current.meta };
      for (const [field, value] of Object.entries(patch)) {
        if (value === undefined) delete next[field as keyof DatasetProvenance];
        else (next as Record<string, unknown>)[field] = value;
      }
      next.peakSchedule = sanitizePeakSchedule(next.peakSchedule) ?? undefined;
      await writeDataset(fileId, current.meta.fileName, current.data, current.meta.resolution, next);
    });
  },

  async delete(key) {
    const fileId = driveId(key);
    if (!fileId) return;
    await enqueue(async () => {
      await trashFile(fileId);
      listed.delete(fileId);
    });
  },
};

/**
 * Remove everything this app put in the user's Drive: every dataset in the
 * folder, then the folder itself. `resetDriveState` only forgets the local
 * half, so the header menu's teardown calls this first.
 *
 * Trashed rather than erased, like a single "Remove from Drive": a mis-click
 * here costs years of merged history, and Drive's trash gives it back for 30
 * days. That is the user's own trash, so it survives the revoke that follows.
 *
 * Scoped to the folder. `drive.file` would narrow a bare `files.list` to what
 * this app created, catching a dataset the user moved elsewhere too, but a bulk
 * delete should not rest on a scope subtlety: what goes is what the
 * confirmation named.
 *
 * Runs on the write chain, so it cannot interleave with a debounced schedule
 * write-back. Returns how many datasets were removed.
 */
export async function deleteAllDriveData(): Promise<number> {
  return enqueue(async () => {
    // Found, not ensured: an account that never saved anything must not have a
    // folder conjured for it here only to be trashed in the next breath.
    const folderId = await findFolder(DRIVE_FOLDER_NAME);
    if (!folderId) {
      await resetDriveState();
      return 0;
    }

    const files = await listFiles(`${quote(folderId)} in parents and trashed=false`, 'id');
    // Files first, folder last: a failure partway through then leaves the rest
    // where the user can still see them, and a retry finds them again. Trashing
    // the folder first would strand them inside a trashed parent.
    for (const file of files) await trashFile(file.id);
    await trashFile(folderId);

    await resetDriveState();
    return files.length;
  });
}
