/// <reference types="bun-types" />
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import '../test/happyDom';
import {
  completeRedirectSignIn, getAccessToken, getSessionUser, hasRedirectResult,
  isSessionExpired, onAuthReset, setReturnStateProvider, signIn, signOut, trySilentRefresh,
} from './googleAuth';

// Google Identity Services and Drive's `about.get` are both stubbed, because
// together they are the pair the account guard compares: GIS hands back a token
// for whichever account is active in the browser, and `about.get` says who that
// token actually belongs to.

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

interface Grant { token: string; scope?: string }

// The account GIS is currently willing to issue a token for, and the identity
// `about.get` reports for it. They move together except where a test pulls them
// apart on purpose.
let grant: Grant | null = null;
let identity: string | null = null;
let revoked: string[] = [];
let resets = 0;
let unregister: (() => void) | null = null;

const realFetch = globalThis.fetch;

interface StubTokenConfig {
  callback: (resp: { access_token?: string; expires_in?: number; scope?: string; error?: string }) => void;
}

beforeEach(async () => {
  grant = { token: 'tok-a', scope: DRIVE_SCOPE };
  identity = 'a@example.com';
  revoked = [];
  resets = 0;

  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: StubTokenConfig) => ({
          requestAccessToken: () => {
            if (!grant) config.callback({ error: 'access_denied' });
            else config.callback({ access_token: grant.token, expires_in: 3600, scope: grant.scope });
          },
        }),
        revoke: (token: string, done?: () => void) => { revoked.push(token); done?.(); },
      },
    },
  };

  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes('/drive/v3/about')) {
      if (!identity) return new Response('unavailable', { status: 503 });
      return new Response(
        JSON.stringify({ user: { displayName: identity, emailAddress: identity, photoLink: null } }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  unregister = onAuthReset(() => { resets++; });
  // `memorySession` is module state that a sessionStorage clear would not
  // reach, so each test starts from a real sign-out.
  signOut();
  resets = 0;
  revoked = [];
});

afterEach(() => {
  unregister?.();
  unregister = null;
  globalThis.fetch = realFetch;
  // These live on the shared happy-dom window, which outlives this file: left
  // stubbed, they would answer for every test bun runs after it.
  window.matchMedia = DEFAULT_MATCH_MEDIA;
  window.location.assign = DEFAULT_LOCATION_ASSIGN;
});

describe('signIn', () => {
  it('stores the granted token under the account it belongs to', async () => {
    const user = await signIn();
    expect(user?.email).toBe('a@example.com');
    expect(getAccessToken()).toBe('tok-a');
    expect(getSessionUser()?.email).toBe('a@example.com');
    expect(isSessionExpired()).toBe(false);
  });
});

describe('trySilentRefresh', () => {
  it('adopts a fresh token for the same account', async () => {
    await signIn();
    grant = { token: 'tok-a2', scope: DRIVE_SCOPE };

    expect(await trySilentRefresh()).toBe('tok-a2');
    expect(getAccessToken()).toBe('tok-a2');
    expect(getSessionUser()?.email).toBe('a@example.com');
    expect(resets).toBe(0);
  });

  it('ends the session when the token comes back for a different account', async () => {
    await signIn();
    // What a second Google account signed into the same browser produces: GIS
    // renews silently, but not as the account this tab signed in as.
    grant = { token: 'tok-b', scope: DRIVE_SCOPE };
    identity = 'b@example.com';

    expect(await trySilentRefresh()).toBeNull();
    // Neither the token nor the label survives: adopting one under the other's
    // name is what would send A's datasets into B's Drive.
    expect(getAccessToken()).toBeNull();
    expect(getSessionUser()).toBeNull();
    // Per-account caches are dropped with it.
    expect(resets).toBe(1);
  });

  it('ends the session when the account cannot be confirmed at all', async () => {
    await signIn();
    grant = { token: 'tok-a2', scope: DRIVE_SCOPE };
    identity = null; // about.get fails — the identity is unverifiable

    expect(await trySilentRefresh()).toBeNull();
    expect(getSessionUser()).toBeNull();
    expect(resets).toBe(1);
  });

  it('refuses a grant that came back without Drive access', async () => {
    await signIn();
    grant = { token: 'tok-a2', scope: 'openid' };

    expect(await trySilentRefresh()).toBeNull();
    // The existing session is left alone: the caller shows "sign in again"
    // rather than the session being torn down under a still-valid account.
    expect(getSessionUser()?.email).toBe('a@example.com');
    expect(resets).toBe(0);
  });

  it('leaves the session in place when the refresh itself fails', async () => {
    await signIn();
    grant = null;

    expect(await trySilentRefresh()).toBeNull();
    expect(getSessionUser()?.email).toBe('a@example.com');
    expect(resets).toBe(0);
  });
});

// The touch-device path: no popup at all. The tab is handed to Google's auth
// endpoint and comes back with the grant in the fragment, so these tests stand
// in for the navigation — one half records where the browser was sent, the
// other replays the URL it was sent back to.

const DEFAULT_MATCH_MEDIA = window.matchMedia;
const DEFAULT_LOCATION_ASSIGN = window.location.assign;

/** Make `prefersRedirectFlow()` true, as a phone would. */
function pretendTouchDevice(): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('pointer: coarse'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** Capture the sign-in navigation instead of performing it. */
function captureNavigation(): { url: string | null } {
  const seen: { url: string | null } = { url: null };
  window.location.assign = (url: string) => { seen.url = url; };
  return seen;
}

/** Put the browser where Google's redirect would leave it. */
function arriveWith(params: Record<string, string>): void {
  window.location.hash = `#${new URLSearchParams(params).toString()}`;
}

describe('redirect sign-in', () => {
  afterEach(() => {
    setReturnStateProvider(null);
    window.location.hash = '';
    sessionStorage.removeItem('energy-meter:gauth:redirect');
  });

  it('sends a touch device to Google instead of opening a popup', async () => {
    pretendTouchDevice();
    const nav = captureNavigation();

    expect(await signIn()).toBeNull();
    // No token was taken from the popup client — the answer arrives next load.
    expect(getAccessToken()).toBeNull();

    const url = new URL(nav.url as string);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('signs in from the returned fragment and hands back the stashed state', async () => {
    pretendTouchDevice();
    const nav = captureNavigation();
    setReturnStateProvider(() => 'local:12');
    await signIn();
    const state = new URL(nav.url as string).searchParams.get('state') as string;

    arriveWith({ access_token: 'tok-a', expires_in: '3600', scope: DRIVE_SCOPE, state });
    expect(hasRedirectResult()).toBe(true);

    const result = await completeRedirectSignIn();
    expect(result?.user.email).toBe('a@example.com');
    expect(result?.returnState).toBe('local:12');
    expect(getAccessToken()).toBe('tok-a');
    // The grant must not be left sitting in the address bar.
    expect(window.location.hash).toBe('');
  });

  it('refuses a response whose state does not match the one it sent', async () => {
    pretendTouchDevice();
    captureNavigation();
    await signIn();

    arriveWith({ access_token: 'forged', expires_in: '3600', scope: DRIVE_SCOPE, state: 'other' });
    await expect(completeRedirectSignIn()).rejects.toThrow(/could not be verified/);
    expect(getAccessToken()).toBeNull();
  });

  it('is redeemable once — a reload cannot replay the grant', async () => {
    pretendTouchDevice();
    const nav = captureNavigation();
    await signIn();
    const state = new URL(nav.url as string).searchParams.get('state') as string;

    arriveWith({ access_token: 'tok-a', expires_in: '3600', scope: DRIVE_SCOPE, state });
    await completeRedirectSignIn();

    arriveWith({ access_token: 'tok-a', expires_in: '3600', scope: DRIVE_SCOPE, state });
    await expect(completeRedirectSignIn()).rejects.toThrow(/could not be verified/);
  });

  it('reports a refusal on the consent screen', async () => {
    pretendTouchDevice();
    const nav = captureNavigation();
    await signIn();
    const state = new URL(nav.url as string).searchParams.get('state') as string;

    arriveWith({ error: 'access_denied', state });
    await expect(completeRedirectSignIn()).rejects.toThrow(/cancelled/);
  });

  it('names the Drive checkbox when the grant comes back without it', async () => {
    pretendTouchDevice();
    const nav = captureNavigation();
    await signIn();
    const state = new URL(nav.url as string).searchParams.get('state') as string;

    arriveWith({ access_token: 'tok-a', expires_in: '3600', scope: 'openid', state });
    await expect(completeRedirectSignIn()).rejects.toThrow(/Google Drive box/);
  });

  it('ignores a page load carrying an unrelated fragment', async () => {
    window.location.hash = '#chart';
    expect(hasRedirectResult()).toBe(false);
    expect(await completeRedirectSignIn()).toBeNull();
  });

  it('does not open a popup to refresh silently on a touch device', async () => {
    await signIn();
    pretendTouchDevice();
    grant = { token: 'tok-a2', scope: DRIVE_SCOPE };

    // The token is left to lapse rather than a second tab appearing unbidden;
    // the session itself stays, so the UI can offer "sign in again".
    expect(await trySilentRefresh()).toBeNull();
    expect(getSessionUser()?.email).toBe('a@example.com');
    expect(resets).toBe(0);
  });
});

describe('signOut', () => {
  it('drops the session, revokes the token, and tears down per-account state', async () => {
    await signIn();
    signOut();

    expect(getSessionUser()).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(revoked).toEqual(['tok-a']);
    expect(resets).toBe(1);
  });
});
