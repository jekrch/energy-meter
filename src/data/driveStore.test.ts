/// <reference types="bun-types" />
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test';
import 'fake-indexeddb/auto';
import type { DataPoint, PeakSchedule } from '../types';
import type { DriveFile, DriveFileMetadata } from './driveClient';
import * as realDriveClientModule from './driveClient';

// An in-memory stand-in for the folder: enough of Drive to exercise the store's
// own logic (metadata mapping, gzip framing, the conflict check, the write
// queue) without a network or an account.
interface FakeFile extends DriveFile {
  body: Blob;
}

const files = new Map<string, FakeFile>();
let nextId = 1;
let ensureFolderCalls = 0;
const requests: string[] = [];

function stamp(file: FakeFile): FakeFile {
  file.version = String(Number(file.version ?? '0') + 1);
  file.modifiedTime = new Date(1_700_000_000_000 + Number(file.version) * 1000).toISOString();
  return file;
}

// Captured before the mock lands, for the same reason as in `driveClient.test.ts`:
// a module mock is global and permanent unless the real namespace is put back.
const realDriveClient = { ...realDriveClientModule };

mock.module('./driveClient', () => ({
  DriveAuthError: class DriveAuthError extends Error {},
  FOLDER_MIME: 'application/vnd.google-apps.folder',
  quote: (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
  ensureFolder: async () => { ensureFolderCalls++; return 'folder-1'; },
  folderUrl: (id: string) => `https://drive.google.com/drive/folders/${id}`,
  listFiles: async () => { requests.push('list'); return [...files.values()]; },
  getFileMeta: async (id: string) => {
    requests.push(`meta:${id}`);
    const f = files.get(id);
    if (!f) throw new Error('not found');
    return { ...f };
  },
  downloadBlob: async (id: string) => { requests.push(`download:${id}`); return files.get(id)!.body; },
  createFile: async (metadata: DriveFileMetadata, content: Blob) => {
    const id = `file-${nextId++}`;
    const file: FakeFile = { id, name: metadata.name!, mimeType: metadata.mimeType, appProperties: metadata.appProperties, body: content };
    files.set(id, stamp(file));
    return { ...file };
  },
  updateFile: async (id: string, metadata: DriveFileMetadata, content: Blob) => {
    const file = files.get(id)!;
    Object.assign(file, { name: metadata.name ?? file.name, mimeType: metadata.mimeType, appProperties: metadata.appProperties, body: content });
    return { ...stamp(file) };
  },
  updateFileMetadata: async () => ({ id: 'x', name: 'x' }),
  trashFile: async (id: string) => { files.delete(id); },
  deleteFile: async (id: string) => { files.delete(id); },
}));

const { driveStore, buildAppProperties, fitProperty, toDatasetMeta, canCompress, resetDriveState } =
  await import('./driveStore');
const { DatasetConflictError } = await import('./datasetStore');

const data: DataPoint[] = [
  { timestamp: 1735689600, value: 412, cost: 5100, duration: 900 },
  { timestamp: 1735690500, value: 388, cost: 4800, duration: 900 },
];

const schedule: PeakSchedule = {
  version: 1,
  periods: [{
    id: 'p1',
    name: 'On-Peak',
    colorKey: 'red',
    rules: [{ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [1, 2, 3, 4, 5], months: [] }],
  }],
  observeHolidays: true,
  holidayRules: [],
  extraHolidays: [],
};

beforeEach(async () => {
  files.clear();
  nextId = 1;
  ensureFolderCalls = 0;
  requests.length = 0;
  await resetDriveState();
});

describe('appProperties mapping', () => {
  it('carries the scalars a library row is drawn from', () => {
    const props = buildAppProperties('January 2026', data, 'RAW',
      { flowDirection: 1, commodity: 0, intervalLength: 900, isMerged: true, peakSchedule: schedule }, true);

    expect(props).toEqual({
      emFileName: 'January 2026',
      emStart: '1735689600',
      emEnd: '1735690500',
      emCount: '2',
      emResolution: 'RAW',
      emFlow: '1',
      emCommodity: '0',
      emInterval: '900',
      emMerged: '1',
      emSchedule: '1',
      emGzip: '1',
    });
  });

  it('omits provenance the dataset does not have', () => {
    const props = buildAppProperties('plain', data, 'DAILY', undefined, false);
    expect(Object.keys(props).sort()).toEqual(
      ['emCount', 'emEnd', 'emFileName', 'emResolution', 'emStart'],
    );
  });

  it('round-trips back into a DatasetMeta', () => {
    const props = buildAppProperties('January 2026', data, 'RAW', { flowDirection: 1, intervalLength: 900 }, true);
    const meta = toDatasetMeta({
      id: 'abc', name: 'january-2026.json.gz', appProperties: props,
      modifiedTime: '2026-01-31T12:00:00.000Z', version: '7',
    });

    expect(meta.key).toBe('drive:abc');
    expect(meta.kind).toBe('drive');
    expect(meta.fileName).toBe('January 2026');
    expect(meta.startDate).toBe(1735689600);
    expect(meta.endDate).toBe(1735690500);
    expect(meta.recordCount).toBe(2);
    expect(meta.resolution).toBe('RAW');
    expect(meta.flowDirection).toBe(1);
    expect(meta.intervalLength).toBe(900);
    expect(meta.syncVersion).toBe('7');
    expect(meta.uploadedAt).toBe(Date.parse('2026-01-31T12:00:00.000Z'));
  });

  it('degrades rather than crashing on a file dropped in by hand', () => {
    const meta = toDatasetMeta({ id: 'abc', name: 'energy-something.json' });
    expect(meta.fileName).toBe('energy-something');
    // Unknown scalars read as zero, which the list renders as "no range yet"
    // rather than as 1970.
    expect(meta.recordCount).toBe(0);
    expect(meta.startDate).toBe(0);
    expect(meta.uploadedAt).toBe(0);
    expect(meta.resolution).toBe('RAW');
  });

  it('ignores malformed property values', () => {
    const meta = toDatasetMeta({
      id: 'abc', name: 'x.json',
      appProperties: { emStart: 'yesterday', emCount: '', emFlow: 'NaN', emResolution: '' },
      modifiedTime: 'not-a-date',
    });
    expect(meta.startDate).toBe(0);
    expect(meta.recordCount).toBe(0);
    expect(meta.flowDirection).toBeUndefined();
    expect(meta.resolution).toBe('RAW');
    expect(meta.uploadedAt).toBe(0);
  });
});

// Drive rejects the whole write with a 403 when any key+value pair exceeds this.
const PROPERTY_LIMIT = 124;
const utf8 = (value: string) => new TextEncoder().encode(value).length;

describe('property size limit', () => {
  it('leaves a value that already fits untouched', () => {
    expect(fitProperty('emFileName', 'January 2026')).toBe('January 2026');
  });

  it('shortens a value so the key and value together fit', () => {
    const long = 'a'.repeat(500);
    const fitted = fitProperty('emFileName', long);
    expect(utf8('emFileName') + utf8(fitted)).toBeLessThanOrEqual(PROPERTY_LIMIT);
    // Marked, so the list never claims a dataset is called something it isn't.
    expect(fitted.endsWith('…')).toBe(true);
  });

  it('never cuts a multi-byte character in half', () => {
    // Emoji are surrogate pairs in UTF-16 and four bytes in UTF-8: a naive
    // slice on either measure would produce a lone half.
    const fitted = fitProperty('emFileName', '🔌'.repeat(80));
    expect(utf8('emFileName') + utf8(fitted)).toBeLessThanOrEqual(PROPERTY_LIMIT);
    expect(fitted).toBe(fitted.normalize());
    expect([...fitted].every((c) => c === '🔌' || c === '…')).toBe(true);
  });

  it('keeps a merged name — the case that actually blows the cap — inside it', () => {
    // What buildMergeName produces from a handful of utility exports.
    const merged = [
      'EPC_Electricity_NonInterval_2025-11-19_2025-12-18',
      'EPC_Electricity_NonInterval_2025-12-19_2026-01-18',
      'EPC_Electricity_NonInterval_2026-01-19_2026-02-18',
    ].join(' + ');
    const props = buildAppProperties(merged, data, 'RAW', undefined, true);

    for (const [key, value] of Object.entries(props)) {
      expect(utf8(key) + utf8(value)).toBeLessThanOrEqual(PROPERTY_LIMIT);
    }
    expect(props.emNameCut).toBe('1');
  });

  it('does not flag a name that fit as shortened', () => {
    expect(buildAppProperties('January 2026', data, 'RAW', undefined, true).emNameCut).toBeUndefined();
  });
});

describe('driveStore — round trip', () => {
  it('saves a dataset and reads its readings back', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW', { intervalLength: 900, peakSchedule: schedule });
    expect(meta).not.toBeNull();
    expect(meta!.fileName).toBe('January 2026');
    expect(meta!.recordCount).toBe(2);

    const loaded = await driveStore.load(meta!.key);
    expect(loaded!.data).toEqual(data);
    expect(loaded!.meta.peakSchedule).toEqual(schedule);
    expect(loaded!.meta.resolution).toBe('RAW');
  });

  it('stores the body gzipped, under a sanitized .json.gz name', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW');
    const file = files.get(meta!.key.slice('drive:'.length))!;

    expect(canCompress()).toBe(true);
    expect(file.name).toBe('january-2026.json.gz');
    expect(file.mimeType).toBe('application/gzip');
    expect(file.appProperties!.emGzip).toBe('1');
    // Gzip magic bytes — the reader sniffs these rather than trusting emGzip,
    // so a file dropped in uncompressed still loads.
    const head = new Uint8Array(await file.body.slice(0, 2).arrayBuffer());
    expect([head[0], head[1]]).toEqual([0x1f, 0x8b]);
  });

  it('reads an uncompressed file that was dropped into the folder by hand', async () => {
    const meta = await driveStore.save('handmade', data, 'RAW');
    const id = meta!.key.slice('drive:'.length);
    const file = files.get(id)!;
    // Same bytes, no gzip, no appProperties — what "download from the app, then
    // re-upload into Drive" produces.
    const plain = await new Response(file.body.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    files.set(id, { id, name: 'handmade.json', body: new Blob([plain]), modifiedTime: '2026-02-01T00:00:00.000Z', version: '1' });
    await resetDriveState();

    const loaded = await driveStore.load(meta!.key);
    expect(loaded!.data).toEqual(data);
    expect(loaded!.meta.fileName).toBe('handmade');
  });

  it('saves a dataset whose name is far past Drive’s property limit', async () => {
    const long = `Very long meter export ${'x'.repeat(300)}`;
    const meta = await driveStore.save(long, data, 'RAW');
    expect(meta).not.toBeNull();

    // The row is shortened, but opening it recovers the full name from the body.
    expect(meta!.fileName.length).toBeLessThan(long.length);
    const loaded = await driveStore.load(meta!.key);
    expect(loaded!.meta.fileName).toBe(long);
  });

  it('keeps the full name through an in-place rewrite', async () => {
    const long = `Very long meter export ${'x'.repeat(300)}`;
    const meta = await driveStore.save(long, data, 'RAW');
    await driveStore.replace(meta!.key, [...data, { timestamp: 1735691400, value: 1, cost: 1 }], 'RAW');

    const loaded = await driveStore.load(meta!.key);
    expect(loaded!.meta.fileName).toBe(long);
    expect(loaded!.data).toHaveLength(3);
  });

  it('returns null for a file that is not a native dataset', async () => {
    files.set('junk', { id: 'junk', name: 'notes.json', body: new Blob(['{"hello":1}']), modifiedTime: 't', version: '1' });
    expect(await driveStore.load('drive:junk')).toBeNull();
  });

  it('ignores keys belonging to another store', async () => {
    expect(await driveStore.load('local:3')).toBeNull();
    await driveStore.delete('local:3');
    await expect(driveStore.replace('local:3', data, 'RAW')).rejects.toThrow(/Not a Drive dataset/);
  });
});

