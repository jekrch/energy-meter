import { useState, useEffect, useCallback, useRef } from 'react';

export function useTouchDevice(): boolean {
    const [isTouchDevice, setIsTouchDevice] = useState(false);
    
    useEffect(() => {
        setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    }, []);
    
    return isTouchDevice;
}

interface TooltipControl {
    activeIndex: number | null;
    setActiveIndex: (index: number | null) => void;
    containerProps: {
        onTouchEnd: (e: React.TouchEvent) => void;
    };
}

export function useTooltipControl(isTouchDevice: boolean): TooltipControl {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const justTappedDataRef = useRef(false);

    // Mark that we just tapped data (called from chart's onClick)
    const setActiveIndexWithMark = useCallback((index: number | null) => {
        if (index !== null) {
            justTappedDataRef.current = true;
        }
        setActiveIndex(prev => prev === index ? null : index);
    }, []);

    // Container touch handler - dismisses tooltip if tap wasn't on data
    const handleContainerTouchEnd = useCallback(() => {
        if (!isTouchDevice) return;
        
        // Small delay to let chart's onClick fire first
        requestAnimationFrame(() => {
            if (!justTappedDataRef.current) {
                setActiveIndex(null);
            }
            justTappedDataRef.current = false;
        });
    }, [isTouchDevice]);

    return {
        activeIndex,
        setActiveIndex: setActiveIndexWithMark,
        containerProps: {
            onTouchEnd: handleContainerTouchEnd
        }
    };
}