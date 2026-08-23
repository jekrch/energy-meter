import { isHourInRange, OFF_PEAK, PEAK_COLOR_KEYS, PEAK_COLORS } from '../types';
import type { HourRange, PeakColorKey, PeakPeriod, PeakRule, PeakSchedule } from '../types';
import { dayKey, holidayDayKeys, parseDayKey, HOLIDAY_RULES, type HolidayRuleKey } from './holidays';
import { MAX_CHART_POINTS, PEAK_BAND_MAX_STEP_SECONDS } from '../constants';
import { toDemandKW } from './demandUnits';

// Peak-period classification.
//
// Evaluating rules per reading would loop periods x rules x hourRanges for every
// point, which is the wrong shape for the 100k+ datasets this codebase already
// takes care with. The schedule only varies over (month, dayOfWeek-or-holiday,
// hour), so the whole thing collapses to a small lookup table built once per
// schedule; classifying a reading is then a date decompose plus one array read.
//
// Timezone caveat: `new Date(ts * 1000)` yields browser-local hours. Utilities
// bill in the meter's local time, so this is right for the normal case and wrong
// when viewing data from another timezone — the same existing limitation as the
// hour filter.

// Slot 7 of the day dimension is "observed holiday"; 0-6 are Sunday..Saturday.
// Day-of-week gets its own dimension rather than a weekday/weekend flag because
// a rule may legitimately name single days.
const HOLIDAY_SLOT = 7;
const DAY_SLOTS = 8;
const TABLE_SIZE = 12 * DAY_SLOTS * 24;

const cellIndex = (month: number, daySlot: number, hour: number): number =>
    (month * DAY_SLOTS + daySlot) * 24 + hour;

export interface PeakIndex {
    // Period index per (month, daySlot, hour) cell, or OFF_PEAK.
    table: Int8Array;
    observeHolidays: boolean;
    holidayRules: PeakSchedule['holidayRules'];
    // Extra 'YYYY-MM-DD' dates, pre-parsed to dayKeys.
    extraHolidays: Set<number>;
    // Observed-holiday dayKeys per calendar year, filled lazily as the data
    // being classified reaches into each year.
    holidayCache: Map<number, Set<number>>;
    schedule: PeakSchedule;
}

const ruleMatches = (rule: PeakRule, month: number, dayOfWeek: number, hour: number): boolean => {
    if (rule.months.length && !rule.months.includes(month)) return false;
    if (rule.daysOfWeek.length && !rule.daysOfWeek.includes(dayOfWeek)) return false;
    if (rule.hourRanges.length &&
        !rule.hourRanges.some(r => isHourInRange(hour, r.start, r.end))) return false;
    // A rule with nothing set matches everything, which is what "no restriction
    // on this dimension" composes to.
    return true;
};

export function buildPeakIndex(schedule: PeakSchedule): PeakIndex {
    const table = new Int8Array(TABLE_SIZE).fill(OFF_PEAK);

    for (let month = 0; month < 12; month++) {
        for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
            for (let hour = 0; hour < 24; hour++) {
                // First match wins.
                for (let p = 0; p < schedule.periods.length; p++) {
                    if (schedule.periods[p].rules.some(r => ruleMatches(r, month, dayOfWeek, hour))) {
                        table[cellIndex(month, dayOfWeek, hour)] = p;
                        break;
                    }
                }
            }
        }
    }
    // The holiday slot stays OFF_PEAK for every month/hour: an observed holiday
    // is off-peak by definition. Leaving it in the table means classify() needs
    // no branch for it.

    const extraHolidays = new Set<number>();
    for (const iso of schedule.extraHolidays) {
        const key = parseDayKey(iso);
        if (key !== null) extraHolidays.add(key);
    }

    return {
        table,
        observeHolidays: schedule.observeHolidays,
        holidayRules: schedule.holidayRules,
        extraHolidays,
        holidayCache: new Map(),
        schedule,
    };
}

const isHolidayDate = (index: PeakIndex, d: Date): boolean => {
    const key = dayKey(d);
    if (index.extraHolidays.has(key)) return true;
    const year = d.getFullYear();
    let keys = index.holidayCache.get(year);
    if (!keys) {
        keys = holidayDayKeys(year, index.holidayRules);
        index.holidayCache.set(year, keys);
    }
    return keys.has(key);
};

