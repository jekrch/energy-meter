import { useState, useEffect, useRef, useMemo } from 'react';
import { type DataPoint, type AnalysisFilters, DAYS_OF_WEEK, MONTHS, HOURS } from '../types';
import { formatShortDate } from '../utils/formatters';
import { useDebouncedValue } from './useDebounceValue';

export function useAnalysis(
    activeTab: string,
    selectionData: DataPoint[],
    groupBy: 'dayOfWeek' | 'month' | 'hour'
) {
    // 1. Filter State
    const [filters, setFilters] = useState<AnalysisFilters>({
        daysOfWeek: [],
        months: [],
        hourStart: 0,
        hourEnd: 23,
    });

    // 2. Results State
    const [results, setResults] = useState<{
        filtered: DataPoint[];
        averages: Array<{ key: number; label: string; average: number; count: number }>;
        timeline: Array<{ timestamp: number; value: number; fullDate: string; count: number }>;
    }>({ filtered: [], averages: [], timeline: [] });

    const [isProcessing, setIsProcessing] = useState(false);
    const processRef = useRef(0);

    // Debounce slider inputs to prevent excessive recalculation
    const debouncedHourStart = useDebouncedValue(filters.hourStart, 150);
    const debouncedHourEnd = useDebouncedValue(filters.hourEnd, 150);

    // Memoize filter sets for faster lookups
    const filterSets = useMemo(() => ({
        daysOfWeek: new Set(filters.daysOfWeek),
        months: new Set(filters.months),
    }), [filters.daysOfWeek, filters.months]);

    useEffect(() => {
        // Skip processing if not on analysis tab or no data
        if (activeTab !== 'analysis' || !selectionData.length) {
            setResults({ filtered: [], averages: [], timeline: [] });
            return;
        }

        const currentProcess = ++processRef.current;
        setIsProcessing(true);

        const { daysOfWeek, months } = filterSets;
        const hasDayFilter = daysOfWeek.size > 0;
        const hasMonthFilter = months.size > 0;
        const hasHourFilter = debouncedHourStart > 0 || debouncedHourEnd < 23;

        const CHUNK = 5000;
        let i = 0;
        const filtered: DataPoint[] = [];

        // --- Step 1: Filter Data (Async Chunked) ---
        const processFilterChunk = () => {
            if (currentProcess !== processRef.current) return;

            const end = Math.min(i + CHUNK, selectionData.length);
            for (; i < end; i++) {
                const d = selectionData[i];

                // Optimization: If no filters are active, skip checks
                if (!hasDayFilter && !hasMonthFilter && !hasHourFilter) {
                    filtered.push(d);
                } else {
                    const date = new Date(d.timestamp * 1000);
                    if (hasDayFilter && !daysOfWeek.has(date.getDay())) continue;
                    if (hasMonthFilter && !months.has(date.getMonth())) continue;
                    if (hasHourFilter) {
                        const hour = date.getHours();
                        if (hour < debouncedHourStart || hour > debouncedHourEnd) continue;
                    }
                    filtered.push(d);
                }
            }

            if (i < selectionData.length) {
                requestAnimationFrame(processFilterChunk);
            } else {
                requestAnimationFrame(() => computeAggregates(filtered));
            }
        };

        // --- Step 2: Compute Aggregates (Async Chunked) ---
        const computeAggregates = (filtered: DataPoint[]) => {
            if (currentProcess !== processRef.current) return;

            const labels = groupBy === 'dayOfWeek' ? DAYS_OF_WEEK : groupBy === 'month' ? MONTHS : HOURS.map(h => `${h}:00`);
            const groupCount = groupBy === 'month' ? 12 : groupBy === 'dayOfWeek' ? 7 : 24;

            // Initialize buckets
            const avgGroups: number[][] = Array.from({ length: groupCount }, () => []);
            const timelineMap = new Map<string, { sum: number; count: number; timestamp: number; label: string }>();

            let j = 0;
            const AGGCHUNK = 3000;

            const processAggChunk = () => {
                if (currentProcess !== processRef.current) return;

                const end = Math.min(j + AGGCHUNK, filtered.length);
                for (; j < end; j++) {
                    const d = filtered[j];
                    const date = new Date(d.timestamp * 1000);

                    // Determine Group Key (0-6 for days, 0-11 for months, 0-23 for hours)
                    const avgKey = groupBy === 'dayOfWeek' ? date.getDay() : groupBy === 'month' ? date.getMonth() : date.getHours();
                    avgGroups[avgKey].push(d.value);

                    // Determine Timeline Key
                    let tlKey: string, tlLabel: string, sortTs: number;
                    if (groupBy === 'month') {
                        const year = date.getFullYear(), month = date.getMonth();
                        tlKey = `${year}-${month}`;
                        tlLabel = `${MONTHS[month]} ${year}`;
                        sortTs = new Date(year, month, 1).getTime() / 1000;
                    } else if (groupBy === 'dayOfWeek') {
                        tlKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                        tlLabel = `${DAYS_OF_WEEK[date.getDay()]} ${formatShortDate(date)}`;
                        sortTs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
                    } else {
                        tlKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
                        tlLabel = `${formatShortDate(date)} ${date.getHours()}:00`;
                        sortTs = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime() / 1000;
                    }

                    const existing = timelineMap.get(tlKey);
                    if (existing) {
                        existing.sum += d.value;
                        existing.count += 1;
                    } else {
                        timelineMap.set(tlKey, { sum: d.value, count: 1, timestamp: sortTs, label: tlLabel });
                    }
                }

                if (j < filtered.length) {
                    requestAnimationFrame(processAggChunk);
                } else {
                    // Finalize Calculations
                    const averages = avgGroups.map((vals, idx) => ({
                        key: idx,
                        label: labels[idx],
                        average: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0,
                        count: vals.length,
                    }));

                    const timeline = Array.from(timelineMap.values())
                        .sort((a, b) => a.timestamp - b.timestamp)
                        .map(g => ({ timestamp: g.timestamp, value: Math.round(g.sum / g.count), fullDate: g.label, count: g.count }));

                    if (currentProcess === processRef.current) {
                        setResults({ filtered, averages, timeline });
                        setIsProcessing(false);
                    }
                }
            };

            requestAnimationFrame(processAggChunk);
        };

        requestAnimationFrame(processFilterChunk);

        return () => { processRef.current++; };
    }, [activeTab, selectionData, filterSets, debouncedHourStart, debouncedHourEnd, groupBy]);

    return { filters, setFilters, results, isProcessing };
}