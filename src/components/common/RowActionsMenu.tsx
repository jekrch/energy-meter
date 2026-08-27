import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';

// Asymmetric timing, matching GoogleAccountButton's menu: eases open, leaves
// briskly. The enter curve is the same decelerating one `rise-in` uses.
const MENU_ENTER_MS = 180;
const MENU_EXIT_MS = 120;
const MENU_ENTER_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const MENU_EXIT_EASE = 'cubic-bezier(0.4, 0, 1, 1)';

/** Tailwind's `sm` breakpoint — the fork between popover and bottom sheet. */
const SM = 640;
const MENU_WIDTH = 240;
const VIEWPORT_MARGIN = 8;

export interface RowAction {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Second line under the label — say what the action does to the data. */
  hint?: string;
  onSelect?: () => void;
  /**
   * Renders the item as a file picker instead of a button. The menu closes
   * once a file is chosen, not when the picker opens.
   */
  file?: { accept: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void };
  disabled?: boolean;
  /** Shown in place of the hint when disabled — why it can't be used now. */
  disabledHint?: string;
  /** Swaps a spinner in for the icon and blocks the item. */
  busy?: boolean;
  /**
   * Red styling, pushed below a divider, and a second tap before it fires.
   * `confirmLabel` is the question that replaces the label in that state.
   */
  destructive?: boolean;
  confirmLabel?: string;
}

interface RowActionsMenuProps {
  actions: RowAction[];
  /** Names the row being acted on — the sheet header on a phone. */
  title: string;
  subtitle?: string;
  /** Labels the trigger for screen readers, e.g. `Actions for 2024-usage.csv`. */
  triggerLabel: string;
  disabled?: boolean;
}

type Placement = { top: number; left: number; above: boolean } | null;

/**
 * The per-row action menu: one neutral `⋯` trigger holding every secondary
 * action as a *labelled* item.
 *
 * Icon-only row buttons put all their meaning in `title` tooltips, which never
 * fire on touch — on a phone those actions are unlabelled glyphs. Labels here
 * read the same on both, so the row keeps a single primary affordance and the
 * rest name themselves.
 *
 * Above `sm` it opens as a popover anchored to the trigger; below, as a bottom
 * sheet with thumb-sized rows, which also puts the destructive action far from
 * where the primary one was tapped.
 */
