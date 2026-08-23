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
    // Set exactly while the indicator is up, so the effect can tell whether the
    // minimum-duration hold applies without depending on `showLoading` itself -
    // depending on it would re-run this effect and re-arm the delay timeout.
    const loadingStartTime = useRef<number | null>(null);
    const delayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const minDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (isLoading) {
            // Wait before showing the indicator, so fast operations never flash it
            delayTimeoutRef.current = setTimeout(() => {
                loadingStartTime.current = Date.now();
                setShowLoading(true);
            }, delayMs);

            return () => {
                if (delayTimeoutRef.current) {
                    clearTimeout(delayTimeoutRef.current);
                    delayTimeoutRef.current = null;
                }
            };
        }

        // Loading finished. If the indicator never appeared, there is nothing to hide.
        if (loadingStartTime.current === null) return;

        // Otherwise hold it for whatever is left of its minimum display time
        const remaining = Math.max(0, minDurationMs - (Date.now() - loadingStartTime.current));
        minDurationTimeoutRef.current = setTimeout(() => {
            loadingStartTime.current = null;
            setShowLoading(false);
        }, remaining);

        return () => {
            if (minDurationTimeoutRef.current) {
                clearTimeout(minDurationTimeoutRef.current);
                minDurationTimeoutRef.current = null;
            }
        };
    }, [isLoading, delayMs, minDurationMs]);

    return showLoading;
}
