import { useCallback, useEffect, useState } from 'react';
import {
  AUTH_CHANGED_EVENT, completeRedirectSignIn, getAccessToken, getSessionUser,
  hasRedirectResult, revokeAccess, signIn, signOut, type AuthUser,
} from '../data/googleAuth';
// Imported for its side effect: the Drive store registers its own teardown with
// `onAuthReset` at import, and nothing else in this hook's tree pulls it in.
import '../data/driveStore';

// How often the expiry check re-runs. A GIS token lasts an hour, so this is
// only about noticing the moment it lapses; nothing polls the network.
const EXPIRY_POLL_MS = 60_000;

export interface GoogleAuthState {
  user: AuthUser | null;
  /** Signed in with a token that is still usable. */
  ready: boolean;
  /** Signed in, but the token has lapsed — the header shows a warning chip. */
  expired: boolean;
  busy: boolean;
  error: string | null;
  /**
   * What the app asked to be remembered across a redirect sign-in, handed back
   * once the tab returns signed in. Null on every other load.
   */
  returnState: string | null;
  /**
   * A sign-in that completed in this tab, by either flow — as opposed to a
   * session simply found in storage on load. The app opens the dataset library
   * on it, so signing in lands on the files the account was signed in for.
   * Stays true until the next sign-out, so a second sign-in raises it again.
   */
  justSignedIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
  /**
   * Hand the grant back to Google and end the session — the teardown behind the
   * header menu, as opposed to the everyday `signOut`. Resolves to whether
   * Google acknowledged it; either way the tab ends up signed out.
   */
  disconnect: () => Promise<boolean>;
  dismissError: () => void;
}

function snapshot() {
  return { user: getSessionUser(), token: getAccessToken() };
}

export function useGoogleAuth(): GoogleAuthState {
  const [{ user, token }, setState] = useState(snapshot);
  // Busy from the very first render on the return leg of a redirect sign-in:
  // this load *is* the sign-in still in progress — the token is in the URL, but
  // the account it belongs to has not been read yet, and the header must not
  // paint a signed-out button in the meantime.
  const [busy, setBusy] = useState(hasRedirectResult);
  const [error, setError] = useState<string | null>(null);
  const [returnState, setReturnState] = useState<string | null>(null);
  const [justSignedIn, setJustSignedIn] = useState(false);

  // Redeem that token. Safe under React's double-invoked mount effect: the
  // first pass consumes the fragment, so the second finds nothing to redeem.
  useEffect(() => {
    completeRedirectSignIn()
      .then((result) => {
        if (!result) return;
        setReturnState(result.returnState);
        setJustSignedIn(true);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Google sign-in failed');
      })
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    const sync = () => setState(snapshot());
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    // Expiry is a clock event, not a user one: nothing dispatches on it, and a
    // tab left open overnight must not keep claiming it can reach Drive.
    const timer = window.setInterval(sync, EXPIRY_POLL_MS);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, sync);
      window.removeEventListener('focus', sync);
      window.clearInterval(timer);
    };
  }, []);

  const doSignIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // A redirect sign-in never returns to this call: the tab is already
      // leaving for Google, so the button holds its busy state until unload
      // rather than flicking back to an idle "Sync with Drive".
      if (await signIn()) {
        setJustSignedIn(true);
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
      setBusy(false);
    }
  }, []);

  const doSignOut = useCallback(() => {
    // The stores clean themselves up: each one registers with `onAuthReset`, so
    // signing out here and a refresh that comes back as a different account
    // both drop the folder id, the listing stamps, and the cached readings
    // through the same path.
    setError(null);
    setJustSignedIn(false);
    signOut();
  }, []);

  const doDisconnect = useCallback(async () => {
    setError(null);
    setJustSignedIn(false);
    // Same teardown as a sign-out — `revokeAccess` ends the session through the
    // same path — with the grant on the Google account given back as well.
    return revokeAccess();
  }, []);

  return {
    user,
    ready: Boolean(user && token),
    expired: Boolean(user && !token),
    busy,
    error,
    returnState,
    justSignedIn,
    signIn: doSignIn,
    signOut: doSignOut,
    disconnect: doDisconnect,
    dismissError: () => setError(null),
  };
}
