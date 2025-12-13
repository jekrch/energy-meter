import { DAYS_OF_WEEK, MONTHS, type AnalysisFilters } from '../types';

export interface ChartDescription {
    main: string;
    filters: string[];
}

function formatHourDisplay(h: number): string {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    if (h < 12) return `${h} AM`;
    return `${h - 12} PM`;
}

export function buildChartDescription(
    analysisView: 'averages' | 'timeline',
    groupBy: 'dayOfWeek' | 'month' | 'hour',
    metricMode: 'energy' | 'cost',
    filters: AnalysisFilters,
    tempFilter?: {
        isActive: boolean;
        min: number | null;
        max: number | null;
        unit: 'C' | 'F';
    }
): ChartDescription {
    const metric = metricMode === 'energy' ? 'energy' : 'cost';
    const groupLabels = { hour: 'hour', dayOfWeek: 'day of week', month: 'month' };
    const groupLabel = groupLabels[groupBy];

    // Main description
    let main: string;
    if (analysisView === 'averages') {
        main = `Average ${metric} by ${groupLabel}`;
    } else {
        const periodLabel = groupBy === 'hour' ? 'Hourly' : groupBy === 'dayOfWeek' ? 'Daily' : 'Monthly';
        main = `${periodLabel} ${metric} timeline`;
    }

    // Build filter descriptions
    const filterParts: string[] = [];

    // Days of week filter
    if (filters.daysOfWeek.length > 0 && filters.daysOfWeek.length < 7) {
        const isWeekdays = filters.daysOfWeek.length === 5 &&
            [1, 2, 3, 4, 5].every(d => filters.daysOfWeek.includes(d));
        const isWeekends = filters.daysOfWeek.length === 2 &&
            filters.daysOfWeek.includes(0) && filters.daysOfWeek.includes(6);

        if (isWeekdays) {
            filterParts.push('weekdays only');
        } else if (isWeekends) {
            filterParts.push('weekends only');
        } else {
            const dayNames = filters.daysOfWeek.map(d => DAYS_OF_WEEK[d].slice(0, 3)).join(', ');
            filterParts.push(dayNames);
        }
    }

    // Months filter
    if (filters.months.length > 0 && filters.months.length < 12) {
        if (filters.months.length <= 3) {
            const monthNames = filters.months.map(m => MONTHS[m]).join(', ');
            filterParts.push(monthNames);
        } else {
            filterParts.push(`${filters.months.length} months`);
        }
    }

    // Hour range filter
    if (filters.hourStart > 0 || filters.hourEnd < 23) {
        filterParts.push(`${formatHourDisplay(filters.hourStart)}–${formatHourDisplay(filters.hourEnd)}`);
    }

    // Temperature filter
    if (tempFilter?.isActive && tempFilter.min !== null && tempFilter.max !== null) {
        const unit = tempFilter.unit === 'F' ? '°F' : '°C';
        filterParts.push(`${Math.round(tempFilter.min)}${unit}–${Math.round(tempFilter.max)}${unit}`);
    }

    return { main, filters: filterParts };
}