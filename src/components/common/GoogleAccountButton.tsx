import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Cloud, CloudOff, ExternalLink, Loader2, LogOut, AlertTriangle } from 'lucide-react';
import type { GoogleAuthState } from '../../hooks/useGoogleAuth';
import { getFolderUrl } from '../../data/driveStore';
import { DRIVE_FOLDER_NAME } from '../../data/config';

interface GoogleAccountButtonProps {
  auth: GoogleAuthState;
}

// Asymmetric timing: the menu eases open, then leaves briskly. The enter curve
// is the same decelerating one `rise-in` uses in index.css.
const MENU_ENTER_MS = 180;
const MENU_EXIT_MS = 120;
const MENU_ENTER_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const MENU_EXIT_EASE = 'cubic-bezier(0.4, 0, 1, 1)';

/**
 * Header control for the Drive connection. Signed out it is a single "Sync with
 * Drive" button; signed in it is the account avatar with a menu naming the
 * account — with two Google accounts in play, datasets silently landing in the
 * wrong Drive is indistinguishable from an empty folder, because `drive.file`
 * also hides files this app did not create.
 */
export const GoogleAccountButton: React.FC<GoogleAccountButtonProps> = ({ auth }) => {
  const [open, setOpen] = useState(false);
  // `open` is the requested state; the menu stays mounted through its exit
  // transition so closing fades out instead of vanishing mid-frame.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two frames, not one: React flushes effects synchronously for click
      // events, so a single rAF can still run before the browser has painted
      // the just-mounted closed state. The transition then starts from a frame
      // that was never shown and visibly jumps partway in.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), MENU_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // `photoLink` is best-effort: null when about.get failed, and the image can
  // still fail to load. Either way the initial-letter circle takes over.
  useEffect(() => { setImageFailed(false); }, [auth.user?.picture]);

  const openFolder = async () => {
    setOpen(false);
    // Opened after the id resolves, so the tab never lands on a Drive 404 for a
    // folder that has not been created yet.
    try {
      window.open(await getFolderUrl(), '_blank', 'noopener,noreferrer');
    } catch {
      // Signed out mid-click, or Drive unreachable — the menu simply closes.
    }
  };

  if (!auth.user) {
    return (
      <div className="shrink-0 relative flex flex-col items-end">
        <button
          onClick={auth.signIn}
          disabled={auth.busy}
          title={`Keep your datasets in your own Google Drive, in a folder named “${DRIVE_FOLDER_NAME}”`}
          className="flex items-center gap-1.5 text-sm font-semibold bg-surface-3 hover:bg-white/5 text-slate-400 hover:text-slate-200 border border-line-2 hover:border-slate-500 px-2.5 sm:px-3 h-[38px] rounded-lg transition-colors disabled:opacity-50"
        >
          {auth.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
          <span className="hidden md:inline">Sync with Drive</span>
        </button>
        {auth.error && (
          <p className="absolute top-full mt-1 max-w-[260px] text-[11px] text-amber-300 text-right">
            {auth.error}
          </p>
        )}
      </div>
    );
  }

  const initial = (auth.user.name || auth.user.email || '?').trim().charAt(0).toUpperCase();

  return (
    <div ref={containerRef} className="shrink-0 relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={auth.expired ? 'Google session expired. Sign in again' : auth.user.email || auth.user.name}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg border px-1.5 h-[38px] transition-colors ${
          auth.expired
            ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20'
            : 'bg-surface-3 border-line-2 text-slate-300 hover:bg-white/5 hover:border-slate-500'
        }`}
      >
        {auth.user.picture && !imageFailed ? (
          <img
            src={auth.user.picture}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="w-6 h-6 rounded-full object-cover"
          />
        ) : (
          <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-semibold flex items-center justify-center">
            {initial}
          </span>
        )}
        {auth.expired && <AlertTriangle className="w-3.5 h-3.5" />}
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {mounted && (
        <div
          role="menu"
          className={`absolute right-0 top-full mt-1.5 w-60 bg-surface-2 border border-line-2 rounded-lg shadow-float overflow-hidden z-50 origin-top-right motion-reduce:transition-none ${
            shown ? '' : 'pointer-events-none'
          }`}
          style={{
            opacity: shown ? 1 : 0,
            transform: shown ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.98)',
            transition: shown
              ? `opacity ${MENU_ENTER_MS}ms ${MENU_ENTER_EASE}, transform ${MENU_ENTER_MS}ms ${MENU_ENTER_EASE}`
              : `opacity ${MENU_EXIT_MS}ms ${MENU_EXIT_EASE}, transform ${MENU_EXIT_MS}ms ${MENU_EXIT_EASE}`,
            // Promote to its own compositor layer for the duration. Without it
            // the scale re-rasterizes the menu's text every frame, which is
            // what reads as choppy on a 180ms transition.
            willChange: 'opacity, transform',
            backfaceVisibility: 'hidden',
          }}
        >
          <div className="px-3 py-2.5 border-b border-line">
            <p className="text-[12px] font-medium text-slate-200 truncate">{auth.user.name}</p>
            {auth.user.email && (
              <p className="text-[11px] text-slate-500 truncate">{auth.user.email}</p>
            )}
          </div>

          {auth.expired && (
            <button
              onClick={() => { setOpen(false); void auth.signIn(); }}
              role="menuitem"
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-amber-300 hover:bg-amber-500/10 transition-colors"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Session expired. Sign in again
            </button>
          )}

          <button
            onClick={openFolder}
            role="menuitem"
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-slate-300 hover:bg-white/5 hover:text-slate-100 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
            Open Drive folder
          </button>

          <button
            onClick={() => { setOpen(false); auth.signOut(); }}
            role="menuitem"
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-slate-300 hover:bg-white/5 hover:text-slate-100 transition-colors border-t border-line"
          >
            <LogOut className="w-3.5 h-3.5 text-slate-500" />
            Sign out
          </button>

          <p className="px-3 py-2 text-[10px] text-slate-500 border-t border-line leading-relaxed">
            <CloudOff className="w-3 h-3 inline-block mr-1 -mt-0.5" />
            Files live in your Drive only. This app has no server.
          </p>
        </div>
      )}
    </div>
  );
};
