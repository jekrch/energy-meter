import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { type DataPoint, type AnalysisFilters, DAYS_OF_WEEK, MONTHS, HOURS } from '../types';
import { useDebouncedValue } from './useDebounceValue';
import { accumulateBucket, finalizeBuckets } from './analysisAggregation';

export interface AnalysisAverageResult {
    key: number;
    label: string;
    average: number;
    avgCost: number;
    count: number;
}

export interface AnalysisTimelineResult {
    timestamp: number;
    value: number;
    cost: number;
    fullDate: string;
    count: number;
    categoryKey: number;
    periodStart: number;
    periodEnd: number;
}

export interface AnalysisResults {
    filtered: DataPoint[];
    averages: AnalysisAverageResult[];
    timeline: AnalysisTimelineResult[];
}

// One accumulated timeline period (keyed by group, e.g. a single month/day/hour bucket)
export interface TimelineBucket {
    sum: number;
    costSum: number;
    count: number;
    timestamp: number;
    label: string;
    categoryKey: number;
    periodStart: number;
    periodEnd: number;
}

// Device-aware configuration
const getDeviceConfig = () => {
    if (typeof navigator === 'undefined') {
        return { chunkSize: 3000, debounceMs: 150, maxDataPoints: Infinity, isMobile: false };
    }
    
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency || 2;
    const isLowEnd = isMobile || cores <= 4;
    
    // Estimate available memory (very rough)
    const lowMemory = navigator.deviceMemory !== undefined
        ? navigator.deviceMemory < 4
        : isMobile;
    
    return {
        // Much smaller chunks on mobile to prevent long frames
        chunkSize: isLowEnd ? 800 : 3000,
        // Longer debounce on slower devices
        debounceMs: isLowEnd ? 300 : 150,
        // Limit data points for analysis on constrained devices
        maxDataPoints: lowMemory ? 50000 : (isLowEnd ? 100000 : Infinity),
        isMobile,
        isLowEnd,
    };
};

const DEVICE_CONFIG = getDeviceConfig();

// Downsample data for analysis if needed (preserves distribution)
function sampleData(data: DataPoint[], maxPoints: number): DataPoint[] {
    if (data.length <= maxPoints) return data;
    
    // Stratified sampling - take evenly spaced points
    const result: DataPoint[] = [];
    const step = data.length / maxPoints;
    
    for (let i = 0; i < maxPoints; i++) {
        const idx = Math.floor(i * step);
        result.push(data[idx]);
    }
    
    return result;
}

// Empty results constant to avoid recreating
const EMPTY_RESULTS: AnalysisResults = Object.freeze({
    filtered: [],
    averages: [],
    timeline: []
});

