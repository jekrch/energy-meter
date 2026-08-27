import { GOOGLE_CLIENT_ID } from './config';

/**
 * Browser-only Google auth. No backend, no client secret: the access token
 * lives in sessionStorage for the tab's lifetime and is used directly against
 * the Drive REST API.
 *
 * Two ways in, same implicit grant underneath. On a pointing device the GIS
 * token client's popup is the better one — it keeps the app mounted. On a phone
 * a popup *is* a second tab, and neither iOS Safari nor Chrome on Android
 * reliably returns focus to the opener when Google closes it, stranding the
 * user on a blank tab. GIS has no redirect mode for the token client (only
 * `initCodeClient` does, and that yields a code needing a secret to exchange),
 * so touch devices get the OAuth implicit flow driven by hand in the top-level
 * tab: navigate out to `/o/oauth2/v2/auth`, come back to a fragment.
 *
 * One scope. `drive.file` authorizes every call this app makes — files.list,
 * create, update, get — and Drive's own `about.get` returns the account label
 * for the header button, so the identity scopes (`openid email profile`) buy
 * nothing. The consent dialog collapses to a single checkbox, and the
 * partial-grant state stops being reachable: unticking the one box yields no
 * token at all rather than an authenticated-but-useless session.
 */

export interface AuthUser {
  name: string;
  email: string;
  picture: string | null;
}

interface AuthSession extends AuthUser {
  token: string;
  exp: number; // epoch ms
}

const STORE_KEY = 'energy-meter:gauth';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
// How long to wait on GIS's callback-only revoke before giving up on hearing
// back. The token is dropped locally regardless.
const REVOKE_TIMEOUT_MS = 8_000;
// The leg of a redirect sign-in that has to outlive the navigation.
const PENDING_KEY = 'energy-meter:gauth:redirect';
// A sign-in abandoned on Google's page is not one to honour on return much
// later, when the tab may be showing something else entirely.
const PENDING_TTL_MS = 10 * 60_000;

/** Whether a space-delimited granted-scope string includes Drive access. */
function hasDriveScope(scope: string | undefined): boolean {
  return !!scope && scope.split(' ').includes(DRIVE_SCOPE);
}

export const AUTH_CHANGED_EVENT = 'energy-meter:auth-changed';

function notifyAuthChanged(): void {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

// Everything derived from a session has to go when the session does: the Drive
// folder id, the listing stamps, and the cached file bodies all belong to one
// account. Stores register here rather than being imported and called, because
// auth sits below them in the import graph and has to stay there.
const resetListeners = new Set<() => void>();

/** Run `listener` whenever a session ends. Returns an unregister function. */
export function onAuthReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => { resetListeners.delete(listener); };
}

function notifyAuthReset(): void {
  for (const listener of resetListeners) {
    // One store failing to clean up must not leave the others uncleaned.
    try { listener(); } catch { /* ignore */ }
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
}

interface TokenClient {
  requestAccessToken: () => void;
}

interface GisOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    prompt?: string;
    hint?: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type?: string }) => void;
  }) => TokenClient;
  // Used only by `revokeAccess` — the deliberate exit. See `signOut` for why
  // the everyday one leaves the grant alone.
  revoke?: (token: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOAuth2 } };
  }
}

let gisPromise: Promise<GisOAuth2> | null = null;

function loadGis(): Promise<GisOAuth2> {
  const existing = window.google?.accounts?.oauth2;
  if (existing) return Promise.resolve(existing);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error('Google sign-in failed to initialize'));
    };
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

// Fallback when sessionStorage is blocked.
let memorySession: AuthSession | null = null;

function readSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: AuthSession | null): void {
  try {
    if (session) sessionStorage.setItem(STORE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    // sessionStorage unavailable — auth still works for this page via memory.
  }
  memorySession = session;
}

function currentSession(): AuthSession | null {
  return readSession() ?? memorySession;
}

/** Access token if present and not within a minute of expiry. */
export function getAccessToken(): string | null {
  const s = currentSession();
  if (!s || Date.now() > s.exp - 60_000) return null;
  return s.token;
}

/** Who signed in this tab, even if their token has since expired (for UI). */
export function getSessionUser(): AuthUser | null {
  const s = currentSession();
  return s ? { name: s.name, email: s.email, picture: s.picture } : null;
}

/** Signed in, but the token has aged out — the header renders a warning chip. */
export function isSessionExpired(): boolean {
  return getSessionUser() !== null && getAccessToken() === null;
}

interface GrantedToken {
  token: string;
  exp: number;
  scope: string | undefined;
}

/**
 * `prompt` is the whole of the difference between the flows: `''` is "ask
 * Google for a token and show nothing", which is what a silent refresh wants
 * and exactly what a signed-out user must not get — with one authorized account
 * it hands back a token for it instantly, so signing out and in again lands
 * back in the same account with no say in it. `hint` names an account without
 * suppressing the chooser.
 */
function requestToken(prompt: string, hint?: string): Promise<GrantedToken> {
  return loadGis().then(
    (oauth2) =>
      new Promise<GrantedToken>((resolve, reject) => {
        const client = oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: DRIVE_SCOPE,
          prompt,
          ...(hint ? { hint } : {}),
          callback: (resp) => {
            if (resp.error || !resp.access_token) {
              reject(new Error(resp.error ?? 'Sign-in was cancelled'));
              return;
            }
            resolve({
              token: resp.access_token,
              exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
              scope: resp.scope,
            });
          },
          error_callback: (err) => reject(new Error(err?.type ?? 'Sign-in failed')),
        });
        client.requestAccessToken();
      }),
  );
}

const DRIVE_DENIED_MESSAGE =
  'GB Energy Meter needs permission to manage its own files in your Google Drive. ' +
  'Please check the Google Drive box on the consent screen and try again.';

/**
 * The account label for the header button. Read from Drive's own `about.get`,
 * which `drive.file` authorizes — so no identity scope is needed just to tell
 * two signed-in Google accounts apart. Cosmetic: a failure degrades to "Me"
 * rather than failing the sign-in.
 */
async function fetchUser(token: string): Promise<AuthUser> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const body = (await res.json()) as {
        user?: { displayName?: string; emailAddress?: string; photoLink?: string };
      };
      const u = body.user ?? {};
      return {
        name: u.displayName ?? u.emailAddress ?? 'Me',
        email: u.emailAddress ?? '',
        picture: u.photoLink ?? null,
      };
    }
  } catch {
    // Profile is cosmetic; fall through.
  }
  return { name: 'Me', email: '', picture: null };
}


// ── Redirect sign-in ────────────────────────────────────────────────────────

/**
 * Whether this device should be sent out and back rather than given a popup.
 * A coarse primary pointer is the honest test for "a popup opens as a tab I
 * have to find my own way back from"; installed PWAs get the same treatment,
 * because a popup out of a standalone window lands in the browser instead.
 */
export function prefersRedirectFlow(): boolean {
  try {
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    // No matchMedia is a browser old enough that the popup is the safer guess.
    return false;
  }
}

/**
 * Where Google sends the tab back to. Must match one of the client's registered
 * redirect URIs character for character, so it is built from the deploy base
 * rather than the current path — any route in the app returns to the same URL.
 */
function redirectUri(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) || '/';
  return new URL(base, window.location.origin).href;
}

/**
 * What a redirect sign-in has to carry across the navigation: the CSRF state to
 * match the response against, and an opaque scrap of app state — the open
 * dataset — so the tab comes back to what the user was looking at instead of
 * the upload screen.
 */
interface PendingRedirect {
  state: string;
  returnState: string | null;
  at: number;
}

let returnStateProvider: (() => string | null) | null = null;

/**
 * Register what to remember across a redirect. The header button that starts
 * sign-in has no idea what is open, so the app supplies it here rather than
 * threading a value through the call.
 */
