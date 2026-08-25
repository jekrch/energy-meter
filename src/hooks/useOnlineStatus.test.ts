/// <reference types="bun-types" />
import { describe, it, expect, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../test/renderHook';
import { useOnlineStatus } from './useOnlineStatus';

// happy-dom's navigator.onLine is a getter on the prototype, so the flag is
// staged by redefining it rather than by assignment.
function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    value,
    configurable: true,
    writable: true,
  });
}

function fire(type: 'online' | 'offline') {
  act(() => { window.dispatchEvent(new Event(type)); });
}

afterEach(() => { setOnLine(true); });

describe('useOnlineStatus', () => {
  it('seeds from navigator.onLine', () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it('reports online when the browser says so', () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it('flips to false on the offline event', () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());

    setOnLine(false);
    fire('offline');
    expect(result.current).toBe(false);
  });

  it('flips back to true on the online event', () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    setOnLine(true);
    fire('online');
    expect(result.current).toBe(true);
  });

  it('reads navigator rather than trusting the event name', () => {
    // A spurious `online` event while the interface is still down must not
    // report connectivity the browser is not claiming.
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    fire('online');
    expect(result.current).toBe(false);
  });

  it('stops listening after unmount', () => {
    setOnLine(true);
    const { result, unmount } = renderHook(() => useOnlineStatus());
    unmount();

    setOnLine(false);
    fire('offline');
    expect(result.current).toBe(true); // last value before unmount
  });
});
