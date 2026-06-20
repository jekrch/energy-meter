/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { renderHook, advanceTime } from '../test/renderHook';
import { useDebouncedValue } from './useDebounceValue';

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    const { result } = renderHook(({ value }) => useDebouncedValue(value, 50), {
      initialProps: { value: 'a' },
    });
    expect(result.current).toBe('a');
  });

  it('does not update before the delay elapses', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 50), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    expect(result.current).toBe('a');
    await advanceTime(20);
    expect(result.current).toBe('a');
  });

  it('updates to the latest value after the delay', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 30), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    await advanceTime(60);
    expect(result.current).toBe('b');
  });

  it('only emits the final value when changes arrive within the window', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 40), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    await advanceTime(15);
    rerender({ value: 'c' });
    await advanceTime(15);
    // still inside the window relative to the latest change
    expect(result.current).toBe('a');
    await advanceTime(50);
    expect(result.current).toBe('c');
  });
});
