import { DAYS_OF_WEEK, MONTHS } from '../types';
import type { HourRange, PeakPeriod, PeakRule, PeakSchedule } from '../types';
import { DEFAULT_HOLIDAY_RULES } from './holidays';

// Human-readable summaries of a peak schedule, plus the starter templates the
// editor offers. Kept apart from `peakSchedule.ts` so the hot classification
// path stays free of presentation concerns.

export const formatHour12 = (h: number): string => {
    if (h === 0) return '12a';
    if (h === 12) return '12p';
    return h < 12 ? `${h}a` : `${h - 12}p`;
};

// `HourRange` ends are *inclusive* — `{ start: 14, end: 18 }` covers 14:00-18:59
// — because that is what `isHourInRange` implements. Utilities publish the same
// window as "2pm to 7pm", so the UI renders the end exclusively. Store
// inclusive, display exclusive.
export const formatExclusiveEnd = (end: number): string => formatHour12((end + 1) % 24);

export const formatHourRange = (r: HourRange): string =>
    `${formatHour12(r.start)}–${formatExclusiveEnd(r.end)}`;

// Contiguous runs over a cyclic domain, so Oct..Dec + Jan..May reads as one
// "Oct–May" rather than two disjoint spans.
const cyclicRuns = (values: readonly number[], cycle: number): [number, number][] => {
    const sorted = [...new Set(values)].filter(v => v >= 0 && v < cycle).sort((a, b) => a - b);
    if (!sorted.length) return [];

    const runs: [number, number][] = [];
    let start = sorted[0];
    let prev = sorted[0];
    for (const v of sorted.slice(1)) {
        if (v === prev + 1) { prev = v; continue; }
        runs.push([start, prev]);
        start = v;
        prev = v;
    }
    runs.push([start, prev]);

    if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === cycle - 1) {
        const tail = runs.pop()!;
        runs[0] = [tail[0], runs[0][1]];
    }
    return runs;
};

const joinRuns = (runs: [number, number][], names: readonly string[]): string =>
    runs.map(([a, b]) => (a === b ? names[a] : `${names[a]}–${names[b]}`)).join(', ');

export const describeMonths = (months: readonly number[]): string =>
    months.length === 0 || months.length === 12
        ? 'All year'
        : joinRuns(cyclicRuns(months, 12), MONTHS);

export const describeDays = (days: readonly number[]): string => {
    const set = new Set(days);
    if (set.size === 0 || set.size === 7) return 'Every day';
    if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'Weekdays';
    if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
    return joinRuns(cyclicRuns(days, 7), DAYS_OF_WEEK);
};

export const describeHours = (ranges: readonly HourRange[]): string =>
    ranges.length === 0 ? 'All hours' : ranges.map(formatHourRange).join(', ');

// "Weekdays · Jun–Sep · 2p–7p"
export const describeRule = (rule: PeakRule): string =>
    [describeDays(rule.daysOfWeek), describeMonths(rule.months), describeHours(rule.hourRanges)]
        .join(' · ');

// Short summary for the toolbar pill / modal header.
export const describeSchedule = (schedule: PeakSchedule): string => {
    if (schedule.label) return schedule.label;
    const active = schedule.periods.filter(p => p.rules.length > 0);
    if (!active.length) return 'No periods defined';
    if (active.length === 1) return `${active[0].name} · ${describeRule(active[0].rules[0])}`;
    return `${active.length} periods`;
};

const newId = (): string =>
    globalThis.crypto?.randomUUID?.() ?? `p-${Math.random().toString(36).slice(2, 10)}`;

const WEEKDAYS = [1, 2, 3, 4, 5];
export const SUMMER_MONTHS = [5, 6, 7, 8];               // Jun–Sep
export const WINTER_MONTHS = [0, 1, 2, 3, 4, 9, 10, 11]; // Oct–May

export const newPeriod = (name: string, colorKey: PeakPeriod['colorKey']): PeakPeriod => ({
    id: newId(),
    name,
    colorKey,
    rules: [{ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [...WEEKDAYS], months: [] }],
});

const baseSchedule = (periods: PeakPeriod[], label: string): PeakSchedule => ({
    version: 1,
    periods,
    observeHolidays: true,
    holidayRules: [...DEFAULT_HOLIDAY_RULES],
    extraHolidays: [],
    label,
});

// Deliberately generic. There are thousands of tariffs and they change yearly,
// so shipping utility-specific presets would mostly ship wrong ones.
export const PEAK_TEMPLATES: { name: string; description: string; build: () => PeakSchedule }[] = [
    {
        name: 'Simple on/off-peak',
        description: 'One on-peak window on weekday afternoons, all year.',
        build: () => baseSchedule([{
            id: newId(),
            name: 'On-Peak',
            colorKey: 'red',
            rules: [{ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [...WEEKDAYS], months: [] }],
        }], 'Simple on/off-peak'),
    },
    {
        name: 'Weekday afternoons, seasonal',
        description: 'Summer afternoons; a morning and an evening window in winter.',
        build: () => baseSchedule([{
            id: newId(),
            name: 'On-Peak',
            colorKey: 'red',
            rules: [
                { hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [...WEEKDAYS], months: [...SUMMER_MONTHS] },
                { hourRanges: [{ start: 6, end: 8 }, { start: 17, end: 19 }], daysOfWeek: [...WEEKDAYS], months: [...WINTER_MONTHS] },
            ],
        }], 'Weekday afternoons, seasonal'),
    },
    {
        name: 'Three-tier weekday',
        description: 'Critical, on- and mid-peak tiers stacked narrowest first.',
        build: () => baseSchedule([
            {
                id: newId(),
                name: 'Critical Peak',
                colorKey: 'red',
                rules: [{ hourRanges: [{ start: 16, end: 17 }], daysOfWeek: [...WEEKDAYS], months: [...SUMMER_MONTHS] }],
            },
            {
                id: newId(),
                name: 'On-Peak',
                colorKey: 'amber',
                rules: [{ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [...WEEKDAYS], months: [] }],
            },
            {
                id: newId(),
                name: 'Mid-Peak',
                colorKey: 'blue',
                rules: [{ hourRanges: [{ start: 7, end: 13 }, { start: 19, end: 21 }], daysOfWeek: [...WEEKDAYS], months: [] }],
            },
        ], 'Three-tier weekday'),
    },
];
