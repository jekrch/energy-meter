import { useState, useEffect, useRef } from 'react';

/**
 * Prevents loading indicator flicker by:
 * 1. Waiting `delayMs` before showing loading state (avoids flash for fast operations)
 * 2. Once shown, keeping it visible for at least `minDurationMs` (avoids blink)
 */
export function useDeferredLoading(
    isLoading: boolean,
    delayMs: number = 150,
    minDurationMs: number = 300
): boolean {
    const [showLoading, setShowLoading] = useState(false);
    const loadingStartTime = useRef<number | null>(null);
    const delayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const minDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // Clear any pending delay timeout
        if (delayTimeoutRef.current) {
            clearTimeout(delayTimeoutRef.current);
            delayTimeoutRef.current = null;
        }

        if (isLoading) {
            // Start loading - wait before showing indicator
            delayTimeoutRef.current = setTimeout(() => {
                loadingStartTime.current = Date.now();
                setShowLoading(true);
            }, delayMs);
        } else {
            // Loading finished
            if (showLoading && loadingStartTime.current !== null) {
                // Ensure minimum display time
                const elapsed = Date.now() - loadingStartTime.current;
                const remaining = minDurationMs - elapsed;

                if (remaining > 0) {
                    // Keep showing for remaining minimum time
                    minDurationTimeoutRef.current = setTimeout(() => {
                        setShowLoading(false);
                        loadingStartTime.current = null;
                    }, remaining);
                } else {
                    // Minimum time already elapsed, hide immediately
                    setShowLoading(false);
                    loadingStartTime.current = null;
                }
            } else {
                // Was never shown (fast operation), ensure it stays hidden
                setShowLoading(false);
                loadingStartTime.current = null;
            }
        }

        return () => {
            if (delayTimeoutRef.current) {
                clearTimeout(delayTimeoutRef.current);
            }
            if (minDurationTimeoutRef.current) {
                clearTimeout(minDurationTimeoutRef.current);
            }
        };
    }, [isLoading, delayMs, minDurationMs, showLoading]);

    return showLoading;
}