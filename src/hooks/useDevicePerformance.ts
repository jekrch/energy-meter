import { useMemo } from 'react';

export function useDevicePerformance() {
  return useMemo(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const hardwareConcurrency = navigator.hardwareConcurrency || 2;
    const isLowEnd = isMobile || hardwareConcurrency <= 4;
    
    return {
      isMobile,
      isLowEnd,
      chunkSize: isLowEnd ? 1500 : 5000,
      debounceMs: isLowEnd ? 350 : 150,
    };
  }, []);
}