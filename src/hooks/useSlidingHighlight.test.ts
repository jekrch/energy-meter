/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderHook } from '../test/renderHook';
import { useSlidingHighlight, highlightStyle } from './useSlidingHighlight';

type Tab = 'a' | 'b';

// happy-dom lays nothing out, so the items are stubs carrying the offsets a
// real button would report. What is under test is the tracking, not layout.
const item = (left: number, top: number, width: number, height: number) =>
  ({ offsetLeft: left, offsetTop: top, offsetWidth: width, offsetHeight: height }) as unknown as HTMLElement;

// The strip element the hook watches; happy-dom gives it no layout of its own,
// which is fine — only the items are measured.
const strip = () => document.createElement('div');

// `version` stands in for the extra deps a caller passes when the strip gains
// or loses an item — it re-runs the measurement without a selection change.
const render = () =>
  renderHook<ReturnType<typeof useSlidingHighlight<Tab>>, { id: Tab; version: number }>(
    ({ id, version }) => useSlidingHighlight<Tab>(id, [version]),
    { initialProps: { id: 'a', version: 0 } },
  );

describe('useSlidingHighlight', () => {
  it('has nothing to draw until the items exist', () => {
    const { result, unmount } = render();
    expect(result.current.rect).toBeNull();
    unmount();
  });

  it('measures a strip that mounts later than the hook', () => {
    const { result, unmount } = render();
    act(() => {
      result.current.setItemRef('a')(item(2, 0, 70, 26));
      result.current.containerRef(strip());
    });
    expect(result.current.rect).toEqual({ left: 2, top: 0, width: 70, height: 26 });
    unmount();
  });

  // `setItemRef(id)` hands React a fresh callback on every render, so React
  // detaches and re-attaches each item every time. Anything the hook does there
  // that sets state re-renders, re-attaches, and loops until React gives up
  // with "Maximum update depth exceeded" — so drive a real strip and count.
  it('settles instead of looping when React re-attaches the item refs', () => {
    let renders = 0;

    function TestStrip() {
      renders++;
      const [tab, setTab] = useState<Tab>('a');
      const { containerRef, setItemRef, rect } = useSlidingHighlight<Tab>(tab);
      return createElement(
        'div',
        { ref: containerRef },
        rect ? createElement('div', { key: 'highlight' }) : null,
        createElement('button', { key: 'a', ref: setItemRef('a'), onClick: () => setTab('a') }, 'A'),
        createElement('button', { key: 'b', ref: setItemRef('b'), onClick: () => setTab('b') }, 'B'),
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(TestStrip)));
    const afterMount = renders;
    expect(afterMount).toBeLessThan(6);

    act(() => (host.querySelectorAll('button')[1] as HTMLElement).click());
    expect(renders - afterMount).toBeLessThan(4);

    act(() => root.unmount());
    host.remove();
  });

  it('follows the active item from one box to the next', () => {
    const { result, rerender, unmount } = render();
    act(() => {
      result.current.setItemRef('a')(item(0, 0, 80, 28));
      result.current.setItemRef('b')(item(86, 0, 110, 28));
      result.current.containerRef(strip());
    });

    rerender({ id: 'b', version: 0 });
    expect(result.current.rect).toEqual({ left: 86, top: 0, width: 110, height: 28 });

    rerender({ id: 'a', version: 0 });
    expect(result.current.rect).toEqual({ left: 0, top: 0, width: 80, height: 28 });
    unmount();
  });

  it('keeps the last box when the active item is gone, rather than jumping to the origin', () => {
    const { result, rerender, unmount } = render();
    act(() => {
      result.current.setItemRef('a')(item(4, 4, 60, 24));
      result.current.containerRef(strip());
    });
    expect(result.current.rect).toEqual({ left: 4, top: 4, width: 60, height: 24 });

    act(() => result.current.setItemRef('a')(null));
    rerender({ id: 'b', version: 1 });
    expect(result.current.rect).toEqual({ left: 4, top: 4, width: 60, height: 24 });
    unmount();
  });

  it('positions the highlight by transform so it can tween', () => {
    expect(highlightStyle({ left: 12, top: 34, width: 56, height: 78 })).toEqual({
      width: 56,
      height: 78,
      transform: 'translate(12px, 34px)',
    });
  });
});