export function setReturnStateProvider(provider: (() => string | null) | null): void {
  returnStateProvider = provider;
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hand the tab to Google. Returns false if the handoff could not be recorded —
 * with no stored state the response could not be told apart from a forged one,
 * so the caller falls back to the popup rather than leaving unverifiable.
 */
function beginRedirectSignIn(): boolean {
  const state = randomState();
  let returnState: string | null = null;
  try {
    returnState = returnStateProvider?.() ?? null;
  } catch {
    // A provider that throws costs the restore, not the sign-in.
  }
  try {
    const pending: PendingRedirect = { state, returnState, at: Date.now() };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    return false;
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: DRIVE_SCOPE,
    state,
    include_granted_scopes: 'true',
  });
  // Re-authorizing a session that has lapsed already knows the account; naming
  // it skips the chooser, which is the whole of the interaction when a phone
  // has one Google account signed in. Starting from signed out is the opposite
  // case — without an explicit prompt Google waves a single authorized account
  // straight through, so ask for the chooser.
  const previous = getSessionUser();
  if (previous?.email) params.set('login_hint', previous.email);
  else params.set('prompt', 'select_account');

  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`);
  return true;
}

/** The OAuth response Google leaves in the fragment, if this load carries one. */
function readRedirectResponse(): URLSearchParams | null {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  // `state` alone is not ours to claim — some other fragment could carry it —
  // but state plus a grant or an error is unambiguously this flow's response.
  if (!params.get('state')) return null;
  return params.get('access_token') || params.get('error') ? params : null;
}

/** Whether this page load is the return leg of a redirect sign-in. */
export function hasRedirectResult(): boolean {
  return readRedirectResponse() !== null;
}

function takePending(): PendingRedirect | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingRedirect) : null;
  } catch {
    return null;
  }
}

/** Strip the grant out of the address bar before anything can share or log it. */
function clearFragment(): void {
  try {
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}`);
  } catch {
    window.location.hash = '';
  }
}

/**
 * Finish a redirect sign-in. Returns null when this load is not a return leg,
 * and otherwise the signed-in user plus whatever the app asked to remember.
 * Throws with a message meant for the user on a refusal or a failed check.
 */
export async function completeRedirectSignIn(): Promise<
  { user: AuthUser; returnState: string | null } | null
> {
  const params = readRedirectResponse();
  if (!params) return null;

  // Both of these consume: the response leaves the URL and the pending record
  // leaves storage before the first await, so a re-entrant call (React's
  // double-invoked mount effect, a stray reload) finds nothing to redeem.
  const pending = takePending();
  clearFragment();

  const error = params.get('error');
  if (error) {
    throw new Error(
      error === 'access_denied' ? 'Sign-in was cancelled' : `Sign-in failed (${error})`,
    );
  }
  if (!pending || pending.state !== params.get('state')) {
    throw new Error('Sign-in could not be verified. Please try again.');
  }
  if (Date.now() - pending.at > PENDING_TTL_MS) {
    throw new Error('Sign-in took too long. Please try again.');
  }
  if (!hasDriveScope(params.get('scope') ?? undefined)) {
    throw new Error(DRIVE_DENIED_MESSAGE);
  }

  const token = params.get('access_token') as string;
  const exp = Date.now() + (Number(params.get('expires_in')) || 3600) * 1000;
  const user = await fetchUser(token);
  writeSession({ ...user, token, exp });
  notifyAuthChanged();
  return { user, returnState: pending.returnState };
}

/**
 * Interactive sign-in (must be called from a user gesture). Resolves to null
 * when the tab is on its way to Google instead: there is no "after" to report
 * in this document, and the caller should hold its pending state until unload.
 */
export async function signIn(): Promise<AuthUser | null> {
  if (prefersRedirectFlow() && beginRedirectSignIn()) return null;

  // Signed out means the account is an open question again: `select_account`
  // so a shared machine, or a personal-vs-work switch, is one click rather than
  // impossible. Re-authorizing a session that only lapsed already knows the
  // account, and going straight through is the kinder path there.
  const previous = getSessionUser();
  let grant = previous
    ? await requestToken('', previous.email || undefined)
    : await requestToken('select_account');
  // With a single scope a partial grant should be unreachable — but granular
  // consent is Google's to change, and this turns a refusal into a message that
  // names the checkbox instead of an opaque failure on the first Drive call.
  if (!hasDriveScope(grant.scope)) {
    grant = await requestToken('consent');
    if (!hasDriveScope(grant.scope)) throw new Error(DRIVE_DENIED_MESSAGE);
  }
  const user = await fetchUser(grant.token);
  writeSession({ ...user, token: grant.token, exp: grant.exp });
  notifyAuthChanged();
  return user;
}

