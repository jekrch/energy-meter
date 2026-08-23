/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import {
  formatHour12, formatExclusiveEnd, formatHourRange,
  describeMonths, describeDays, describeHours, describeRule, describeSchedule,
  PEAK_TEMPLATES, SUMMER_MONTHS, WINTER_MONTHS, newPeriod,
} from './peakScheduleFormat';
import { buildPeakIndex, classify, sanitizePeakSchedule } from './peakSchedule';
import { OFF_PEAK, type PeakSchedule } from '../types';

describe('hour formatting', () => {
  it('renders 12-hour labels', () => {
    expect([0, 1, 11, 12, 13, 23].map(formatHour12)).toEqual(['12a', '1a', '11a', '12p', '1p', '11p']);
  });

  it('renders an inclusive end hour exclusively, the way tariffs are published', () => {
    // {start:14, end:18} covers 14:00-18:59 — "2pm to 7pm".
    expect(formatHourRange({ start: 14, end: 18 })).toBe('2p–7p');
    expect(formatExclusiveEnd(18)).toBe('7p');
  });

  it('wraps a 23:00 end back to midnight rather than showing a 24th hour', () => {
    expect(formatExclusiveEnd(23)).toBe('12a');
    expect(formatHourRange({ start: 22, end: 5 })).toBe('10p–6a');
  });
});

describe('describeMonths', () => {
  it('collapses a contiguous run', () => {
    expect(describeMonths(SUMMER_MONTHS)).toBe('Jun–Sep');
  });

  it('joins a run that wraps across the new year into one span', () => {
    expect(describeMonths(WINTER_MONTHS)).toBe('Oct–May');
  });

  it('names a lone month without a dash', () => {
    expect(describeMonths([6])).toBe('Jul');
  });

  it('lists disjoint runs', () => {
    expect(describeMonths([1, 2, 6, 7])).toBe('Feb–Mar, Jul–Aug');
  });

  it('treats empty and complete alike', () => {
    expect(describeMonths([])).toBe('All year');
    expect(describeMonths([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe('All year');
  });
});

describe('describeDays', () => {
  it('names the two common sets', () => {
    expect(describeDays([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(describeDays([0, 6])).toBe('Weekends');
  });

  it('treats empty and complete alike', () => {
    expect(describeDays([])).toBe('Every day');
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
  });

  it('collapses any other run', () => {
    expect(describeDays([1, 2, 3])).toBe('Mon–Wed');
    expect(describeDays([3])).toBe('Wed');
  });
});

describe('describeHours and describeRule', () => {
  it('joins multiple windows', () => {
    expect(describeHours([{ start: 6, end: 8 }, { start: 17, end: 19 }])).toBe('6a–9a, 5p–8p');
  });

  it('calls an empty window list all hours', () => {
    expect(describeHours([])).toBe('All hours');
  });

  it('reads as days · months · hours', () => {
    expect(describeRule({ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [1, 2, 3, 4, 5], months: SUMMER_MONTHS }))
      .toBe('Weekdays · Jun–Sep · 2p–7p');
  });
});

describe('describeSchedule', () => {
  const base = (periods: PeakSchedule['periods'], label?: string): PeakSchedule => ({
    version: 1, periods, observeHolidays: true, holidayRules: [], extraHolidays: [], ...(label ? { label } : {}),
  });

  it('prefers the user-supplied label', () => {
    expect(describeSchedule(base([], 'ComEd Rate 6'))).toBe('ComEd Rate 6');
  });

  it('summarizes a single period by its first rule', () => {
    expect(describeSchedule(base([newPeriod('On-Peak', 'red')])))
      .toBe('On-Peak · Weekdays · All year · 2p–7p');
  });

  it('counts multiple periods', () => {
    expect(describeSchedule(base([newPeriod('A', 'red'), newPeriod('B', 'amber')]))).toBe('2 periods');
  });

  it('says so when nothing is defined', () => {
    expect(describeSchedule(base([]))).toBe('No periods defined');
  });
});

describe('starter templates', () => {
  it('produce schedules that survive validation', () => {
    for (const template of PEAK_TEMPLATES) {
      expect(sanitizePeakSchedule(template.build())).not.toBeNull();
    }
  });

  it('give every period a distinct id', () => {
    for (const template of PEAK_TEMPLATES) {
      const ids = template.build().periods.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('shade a summer weekday afternoon in every template', () => {
    // Wed Jul 9 2025, 3pm.
    const ts = new Date(2025, 6, 9, 15).getTime() / 1000;
    for (const template of PEAK_TEMPLATES) {
      expect(classify(ts, buildPeakIndex(template.build()))).not.toBe(OFF_PEAK);
    }
  });

  it('leaves a summer weekend afternoon off-peak in every template', () => {
    const ts = new Date(2025, 6, 12, 15).getTime() / 1000; // Saturday
    for (const template of PEAK_TEMPLATES) {
      expect(classify(ts, buildPeakIndex(template.build()))).toBe(OFF_PEAK);
    }
  });

  it('orders the three-tier template narrowest-first, so the critical tier wins', () => {
    const threeTier = PEAK_TEMPLATES.find((t) => t.name === 'Three-tier weekday')!.build();
    const index = buildPeakIndex(threeTier);
    // 4pm on a July weekday is inside all three tiers; Critical Peak is first.
    expect(threeTier.periods[classify(new Date(2025, 6, 9, 16).getTime() / 1000, index)].name).toBe('Critical Peak');
    expect(threeTier.periods[classify(new Date(2025, 6, 9, 15).getTime() / 1000, index)].name).toBe('On-Peak');
    expect(threeTier.periods[classify(new Date(2025, 6, 9, 10).getTime() / 1000, index)].name).toBe('Mid-Peak');
  });
});
