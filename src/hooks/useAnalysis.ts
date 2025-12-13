import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { type DataPoint, type AnalysisFilters, DAYS_OF_WEEK, MONTHS, HOURS } from '../types';
import { formatShortDate } from '../utils/formatters';
import { useDebouncedValue } from './useDebounceValue';

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

// Device-aware configuration
const getDeviceConfig = () => {
    if (typeof navigator === 'undefined') {
        return { chunkSize: 3000, debounceMs: 150 };
    }
    
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency || 2;
    const isLowEnd = isMobile || cores <= 4;
    
    return {
        chunkSize: isLowEnd ? 1500 : 4000,
        debounceMs: isLowEnd ? 250 : 150,
        isLowEnd,
    };
};

const DEVICE_CONFIG = getDeviceConfig();

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

    const [results, setResults] = useState<AnalysisResults>({
        filtered: [],
        averages: [],
        timeline: []
    });

    const [isProcessing, setIsProcessing] = useState(false);
    const processRef = useRef(0);

    const debouncedHourStart = useDebouncedValue(filters.hourStart, DEVICE_CONFIG.debounceMs);
    const debouncedHourEnd = useDebouncedValue(filters.hourEnd, DEVICE_CONFIG.debounceMs);

    const filterSets = useMemo(() => ({
        daysOfWeek: new Set(filters.daysOfWeek),
        months: new Set(filters.months),
    }), [filters.daysOfWeek, filters.months]);

    const labels = useMemo(() => {
        if (groupBy === 'dayOfWeek') return DAYS_OF_WEEK;
        if (groupBy === 'month') return MONTHS;
        return HOURS.map(h => `${h}:00`);
    }, [groupBy]);

    const groupCount = groupBy === 'month' ? 12 : groupBy === 'dayOfWeek' ? 7 : 24;

    useEffect(() => {
        if (activeTab !== 'analysis') {
            return;
        }
        
        if (!selectionData.length) {
            setResults({ filtered: [], averages: [], timeline: [] });
            return;
        }

        const currentProcess = ++processRef.current;
        setIsProcessing(true);

        const { daysOfWeek, months } = filterSets;
        const hasDayFilter = daysOfWeek.size > 0;
        const hasMonthFilter = months.size > 0;
        const hasHourFilter = debouncedHourStart > 0 || debouncedHourEnd < 23;
        const hasAnyFilter = hasDayFilter || hasMonthFilter || hasHourFilter;

        // Helper to finalize and commit results
        const finalizeResults = (
            filteredData: DataPoint[],
            timelineMap: Map<string, any>
        ) => {
            if (currentProcess !== processRef.current) return;

            const timeline: AnalysisTimelineResult[] = Array.from(timelineMap.values())
                .sort((a, b) => a.timestamp - b.timestamp)
                .map(g => ({
                    timestamp: g.timestamp,
                    value: g.sum,
                    cost: g.costSum,
                    fullDate: g.label,
                    count: g.count,
                    categoryKey: g.categoryKey,
                    periodStart: g.periodStart,
                    periodEnd: g.periodEnd
                }));

            const categoryTotals: { values: number[]; costs: number[] }[] =
                Array.from({ length: groupCount }, () => ({ values: [], costs: [] }));

            for (const period of timelineMap.values()) {
                const cat = categoryTotals[period.categoryKey];
                if (cat) {
                    cat.values.push(period.sum);
                    cat.costs.push(period.costSum);
                }
            }

            const averages: AnalysisAverageResult[] = categoryTotals.map((group, idx) => {
                const valueCount = group.values.length;
                const costCount = group.costs.length;
                
                return {
                    key: idx,
                    label: labels[idx],
                    average: valueCount > 0
                        ? Math.round(group.values.reduce((a, b) => a + b, 0) / valueCount)
                        : 0,
                    avgCost: costCount > 0
                        ? Math.round(group.costs.reduce((a, b) => a + b, 0) / costCount)
                        : 0,
                    count: valueCount,
                };
            });

            if (currentProcess === processRef.current) {
                setResults({ filtered: filteredData, averages, timeline });
                setIsProcessing(false);
            }
        };

        // Aggregation logic
        const computeAggregates = (filteredData: DataPoint[]) => {
            if (currentProcess !== processRef.current) return;

            const timelineMap = new Map<string, {
                sum: number;
                costSum: number;
                count: number;
                timestamp: number;
                label: string;
                categoryKey: number;
                periodStart: number;
                periodEnd: number;
            }>();

            const AGGCHUNK = DEVICE_CONFIG.chunkSize;
            let j = 0;

            const processAggChunk = () => {
                if (currentProcess !== processRef.current) return;

                const end = Math.min(j + AGGCHUNK, filteredData.length);
                
                for (; j < end; j++) {
                    const d = filteredData[j];
                    const ts = d.timestamp * 1000;
                    const date = new Date(ts);

                    let categoryKey: number;
                    if (groupBy === 'dayOfWeek') {
                        categoryKey = date.getDay();
                    } else if (groupBy === 'month') {
                        categoryKey = date.getMonth();
                    } else {
                        categoryKey = date.getHours();
                    }

                    let tlKey: string;
                    let tlLabel: string;
                    let sortTs: number;
                    let periodStart: number;
                    let periodEnd: number;

                    const year = date.getFullYear();
                    const month = date.getMonth();
                    const day = date.getDate();
                    const hour = date.getHours();

                    if (groupBy === 'month') {
                        tlKey = `${year}-${month}`;
                        tlLabel = `${MONTHS[month]} ${year}`;
                        sortTs = new Date(year, month, 1).getTime() / 1000;
                        periodStart = sortTs;
                        const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
                        periodEnd = Math.floor(monthEnd.getTime() / 1000);
                    } else if (groupBy === 'dayOfWeek') {
                        tlKey = `${year}-${month}-${day}`;
                        tlLabel = `${DAYS_OF_WEEK[date.getDay()]} ${formatShortDate(date)}`;
                        sortTs = new Date(year, month, day).getTime() / 1000;
                        periodStart = sortTs;
                        periodEnd = periodStart + 86400 - 1;
                    } else {
                        tlKey = `${year}-${month}-${day}-${hour}`;
                        tlLabel = `${formatShortDate(date)} ${hour}:00`;
                        sortTs = new Date(year, month, day, hour).getTime() / 1000;
                        periodStart = sortTs;
                        periodEnd = periodStart + 3600 - 1;
                    }

                    const existing = timelineMap.get(tlKey);
                    if (existing) {
                        existing.sum += d.value;
                        existing.costSum += d.cost ?? 0;
                        existing.count += 1;
                    } else {
                        timelineMap.set(tlKey, {
                            sum: d.value,
                            costSum: d.cost ?? 0,
                            count: 1,
                            timestamp: sortTs,
                            label: tlLabel,
                            categoryKey,
                            periodStart,
                            periodEnd
                        });
                    }
                }

                if (j < filteredData.length) {
                    requestAnimationFrame(processAggChunk);
                } else {
                    finalizeResults(filteredData, timelineMap);
                }
            };

            requestAnimationFrame(processAggChunk);
        };

        // FAST PATH: No filters - skip filtering entirely
        if (!hasAnyFilter) {
            requestAnimationFrame(() => {
                if (currentProcess === processRef.current) {
                    computeAggregates(selectionData);
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

            const end = Math.min(i + CHUNK, selectionData.length);
            
            for (; i < end; i++) {
                const d = selectionData[i];
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

            if (i < selectionData.length) {
                requestAnimationFrame(processFilterChunk);
            } else {
                requestAnimationFrame(() => {
                    if (currentProcess === processRef.current) {
                        computeAggregates(filtered);
                    }
                });
            }
        };

        requestAnimationFrame(processFilterChunk);

        return () => { processRef.current++; };
    }, [
        activeTab,
        selectionData,
        filterSets,
        debouncedHourStart,
        debouncedHourEnd,
        groupBy,
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
        isProcessing
    };
}