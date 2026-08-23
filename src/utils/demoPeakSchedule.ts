import type { PeakSchedule } from '../types';
import { DEFAULT_HOLIDAY_RULES } from './holidays';

// The peak rate schedule the demo dataset ships with, so "Try the Demo" lands on
// a dashboard where the rate-period features (chart bands, the peak split card,
// the per-period export columns) are actually doing something.
//
// It is deliberately NOT a default for real data: Green Button files carry no
// rate metadata, so inventing a schedule for someone's own meter would put
// made-up numbers next to their real usage. This is applied only while the demo
// dataset is loaded, is never persisted on its own, and steps aside the moment
// the user has a schedule of their own (see App's demoPeakActive).
//
// Shaped to match generateSampleData's profile — a weekday evening ramp that
// peaks around 7pm — so the bands line up with visible behavior.
export const DEMO_PEAK_SCHEDULE: PeakSchedule = {
    version: 1,
    periods: [
        {
            id: 'demo-on-peak',
            name: 'On-Peak',
            colorKey: 'red',
            // Weekdays 4pm–9pm (inclusive ends: 16..20).
            rules: [{ hourRanges: [{ start: 16, end: 20 }], daysOfWeek: [1, 2, 3, 4, 5], months: [] }],
        },
        {
            id: 'demo-mid-peak',
            name: 'Mid-Peak',
            colorKey: 'amber',
            // The rest of the weekday business hours, either side of On-Peak.
            // On-Peak is listed first, so the 4pm–9pm overlap resolves to it.
            rules: [{ hourRanges: [{ start: 7, end: 22 }], daysOfWeek: [1, 2, 3, 4, 5], months: [] }],
        },
    ],
    observeHolidays: true,
    holidayRules: DEFAULT_HOLIDAY_RULES,
    label: 'Sample TOU Schedule',
    extraHolidays: [],
};
