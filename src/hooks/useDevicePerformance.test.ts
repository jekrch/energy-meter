/// <reference types="bun-types" />
import { describe, it, expect, afterEach } from 'bun:test';
import { renderHook } from '../test/renderHook';
import { useDevicePerformance } from './useDevicePerformance';

// Snapshot navigator getters we override so each test starts clean.
const originalUA = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
const originalHC = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');

function setNavigator(userAgent: string, hardwareConcurrency: number) {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: hardwareConcurrency, configurable: true });
}

afterEach(() => {
  if (originalUA) Object.defineProperty(navigator, 'userAgent', originalUA);
  if (originalHC) Object.defineProperty(navigator, 'hardwareConcurrency', originalHC);
});

describe('useDevicePerformance', () => {
  it('flags a desktop with many cores as high-end', () => {
    setNavigator('Mozilla/5.0 (Macintosh)', 8);
    const { result } = renderHook(() => useDevicePerformance());
    expect(result.current).toEqual({
      isMobile: false,
      isLowEnd: false,
      chunkSize: 5000,
      debounceMs: 150,
    });
  });

  it('flags a mobile user agent as low-end regardless of cores', () => {
    setNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 8);
    const { result } = renderHook(() => useDevicePerformance());
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isLowEnd).toBe(true);
    expect(result.current.chunkSize).toBe(1500);
    expect(result.current.debounceMs).toBe(350);
  });

  it('flags a desktop with few cores as low-end', () => {
    setNavigator('Mozilla/5.0 (Windows NT 10.0)', 4);
    const { result } = renderHook(() => useDevicePerformance());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isLowEnd).toBe(true);
    expect(result.current.chunkSize).toBe(1500);
  });

  it('defaults to 2 cores when hardwareConcurrency is unavailable', () => {
    setNavigator('Mozilla/5.0 (X11; Linux)', 0);
    const { result } = renderHook(() => useDevicePerformance());
    // 0 || 2 => 2, which is <= 4 => low-end
    expect(result.current.isLowEnd).toBe(true);
  });
});
