/// <reference types="bun-types" />
// Minimal renderHook utility for bun:test + happy-dom, so hooks can be exercised
// without pulling in @testing-library/react. Mirrors the small surface we use:
// result.current, rerender(props), unmount().
import './happyDom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// React 19 requires this flag for act() to flush effects synchronously.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface RenderHookResult<T, P> {
  result: { current: T };
  rerender: (props?: P) => void;
  unmount: () => void;
}

export function renderHook<T, P = undefined>(
  callback: (props: P) => T,
  options?: { initialProps?: P }
): RenderHookResult<T, P> {
  const result = { current: undefined as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  let lastProps = options?.initialProps as P;

  function TestComponent({ hookProps }: { hookProps: P }) {
    result.current = callback(hookProps);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(TestComponent, { hookProps: lastProps }));
  });

  return {
    result,
    rerender: (props?: P) => {
      if (props !== undefined) lastProps = props;
      act(() => {
        root.render(createElement(TestComponent, { hookProps: lastProps }));
      });
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// Resolve after `ms` of real time, flushing React effects via act().
export async function advanceTime(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