// The period index a timestamp falls in, or OFF_PEAK (-1).
export function classify(ts: number, index: PeakIndex): number {
    const d = new Date(ts * 1000);
    const daySlot = index.observeHolidays && isHolidayDate(index, d)
        ? HOLIDAY_SLOT
        : d.getDay();
    return index.table[cellIndex(d.getMonth(), daySlot, d.getHours())];
}

// True when the schedule can never shade anything, so callers can skip the
// whole overlay rather than building runs that come back empty.
export const scheduleIsEmpty = (schedule: PeakSchedule): boolean =>
    schedule.periods.every(p => p.rules.length === 0);

export interface BandRun {
    periodIdx: number;
    x1: string;   // first category value of the run
    x2: string;   // last category value of the run
}

// Collapse a rendered series into one band per contiguous run of the same
// period. Bands are derived from the rendered points, not the raw data, because
// MainChart's XAxis is a *category* axis keyed on `fullDate` — a ReferenceArea
// there has to name exact category values, not timestamps.
//
// Runs merge across a gap in the underlying timestamps on purpose: on a category
// axis a missing hour is not a visual gap, its neighbours are simply adjacent
// categories, so splitting the band would draw a seam that isn't there.
export function buildBandRuns(
    points: readonly { timestamp: number; fullDate?: string }[],
    index: PeakIndex,
): BandRun[] {
    const runs: BandRun[] = [];
    let current: BandRun | null = null;

    for (const point of points) {
        const category = point.fullDate;
        if (category === undefined) continue;
        const periodIdx = classify(point.timestamp, index);

        if (current && current.periodIdx === periodIdx) {
            current.x2 = category;
            continue;
        }
        if (current && current.periodIdx !== OFF_PEAK) runs.push(current);
        current = { periodIdx, x1: category, x2: category };
    }
    if (current && current.periodIdx !== OFF_PEAK) runs.push(current);

    return runs;
}

// Whether the bands can be drawn honestly for the current view, and if not, why
// — the caller shows the reason rather than silently dropping the overlay.
//
// Two ways they'd lie. A DAILY/WEEKLY bucket spans both peak and off-peak hours,
// so shading it one color is simply false. And once the rendered series is
// downsampled coarser than hourly, band edges snap to surviving sample points
// instead of real period boundaries.
export type PeakBandGate = 'ok' | 'resolution' | 'density';

export function peakBandGate(
    resolution: string,
    pointStepSeconds: number,
    viewSpanSeconds: number,
): PeakBandGate {
    if (resolution !== 'RAW' && resolution !== 'HOURLY') {
        // The series is capped at MAX_CHART_POINTS whatever the resolution, so on
        // a long enough view switching to Hourly wouldn't help either — blame the
        // span instead of sending the user to a setting that changes nothing.
        return viewSpanSeconds / MAX_CHART_POINTS > PEAK_BAND_MAX_STEP_SECONDS
            ? 'density'
            : 'resolution';
    }
    // Measured density, not the span: LTTB thins a series unevenly, so the local
    // gap between plotted points is what decides whether an edge lands right.
    if (pointStepSeconds > PEAK_BAND_MAX_STEP_SECONDS) return 'density';
    return 'ok';
}

// Kept short: the chip shares the top of the plot with the download button.
export const PEAK_BAND_GATE_HINTS: Record<Exclude<PeakBandGate, 'ok'>, string> = {
    resolution: 'Peak bands need Hourly',
    density: 'Zoom in for peak bands',
};

// Typical gap between consecutive rendered points, which is what decides whether
// a band can be placed accurately. The median rather than the average so a
// single long gap in the data doesn't suppress bands for the whole view.
export function medianPointStep(points: readonly { timestamp: number }[]): number {
    if (points.length < 2) return 0;
    const steps: number[] = [];
    for (let i = 1; i < points.length; i++) steps.push(points[i].timestamp - points[i - 1].timestamp);
    steps.sort((a, b) => a - b);
    return steps[Math.floor(steps.length / 2)];
}

// --- Validation --------------------------------------------------------------
// A schedule can arrive from three untrusted places: localStorage written by an
// older build, a shared native `.json` file, and the editor's paste-in import.
// All three go through here, so a malformed schedule degrades to `null` rather
// than throwing somewhere inside a render.