describe('driveStore — listing', () => {
  it('lists saved datasets as library rows', async () => {
    await driveStore.save('one', data, 'RAW');
    await driveStore.save('two', data, 'DAILY');

    const listing = await driveStore.list();
    expect(listing.map((m) => m.fileName).sort()).toEqual(['one', 'two']);
    expect(listing.every((m) => m.kind === 'drive')).toBe(true);
  });

  it('bootstraps the folder once and reuses it', async () => {
    await driveStore.list();
    await driveStore.save('one', data, 'RAW');
    await driveStore.list();
    expect(ensureFolderCalls).toBe(1);
  });

  it('serves a listed dataset from cache instead of re-downloading', async () => {
    const meta = await driveStore.save('cached', data, 'RAW');
    await driveStore.load(meta!.key);
    requests.length = 0;
    await driveStore.load(meta!.key);
    // The write seeded the cache and the listing stamp validates it.
    expect(requests.filter((r) => r.startsWith('download'))).toHaveLength(0);
  });

  it('drops the cached readings when the session ends', async () => {
    const meta = await driveStore.save('cached', data, 'RAW');
    await driveStore.load(meta!.key);

    // Signing out must not leave a copy of the account's readings on disk for
    // whoever opens the browser next.
    await resetDriveState();
    requests.length = 0;
    const reloaded = await driveStore.load(meta!.key);

    expect(requests.filter((r) => r.startsWith('download'))).toHaveLength(1);
    expect(reloaded!.data).toEqual(data);
  });
});

