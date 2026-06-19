import { useEffect } from 'react';

// Shared lock count so multiple simultaneously-open modals don't unlock the
// body until the last one closes.
let lockCount = 0;
let previousOverflow = '';
let previousPaddingRight = '';

/**
 * Prevents the page behind a modal from scrolling while it is open. Scrolling
 * is confined to the modal itself. Compensates for the removed scrollbar width
 * so the underlying layout doesn't shift.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const { body } = document;
    if (lockCount === 0) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      previousOverflow = body.style.overflow;
      previousPaddingRight = body.style.paddingRight;
      body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
        body.style.paddingRight = `${current + scrollbarWidth}px`;
      }
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        body.style.overflow = previousOverflow;
        body.style.paddingRight = previousPaddingRight;
      }
    };
  }, [active]);
}
