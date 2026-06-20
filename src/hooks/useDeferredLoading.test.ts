/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { renderHook, advanceTime } from '../test/renderHook';
import { useDeferredLoading } from './useDeferredLoading';

describe('useDeferredLoading', () => {
  it('starts hidden', () => {
    const { result } = renderHook(
      ({ loading }) => useDeferredLoading(loading, 30, 60),
      { initialProps: { loading: false } }
    );
    expect(result.current).toBe(false);
  });

  it('never shows for an operation that finishes before the delay', async () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useDeferredLoading(loading, 40, 60),
      { initialProps: { loading: true } }
    );
    await advanceTime(15);
    rerender({ loading: false }); // done before the 40ms delay
    await advanceTime(60);
    expect(result.current).toBe(false);
  });

  it('shows the indicator once loading outlasts the delay', async () => {
    const { result } = renderHook(
      ({ loading }) => useDeferredLoading(loading, 20, 40),
      { initialProps: { loading: true } }
    );
    expect(result.current).toBe(false);
    await advanceTime(50);
    expect(result.current).toBe(true);
  });

  it('keeps the indicator up for the minimum duration after loading ends', async () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useDeferredLoading(loading, 10, 120),
      { initialProps: { loading: true } }
    );
    await advanceTime(30); // past the delay, indicator is shown
    expect(result.current).toBe(true);

    rerender({ loading: false });
    expect(result.current).toBe(true); // min duration not yet met
    await advanceTime(40);
    expect(result.current).toBe(true); // still within the minimum window

    await advanceTime(120);
    expect(result.current).toBe(false);
  });
});
