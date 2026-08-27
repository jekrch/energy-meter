import { getAccessToken, trySilentRefresh } from './googleAuth';

/**
 * Minimal typed wrapper over the Google Drive v3 REST API. Pure fetch — no gapi
 * SDK. Every call carries the current OAuth token; a 401 triggers one
 * silent-refresh attempt before surfacing DriveAuthError, which the UI turns
 * into a "sign in again" state.
 */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;          // bytes, as a string; absent for folders
  modifiedTime?: string;  // RFC 3339 — cache validation
  version?: string;       // monotonic per file — conflict detection
  appProperties?: Record<string, string>;
}

/** Per-file metadata Drive accepts on create/update. */
export interface DriveFileMetadata {
  name?: string;
  mimeType?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

async function authFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = getAccessToken();
  if (!token) {
    // An expired token is recoverable without a click; a missing one is not.
    if (retry && (await trySilentRefresh())) return authFetch(url, init, false);
    throw new DriveAuthError('Not signed in to Google Drive');
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) {
    if (retry && (await trySilentRefresh())) return authFetch(url, init, false);
    throw new DriveAuthError('Google session expired');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Drive API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

/**
 * Quote a value as a Drive query string literal. Drive's `q` grammar escapes
 * with backslashes, so an unescaped apostrophe — ordinary in a dataset name
 * like `Mum's meter` — would terminate the literal early and let the rest of
 * the value be parsed as query syntax.
 */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export async function listFiles(q: string, fields = 'id,name,mimeType'): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      pageSize: '1000',
      fields: `nextPageToken,files(${fields})`,
      spaces: 'drive',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await authFetch(`${API}/files?${params}`);
    const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function createFolder(name: string, parentId?: string): Promise<string> {
  const res = await authFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : undefined,
    }),
  });
  return ((await res.json()) as { id: string }).id;
}

/**
 * Find a folder by name (optionally under a parent) without creating it. The
 * teardown path needs this: `ensureFolder` would conjure a folder for an
 * account that never saved anything, only to trash it a moment later.
 */
export async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const parentClause = parentId ? ` and ${quote(parentId)} in parents` : '';
  const found = await listFiles(
    `name=${quote(name)} and mimeType=${quote(FOLDER_MIME)} and trashed=false${parentClause}`,
    'id,name',
  );
  return found[0]?.id ?? null;
}

/** Find a folder by name (optionally under a parent), creating it if absent. */
export async function ensureFolder(name: string, parentId?: string): Promise<string> {
  return (await findFolder(name, parentId)) ?? createFolder(name, parentId);
}

/** Current server-side metadata for one file — the conflict check reads this. */
export async function getFileMeta(fileId: string, fields = 'id,version,modifiedTime'): Promise<DriveFile> {
  const res = await authFetch(`${API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`);
  return res.json() as Promise<DriveFile>;
}

export async function downloadBlob(fileId: string): Promise<Blob> {
  const res = await authFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
  return res.blob();
}

// One multipart/related body carrying JSON metadata and the file bytes, so a
// dataset's readings and its appProperties are always written in one request
// and can never disagree.
function multipartBody(metadata: DriveFileMetadata, content: Blob): { body: Blob; contentType: string } {
  const boundary = `energymeter${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${content.type || 'application/octet-stream'}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

const WRITE_FIELDS = 'id,name,mimeType,size,modifiedTime,version,appProperties';

export async function createFile(
  metadata: DriveFileMetadata,
  content: Blob,
  fields = WRITE_FIELDS,
): Promise<DriveFile> {
  const { body, contentType } = multipartBody(metadata, content);
  const res = await authFetch(`${UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent(fields)}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
  return res.json() as Promise<DriveFile>;
}

/** Overwrite a file's content and metadata together; returns the new metadata. */
export async function updateFile(
  fileId: string,
  metadata: DriveFileMetadata,
  content: Blob,
  fields = WRITE_FIELDS,
): Promise<DriveFile> {
  const { body, contentType } = multipartBody(metadata, content);
  const res = await authFetch(
    `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${encodeURIComponent(fields)}`,
    { method: 'PATCH', headers: { 'Content-Type': contentType }, body },
  );
  return res.json() as Promise<DriveFile>;
}

/** Patch metadata alone — no content upload, so no re-serializing a dataset. */
export async function updateFileMetadata(
  fileId: string,
  metadata: DriveFileMetadata,
  fields = WRITE_FIELDS,
): Promise<DriveFile> {
  const res = await authFetch(
    `${API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    },
  );
  return res.json() as Promise<DriveFile>;
}

/**
 * Move a file to Drive's trash. Preferred over `files.delete` for datasets:
 * "Remove from Drive" then stays recoverable from the user's own trash for 30
 * days, which matters for a merged multi-year history removed by mis-click.
 */
export async function trashFile(fileId: string): Promise<void> {
  await authFetch(`${API}/files/${encodeURIComponent(fileId)}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

/** Erase permanently. Used only where trashing would be misleading. */
export async function deleteFile(fileId: string): Promise<void> {
  await authFetch(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

export function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}
