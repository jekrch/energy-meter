// US federal holiday computation for the peak-rate schedule.
//
// TOU tariffs treat holidays as off-peak, but each utility observes a different
// subset of the eleven federal holidays, so callers pass the keys they want.
// Fixed-date holidays shift when they land on a weekend (Sat -> preceding Fri,
// Sun -> following Mon), which is the date that actually appears on a bill.
//
// Everything here works in browser-local time, matching how the rest of the app
// decomposes timestamps (see the timezone note in `peakSchedule.ts`).

export type HolidayRuleKey =
    | 'newYears'
    | 'mlk'
    | 'presidents'
    | 'memorial'
    | 'juneteenth'
    | 'independence'
    | 'labor'
    | 'columbus'
    | 'veterans'
    | 'thanksgiving'
    | 'christmas';

export const HOLIDAY_RULES: { key: HolidayRuleKey; name: string }[] = [
    { key: 'newYears', name: "New Year's Day" },
    { key: 'mlk', name: 'Martin Luther King Jr. Day' },
    { key: 'presidents', name: "Presidents' Day" },
    { key: 'memorial', name: 'Memorial Day' },
    { key: 'juneteenth', name: 'Juneteenth' },
    { key: 'independence', name: 'Independence Day' },
    { key: 'labor', name: 'Labor Day' },
    { key: 'columbus', name: 'Columbus Day' },
    { key: 'veterans', name: 'Veterans Day' },
    { key: 'thanksgiving', name: 'Thanksgiving' },
    { key: 'christmas', name: 'Christmas Day' },
];

// The six most TOU tariffs actually observe. Utilities rarely give up peak
// pricing for MLK / Presidents / Juneteenth / Columbus / Veterans.
export const DEFAULT_HOLIDAY_RULES: HolidayRuleKey[] = [
    'newYears', 'memorial', 'independence', 'labor', 'thanksgiving', 'christmas',
];

// Compact numeric identity for a local calendar day (20260704). Used instead of
// a 'YYYY-MM-DD' string so per-reading holiday lookups allocate nothing.
export const dayKey = (d: Date): number =>
    d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();

// 'YYYY-MM-DD' -> dayKey. Returns null on anything that isn't that shape.
export const parseDayKey = (iso: string): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return year * 10000 + (month - 1) * 100 + day;
};

// dayKey -> 'YYYY-MM-DD'.
export const formatDayKey = (key: number): string => {
    const year = Math.floor(key / 10000);
    const month = Math.floor(key / 100) % 100;
    const day = key % 100;
    return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// The `n`th `weekday` of a month (n is 1-based; weekday 0 = Sunday).
const nthWeekday = (year: number, month: number, weekday: number, n: number): Date => {
    const firstDow = new Date(year, month, 1).getDay();
    const offset = (weekday - firstDow + 7) % 7;
    return new Date(year, month, 1 + offset + (n - 1) * 7);
};

// The last `weekday` of a month. `new Date(y, m + 1, 0)` is that month's last day.
const lastWeekday = (year: number, month: number, weekday: number): Date => {
    const last = new Date(year, month + 1, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month, last.getDate() - offset);
};

// Weekend observation shift. A no-op for the nth-weekday holidays, which can
// never land on a weekend, so it is applied uniformly.
const observed = (d: Date): Date => {
    const dow = d.getDay();
    if (dow === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    if (dow === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return d;
};

export interface HolidayOccurrence {
    key: HolidayRuleKey;
    date: Date;   // the *observed* date, local midnight
}

const nominalDates = (year: number): HolidayOccurrence[] => [
    { key: 'newYears', date: new Date(year, 0, 1) },
    { key: 'mlk', date: nthWeekday(year, 0, 1, 3) },
    { key: 'presidents', date: nthWeekday(year, 1, 1, 3) },
    { key: 'memorial', date: lastWeekday(year, 4, 1) },
    { key: 'juneteenth', date: new Date(year, 5, 19) },
    { key: 'independence', date: new Date(year, 6, 4) },
    { key: 'labor', date: nthWeekday(year, 8, 1, 1) },
    { key: 'columbus', date: nthWeekday(year, 9, 1, 2) },
    { key: 'veterans', date: new Date(year, 10, 11) },
    { key: 'thanksgiving', date: nthWeekday(year, 10, 4, 4) },
    { key: 'christmas', date: new Date(year, 11, 25) },
];

const yearCache = new Map<number, HolidayOccurrence[]>();

// Every federal holiday *observed* during `year`, memoized. Note the two ways a
// year's list can differ from its nominal dates: a Jan 1 that falls on Saturday
// is observed on Dec 31 of the previous year (so it leaves this year and joins
// the one before), which is why next year's New Year's Day is considered here.
export function federalHolidays(year: number): readonly HolidayOccurrence[] {
    let list = yearCache.get(year);
    if (!list) {
        const nominal: HolidayOccurrence[] = [
            ...nominalDates(year),
            { key: 'newYears', date: new Date(year + 1, 0, 1) },
        ];
        list = [];
        for (const occ of nominal) {
            const date = observed(occ.date);
            if (date.getFullYear() === year) list.push({ key: occ.key, date });
        }
        yearCache.set(year, list);
    }
    return list;
}

// The dayKeys of the observed holidays in `year` that `rules` selects.
export function holidayDayKeys(year: number, rules: readonly HolidayRuleKey[]): Set<number> {
    const wanted = new Set(rules);
    const keys = new Set<number>();
    for (const occ of federalHolidays(year)) {
        if (wanted.has(occ.key)) keys.add(dayKey(occ.date));
    }
    return keys;
}
