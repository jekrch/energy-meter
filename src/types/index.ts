export const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const HOURS = Array.from({ length: 24 }, (_, i) => i);


export interface DataPoint {
  timestamp: number;
  value: number;
  cost: number;  // Cost in micro-dollars (divide by 100000 for dollars)
  date?: string;
  time?: string;
  fullDate?: string;
}

export interface TimeRange {
    start: number | null;
    end: number | null;
}

export interface AnalysisFilters {
    daysOfWeek: number[];
    months: number[];
    hourStart: number;
    hourEnd: number;
}

export type MetricMode = 'energy' | 'cost';

export const RESOLUTIONS: Record<string, { label: string; seconds: number }> = {
    RAW: { label: 'Raw Data', seconds: 0 },
    HOURLY: { label: 'Hourly Sum', seconds: 3600 },
    DAILY: { label: 'Daily Sum', seconds: 86400 },
    WEEKLY: { label: 'Weekly Sum', seconds: 604800 },
};

// types.ts - Updated with cost support

export interface DataPoint {
  timestamp: number;
  value: number;
  cost: number;  // Cost in micro-dollars (divide by 100000 for dollars)
  // Optional display fields added during processing
  date?: string;
  time?: string;
  fullDate?: string;
}

export interface TimeRange {
  start: number | null;
  end: number | null;
}

export interface AnalysisFilters {
  daysOfWeek: number[];
  months: number[];
  hourStart: number;
  hourEnd: number;
}


