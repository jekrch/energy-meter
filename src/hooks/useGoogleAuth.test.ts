/// <reference types="bun-types" />
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import 'fake-indexeddb/auto'; // driveStore is imported for its side effect
import { act } from 'react';
import { renderHook, advanceTime } from '../test/renderHook';
import { useGoogleAuth } from './useGoogleAuth';
import { AUTH_CHANGED_EVENT, signIn, signOut } from '../data/googleAuth';

// Driven through the real googleAuth module with the same Google Identity
// Services and Drive `about.get` stubs its own tests use — mocking googleAuth
// would leak through bun's shared module registry into those tests. What is
// asserted here is the hook's own job: turning session state into the flags the
// header renders, and staying in step when the session changes underneath it.

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

interface StubTokenConfig {
  callback: (resp: {
    access_token?: string; expires_in?: number; scope?: string; error?: string;
  }) => void;
}

let grant: { token: string; scope?: string } | null = null;
let identity: string | null = null;
const realFetch = globalThis.fetch;

beforeEach(() => {
  grant = { token: 'tok-a', scope: DRIVE_SCOPE };
  identity = 'a@example.com';

  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: StubTokenConfig) => ({
          requestAccessToken: () => {
            if (!grant) config.callback({ error: 'access_denied' });
            else config.callback({ access_token: grant.token, expires_in: 3600, scope: grant.scope });
          },
        }),
        revoke: (_token: string, done?: () => void) => { done?.(); },
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
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  // `memorySession` is module state a sessionStorage clear would not reach.
  signOut();
});

// `signOut` dispatches AUTH_CHANGED_EVENT synchronously, which a mounted hook
// turns into a state update — so hooks are torn down before the teardown
// sign-out, and every in-test session change happens inside act().
const mounted: { unmount: () => void }[] = [];

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  globalThis.fetch = realFetch;
  signOut();
});

/** Mount, and let the mount effect's redirect check resolve. */
async function mountHook() {
  const view = renderHook(() => useGoogleAuth());
  mounted.push(view);
  await advanceTime(10);
  return view;
}

describe('useGoogleAuth signed out', () => {
  it('reports no user and neither ready nor expired', async () => {
    const { result } = await mountHook();
    expect(result.current.user).toBeNull();
    expect(result.current.ready).toBe(false);
    expect(result.current.expired).toBe(false);
  });

  it('settles out of busy once the redirect check finishes', async () => {
    const { result } = await mountHook();
    expect(result.current.busy).toBe(false);
  });

  it('starts with no error and no return state', async () => {
    const { result } = await mountHook();
    expect(result.current.error).toBeNull();
    expect(result.current.returnState).toBeNull();
  });
});

describe('useGoogleAuth signing in', () => {
  it('reports the signed-in account as ready', async () => {
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });

    expect(result.current.user?.email).toBe('a@example.com');
    expect(result.current.ready).toBe(true);
    expect(result.current.expired).toBe(false);
  });

  it('clears busy after a popup sign-in returns', async () => {
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });
    expect(result.current.busy).toBe(false);
  });

  it('raises justSignedIn only once the popup sign-in lands', async () => {
    const { result } = await mountHook();
    expect(result.current.justSignedIn).toBe(false);

    await act(async () => { await result.current.signIn(); });
    expect(result.current.justSignedIn).toBe(true);
  });

  it('leaves justSignedIn down when the grant is refused', async () => {
    grant = null;
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });
    expect(result.current.justSignedIn).toBe(false);
  });

  it('leaves justSignedIn down for a session already in storage', async () => {
    await act(async () => { await signIn(); });
    const { result } = await mountHook();

    expect(result.current.ready).toBe(true);
    expect(result.current.justSignedIn).toBe(false);
  });

  it('surfaces a refused grant as an error rather than a signed-in state', async () => {
    grant = null;
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });

    expect(result.current.error).toBeTruthy();
    expect(result.current.ready).toBe(false);
    expect(result.current.busy).toBe(false);
  });

  it('lets the error be dismissed', async () => {
    grant = null;
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });
    expect(result.current.error).toBeTruthy();

    act(() => { result.current.dismissError(); });
    expect(result.current.error).toBeNull();
  });

  it('clears a previous error when sign-in is retried', async () => {
    grant = null;
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });
    expect(result.current.error).toBeTruthy();

    grant = { token: 'tok-a', scope: DRIVE_SCOPE };
    await act(async () => { await result.current.signIn(); });
    expect(result.current.error).toBeNull();
    expect(result.current.ready).toBe(true);
  });
});

describe('useGoogleAuth signing out', () => {
  it('drops the account and the ready flag', async () => {
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });
    expect(result.current.ready).toBe(true);

    await act(async () => { result.current.signOut(); await advanceTime(0); });
    expect(result.current.user).toBeNull();
    expect(result.current.ready).toBe(false);
    expect(result.current.expired).toBe(false);
  });

  it('lowers justSignedIn so a later sign-in raises it again', async () => {
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });
    expect(result.current.justSignedIn).toBe(true);

    await act(async () => { result.current.signOut(); await advanceTime(0); });
    expect(result.current.justSignedIn).toBe(false);

    await act(async () => { await result.current.signIn(); });
    expect(result.current.justSignedIn).toBe(true);
  });

  it('clears any standing error', async () => {
    grant = null;
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });
    expect(result.current.error).toBeTruthy();

    await act(async () => { result.current.signOut(); await advanceTime(0); });
    expect(result.current.error).toBeNull();
  });
});

describe('useGoogleAuth staying in step with the session', () => {
  it('picks up a sign-in that happened outside the hook', async () => {
    // Another part of the app (or a store's own refresh) can move the session;
    // the header must not keep showing a signed-out button.
    const { result } = await mountHook();
    expect(result.current.user).toBeNull();

    await act(async () => { await signIn(); });
    await act(async () => { await advanceTime(0); });
    expect(result.current.user?.email).toBe('a@example.com');
  });

  it('re-reads the session when the tab regains focus', async () => {
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });

    // Sign out, then let the focus listener be what re-reads the session.
    await act(async () => { signOut(); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(result.current.user).toBeNull();
  });

  it('re-reads the session on the auth-changed event', async () => {
    const { result } = await mountHook();
    await act(async () => { await result.current.signIn(); });

    await act(async () => { signOut(); });
    await act(async () => { window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)); });
    expect(result.current.ready).toBe(false);
  });

  it('stops listening after unmount', async () => {
    const { result, unmount } = await mountHook();
    await act(async () => { await result.current.signIn(); });
    const before = result.current.user;
    mounted.pop();
    unmount();

    signOut();
    await act(async () => { window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)); });
    expect(result.current.user).toBe(before);
  });
});