export function useAnalysis(
    activeTab: string,
    selectionData: DataPoint[],
    groupBy: 'dayOfWeek' | 'month' | 'hour'
) {
    const [filters, setFilters] = useState<AnalysisFilters>({
        daysOfWeek: [],
        months: [],
        hourStart: 0,
        hourEnd: 23,
    });

    const [results, setResults] = useState<AnalysisResults>(EMPTY_RESULTS);
    const [isProcessing, setIsProcessing] = useState(false);
    const processRef = useRef(0);
    
    // Track if we've shown a sampling warning
    const samplingWarningShown = useRef(false);

    // Debounce groupBy changes on mobile to prevent rapid switching crashes
    const debouncedGroupBy = useDebouncedValue(groupBy, DEVICE_CONFIG.isMobile ? 200 : 0);
    
    const debouncedHourStart = useDebouncedValue(filters.hourStart, DEVICE_CONFIG.debounceMs);
    const debouncedHourEnd = useDebouncedValue(filters.hourEnd, DEVICE_CONFIG.debounceMs);

    const filterSets = useMemo(() => ({
        daysOfWeek: new Set(filters.daysOfWeek),
        months: new Set(filters.months),
    }), [filters.daysOfWeek, filters.months]);

    const labels = useMemo(() => {
        if (debouncedGroupBy === 'dayOfWeek') return DAYS_OF_WEEK;
        if (debouncedGroupBy === 'month') return MONTHS;
        return HOURS.map(h => `${h}:00`);
    }, [debouncedGroupBy]);

    const groupCount = debouncedGroupBy === 'month' ? 12 : debouncedGroupBy === 'dayOfWeek' ? 7 : 24;

    // Sample data if too large for device
    const workingData = useMemo(() => {
        if (selectionData.length > DEVICE_CONFIG.maxDataPoints) {
            if (!samplingWarningShown.current) {
                console.warn(
                    `Dataset (${selectionData.length} points) exceeds device limit. ` +
                    `Sampling to ${DEVICE_CONFIG.maxDataPoints} points for analysis.`
                );
                samplingWarningShown.current = true;
            }
            return sampleData(selectionData, DEVICE_CONFIG.maxDataPoints);
        }
        return selectionData;
    }, [selectionData]);

    useEffect(() => {
        if (activeTab !== 'analysis') {
            return;
        }
        
        if (!workingData.length) {
            setResults(EMPTY_RESULTS);
            return;
        }

        const currentProcess = ++processRef.current;
        setIsProcessing(true);
        
        // Clear previous results immediately to reduce memory pressure
        // This helps GC reclaim memory before we allocate new structures
        setResults(EMPTY_RESULTS);

        const { daysOfWeek, months } = filterSets;
        const hasDayFilter = daysOfWeek.size > 0;
        const hasMonthFilter = months.size > 0;
        const hasHourFilter = debouncedHourStart > 0 || debouncedHourEnd < 23;
        const hasAnyFilter = hasDayFilter || hasMonthFilter || hasHourFilter;

        // Use requestIdleCallback if available for lower priority work
        const scheduleWork = (callback: () => void) => {
            if (window.requestIdleCallback) {
                window.requestIdleCallback(callback, { timeout: 100 });
            } else {
                requestAnimationFrame(callback);
            }
        };

        // Helper to finalize and commit results
        const finalizeResults = (
            filteredData: DataPoint[],
            timelineMap: Map<string, TimelineBucket>
        ) => {
            if (currentProcess !== processRef.current) return;

            try {
                const { averages, timeline } = finalizeBuckets(timelineMap, groupCount, labels);

                if (currentProcess === processRef.current) {
                    setResults({ filtered: filteredData, averages, timeline });
                    setIsProcessing(false);
                }
            } catch (err) {
                console.error('Error finalizing analysis results:', err);
                if (currentProcess === processRef.current) {
                    setResults(EMPTY_RESULTS);
                    setIsProcessing(false);
                }
            }
        };

        // Aggregation logic with error handling
        const computeAggregates = (filteredData: DataPoint[]) => {
            if (currentProcess !== processRef.current) return;

            const timelineMap = new Map<string, TimelineBucket>();

            const AGGCHUNK = DEVICE_CONFIG.chunkSize;
            let j = 0;

            const processAggChunk = () => {
                if (currentProcess !== processRef.current) return;

                try {
                    const end = Math.min(j + AGGCHUNK, filteredData.length);
                    
                    for (; j < end; j++) {
                        accumulateBucket(timelineMap, filteredData[j], debouncedGroupBy);
                    }

                    if (j < filteredData.length) {
                        scheduleWork(processAggChunk);
                    } else {
                        scheduleWork(() => finalizeResults(filteredData, timelineMap));
                    }
                } catch (err) {
                    console.error('Error in aggregation chunk:', err);
                    if (currentProcess === processRef.current) {
                        setResults(EMPTY_RESULTS);
                        setIsProcessing(false);
                    }
                }
            };

            scheduleWork(processAggChunk);
        };

        // FAST PATH: No filters - skip filtering entirely
        if (!hasAnyFilter) {
            scheduleWork(() => {
                if (currentProcess === processRef.current) {
                    computeAggregates(workingData);
                }
            });
            return () => { processRef.current++; };
        }

        // FILTERED PATH: Process in chunks
        const CHUNK = DEVICE_CONFIG.chunkSize;
        let i = 0;
        const filtered: DataPoint[] = [];

        const processFilterChunk = () => {
            if (currentProcess !== processRef.current) return;

            try {
                const end = Math.min(i + CHUNK, workingData.length);
                
                for (; i < end; i++) {
                    const d = workingData[i];
                    const ts = d.timestamp * 1000;
                    const date = new Date(ts);
                    
                    if (hasDayFilter && !daysOfWeek.has(date.getDay())) continue;
                    if (hasMonthFilter && !months.has(date.getMonth())) continue;
                    if (hasHourFilter) {
                        const hour = date.getHours();
                        if (hour < debouncedHourStart || hour > debouncedHourEnd) continue;
                    }
                    
                    filtered.push(d);
                }

                if (i < workingData.length) {
                    scheduleWork(processFilterChunk);
                } else {
                    scheduleWork(() => {
                        if (currentProcess === processRef.current) {
                            computeAggregates(filtered);
                        }
                    });
                }
            } catch (err) {
                console.error('Error in filter chunk:', err);
                if (currentProcess === processRef.current) {
                    setResults(EMPTY_RESULTS);
                    setIsProcessing(false);
                }
            }
        };

        scheduleWork(processFilterChunk);

        return () => { processRef.current++; };
    }, [
        activeTab,
        workingData,
        filterSets,
        debouncedHourStart,
        debouncedHourEnd,
        debouncedGroupBy,
        labels,
        groupCount
    ]);

    const stableSetFilters = useCallback((
        updater: React.SetStateAction<AnalysisFilters>
    ) => {
        setFilters(updater);
    }, []);

    return {
        filters,
        setFilters: stableSetFilters,
        results,
        isProcessing,
        // Expose if data was sampled so UI can show indicator
        isDataSampled: workingData.length < selectionData.length,
        originalCount: selectionData.length,
        sampledCount: workingData.length,
    };
}