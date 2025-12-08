import { useState, useEffect, useRef, useMemo } from 'react';
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

    const debouncedHourStart = useDebouncedValue(filters.hourStart, 150);
    const debouncedHourEnd = useDebouncedValue(filters.hourEnd, 150);

    const filterSets = useMemo(() => ({
        daysOfWeek: new Set(filters.daysOfWeek),
        months: new Set(filters.months),
    }), [filters.daysOfWeek, filters.months]);

    useEffect(() => {
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

        const processFilterChunk = () => {
            if (currentProcess !== processRef.current) return;

            const end = Math.min(i + CHUNK, selectionData.length);
            for (; i < end; i++) {
                const d = selectionData[i];

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

        const computeAggregates = (filtered: DataPoint[]) => {
            if (currentProcess !== processRef.current) return;

            const labels = groupBy === 'dayOfWeek' 
                ? DAYS_OF_WEEK 
                : groupBy === 'month' 
                    ? MONTHS 
                    : HOURS.map(h => `${h}:00`);

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

            let j = 0;
            const AGGCHUNK = 3000;

            const processAggChunk = () => {
                if (currentProcess !== processRef.current) return;

                const end = Math.min(j + AGGCHUNK, filtered.length);
                for (; j < end; j++) {
                    const d = filtered[j];
                    const date = new Date(d.timestamp * 1000);

                    const categoryKey = groupBy === 'dayOfWeek' 
                        ? date.getDay() 
                        : groupBy === 'month' 
                            ? date.getMonth() 
                            : date.getHours();

                    let tlKey: string, tlLabel: string, sortTs: number;
                    let periodStart: number, periodEnd: number;
                    
                    if (groupBy === 'month') {
                        const year = date.getFullYear(), month = date.getMonth();
                        tlKey = `${year}-${month}`;
                        tlLabel = `${MONTHS[month]} ${year}`;
                        sortTs = new Date(year, month, 1).getTime() / 1000;
                        periodStart = sortTs;
                        const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
                        periodEnd = Math.floor(monthEnd.getTime() / 1000);
                    } else if (groupBy === 'dayOfWeek') {
                        tlKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                        tlLabel = `${DAYS_OF_WEEK[date.getDay()]} ${formatShortDate(date)}`;
                        sortTs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
                        periodStart = sortTs;
                        periodEnd = periodStart + 86400 - 1;
                    } else {
                        tlKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
                        tlLabel = `${formatShortDate(date)} ${date.getHours()}:00`;
                        sortTs = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime() / 1000;
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

                if (j < filtered.length) {
                    requestAnimationFrame(processAggChunk);
                } else {
                    // Timeline: include categoryKey and period bounds
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

                    // Averages: group period totals by category
                    const groupCount = groupBy === 'month' ? 12 : groupBy === 'dayOfWeek' ? 7 : 24;
                    const categoryTotals: { values: number[]; costs: number[] }[] = 
                        Array.from({ length: groupCount }, () => ({ values: [], costs: [] }));

                    for (const period of timelineMap.values()) {
                        categoryTotals[period.categoryKey].values.push(period.sum);
                        categoryTotals[period.categoryKey].costs.push(period.costSum);
                    }

                    const averages: AnalysisAverageResult[] = categoryTotals.map((group, idx) => ({
                        key: idx,
                        label: labels[idx],
                        average: group.values.length 
                            ? Math.round(group.values.reduce((a, b) => a + b, 0) / group.values.length) 
                            : 0,
                        avgCost: group.costs.length 
                            ? Math.round(group.costs.reduce((a, b) => a + b, 0) / group.costs.length) 
                            : 0,
                        count: group.values.length,
                    }));

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