export const RowActionsMenu: React.FC<RowActionsMenuProps> = ({
  actions,
  title,
  subtitle,
  triggerLabel,
  disabled = false,
}) => {
  // `open` is the requested state; the menu stays mounted through its exit
  // transition so closing fades out instead of vanishing mid-frame. `shown`
  // drives the transition itself.
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [placement, setPlacement] = useState<Placement>(null);
  // The destructive item awaiting its second tap. Cleared whenever the menu
  // opens or finishes closing, so a pending confirm never survives to the next
  // opening.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [primary, destructive] = useMemo(() => [
    actions.filter((a) => !a.destructive),
    actions.filter((a) => a.destructive),
  ], [actions]);
  const ordered = useMemo(() => [...primary, ...destructive], [primary, destructive]);

  // Viewport width, not touch support, decides the shape: a narrow window on a
  // desktop needs the sheet just as much as a phone does.
  useEffect(() => {
    const size = window.matchMedia(`(min-width: ${SM}px)`);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { setIsDesktop(size.matches); setReduceMotion(motion.matches); };
    sync();
    size.addEventListener('change', sync);
    motion.addEventListener('change', sync);
    return () => {
      size.removeEventListener('change', sync);
      motion.removeEventListener('change', sync);
    };
  }, []);

  const close = useCallback(() => {
    setShown(false);
    setOpen(false);
  }, []);

  const openMenu = () => {
    if (disabled) return;
    setConfirmId(null);
    setMounted(true);
    setOpen(true);
  };

  // Enter: start the transition once the closed state has actually been
  // painted. Two frames, not one — React flushes effects synchronously for
  // click events, so a single rAF can still run before the browser has painted
  // the just-mounted closed state. The transition then starts from a frame that
  // was never shown and visibly jumps partway in.
  useEffect(() => {
    if (!mounted || !open) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [mounted, open]);

  // Exit: stay mounted until the closing transition has run, so dismissing
  // fades out instead of vanishing mid-frame.
  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => {
      setMounted(false);
      setConfirmId(null);
      setPlacement(null);
    }, MENU_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // Placed before the browser paints, so the menu is never seen at the origin
  // it was measured at. It flips above the trigger when the space below can't
  // hold it, and never hangs off either edge.
  useLayoutEffect(() => {
    if (!mounted || !isDesktop) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const height = menu.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < height + VIEWPORT_MARGIN && rect.top > spaceBelow;
    const top = above
      ? Math.max(VIEWPORT_MARGIN, rect.top - height - 6)
      : Math.min(rect.bottom + 6, window.innerHeight - height - VIEWPORT_MARGIN);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
    );
    setPlacement({ top, left, above });
  }, [mounted, isDesktop, confirmId, ordered.length]);

  // Move focus into the menu so keyboard and screen-reader users land on the
  // first action rather than behind the overlay.
  useEffect(() => {
    if (!mounted || !open) return;
    const id = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [mounted, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // Back out of a pending confirm first, so Escape never closes the whole
      // menu when the user only meant to call off the delete.
      if (confirmId) setConfirmId(null);
      else close();
    };
    // Capture, so the Escape that dismisses this menu doesn't also reach the
    // modal underneath and close both at once.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, close, confirmId]);

  // A popover anchored to a row inside a scrolling list drifts off its row the
  // moment that list moves, so scrolling dismisses it. The sheet isn't anchored
  // to anything and stays put.
  useEffect(() => {
    if (!open || !isDesktop) return;
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, isDesktop, close]);

  const moveFocus = (from: HTMLElement, delta: number) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(from);
    const next = index === -1 ? 0 : (index + delta + items.length) % items.length;
    items[next].focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(target, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(target, -1); }
    else if (e.key === 'Tab') { e.preventDefault(); moveFocus(target, e.shiftKey ? -1 : 1); }
  };

  const runAction = (action: RowAction) => {
    if (action.disabled || action.busy) return;
    if (action.destructive && confirmId !== action.id) {
      setConfirmId(action.id);
      return;
    }
    action.onSelect?.();
    close();
  };

  const compact = isDesktop;
  const itemPad = compact ? 'px-3 py-2' : 'px-4 py-3';
  const itemText = compact ? 'text-[13px]' : 'text-sm';

  const renderItem = (action: RowAction, index: number, withDivider: boolean) => {
    const Icon = action.icon;
    const confirming = confirmId === action.id;
    const blocked = action.disabled || action.busy;
    const hint = action.disabled ? action.disabledHint ?? action.hint : action.hint;

    const tone = action.destructive
      ? 'text-red-300 hover:bg-red-500/10 focus-visible:bg-red-500/10'
      : 'text-slate-200 hover:bg-white/5 focus-visible:bg-white/5';

    const body = (
      <>
        <Icon
          className={`w-4 h-4 shrink-0 ${action.busy ? 'animate-spin' : ''} ${
            action.destructive ? 'text-red-400' : 'text-slate-400'
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {confirming ? action.confirmLabel ?? `${action.label}?` : action.label}
          </span>
          {hint && (
            <span className={`block text-[11px] leading-snug ${
              action.destructive ? 'text-red-400/70' : 'text-slate-500'
            }`}>
              {hint}
            </span>
          )}
        </span>
      </>
    );

    const shared = `w-full flex items-start gap-2.5 text-left transition-colors ${itemPad} ${itemText} ${tone} ${
      blocked ? 'opacity-40 pointer-events-none' : ''
    } ${confirming ? 'bg-red-500/10' : ''}`;

    return (
      <React.Fragment key={action.id}>
        {withDivider && <div className="my-1 border-t border-line" />}
        {action.file && !blocked ? (
          <label
            role="menuitem"
            tabIndex={index === 0 ? 0 : -1}
            className={`${shared} cursor-pointer`}
            // A label isn't activated by Enter/Space the way a button is, so
            // the keypress is forwarded to the input it wraps.
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.currentTarget.querySelector('input')?.click();
            }}
          >
            {body}
            <input
              type="file"
              accept={action.file.accept}
              className="hidden"
              onChange={(e) => { action.file?.onChange(e); close(); }}
            />
          </label>
        ) : (
          <button
            type="button"
            role="menuitem"
            tabIndex={index === 0 ? 0 : -1}
            aria-disabled={blocked || undefined}
            onClick={() => runAction(action)}
            className={shared}
          >
            {body}
          </button>
        )}
        {confirming && (
          <div className={`flex items-center justify-end gap-1.5 pb-2 ${compact ? 'px-3' : 'px-4'}`}>
            <button
              type="button"
              onClick={() => setConfirmId(null)}
              className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={() => runAction(action)}
              className="px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 text-xs font-medium rounded-lg transition-colors"
            >
              {action.label}
            </button>
          </div>
        )}
      </React.Fragment>
    );
  };

  const duration = reduceMotion ? 0 : shown ? MENU_ENTER_MS : MENU_EXIT_MS;
  const ease = shown ? MENU_ENTER_EASE : MENU_EXIT_EASE;
  // Promote to its own compositor layer for the duration. Without it the
  // transform re-rasterizes the menu's text every frame, which is what reads as
  // choppy on a sub-200ms transition.
  const layer = { willChange: 'opacity, transform', backfaceVisibility: 'hidden' } as const;

  const popoverStyle: React.CSSProperties = {
    top: placement?.top ?? 0,
    left: placement?.left ?? 0,
    width: MENU_WIDTH,
    // Hidden, not unmounted, for the frame it is measured in: `offsetHeight`
    // needs it laid out, and `visibility` keeps it out of sight while it is.
    visibility: placement ? 'visible' : 'hidden',
    opacity: shown ? 1 : 0,
    transform: shown
      ? 'translateY(0) scale(1)'
      : `translateY(${placement?.above ? 4 : -4}px) scale(0.98)`,
    transition: `opacity ${duration}ms ${ease}, transform ${duration}ms ${ease}`,
    ...layer,
  };

  const sheetStyle: React.CSSProperties = {
    transform: shown ? 'translateY(0)' : 'translateY(100%)',
    transition: `transform ${duration}ms ${ease}`,
    ...layer,
  };

  const menuBody = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={triggerLabel}
      onKeyDown={onMenuKeyDown}
      onClick={(e) => e.stopPropagation()}
      style={compact ? popoverStyle : sheetStyle}
      className={`${
        compact
          ? `fixed z-[9999] bg-surface-2 border border-line-2 rounded-xl shadow-float overflow-hidden py-1 ${
              placement?.above ? 'origin-bottom-right' : 'origin-top-right'
            }`
          : 'fixed inset-x-0 bottom-0 z-[9999] bg-surface-2 border-t border-line-2 rounded-t-2xl shadow-float overflow-hidden pb-[env(safe-area-inset-bottom)]'
      } ${shown ? '' : 'pointer-events-none'}`}
    >
      {/* On a list of similarly-named meter files, the sheet has to say which
          row it is about to act on. The popover sits on its row, so it needn't. */}
      {!compact && (
        <div className="px-4 pt-3 pb-2.5 border-b border-line">
          <p className="text-sm font-medium text-slate-100 truncate">{title}</p>
          {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
        </div>
      )}
      <div className={compact ? '' : 'py-1.5'}>
        {ordered.map((action, i) =>
          renderItem(action, i, action.destructive === true && i === primary.length && primary.length > 0),
        )}
      </div>
      {!compact && (
        <div className="px-4 pt-1 pb-2">
          <button
            type="button"
            onClick={close}
            className="w-full py-3 text-sm font-medium text-slate-400 hover:text-slate-200 border border-line rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); openMenu(); }}
        disabled={disabled}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border transition-colors disabled:opacity-40 ${
          open
            ? 'text-slate-200 bg-white/5 border-line-2'
            : 'text-slate-400 hover:text-slate-200 border-line hover:border-line-2 hover:bg-white/5'
        }`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {mounted && createPortal(
        <>
          <div
            className={`fixed inset-0 z-[9999] ${compact ? '' : 'bg-black/40'}`}
            style={{
              opacity: shown ? 1 : 0,
              transition: `opacity ${duration}ms ${ease}`,
            }}
            onClick={(e) => { e.stopPropagation(); close(); }}
          />
          {menuBody}
        </>,
        document.body,
      )}
    </>
  );
};
