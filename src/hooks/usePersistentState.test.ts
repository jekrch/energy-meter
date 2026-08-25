/// <reference types="bun-types" />
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../test/renderHook';
import { usePersistentState } from './usePersistentState';

const realLocalStorage = globalThis.localStorage;

function restoreStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    value: realLocalStorage,
    configurable: true,
    writable: true,
  });
}

/** Swap in a storage stand-in whose named methods throw. */
function breakStorage(broken: { get?: boolean; set?: boolean }) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      ...realLocalStorage,
      getItem: broken.get
        ? () => { throw new Error('storage blocked'); }
        : realLocalStorage.getItem.bind(realLocalStorage),
      setItem: broken.set
        ? () => { throw new Error('quota exceeded'); }
        : realLocalStorage.setItem.bind(realLocalStorage),
    },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { restoreStorage(); localStorage.clear(); });

describe('usePersistentState', () => {
  it('starts at the fallback when nothing is stored', () => {
    const { result } = renderHook(() => usePersistentState('k-empty', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('mirrors the initial value to storage on mount', () => {
    renderHook(() => usePersistentState('k-mirror', { a: 1 }));
    expect(localStorage.getItem('k-mirror')).toBe('{"a":1}');
  });

  it('rehydrates a stored value in place of the fallback', () => {
    localStorage.setItem('k-hydrate', JSON.stringify([1, 2, 3]));
    const { result } = renderHook(() => usePersistentState<number[]>('k-hydrate', []));
    expect(result.current[0]).toEqual([1, 2, 3]);
  });

  it('writes through on every update', () => {
    const { result } = renderHook(() => usePersistentState('k-write', 0));
    act(() => { result.current[1](7); });
    expect(result.current[0]).toBe(7);
    expect(localStorage.getItem('k-write')).toBe('7');
  });

  it('accepts an updater function like useState', () => {
    const { result } = renderHook(() => usePersistentState('k-updater', 10));
    act(() => { result.current[1]((n) => n + 5); });
    expect(result.current[0]).toBe(15);
    expect(localStorage.getItem('k-updater')).toBe('15');
  });

  it('survives a remount by reading back what it wrote', () => {
    const first = renderHook(() => usePersistentState('k-remount', 'a'));
    act(() => { first.result.current[1]('b'); });
    first.unmount();

    const second = renderHook(() => usePersistentState('k-remount', 'a'));
    expect(second.result.current[0]).toBe('b');
  });

  it('distinguishes a stored falsy value from a missing key', () => {
    // JSON.parse('false') is a legitimate stored value; only a null raw read
    // should fall back.
    localStorage.setItem('k-false', 'false');
    const { result } = renderHook(() => usePersistentState('k-false', true));
    expect(result.current[0]).toBe(false);
  });

  it('falls back when the stored value is not valid JSON', () => {
    localStorage.setItem('k-corrupt', '{not json');
    const { result } = renderHook(() => usePersistentState('k-corrupt', 'safe'));
    expect(result.current[0]).toBe('safe');
  });

  it('falls back when reading storage throws', () => {
    breakStorage({ get: true });
    const { result } = renderHook(() => usePersistentState('k-blocked', 'safe'));
    expect(result.current[0]).toBe('safe');
  });

  it('keeps working when writing to storage throws', () => {
    breakStorage({ set: true });
    const { result } = renderHook(() => usePersistentState('k-quota', 1));
    act(() => { result.current[1](2); });
    expect(result.current[0]).toBe(2); // in-memory state is unaffected
  });

  it('re-reads nothing when the key changes but writes the current value there', () => {
    // The key is only consulted on first render; a changed key writes through.
    const { result, rerender } = renderHook(
      ({ k }) => usePersistentState(k, 'init'),
      { initialProps: { k: 'k-one' } },
    );
    act(() => { result.current[1]('moved'); });
    rerender({ k: 'k-two' });
    expect(localStorage.getItem('k-two')).toBe('"moved"');
  });
});
