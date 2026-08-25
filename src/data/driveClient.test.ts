/// <reference types="bun-types" />
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  DriveAuthError, FOLDER_MIME, createFile, deleteFile, downloadBlob, ensureFolder,
  folderUrl, getFileMeta, listFiles, quote, trashFile, updateFile, updateFileMetadata,
} from './driveClient';

// The client is exercised against a stubbed fetch: no test touches real Drive.
// `googleAuth` is mocked at the module level so token state is a test fixture
// rather than a session.
let token: string | null = 'tok-1';
let refreshResult: string | null = 'tok-2';
let refreshCalls = 0;

mock.module('./googleAuth', () => ({
  getAccessToken: () => token,
  trySilentRefresh: async () => {
    refreshCalls++;
    token = refreshResult;
    return refreshResult;
  },
  // Bun shares one module registry across test files, so this stand-in is what
  // `driveStore` sees too — it must carry the whole surface that module imports.
  onAuthReset: () => () => {},
}));

interface Call { url: string; init: RequestInit }
let calls: Call[] = [];
let responses: Response[] = [];
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  token = 'tok-1';
  refreshResult = 'tok-2';
  refreshCalls = 0;
  calls = [];
  responses = [];
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return responses.shift() ?? json({});
  }) as typeof fetch;
});

afterEach(() => { globalThis.fetch = realFetch; });

describe('quote', () => {
  it('wraps a plain value in Drive query quotes', () => {
    expect(quote('folder-id')).toBe("'folder-id'");
  });

  it('escapes apostrophes so the literal cannot terminate early', () => {
    // Without this, `name='Mum's meter'` parses as a literal followed by junk.
    expect(quote("Mum's meter")).toBe("'Mum\\'s meter'");
  });

  it('escapes backslashes before apostrophes', () => {
    expect(quote('a\\b')).toBe("'a\\\\b'");
  });
});

describe('listFiles', () => {
  it('sends the query, requested fields, and drive space', async () => {
    responses = [json({ files: [{ id: '1', name: 'a.json' }] })];
    const out = await listFiles("'folder' in parents", 'id,name,appProperties');

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/drive/v3/files');
    expect(url.searchParams.get('q')).toBe("'folder' in parents");
    expect(url.searchParams.get('fields')).toBe('nextPageToken,files(id,name,appProperties)');
    expect(url.searchParams.get('spaces')).toBe('drive');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(out).toHaveLength(1);
  });

  it('follows nextPageToken until the listing is exhausted', async () => {
    responses = [
      json({ files: [{ id: '1', name: 'a' }], nextPageToken: 'p2' }),
      json({ files: [{ id: '2', name: 'b' }] }),
    ];
    const out = await listFiles('q');
    expect(out.map((f) => f.id)).toEqual(['1', '2']);
    expect(new URL(calls[1].url).searchParams.get('pageToken')).toBe('p2');
  });
});