describe('driveStore — replacing in place', () => {
  const extended = [...data, { timestamp: 1735691400, value: 500, cost: 6000, duration: 900 }];

  it('overwrites the file, keeping its id and name', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW');
    const next = await driveStore.replace(meta!.key, extended, 'RAW', { isMerged: true });

    expect(next.key).toBe(meta!.key);
    expect(next.fileName).toBe('January 2026');
    expect(next.recordCount).toBe(3);
    expect(next.isMerged).toBe(true);
    expect(files.size).toBe(1);

    const loaded = await driveStore.load(meta!.key);
    expect(loaded!.data).toEqual(extended);
  });

  it('refuses the write when the file moved on in Drive', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW');
    const staleVersion = meta!.syncVersion;

    // Another device writes first.
    await driveStore.replace(meta!.key, extended, 'RAW');

    await expect(
      driveStore.replace(meta!.key, data, 'RAW', undefined, { syncVersion: staleVersion }),
    ).rejects.toBeInstanceOf(DatasetConflictError);
    // And the other device's readings are still there.
    expect((await driveStore.load(meta!.key))!.data).toEqual(extended);
  });

  it('allows the write when the caller holds the current version', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW');
    const next = await driveStore.replace(meta!.key, extended, 'RAW', undefined, { syncVersion: meta!.syncVersion });
    expect(next.recordCount).toBe(3);
  });
});

