export const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const HOURS = Array.from({ length: 24 }, (_, i) => i);

export interface RateChange {
  timestamp: number;
  previousRate: number;  // micro-dollars per Wh
  newRate: number;
  percentChange: number;
  direction: 'increase' | 'decrease';
}

export interface RatePeriod {
  startTimestamp: number;
  endTimestamp: number;
  rate: number;  // micro-dollars per Wh
  readings: number;
}

export interface DataPoint {
  timestamp: number;
  value: number;
  cost: number;  // Cost in micro-dollars (divide by 100000 for dollars)
  demand?: number;  // Instantaneous demand in kW, derived from value / duration
  date?: string;
  time?: string;
  fullDate?: string;
  duration?: number;
}

export interface TimeRange {
    start: number | null;
    end: number | null;
}

export interface HourRange {
    start: number;
    end: number;
}

export interface AnalysisFilters {
    daysOfWeek: number[];
    months: number[];
    // One or more hour windows; the filter keeps points matching ANY window.
    // start <= end is a normal range; start > end wraps across midnight.
    hourRanges: HourRange[];
}

// start <= end is a normal range; start > end wraps across midnight
export const isHourInRange = (h: number, start: number, end: number): boolean =>
    start <= end ? h >= start && h <= end : h >= start || h <= end;

// The hour filter only restricts the data when there is at least one window and
// none of them already covers the whole day (a full-day window is a no-op).
export const isHourFilterActive = (ranges: HourRange[]): boolean =>
    ranges.length > 0 && !ranges.some(r => r.start === 0 && r.end === 23);

// True when the given hour passes the set of windows (empty set = no filter).
export const hourPassesRanges = (h: number, ranges: HourRange[]): boolean =>
    ranges.length === 0 || ranges.some(r => isHourInRange(h, r.start, r.end));

export type MetricMode = 'energy' | 'cost' | 'demand';

export const RESOLUTIONS: Record<string, { label: string; seconds: number }> = {
    RAW: { label: 'Raw Data', seconds: 0 },
    HOURLY: { label: 'Hourly Sum', seconds: 3600 },
    DAILY: { label: 'Daily Sum', seconds: 86400 },
    WEEKLY: { label: 'Weekly Sum', seconds: 604800 },
};

// Time-of-use peak rate schedule — model lives in its own file to keep this one
// navigable, re-exported here so `from '../types'` stays the single import.
export type { PeakColorKey, PeakRule, PeakPeriod, PeakSchedule } from './peakSchedule';
export { PEAK_COLORS, PEAK_COLOR_KEYS, OFF_PEAK, emptyRule } from './peakSchedule';
