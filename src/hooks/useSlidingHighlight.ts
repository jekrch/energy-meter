import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Tracks the box of the selected item in a tab / segment strip, so one
 * highlight can slide over to a new selection instead of blinking off the old
 * item and on the new one.
 *
 * The box is measured off the live elements rather than computed from a
 * fraction of the strip, so labels of different widths — and strips that wrap
 * onto a second row — both land correctly.
 *
 * Attach `containerRef` to the strip (which must be positioned, i.e.
 * `relative`), `setItemRef(id)` to each item, and drive the highlight's
 * width/height and `translate()` from `rect`. `rect` is null until the first
 * measurement, which happens before paint, so there is nothing to draw yet.
 */
export function useSlidingHighlight<K extends string>(
  activeId: K,
  /**
   * Anything that moves the items without changing `activeId` — an item being
   * added or removed, say. Items arriving and resizes are already handled.
   */
  deps: readonly unknown[] = [],
) {
  const itemRefs = useRef<Partial<Record<K, HTMLElement | null>>>({});
  const [rect, setRect] = useState<HighlightRect | null>(null);
  // The strip itself is state, not a ref: a strip that mounts later than the
  // hook — a modal tab bar, a toolbar waiting on data — then measures as it
  // arrives, rather than sitting unmeasured until the next selection. The
  // callback is stable, so it only runs when the element really comes or goes.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((el: HTMLDivElement | null) => setContainer(el), []);

  useLayoutEffect(() => {
    const measure = () => {
      const el = itemRefs.current[activeId];
      if (!el) return;
      // No box to measure — the strip is inside a `display: none` pane, say.
      // Keep the last good rect so it doesn't collapse to 0 and then tween
      // back out from the corner when the pane is shown again.
      if (!el.offsetWidth && !el.offsetHeight) return;
      const next = {
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
      // Same box as last time: a resize that changed nothing here must not
      // become a state update, or the observer feeds itself.
      setRect((prev) => (prev
        && prev.left === next.left && prev.top === next.top
        && prev.width === next.width && prev.height === next.height
        ? prev
        : next));
    };
    measure();

    if (!container || typeof ResizeObserver === 'undefined') return;
    // Items reflow when the panel is resized, a webfont lands, or a wrapping
    // strip changes rows — remeasure rather than drift.
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, container, ...deps]);

  // Only records the element. Anything that sets state here would re-render,
  // which hands every item a fresh ref callback, which re-attaches it — a loop.
  const setItemRef = useCallback(
    (id: K) => (el: HTMLElement | null) => {
      itemRefs.current[id] = el;
    },
    [],
  );

  return { containerRef, setItemRef, rect };
}

/**
 * The highlight's own styling, minus its colours: an absolutely placed box
 * that tweens to wherever the measurement puts it. Pair with `highlightStyle`.
 */
export const SLIDING_HIGHLIGHT_CLASS =
  'absolute top-0 left-0 transition-[transform,width,background-color,border-color] duration-200 ease-out motion-reduce:transition-none';

export const highlightStyle = (rect: HighlightRect): CSSProperties => ({
  width: rect.width,
  height: rect.height,
  transform: `translate(${rect.left}px, ${rect.top}px)`,
});

/**
 * The underline variant, for tab bars that sit on a rule rather than carrying a
 * filled pill: a hairline that spans the active tab and slides along the bottom
 * of the strip. Pair with `indicatorStyle` and give it a colour.
 */
export const SLIDING_HIGHLIGHT_INDICATOR_CLASS =
  'absolute bottom-0 left-0 h-[2px] rounded-full transition-[transform,width,background-color] duration-200 ease-out motion-reduce:transition-none';

export const indicatorStyle = (rect: HighlightRect): CSSProperties => ({
  width: rect.width,
  transform: `translateX(${rect.left}px)`,
});