const isIntIn = (v: unknown, min: number, max: number): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

const sanitizeHourRanges = (value: unknown): HourRange[] | null => {
    if (!Array.isArray(value)) return null;
    const ranges: HourRange[] = [];
    for (const r of value) {
        if (!r || typeof r !== 'object') return null;
        const { start, end } = r as HourRange;
        if (!isIntIn(start, 0, 23) || !isIntIn(end, 0, 23)) return null;
        ranges.push({ start, end });
    }
    return ranges;
};

const sanitizeIntList = (value: unknown, max: number): number[] | null => {
    if (!Array.isArray(value)) return null;
    const out: number[] = [];
    for (const v of value) {
        if (!isIntIn(v, 0, max)) return null;
        if (!out.includes(v)) out.push(v);
    }
    return out;
};

export function sanitizePeakSchedule(value: unknown): PeakSchedule | null {
    if (!value || typeof value !== 'object') return null;
    const obj = value as Partial<PeakSchedule>;
    if (obj.version !== 1 || !Array.isArray(obj.periods)) return null;

    const periods: PeakPeriod[] = [];
    for (const p of obj.periods) {
        if (!p || typeof p !== 'object') return null;
        if (typeof p.id !== 'string' || typeof p.name !== 'string') return null;
        if (!PEAK_COLOR_KEYS.includes(p.colorKey)) return null;
        if (!Array.isArray(p.rules)) return null;

        const rules: PeakRule[] = [];
        for (const r of p.rules) {
            if (!r || typeof r !== 'object') return null;
            const hourRanges = sanitizeHourRanges(r.hourRanges);
            const daysOfWeek = sanitizeIntList(r.daysOfWeek, 6);
            const months = sanitizeIntList(r.months, 11);
            if (!hourRanges || !daysOfWeek || !months) return null;
            rules.push({ hourRanges, daysOfWeek, months });
        }
        periods.push({ id: p.id, name: p.name, colorKey: p.colorKey, rules });
    }

    // Unknown holiday keys are dropped rather than rejected, so a schedule
    // written by a build that knows more holidays still loads here.
    const known = new Set(HOLIDAY_RULES.map(r => r.key));
    const holidayRules = Array.isArray(obj.holidayRules)
        ? obj.holidayRules.filter((k): k is HolidayRuleKey => known.has(k as HolidayRuleKey))
        : [];
    const extraHolidays = Array.isArray(obj.extraHolidays)
        ? obj.extraHolidays.filter((d): d is string => typeof d === 'string' && parseDayKey(d) !== null)
        : [];

    return {
        version: 1,
        periods,
        observeHolidays: obj.observeHolidays !== false,
        holidayRules,
        extraHolidays,
        ...(typeof obj.label === 'string' ? { label: obj.label } : {}),
    };
}

// Parse a pasted / uploaded schedule document. Accepts either a bare schedule or
// one wrapped in `{ peakSchedule: ... }`, so a native data file pasted whole
// still yields its schedule.
export function parsePeakScheduleJson(text: string): PeakSchedule | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    const wrapped = (parsed as { peakSchedule?: unknown })?.peakSchedule;
    return sanitizePeakSchedule(wrapped ?? parsed);
}

// Stable identity for what a schedule *does*, ignoring presentation (label,
// period names, colors, ids). Two schedules with the same fingerprint classify
// every timestamp identically, which is the question the merge check asks.
export function scheduleFingerprint(schedule: PeakSchedule): string {
    return JSON.stringify({
        periods: schedule.periods.map(p => p.rules),
        observeHolidays: schedule.observeHolidays,
        holidayRules: [...schedule.holidayRules].sort(),
        extraHolidays: [...schedule.extraHolidays].sort(),
    });
}

// --- Usage split -------------------------------------------------------------

export interface PeakSplitEntry {
    periodIdx: number;        // OFF_PEAK for the implicit off-peak bucket
    name: string;
    colorKey: PeakColorKey | null;   // null for off-peak, which has no color
    energy: number;           // Wh
    cost: number;             // micro-dollars
    readings: number;
    energyShare: number;      // 0..1 of total energy
    costShare: number;        // 0..1 of total cost
    // Demand is a rate, not a quantity, so it gets a maximum rather than a sum
    // and has no meaningful "share". Demand charges bill the single highest
    // interval *within* a rate period, which is exactly this number.
    maxDemand: number;        // kW, 0 when the period matched no reading
    maxDemandTs: number;      // when that interval started; 0 when none
}