/** Drop the session and everything derived from it, without revoking. */
function endSession(): void {
  writeSession(null);
  notifyAuthReset();
  notifyAuthChanged();
}

/**
 * Renew the token without user interaction. Returns the new token or null, in
 * which case the caller surfaces a "sign in again" state rather than failing
 * silently.
 */
export async function trySilentRefresh(): Promise<string | null> {
  // GIS opens its popup even when nothing needs consent, which on a phone is an
  // unannounced second tab arriving mid-session with no gesture behind it. On
  // those devices the token is left to lapse into the "sign in again" chip,
  // which costs one deliberate tap an hour instead.
  if (prefersRedirectFlow()) return null;

  const prev = currentSession();
  try {
    const { token, exp, scope } = await requestToken('');
    // A silent grant that lost the Drive scope is useless — force the caller
    // back to interactive sign-in rather than caching a broken token.
    if (!hasDriveScope(scope)) return null;

    // GIS issues the token for whichever Google account is active in the
    // browser, which need not be the one this tab signed in as. Adopting it
    // under the previous account's label would leave the header naming one
    // account while every read and write landed in another's Drive — so the
    // identity is re-read and checked rather than carried over. An identity
    // that cannot be confirmed at all (`fetchUser` degrades to an empty email)
    // counts as a mismatch: ending the session costs one click, and the
    // silent-crossover it prevents is not recoverable.
    const user = await fetchUser(token);
    if (prev?.email && user.email !== prev.email) {
      endSession();
      return null;
    }

    writeSession({ ...user, token, exp });
    notifyAuthChanged();
    return token;
  } catch {
    return null;
  }
}

/**
 * Hand the token back to Google and end the session: the deliberate exit, where
 * the app disappears from the account's third-party apps list, as opposed to
 * the everyday `signOut`.
 *
 * Returns whether Google acknowledged it. False is not a failure to act on: the
 * local session goes either way, and the caller points at the account's
 * connections page rather than leaving the user signed in to what they just
 * asked to be rid of.
 */
export async function revokeAccess(): Promise<boolean> {
  // A lapsed session still has a grant worth revoking, and on a pointing device
  // the refresh is silent — so try for a token rather than reporting nothing to
  // revoke to a user who can plainly see the app listed on their account.
  const token = getAccessToken() ?? (await trySilentRefresh());
  if (!token) {
    endSession();
    return false;
  }
  try {
    return await revokeToken(token);
  } finally {
    endSession();
  }
}

/**
 * GIS's own revoke, with the bare OAuth endpoint behind it. The callback form
 * has no error channel and no documented timeout, so it races a deadline: a
 * revoke that never calls back must not strand the user in a modal spinner.
 */
async function revokeToken(token: string): Promise<boolean> {
  try {
    const oauth2 = await loadGis();
    if (oauth2.revoke) {
      return await new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => resolve(false), REVOKE_TIMEOUT_MS);
        oauth2.revoke!(token, () => {
          window.clearTimeout(timer);
          resolve(true);
        });
      });
    }
  } catch {
    // GIS blocked or unreachable — the endpoint below is the same operation.
  }
  try {
    // `no-cors`: the response is opaque and unreadable, but the request is sent
    // as a simple form POST, which is all the revoke endpoint needs. Nothing
    // here can distinguish success from failure, so this reports the weaker
    // claim — the caller shows the connections page either way.
    await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(token)}`,
    });
  } catch {
    return false;
  }
  return false;
}

/**
 * Sign out of this browser. Deliberately local: the session and everything
 * derived from it go, and the grant on the Google account stays.
 *
 * Revoking here instead would be tidier-looking and worse to live with. A
 * revoked grant means the consent screen on every single sign-in, which is the
 * screen users are trained to read carefully — showing it as routine furniture
 * for signing back into an app they use daily teaches them to click through it.
 * And it buys nothing: no token survives sign-out to be revoked. The access
 * token lives in sessionStorage for a tab, there is no refresh token (implicit
 * grant, no backend), and what remains is an entry in the account's third-party
 * apps list, which the user can remove whenever they mean to — from Google, or
 * from the header menu's teardown, which calls `revokeAccess` instead.
 */
export function signOut(): void {
  endSession();
}
