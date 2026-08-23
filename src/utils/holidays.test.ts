/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import {
  federalHolidays, holidayDayKeys, dayKey, parseDayKey, formatDayKey,
  DEFAULT_HOLIDAY_RULES, HOLIDAY_RULES, type HolidayRuleKey,
} from './holidays';

const dateOf = (year: number, key: HolidayRuleKey): Date => {
  const hit = federalHolidays(year).find(h => h.key === key);
  if (!hit) throw new Error(`${key} missing from ${year}`);
  return hit.date;
};

const iso = (d: Date) => formatDayKey(dayKey(d));

describe('federalHolidays — nth-weekday rules', () => {
  it('places MLK on the third Monday of January', () => {
    expect(iso(dateOf(2026, 'mlk'))).toBe('2026-01-19');
    expect(iso(dateOf(2024, 'mlk'))).toBe('2024-01-15');
  });

  it('places Thanksgiving on the fourth Thursday of November', () => {
    expect(iso(dateOf(2026, 'thanksgiving'))).toBe('2026-11-26');
    expect(iso(dateOf(2024, 'thanksgiving'))).toBe('2024-11-28');
  });

  it('places Memorial Day on the LAST Monday of May, not the fourth', () => {
    // 2027 May has five Mondays — the 31st, not the 24th.
    expect(iso(dateOf(2027, 'memorial'))).toBe('2027-05-31');
    expect(iso(dateOf(2026, 'memorial'))).toBe('2026-05-25');
  });

  it('handles a leap year, where March onward shifts a day', () => {
    // 2024 is a leap year; Labor Day is the first Monday of September.
    expect(iso(dateOf(2024, 'labor'))).toBe('2024-09-02');
    expect(iso(dateOf(2024, 'columbus'))).toBe('2024-10-14');
    expect(iso(dateOf(2024, 'presidents'))).toBe('2024-02-19');
  });

  it('never shifts an nth-weekday holiday off its Monday/Thursday', () => {
    for (let year = 2020; year <= 2030; year++) {
      expect(dateOf(year, 'mlk').getDay()).toBe(1);
      expect(dateOf(year, 'memorial').getDay()).toBe(1);
      expect(dateOf(year, 'thanksgiving').getDay()).toBe(4);
    }
  });
});

describe('federalHolidays — weekend observation', () => {
  it('shifts a Saturday Independence Day back to Friday', () => {
    // Jul 4 2026 is a Saturday.
    expect(new Date(2026, 6, 4).getDay()).toBe(6);
    expect(iso(dateOf(2026, 'independence'))).toBe('2026-07-03');
  });

  it('shifts a Sunday Christmas forward to Monday', () => {
    // Dec 25 2022 is a Sunday.
    expect(new Date(2022, 11, 25).getDay()).toBe(0);
    expect(iso(dateOf(2022, 'christmas'))).toBe('2022-12-26');
  });

  it('leaves a weekday holiday alone', () => {
    expect(iso(dateOf(2025, 'independence'))).toBe('2025-07-04');
  });

  it("observes a Sunday New Year's Day on the following Monday", () => {
    // Jan 1 2023 is a Sunday.
    expect(iso(dateOf(2023, 'newYears'))).toBe('2023-01-02');
  });

  it("moves a Saturday New Year's Day into the PREVIOUS calendar year", () => {
    // Jan 1 2022 is a Saturday -> observed Fri Dec 31 2021. So 2021 carries two
    // New Year's observances (its own Jan 1, plus 2022's rolled back)...
    expect(new Date(2022, 0, 1).getDay()).toBe(6);
    const newYears2021 = federalHolidays(2021).filter(h => h.key === 'newYears').map(h => iso(h.date));
    expect(newYears2021).toEqual(['2021-01-01', '2021-12-31']);

    // ...and 2022 has none: its own rolled back into 2021, and Jan 1 2023 is a
    // Sunday, which moves forward into 2023 rather than back.
    expect(federalHolidays(2022).some(h => h.key === 'newYears')).toBe(false);
  });

  it('lists eleven holidays in an ordinary year', () => {
    // 2025: Jan 1 is a Wednesday and Jan 1 2026 is a Thursday, so no rollback.
    expect(federalHolidays(2025)).toHaveLength(11);
    expect(new Set(federalHolidays(2025).map(h => h.key)).size).toBe(11);
  });

  it('exposes a name for every rule key it can emit', () => {
    const named = new Set(HOLIDAY_RULES.map(r => r.key));
    for (const occ of federalHolidays(2025)) expect(named.has(occ.key)).toBe(true);
  });
});

describe('holidayDayKeys', () => {
  it('returns only the selected rules', () => {
    const keys = holidayDayKeys(2025, ['independence', 'christmas']);
    expect(keys.size).toBe(2);
    expect(keys.has(parseDayKey('2025-07-04')!)).toBe(true);
    expect(keys.has(parseDayKey('2025-12-25')!)).toBe(true);
    expect(keys.has(parseDayKey('2025-11-11')!)).toBe(false);
  });

  it('returns six dates for the default TOU subset', () => {
    expect(holidayDayKeys(2025, DEFAULT_HOLIDAY_RULES).size).toBe(6);
  });

  it('returns an empty set for no rules', () => {
    expect(holidayDayKeys(2025, []).size).toBe(0);
  });
});

describe('dayKey encoding', () => {
  it('round-trips through the ISO form', () => {
    for (const s of ['2025-01-01', '2024-02-29', '2026-12-31']) {
      expect(formatDayKey(parseDayKey(s)!)).toBe(s);
    }
  });

  it('agrees with dayKey on a Date', () => {
    expect(dayKey(new Date(2025, 6, 4))).toBe(parseDayKey('2025-07-04')!);
  });

  it('rejects malformed dates', () => {
    for (const s of ['2025-7-4', 'nonsense', '', '2025-13-01', '2025-01-00']) {
      expect(parseDayKey(s)).toBeNull();
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDayKey('  2025-07-04 ')).toBe(parseDayKey('2025-07-04'));
  });

  it('orders chronologically, so keys compare as numbers', () => {
    expect(parseDayKey('2025-01-31')!).toBeLessThan(parseDayKey('2025-02-01')!);
    expect(parseDayKey('2025-12-31')!).toBeLessThan(parseDayKey('2026-01-01')!);
  });
});