// How much of a dataset's energy and cost landed in each rate period. The
// share of usage during peak is the number most users actually want from a TOU
// schedule, and it falls out of the classification the bands already do.
//
// Off-peak is always the last entry, matching how it reads on the chart: the
// unshaded remainder.
export function computePeakSplit(
    data: readonly { timestamp: number; value: number; cost?: number; duration?: number }[],
    schedule: PeakSchedule,
): PeakSplitEntry[] {
    const index = buildPeakIndex(schedule);
    const blank = { energy: 0, cost: 0, readings: 0, energyShare: 0, costShare: 0, maxDemand: 0, maxDemandTs: 0 };
    const entries: PeakSplitEntry[] = schedule.periods.map((p, periodIdx) => ({
        periodIdx, name: p.name, colorKey: p.colorKey, ...blank,
    }));
    const offPeak: PeakSplitEntry = {
        periodIdx: OFF_PEAK, name: 'Off-Peak', colorKey: null, ...blank,
    };

    let totalEnergy = 0;
    let totalCost = 0;
    for (const point of data) {
        const periodIdx = classify(point.timestamp, index);
        const bucket = periodIdx === OFF_PEAK ? offPeak : entries[periodIdx];
        const cost = point.cost ?? 0;
        bucket.energy += point.value;
        bucket.cost += cost;
        bucket.readings++;
        // Derived from the reading's own duration rather than a stored `demand`,
        // matching App's headline stat — the raw points this runs over do not
        // all carry one.
        const demand = toDemandKW(point.value, point.duration);
        if (demand > bucket.maxDemand) {
            bucket.maxDemand = demand;
            bucket.maxDemandTs = point.timestamp;
        }
        totalEnergy += point.value;
        totalCost += cost;
    }

    const all = [...entries, offPeak];
    for (const entry of all) {
        entry.energyShare = totalEnergy > 0 ? entry.energy / totalEnergy : 0;
        entry.costShare = totalCost > 0 ? entry.cost / totalCost : 0;
    }
    return all;
}

// Which period each hour of the day falls in with day-of-week and month scoping
// ignored — the schedule's "nominal" shape. The hour-of-day analysis view
// averages across every day of the range, so its bars have no single weekday /
// weekend / seasonal identity and cannot be classified exactly; this is what the
// published tariff would call the peak window. First match wins, as elsewhere.
export function nominalHourPeriods(schedule: PeakSchedule): number[] {
    return Array.from({ length: 24 }, (_, hour) => {
        for (let p = 0; p < schedule.periods.length; p++) {
            const matched = schedule.periods[p].rules.some(rule =>
                rule.hourRanges.length === 0 ||
                rule.hourRanges.some(r => isHourInRange(hour, r.start, r.end)));
            if (matched) return p;
        }
        return OFF_PEAK;
    });
}

export interface PeakStackSegment {
    slot: number;    // index into a row's per-period array
    name: string;
    color: string;
}

// Segments for a bar stacked by rate period, or null when the bar must stay a
// single total.
//
// `rowSlots` is the length of the per-period array the aggregated rows actually
// carry, and checking it is not paranoia: the schedule reaches the chart as a
// prop while the split reaches it through an async, chunked aggregation, so the
// two disagree whenever the schedule has just changed. Stacking across that
// mismatch reads every segment as zero and renders an empty chart, so fall back
// to the plain total until the data catches up.
export function peakStackSegments(
    schedule: PeakSchedule | null,
    offPeakColor: string,
    rowSlots: number,
): PeakStackSegment[] | null {
    if (!schedule || scheduleIsEmpty(schedule)) return null;
    if (rowSlots !== schedule.periods.length + 1) return null;
    // Off-peak leads so it sits at the base of the stack in the metric's own
    // color; the peak tiers cap each bar, which is the part worth reading.
    return [
        { slot: schedule.periods.length, name: 'Off-Peak', color: offPeakColor },
        ...schedule.periods.map((period, slot) => ({
            slot,
            name: period.name,
            color: PEAK_COLORS[period.colorKey],
        })),
    ];
}
