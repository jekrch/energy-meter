/// <reference types="bun-types" />
import { describe, it, expect, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook, advanceTime } from '../test/renderHook';
import { useTouchDevice, useTooltipControl } from './useTooltipControl';

// On a touch device a chart tooltip has no hover to dismiss it, so this hook
// owns the tap semantics: tapping data opens or toggles it, tapping the page
// outside the chart and the tooltip closes it, and tapping either of those two
// leaves it alone.

function setMaxTouchPoints(n: number) {
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: n, configurable: true, writable: true,
  });
}

function clearOnTouchStart() {
  delete (window as unknown as Record<string, unknown>).ontouchstart;
}

/** A Recharts click payload for a point, or for empty chart space. */
const onData = (index: number) => ({ activeTooltipIndex: index });
const onBlankChart = {};

/** Attach an element to the document so document-level listeners can see it. */
function mount(el: HTMLElement) {
  document.body.appendChild(el);
  return el;
}

/**
 * Dispatch a real document event from `target`. The hook arms its listeners on
 * a 50ms delay so the tap that opened the tooltip cannot immediately close it.
 */
async function tapDocument(target: Node, type: 'click' | 'touchstart' = 'click') {
  await advanceTime(80); // let the listeners arm
  await act(async () => {
    target.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

afterEach(() => {
  setMaxTouchPoints(0);
  clearOnTouchStart();
  document.body.innerHTML = '';
});

describe('useTouchDevice', () => {
  it('reports false on a pointer-only device', () => {
    setMaxTouchPoints(0);
    clearOnTouchStart();
    const { result } = renderHook(() => useTouchDevice());
    expect(result.current).toBe(false);
  });

  it('reports true when maxTouchPoints is positive', () => {
    setMaxTouchPoints(5);
    const { result } = renderHook(() => useTouchDevice());
    expect(result.current).toBe(true);
  });

  it('reports true when ontouchstart is present on window', () => {
    setMaxTouchPoints(0);
    (window as unknown as Record<string, unknown>).ontouchstart = null;
    const { result } = renderHook(() => useTouchDevice());
    expect(result.current).toBe(true);
  });

  it('commits false first, so the first paint never assumes touch', () => {
    // Detection lives in an effect; the initial render cannot see the device.
    setMaxTouchPoints(5);
    let firstSeen: boolean | undefined;
    renderHook(() => {
      const v = useTouchDevice();
      firstSeen ??= v;
      return v;
    });
    expect(firstSeen).toBe(false);
  });
});

describe('useTooltipControl on a touch device', () => {
  const render = () => renderHook(() => useTooltipControl(true));

  it('starts with no active index', () => {
    const { result } = render();
    expect(result.current.activeIndex).toBeNull();
  });

  it('opens the tooltip on a tap that lands on a data point', () => {
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });
    expect(result.current.activeIndex).toBe(3);
  });

  it('toggles the tooltip shut when the same point is tapped again', () => {
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });
    act(() => { result.current.handleChartClick(onData(3)); });
    expect(result.current.activeIndex).toBeNull();
  });

  it('moves to another point without an intervening dismiss', () => {
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(1)); });
    act(() => { result.current.handleChartClick(onData(2)); });
    expect(result.current.activeIndex).toBe(2);
  });

  it('opens on index 0, which is falsy but a real point', () => {
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(0)); });
    expect(result.current.activeIndex).toBe(0);
  });

  it('dismisses on a tap inside the chart but off any data point', () => {
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });
    act(() => { result.current.handleChartClick(onBlankChart); });
    expect(result.current.activeIndex).toBeNull();
  });

  it('tolerates a null click payload', () => {
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });
    act(() => { result.current.handleChartClick(null); });
    expect(result.current.activeIndex).toBeNull();
  });

  it('closes on clearTooltip', () => {
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });
    act(() => { result.current.clearTooltip(); });
    expect(result.current.activeIndex).toBeNull();
  });

  it('exposes setActiveIndex for a caller that drives the index itself', () => {
    const { result } = render();
    act(() => { result.current.setActiveIndex(7); });
    expect(result.current.activeIndex).toBe(7);
  });

  it('keeps stable refs for the tooltip and chart container', () => {
    const { result, rerender } = render();
    const { tooltipRef, chartContainerRef } = result.current;
    rerender();
    expect(result.current.tooltipRef).toBe(tooltipRef);
    expect(result.current.chartContainerRef).toBe(chartContainerRef);
  });
});

describe('useTooltipControl dismissing by tapping away', () => {
  const render = () => renderHook(() => useTooltipControl(true));

  it('closes when the page is tapped outside the chart and tooltip', async () => {
    const elsewhere = mount(document.createElement('div'));
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });

    await tapDocument(elsewhere);
    expect(result.current.activeIndex).toBeNull();
  });

  it('closes on a touchstart as well as a click', async () => {
    const elsewhere = mount(document.createElement('div'));
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });

    await tapDocument(elsewhere, 'touchstart');
    expect(result.current.activeIndex).toBeNull();
  });

  it('stays open when the tap lands inside the tooltip', async () => {
    const tooltip = mount(document.createElement('div'));
    const inner = tooltip.appendChild(document.createElement('span'));
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });
    result.current.tooltipRef.current = tooltip as HTMLDivElement;

    await tapDocument(inner);
    expect(result.current.activeIndex).toBe(3);
  });

  it('stays open when the tap lands inside the chart, leaving it to the chart', async () => {
    // The chart's own onClick decides between switching points and dismissing;
    // the document listener must not race it.
    const chart = mount(document.createElement('div'));
    const inner = chart.appendChild(document.createElement('span'));
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });
    result.current.chartContainerRef.current = chart as HTMLDivElement;

    await tapDocument(inner);
    expect(result.current.activeIndex).toBe(3);
  });

  it('does not arm the listener until the opening tap has passed', async () => {
    // Without the delay, the very tap that opened the tooltip would bubble to
    // the document and close it again.
    const elsewhere = mount(document.createElement('div'));
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });

    await act(async () => {
      elsewhere.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(result.current.activeIndex).toBe(3);
  });

  it('listens only while a tooltip is open', async () => {
    const elsewhere = mount(document.createElement('div'));
    const { result } = render();

    // Nothing open: a stray tap changes nothing and nothing is listening.
    await tapDocument(elsewhere);
    expect(result.current.activeIndex).toBeNull();
  });

  it('stops listening after unmount', async () => {
    const elsewhere = mount(document.createElement('div'));
    const { result, unmount } = render();
    act(() => { result.current.handleChartClick(onData(3)); });
    await advanceTime(80);
    unmount();

    await act(async () => {
      elsewhere.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(result.current.activeIndex).toBe(3); // last value before unmount
  });
});

describe('useTooltipControl on a pointer device', () => {
  const render = () => renderHook(() => useTooltipControl(false));

  it('ignores chart clicks entirely, leaving hover to drive the tooltip', () => {
    const { result } = render();
    act(() => { result.current.handleChartClick(onData(3)); });
    expect(result.current.activeIndex).toBeNull();
  });

  it('never arms the tap-away listener', async () => {
    const elsewhere = mount(document.createElement('div'));
    const { result } = render();
    act(() => { result.current.setActiveIndex(3) ; });

    await tapDocument(elsewhere);
    expect(result.current.activeIndex).toBe(3);
  });
});
