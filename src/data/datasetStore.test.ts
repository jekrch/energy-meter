/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import {
  MAX_DATASET_NAME, decodeKey, driveId, encodeKey, keyKind, localId,
  normalizeDatasetName, stripUndefined,
} from './datasetStore';

describe('dataset keys', () => {
  it('qualifies an id with the store it belongs to', () => {
    expect(encodeKey('local', 12)).toBe('local:12');
    expect(encodeKey('drive', '1AbC')).toBe('drive:1AbC');
  });

  it('round-trips both stores', () => {
    expect(decodeKey('local:12')).toEqual({ kind: 'local', id: '12' });
    expect(decodeKey('drive:1AbC')).toEqual({ kind: 'drive', id: '1AbC' });
  });

  it('splits on the first colon only, so an opaque Drive id survives', () => {
    expect(decodeKey('drive:a:b:c')).toEqual({ kind: 'drive', id: 'a:b:c' });
  });

  it('rejects anything that is not a key of a known store', () => {
    for (const bad of ['', '12', ':12', 'local:', 'ftp:x', null, undefined]) {
      expect(decodeKey(bad as string)).toBeNull();
      expect(keyKind(bad as string)).toBeNull();
    }
  });

  it('extracts a numeric local id and refuses everything else', () => {
    expect(localId('local:12')).toBe(12);
    expect(localId('local:abc')).toBeNull();
    // A Drive key must never be read as a local row id — that would patch or
    // delete an unrelated dataset in the browser's history.
    expect(localId('drive:12')).toBeNull();
  });

  it('extracts a Drive file id and refuses everything else', () => {
    expect(driveId('drive:1AbC')).toBe('1AbC');
    expect(driveId('local:12')).toBeNull();
  });
});

describe('stripUndefined', () => {
  it('drops undefined-valued fields so stored rows stay lean', () => {
    expect(stripUndefined({ intervalLength: 900, commodity: undefined })).toEqual({ intervalLength: 900 });
  });

  it('keeps defined falsy values, which are real ESPI codes', () => {
    expect(stripUndefined({ flowDirection: 0, isMerged: false })).toEqual({ flowDirection: 0, isMerged: false });
  });

  it('treats an absent provenance as empty', () => {
    expect(stripUndefined(undefined)).toEqual({});
  });
});

describe('normalizeDatasetName', () => {
  it('trims and collapses whitespace, so a pasted cell reads as one name', () => {
    expect(normalizeDatasetName('  Home   electricity\n2025 ')).toBe('Home electricity 2025');
  });

  it('rejects a name with nothing left in it', () => {
    expect(normalizeDatasetName('   ')).toBeNull();
    expect(normalizeDatasetName('')).toBeNull();
  });

  it('caps a name that would not survive a library row', () => {
    const long = 'x'.repeat(MAX_DATASET_NAME + 50);
    expect(normalizeDatasetName(long)).toHaveLength(MAX_DATASET_NAME);
  });

  it('leaves an ordinary name exactly as typed', () => {
    expect(normalizeDatasetName('january.csv')).toBe('january.csv');
  });
});
