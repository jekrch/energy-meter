import type { HourRange } from './index';
import type { HolidayRuleKey } from '../utils/holidays';

// Time-of-use peak rate schedule. Green Button data carries no rate-period
// metadata, so the schedule is user-supplied and purely a *visual reference* —
// nothing here recomputes a bill.
//
// Kept out of `types/index.ts` (already large) and re-exported from it.

// Constrained to the four §3 accent tokens rather than free hex, so a schedule
// can never introduce an off-palette color. Red is the §3 "peak/extreme" accent
// and the default for a new period.
export type PeakColorKey = 'red' | 'amber' | 'violet' | 'blue';

export const PEAK_COLOR_KEYS: PeakColorKey[] = ['red', 'amber', 'violet', 'blue'];

// §8: Recharts takes colors as SVG props, so the token hexes live here.
export const PEAK_COLORS: Record<PeakColorKey, string> = {
    red: '#f87171',      // red-400
    amber: '#fbbf24',    // amber-400
    violet: '#a78bfa',   // violet-400
    blue: '#60a5fa',     // blue-400
};

// One scoping rule. An empty array means "no restriction on this dimension", so
// `{ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [], months: [] }` is
// every day of every month, 2p-7p. Within a rule the three dimensions are AND'd;
// a period's rules are OR'd, which is what lets one period hold both a summer
// and a winter window.
export interface PeakRule {
    hourRanges: HourRange[];   // inclusive ends, wraps midnight — see isHourInRange
    daysOfWeek: number[];      // 0 = Sunday
    months: number[];          // 0 = January
}

export interface PeakPeriod {
    id: string;
    name: string;              // "On-Peak", "Mid-Peak", "Critical Peak"
    colorKey: PeakColorKey;
    rules: PeakRule[];
}

export interface PeakSchedule {
    version: 1;
    // Evaluated in order — the FIRST period that matches wins, so a narrow
    // "Critical Peak" must sit above a broad "On-Peak" that would also match.
    periods: PeakPeriod[];
    observeHolidays: boolean;         // holidays fall through to off-peak
    holidayRules: HolidayRuleKey[];   // which federal holidays this utility observes
    extraHolidays: string[];          // additional 'YYYY-MM-DD' dates
    label?: string;                   // "ComEd C&I — Rate 6", shown in the UI
}

// Off-peak is implicit: a timestamp matching no period. That keeps the common
// single-window case to one object and makes an unshaded chart region
// unambiguously off-peak.
export const OFF_PEAK = -1;

export const emptyRule = (): PeakRule => ({ hourRanges: [], daysOfWeek: [], months: [] });