describe('multipart writes', () => {
  it('frames metadata and content into one related body on create', async () => {
    responses = [json({ id: 'new', name: 'x.json.gz' })];
    await createFile(
      { name: 'x.json.gz', mimeType: 'application/gzip', parents: ['folder'], appProperties: { emCount: '2' } },
      new Blob(['BODY'], { type: 'application/gzip' }),
    );

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/upload/drive/v3/files');
    expect(url.searchParams.get('uploadType')).toBe('multipart');
    expect(calls[0].init.method).toBe('POST');

    const contentType = (calls[0].init.headers as Record<string, string>)['Content-Type'];
    const boundary = contentType.match(/boundary=(.+)$/)![1];
    const body = await (calls[0].init.body as Blob).text();
    // Two parts, correctly delimited, metadata first.
    expect(body.startsWith(`--${boundary}\r\nContent-Type: application/json`)).toBe(true);
    expect(body.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
    expect(body).toContain('"appProperties":{"emCount":"2"}');
    expect(body).toContain('Content-Type: application/gzip');
    expect(body).toContain('BODY');
  });

  it('PATCHes the same framing to an existing file id on update', async () => {
    responses = [json({ id: 'abc', name: 'x.json.gz' })];
    await updateFile('abc', { name: 'x.json.gz' }, new Blob(['B']));
    expect(new URL(calls[0].url).pathname).toBe('/upload/drive/v3/files/abc');
    expect(calls[0].init.method).toBe('PATCH');
  });
});

describe('token handling', () => {
  it('retries once after a silent refresh when Drive answers 401', async () => {
    responses = [json({ error: 'expired' }, 401), json({ files: [{ id: '1', name: 'a' }] })];
    const out = await listFiles('q');

    expect(refreshCalls).toBe(1);
    expect(out).toHaveLength(1);
    // The retry carries the refreshed token, not the stale one.
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-2');
  });

  it('throws DriveAuthError when the retried request is also 401', async () => {
    responses = [json({}, 401), json({}, 401)];
    await expect(listFiles('q')).rejects.toBeInstanceOf(DriveAuthError);
    expect(refreshCalls).toBe(1);
  });

  it('throws DriveAuthError without a request when there is no token to refresh', async () => {
    token = null;
    refreshResult = null;
    await expect(listFiles('q')).rejects.toBeInstanceOf(DriveAuthError);
    expect(calls).toHaveLength(0);
  });

  it('surfaces a non-auth failure with its status and body', async () => {
    responses = [new Response('accessNotConfigured', { status: 403 })];
    await expect(listFiles('q')).rejects.toThrow(/Drive API 403.*accessNotConfigured/);
    expect(refreshCalls).toBe(0);
  });
});

describe('ensureFolder', () => {
  it('returns an existing folder without creating one', async () => {
    responses = [json({ files: [{ id: 'existing', name: 'Energy Meter' }] })];
    expect(await ensureFolder('Energy Meter')).toBe('existing');
    expect(calls).toHaveLength(1); // the lookup only
  });

  it('searches by name, folder mime, and untrashed state', async () => {
    responses = [json({ files: [{ id: 'existing' }] })];
    await ensureFolder('Energy Meter');

    const q = new URL(calls[0].url).searchParams.get('q')!;
    expect(q).toContain("name='Energy Meter'");
    expect(q).toContain(`mimeType='${FOLDER_MIME}'`);
    expect(q).toContain('trashed=false');
    expect(q).not.toContain('in parents');
  });

  it('scopes the search to a parent when one is given', async () => {
    responses = [json({ files: [{ id: 'existing' }] })];
    await ensureFolder('Datasets', 'parent-id');
    expect(new URL(calls[0].url).searchParams.get('q')).toContain("'parent-id' in parents");
  });

  it('creates the folder when the search comes back empty', async () => {
    responses = [json({ files: [] }), json({ id: 'created' })];
    expect(await ensureFolder('Energy Meter')).toBe('created');

    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({
      name: 'Energy Meter',
      mimeType: FOLDER_MIME,
      parents: undefined,
    });
  });

  it('creates the folder under the requested parent', async () => {
    responses = [json({ files: [] }), json({ id: 'created' })];
    await ensureFolder('Datasets', 'parent-id');
    expect(JSON.parse(calls[1].init.body as string).parents).toEqual(['parent-id']);
  });

  it('escapes a folder name that would otherwise break the query', async () => {
    responses = [json({ files: [{ id: 'existing' }] })];
    await ensureFolder("Mum's meter");
    expect(new URL(calls[0].url).searchParams.get('q')).toContain("name='Mum\\'s meter'");
  });
});

describe('getFileMeta', () => {
  it('requests the conflict-check fields by default', async () => {
    responses = [json({ id: 'abc', version: '9' })];
    expect(await getFileMeta('abc')).toMatchObject({ id: 'abc', version: '9' });

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/drive/v3/files/abc');
    expect(url.searchParams.get('fields')).toBe('id,version,modifiedTime');
  });

  it('honours an explicit field list', async () => {
    responses = [json({ id: 'abc' })];
    await getFileMeta('abc', 'id,appProperties');
    expect(new URL(calls[0].url).searchParams.get('fields')).toBe('id,appProperties');
  });

  it('percent-encodes a file id with URL-significant characters', async () => {
    responses = [json({ id: 'a/b' })];
    await getFileMeta('a/b?c');
    expect(calls[0].url).toContain('/files/a%2Fb%3Fc?');
  });
});

describe('downloadBlob', () => {
  it('asks for the media stream and returns the bytes', async () => {
    responses = [new Response('GZIPPED')];
    const blob = await downloadBlob('abc');
    expect(await blob.text()).toBe('GZIPPED');
    expect(new URL(calls[0].url).searchParams.get('alt')).toBe('media');
  });

  it('carries the bearer token like every other call', async () => {
    responses = [new Response('x')];
    await downloadBlob('abc');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });
});

describe('updateFileMetadata', () => {
  it('PATCHes metadata alone, with no upload endpoint involved', async () => {
    responses = [json({ id: 'abc', name: 'renamed.json.gz' })];
    const out = await updateFileMetadata('abc', { name: 'renamed.json.gz' });

    expect(out.name).toBe('renamed.json.gz');
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/drive/v3/files/abc'); // not /upload/
    expect(calls[0].init.method).toBe('PATCH');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type'])
      .toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ name: 'renamed.json.gz' });
  });

  it('returns the full write field set by default', async () => {
    responses = [json({ id: 'abc' })];
    await updateFileMetadata('abc', { appProperties: { emCount: '5' } });
    expect(new URL(calls[0].url).searchParams.get('fields'))
      .toBe('id,name,mimeType,size,modifiedTime,version,appProperties');
  });
});

describe('removal', () => {
  it('trashes rather than erasing, so a mis-click stays recoverable', async () => {
    responses = [json({ id: 'abc' })];
    await trashFile('abc');

    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ trashed: true });
  });

  it('erases permanently on deleteFile', async () => {
    responses = [new Response(null, { status: 204 })];
    await deleteFile('abc');

    expect(calls[0].init.method).toBe('DELETE');
    expect(new URL(calls[0].url).pathname).toBe('/drive/v3/files/abc');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('encodes the file id on both removal paths', async () => {
    responses = [json({}), new Response(null, { status: 204 })];
    await trashFile('a/b');
    await deleteFile('a/b');
    expect(calls[0].url).toContain('/files/a%2Fb');
    expect(calls[1].url).toContain('/files/a%2Fb');
  });

  it('surfaces a Drive failure on trash rather than reporting success', async () => {
    responses = [new Response('notFound', { status: 404 })];
    await expect(trashFile('gone')).rejects.toThrow(/Drive API 404/);
  });
});

describe('folderUrl', () => {
  it('builds the browser link for a folder id', () => {
    expect(folderUrl('1AbC')).toBe('https://drive.google.com/drive/folders/1AbC');
  });
});