describe('driveStore — provenance patches', () => {
  it('writes a peak schedule into the file body', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW');
    await driveStore.patchProvenance(meta!.key, { peakSchedule: schedule });

    const loaded = await driveStore.load(meta!.key);
    expect(loaded!.meta.peakSchedule).toEqual(schedule);
    // The readings survive the rewrite, and the badge property follows.
    expect(loaded!.data).toEqual(data);
    expect(files.get(meta!.key.slice('drive:'.length))!.appProperties!.emSchedule).toBe('1');
  });

  it('clears a schedule when the patch value is undefined', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW', { peakSchedule: schedule });
    await driveStore.patchProvenance(meta!.key, { peakSchedule: undefined });

    const loaded = await driveStore.load(meta!.key);
    expect(loaded!.meta.peakSchedule).toBeUndefined();
    expect(files.get(meta!.key.slice('drive:'.length))!.appProperties!.emSchedule).toBeUndefined();
  });

  it('serializes concurrent writes rather than interleaving them', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW');
    // A merge-back and a schedule patch fired in the same tick: both land, and
    // neither reads a half-written file.
    await Promise.all([
      driveStore.replace(meta!.key, [...data, { timestamp: 1735691400, value: 1, cost: 1 }], 'RAW'),
      driveStore.patchProvenance(meta!.key, { peakSchedule: schedule }),
    ]);

    const loaded = await driveStore.load(meta!.key);
    expect(loaded!.meta.peakSchedule).toEqual(schedule);
    expect(loaded!.data).toHaveLength(3);
  });
});

describe('driveStore — renaming', () => {
  it('agrees on the new name everywhere the old one was written', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW', { peakSchedule: schedule });
    const fileId = meta!.key.slice('drive:'.length);

    const next = await driveStore.rename(meta!.key, '  Home   electricity 2026  ');
    expect(next.fileName).toBe('Home electricity 2026');

    // Drive's own file name (slugified), the property the listing reads, and
    // the name inside the body — `load` trusts the body over the other two, so
    // a metadata-only rename would come back wrong the moment it was opened.
    const file = files.get(fileId)!;
    expect(file.name).toBe('home-electricity-2026.json.gz');
    expect(file.appProperties!.emFileName).toBe('Home electricity 2026');
    expect((await driveStore.load(meta!.key))!.meta.fileName).toBe('Home electricity 2026');
    expect((await driveStore.list())[0].fileName).toBe('Home electricity 2026');
  });

  it('keeps the readings and everything stored alongside them', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW', {
      flowDirection: 1, commodity: 0, intervalLength: 900, peakSchedule: schedule,
    });

    await driveStore.rename(meta!.key, 'renamed');

    const loaded = await driveStore.load(meta!.key);
    expect(loaded!.data).toEqual(data);
    expect(loaded!.meta.peakSchedule).toEqual(schedule);
    expect(loaded!.meta.flowDirection).toBe(1);
    expect(loaded!.meta.intervalLength).toBe(900);
    expect(loaded!.meta.resolution).toBe('RAW');
  });

  it('refuses a name with nothing in it', async () => {
    const meta = await driveStore.save('January 2026', data, 'RAW');
    await expect(driveStore.rename(meta!.key, '   ')).rejects.toThrow();
    expect((await driveStore.load(meta!.key))!.meta.fileName).toBe('January 2026');
  });

  it('refuses to rename anything that is not a Drive dataset', async () => {
    await expect(driveStore.rename('local:1', 'nope')).rejects.toThrow();
  });
});

describe('driveStore — deleting', () => {
  it('trashes the file so the user can still recover it', async () => {
    const meta = await driveStore.save('doomed', data, 'RAW');
    await driveStore.delete(meta!.key);
    expect(files.size).toBe(0);
    expect(await driveStore.list()).toHaveLength(0);
  });
});

// Hand the real module back, so the mock cannot outlive this file.
afterAll(() => {
  mock.module('./driveClient', () => realDriveClient);
});
