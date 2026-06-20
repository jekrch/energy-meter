import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';

/** Duration of the open/close transition — keep in sync with the `duration-150`
 *  utility classes below. */
const ANIM_MS = 150;

export interface ModalHandle {
  /**
   * Play the exit animation, then run `afterExit` (or `onClose` if omitted).
   * Use the callback form when the dismissal should also trigger an action that
   * unmounts the modal — e.g. `close(() => onSelect(idx))` — so the animation
   * finishes before the parent tears the modal down. Repeated calls are no-ops.
   */
  close: (afterExit?: () => void) => void;
}

export interface ModalProps {
  /** Called after the exit animation completes; the parent should unmount here. */
  onClose: () => void;
  /** The modal's content, rendered inside the styled surface card. */
  children: React.ReactNode;
  /** Overlay background + vertical padding. Overrides the default. */
  overlayClassName?: string;
  overlayStyle?: React.CSSProperties;
  /** Panel wrapper sizing, e.g. "max-w-lg max-h-[84vh]". */
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
  /** Extra classes appended to the surface card. */
  cardClassName?: string;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  ariaLabel?: string;
}

/**
 * Shared modal shell: portal, scroll lock, overlay click-outside, Escape
 * handling, and a consistent fade/slide/scale open-close animation.
 *
 * It is mounted conditionally by the parent (mounting plays the enter
 * animation). To dismiss with the exit animation, call `close()` via the ref
 * instead of unmounting directly; `close` delays the parent's `onClose` until
 * the animation finishes.
 */
export const Modal = forwardRef<ModalHandle, ModalProps>(function Modal(
  {
    onClose,
    children,
    overlayClassName = 'pt-[10vh] bg-black/30 backdrop-blur-[2px]',
    overlayStyle,
    panelClassName = 'max-w-lg max-h-[84vh]',
    panelStyle,
    cardClassName = '',
    closeOnOverlayClick = true,
    closeOnEscape = true,
    ariaLabel,
  },
  ref,
) {
  const [isAnimating, setIsAnimating] = useState(false);
  const closedRef = useRef(false);

  useScrollLock(true);

  // Enter animation: render hidden for one frame, then transition in.
  useEffect(() => {
    const id = requestAnimationFrame(() => setIsAnimating(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = useCallback(
    (afterExit?: () => void) => {
      if (closedRef.current) return;
      closedRef.current = true;
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      setIsAnimating(false);
      window.setTimeout(() => (afterExit ?? onClose)(), ANIM_MS);
    },
    [onClose],
  );

  useImperativeHandle(ref, () => ({ close }), [close]);

  useEffect(() => {
    if (!closeOnEscape) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeOnEscape, close]);

  return createPortal(
    <div
      className={`fixed inset-0 z-[9998] flex items-start justify-center px-4 transition-opacity duration-150 ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      } ${overlayClassName}`}
      style={overlayStyle}
      onClick={closeOnOverlayClick ? () => close() : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        className={`w-full flex flex-col transition-all duration-150 ease-out ${
          isAnimating ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95'
        } ${panelClassName}`}
        style={panelStyle}
      >
        <div
          className={`bg-surface border border-line rounded-2xl shadow-float overflow-hidden flex flex-col ${cardClassName}`}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
});
