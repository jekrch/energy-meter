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
    clearTooltip: () => void;
    tooltipRef: React.RefObject<HTMLDivElement | null>;
    chartContainerRef: React.RefObject<HTMLDivElement | null>;
    handleChartClick: (state: any) => void;
}

export function useTooltipControl(isTouchDevice: boolean): TooltipControl {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const chartContainerRef = useRef<HTMLDivElement | null>(null);

    const clearTooltip = useCallback(() => {
        setActiveIndex(null);
    }, []);

    // Document-level listener to dismiss tooltip when tapping outside
    useEffect(() => {
        if (!isTouchDevice || activeIndex === null) return;

        const handleDocumentClick = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node;
            
            // If click was inside the tooltip, don't dismiss
            if (tooltipRef.current?.contains(target)) {
                return;
            }
            
            // If click was inside the chart container, let the chart's onClick handle it
            if (chartContainerRef.current?.contains(target)) {
                return;
            }

            // Click was outside both tooltip and chart - dismiss
            setActiveIndex(null);
        };

        // Small delay to avoid the same tap that opened the tooltip from closing it
        const timeoutId = setTimeout(() => {
            document.addEventListener('touchstart', handleDocumentClick, { passive: true });
            document.addEventListener('click', handleDocumentClick);
        }, 50);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('touchstart', handleDocumentClick);
            document.removeEventListener('click', handleDocumentClick);
        };
    }, [isTouchDevice, activeIndex]);

    // Handler for chart onClick
    const handleChartClick = useCallback((state: any) => {
        if (!isTouchDevice) return;
        
        if (state?.activeTooltipIndex !== undefined) {
            // Toggle if same index, otherwise switch to new index
            setActiveIndex(prev => 
                prev === state.activeTooltipIndex ? null : state.activeTooltipIndex
            );
        } else {
            // Clicked on chart but not on data - dismiss
            setActiveIndex(null);
        }
    }, [isTouchDevice]);

    return {
        activeIndex,
        setActiveIndex,
        clearTooltip,
        tooltipRef,
        chartContainerRef,
        handleChartClick
    };
}