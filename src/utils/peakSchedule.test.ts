/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import {
  buildPeakIndex, classify, buildBandRuns, scheduleIsEmpty, peakBandGate,
  sanitizePeakSchedule, parsePeakScheduleJson, scheduleFingerprint, computePeakSplit,
  medianPointStep, nominalHourPeriods, peakStackSegments,
} from './peakSchedule';
import { isHourInRange, OFF_PEAK, PEAK_COLORS } from '../types';
import type { PeakPeriod, PeakRule, PeakSchedule } from '../types';
import { dayKey, holidayDayKeys, parseDayKey } from './holidays';

const rule = (r: Partial<PeakRule>): PeakRule =>
  ({ hourRanges: [], daysOfWeek: [], months: [], ...r });

const period = (name: string, rules: PeakRule[]): PeakPeriod =>
  ({ id: name, name, colorKey: 'red', rules });

const schedule = (periods: PeakPeriod[], over: Partial<PeakSchedule> = {}): PeakSchedule => ({
  version: 1,
  periods,
  observeHolidays: false,
  holidayRules: [],
  extraHolidays: [],
  ...over,
});

// Local-time timestamp in epoch seconds, matching how classify decomposes.
const ts = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).getTime() / 1000;

const WEEKDAYS = [1, 2, 3, 4, 5];
const SUMMER = [5, 6, 7, 8];
const WINTER = [0, 1, 2, 3, 4, 9, 10, 11];

// The requester's tariff: 2p-7p summer weekdays, 6-9a + 5-8p winter weekdays.
const seasonal = schedule([
  period('On-Peak', [
    rule({ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: WEEKDAYS, months: SUMMER }),
    rule({ hourRanges: [{ start: 6, end: 8 }, { start: 17, end: 19 }], daysOfWeek: WEEKDAYS, months: WINTER }),
  ]),
]);

// Independent reference: walk the schedule directly for one timestamp.
const classifyNaive = (t: number, s: PeakSchedule): number => {
  const d = new Date(t * 1000);
  const [month, dow, hour] = [d.getMonth(), d.getDay(), d.getHours()];
  if (s.observeHolidays) {
    const key = dayKey(d);
    const extra = new Set(s.extraHolidays.map(parseDayKey));
    if (extra.has(key) || holidayDayKeys(d.getFullYear(), s.holidayRules).has(key)) return OFF_PEAK;
  }
  for (let p = 0; p < s.periods.length; p++) {
    for (const r of s.periods[p].rules) {
      if (r.months.length && !r.months.includes(month)) continue;
      if (r.daysOfWeek.length && !r.daysOfWeek.includes(dow)) continue;
      if (r.hourRanges.length && !r.hourRanges.some(h => isHourInRange(hour, h.start, h.end))) continue;
      return p;
    }
  }
  return OFF_PEAK;
};

describe('classify — hour windows', () => {
  const afternoons = buildPeakIndex(schedule([
    period('On-Peak', [rule({ hourRanges: [{ start: 14, end: 18 }] })]),
  ]));

  it('treats the stored end hour as inclusive (14-18 is 2p through 7p)', () => {
    expect(classify(ts(2025, 5, 10, 13), afternoons)).toBe(OFF_PEAK);
    expect(classify(ts(2025, 5, 10, 14), afternoons)).toBe(0);
    expect(classify(ts(2025, 5, 10, 18), afternoons)).toBe(0);
    expect(classify(ts(2025, 5, 10, 19), afternoons)).toBe(OFF_PEAK);
  });

  it('wraps a window across midnight when start > end', () => {
    const overnight = buildPeakIndex(schedule([
      period('Night', [rule({ hourRanges: [{ start: 22, end: 5 }] })]),
    ]));
    for (const h of [22, 23, 0, 3, 5]) expect(classify(ts(2025, 5, 10, h), overnight)).toBe(0);
    for (const h of [6, 12, 21]) expect(classify(ts(2025, 5, 10, h), overnight)).toBe(OFF_PEAK);
  });

  it('unions multiple windows within one rule', () => {
    const twice = buildPeakIndex(schedule([
      period('On-Peak', [rule({ hourRanges: [{ start: 6, end: 8 }, { start: 17, end: 19 }] })]),
    ]));
    for (const h of [6, 8, 17, 19]) expect(classify(ts(2025, 0, 8, h), twice)).toBe(0);
    for (const h of [5, 9, 16, 20]) expect(classify(ts(2025, 0, 8, h), twice)).toBe(OFF_PEAK);
  });
});

describe('classify — empty dimensions mean "no restriction"', () => {
  it('applies an hours-only rule to every day and month', () => {
    const index = buildPeakIndex(schedule([
      period('On-Peak', [rule({ hourRanges: [{ start: 14, end: 18 }] })]),
    ]));
    expect(classify(ts(2025, 0, 5, 15), index)).toBe(0);   // a January Sunday
    expect(classify(ts(2025, 7, 6, 15), index)).toBe(0);   // an August Wednesday
  });

  it('applies a days-only rule to every hour and month', () => {
    const index = buildPeakIndex(schedule([
      period('Weekdays', [rule({ daysOfWeek: WEEKDAYS })]),
    ]));
    expect(classify(ts(2025, 0, 6, 3), index)).toBe(0);        // Monday 3am
    expect(classify(ts(2025, 0, 5, 3), index)).toBe(OFF_PEAK); // Sunday 3am
  });

  it('treats a rule with nothing set as always-on', () => {
    const index = buildPeakIndex(schedule([period('Always', [rule({})])]));
    expect(classify(ts(2025, 2, 9, 4), index)).toBe(0);
  });

  it('never matches a period that has no rules at all', () => {
    const index = buildPeakIndex(schedule([period('Unused', [])]));
    expect(classify(ts(2025, 2, 9, 4), index)).toBe(OFF_PEAK);
  });
});

describe('classify — seasons and day scoping', () => {
  const index = buildPeakIndex(seasonal);

  it('uses the summer window on a summer weekday', () => {
    expect(classify(ts(2025, 6, 9, 15), index)).toBe(0);         // Jul Wed 3pm
    expect(classify(ts(2025, 6, 9, 7), index)).toBe(OFF_PEAK);   // winter-only hour
  });

  it('uses the winter window on a winter weekday', () => {
    expect(classify(ts(2025, 0, 8, 7), index)).toBe(0);          // Jan Wed 7am
    expect(classify(ts(2025, 0, 8, 15), index)).toBe(OFF_PEAK);  // summer-only hour
  });

  it('flips at the season boundary between the last hour of May and the first of June', () => {
    expect(classify(ts(2025, 4, 30, 15), index)).toBe(OFF_PEAK); // Fri May 30, 3pm
    expect(classify(ts(2025, 5, 2, 15), index)).toBe(0);         // Mon Jun 2, 3pm
    expect(classify(ts(2025, 4, 30, 7), index)).toBe(0);         // winter morning
    expect(classify(ts(2025, 5, 2, 7), index)).toBe(OFF_PEAK);
  });

  it('leaves weekends off-peak in both seasons', () => {
    expect(classify(ts(2025, 6, 12, 15), index)).toBe(OFF_PEAK); // Saturday
    expect(classify(ts(2025, 0, 12, 7), index)).toBe(OFF_PEAK);  // Sunday
  });

  it('honours a rule that names a single day of the week', () => {
    const mondays = buildPeakIndex(schedule([
      period('Monday peak', [rule({ daysOfWeek: [1], hourRanges: [{ start: 9, end: 9 }] })]),
    ]));
    expect(classify(ts(2025, 5, 2, 9), mondays)).toBe(0);         // Monday
    expect(classify(ts(2025, 5, 3, 9), mondays)).toBe(OFF_PEAK);  // Tuesday
  });
});

describe('classify — first match wins', () => {
  const overlapping = schedule([
    period('Critical', [rule({ hourRanges: [{ start: 16, end: 17 }], months: [6] })]),
    period('On-Peak', [rule({ hourRanges: [{ start: 14, end: 18 }] })]),
  ]);

  it('picks the earlier period where two overlap', () => {
    const index = buildPeakIndex(overlapping);
    expect(classify(ts(2025, 6, 9, 16), index)).toBe(0);   // both match -> Critical
    expect(classify(ts(2025, 6, 9, 15), index)).toBe(1);   // only On-Peak
    expect(classify(ts(2025, 5, 9, 16), index)).toBe(1);   // Critical is July-only
  });

  it('reverses when the periods are reordered', () => {
    const flipped = buildPeakIndex(schedule([...overlapping.periods].reverse()));
    expect(classify(ts(2025, 6, 9, 16), flipped)).toBe(0); // On-Peak now first
  });
});

describe('classify — holidays', () => {
  const alwaysPeak = [period('On-Peak', [rule({ daysOfWeek: WEEKDAYS })])];

  it('drops an observed holiday to off-peak', () => {
    const index = buildPeakIndex(schedule(alwaysPeak, {
      observeHolidays: true,
      holidayRules: ['independence'],
    }));
    expect(classify(ts(2025, 6, 4, 15), index)).toBe(OFF_PEAK); // Fri Jul 4 2025
    expect(classify(ts(2025, 6, 3, 15), index)).toBe(0);        // Thu Jul 3
  });

  it('follows the weekend observation shift, not the nominal date', () => {
    // Jul 4 2026 is a Saturday -> observed Friday Jul 3.
    const index = buildPeakIndex(schedule(alwaysPeak, {
      observeHolidays: true,
      holidayRules: ['independence'],
    }));
    expect(classify(ts(2026, 6, 3, 15), index)).toBe(OFF_PEAK);
  });

  it('ignores holidays entirely when observeHolidays is off', () => {
    const index = buildPeakIndex(schedule(alwaysPeak, {
      observeHolidays: false,
      holidayRules: ['independence'],
    }));
    expect(classify(ts(2025, 6, 4, 15), index)).toBe(0);
  });

  it('honours extraHolidays and skips unparseable entries', () => {
    const index = buildPeakIndex(schedule(alwaysPeak, {
      observeHolidays: true,
      holidayRules: [],
      extraHolidays: ['2025-08-06', 'not-a-date'],
    }));
    expect(classify(ts(2025, 7, 6, 15), index)).toBe(OFF_PEAK); // Wed Aug 6
    expect(classify(ts(2025, 7, 7, 15), index)).toBe(0);
  });

  it('resolves holidays independently in each year the data spans', () => {
    const index = buildPeakIndex(schedule(alwaysPeak, {
      observeHolidays: true,
      holidayRules: ['christmas'],
    }));
    expect(classify(ts(2024, 11, 25, 15), index)).toBe(OFF_PEAK); // Wed Dec 25 2024
    expect(classify(ts(2025, 11, 25, 15), index)).toBe(OFF_PEAK); // Thu Dec 25 2025
    // Dec 25 2027 is a Saturday -> observed Friday the 24th.
    expect(classify(ts(2027, 11, 24, 15), index)).toBe(OFF_PEAK);
    expect(classify(ts(2027, 11, 23, 15), index)).toBe(0);
  });
});

describe('classify — DST', () => {
  it('classifies by local wall-clock hour across a DST transition day', () => {
    const index = buildPeakIndex(schedule([
      period('On-Peak', [rule({ hourRanges: [{ start: 14, end: 18 }] })]),
    ]));
    // Walk real elapsed hours through the US spring-forward day; whatever the
    // local clock reads is what the schedule must be judged against.
    let t = ts(2026, 2, 8, 0);
    for (let i = 0; i < 26; i++, t += 3600) {
      const hour = new Date(t * 1000).getHours();
      const expected = hour >= 14 && hour <= 18 ? 0 : OFF_PEAK;
      expect(classify(t, index)).toBe(expected);
    }
  });
});

describe('buildPeakIndex — table matches a naive walk of the schedule', () => {
  it('agrees on every (month, day-of-week, hour) cell of a multi-rule schedule', () => {
    const multi = schedule([
      period('Critical', [rule({ hourRanges: [{ start: 16, end: 17 }], months: [6], daysOfWeek: WEEKDAYS })]),
      ...seasonal.periods,
      period('Overnight', [rule({ hourRanges: [{ start: 23, end: 4 }] })]),
    ]);
    const index = buildPeakIndex(multi);

    let checked = 0;
    // 2024 covers a leap year and every weekday lands in every month.
    for (let month = 0; month < 12; month++) {
      for (let day = 1; day <= 28; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const t = ts(2024, month, day, hour);
          expect(classify(t, index)).toBe(classifyNaive(t, multi));
          checked++;
        }
      }
    }
    expect(checked).toBe(12 * 28 * 24);
  });

  it('agrees with the naive walk when holidays are observed', () => {
    const withHolidays = schedule([period('On-Peak', [rule({ daysOfWeek: WEEKDAYS })])], {
      observeHolidays: true,
      holidayRules: ['newYears', 'independence', 'christmas'],
      extraHolidays: ['2025-03-17'],
    });
    const index = buildPeakIndex(withHolidays);
    for (let month = 0; month < 12; month++) {
      for (let day = 1; day <= 28; day++) {
        const t = ts(2025, month, day, 12);
        expect(classify(t, index)).toBe(classifyNaive(t, withHolidays));
      }
    }
  });
});

describe('scheduleIsEmpty', () => {
  it('is true for no periods and for periods with no rules', () => {
    expect(scheduleIsEmpty(schedule([]))).toBe(true);
    expect(scheduleIsEmpty(schedule([period('Empty', [])]))).toBe(true);
  });

  it('is false once any period has a rule', () => {
    expect(scheduleIsEmpty(seasonal)).toBe(false);
  });
});

describe('buildBandRuns', () => {
  const index = buildPeakIndex(schedule([
    period('On-Peak', [rule({ hourRanges: [{ start: 14, end: 16 }] })]),
  ]));

  // One point per hour of Jun 10 2025, categories matching MainChart's fullDate.
  const hourly = (hours: number[]) => hours.map(h => ({
    timestamp: ts(2025, 5, 10, h),
    fullDate: `Jun 10, ${h}:00`,
  }));

  it('merges contiguous hours into a single band', () => {
    const runs = buildBandRuns(hourly([12, 13, 14, 15, 16, 17, 18]), index);
    expect(runs).toEqual([{ periodIdx: 0, x1: 'Jun 10, 14:00', x2: 'Jun 10, 16:00' }]);
  });

  it('emits nothing when no point is in a peak period', () => {
    expect(buildBandRuns(hourly([0, 1, 2, 20, 21]), index)).toEqual([]);
  });

  it('emits a single-point run with x1 === x2', () => {
    const runs = buildBandRuns(hourly([13, 14, 17]), index);
    expect(runs).toEqual([{ periodIdx: 0, x1: 'Jun 10, 14:00', x2: 'Jun 10, 14:00' }]);
  });

  it('emits one run per day across a multi-day series', () => {
    const points = [10, 11].flatMap(day =>
      [13, 14, 15, 16, 17].map(h => ({ timestamp: ts(2025, 5, day, h), fullDate: `Jun ${day}, ${h}:00` })));
    const runs = buildBandRuns(points, index);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual({ periodIdx: 0, x1: 'Jun 10, 14:00', x2: 'Jun 10, 16:00' });
    expect(runs[1]).toEqual({ periodIdx: 0, x1: 'Jun 11, 14:00', x2: 'Jun 11, 16:00' });
  });

  it('merges across a gap in the timestamps, since a category axis has no gap', () => {
    // 15:00 is missing from the data; 14:00 and 16:00 are adjacent categories.
    const runs = buildBandRuns(hourly([14, 16]), index);
    expect(runs).toEqual([{ periodIdx: 0, x1: 'Jun 10, 14:00', x2: 'Jun 10, 16:00' }]);
  });

  it('splits a run where the period changes', () => {
    const tiered = buildPeakIndex(schedule([
      period('Critical', [rule({ hourRanges: [{ start: 15, end: 15 }] })]),
      period('On-Peak', [rule({ hourRanges: [{ start: 14, end: 16 }] })]),
    ]));
    const runs = buildBandRuns(hourly([13, 14, 15, 16, 17]), tiered);
    expect(runs).toEqual([
      { periodIdx: 1, x1: 'Jun 10, 14:00', x2: 'Jun 10, 14:00' },
      { periodIdx: 0, x1: 'Jun 10, 15:00', x2: 'Jun 10, 15:00' },
      { periodIdx: 1, x1: 'Jun 10, 16:00', x2: 'Jun 10, 16:00' },
    ]);
  });

  it('skips points that carry no category value', () => {
    const points = [
      { timestamp: ts(2025, 5, 10, 14), fullDate: 'Jun 10, 14:00' },
      { timestamp: ts(2025, 5, 10, 15) },
      { timestamp: ts(2025, 5, 10, 16), fullDate: 'Jun 10, 16:00' },
    ];
    expect(buildBandRuns(points, index)).toEqual([
      { periodIdx: 0, x1: 'Jun 10, 14:00', x2: 'Jun 10, 16:00' },
    ]);
  });

  it('returns nothing for an empty series', () => {
    expect(buildBandRuns([], index)).toEqual([]);
  });
});

describe('sanitizePeakSchedule', () => {
  const valid = {
    version: 1,
    periods: [{
      id: 'p1', name: 'On-Peak', colorKey: 'red',
      rules: [{ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [1, 5], months: [6] }],
    }],
    observeHolidays: true,
    holidayRules: ['independence'],
    extraHolidays: ['2025-08-06'],
    label: 'Test',
  };

  it('accepts a well-formed schedule unchanged', () => {
    expect(sanitizePeakSchedule(valid)).toEqual(valid as PeakSchedule);
  });

  it('rejects non-objects and the wrong version', () => {
    for (const bad of [null, undefined, 42, 'schedule', [], { version: 2, periods: [] }]) {
      expect(sanitizePeakSchedule(bad)).toBeNull();
    }
  });

  it('rejects an off-palette color, so a band can never draw an unknown hex', () => {
    expect(sanitizePeakSchedule({ ...valid, periods: [{ ...valid.periods[0], colorKey: 'chartreuse' }] })).toBeNull();
  });

  it('rejects out-of-domain hours, days and months', () => {
    const withRule = (rule: unknown) =>
      sanitizePeakSchedule({ ...valid, periods: [{ ...valid.periods[0], rules: [rule] }] });
    expect(withRule({ hourRanges: [{ start: 14, end: 24 }], daysOfWeek: [], months: [] })).toBeNull();
    expect(withRule({ hourRanges: [], daysOfWeek: [7], months: [] })).toBeNull();
    expect(withRule({ hourRanges: [], daysOfWeek: [], months: [12] })).toBeNull();
    expect(withRule({ hourRanges: [], daysOfWeek: [1.5], months: [] })).toBeNull();
    expect(withRule({ hourRanges: 'all day', daysOfWeek: [], months: [] })).toBeNull();
  });

  it('de-duplicates day and month lists', () => {
    const out = sanitizePeakSchedule({
      ...valid,
      periods: [{ ...valid.periods[0], rules: [{ hourRanges: [], daysOfWeek: [1, 1, 2], months: [3, 3] }] }],
    });
    expect(out!.periods[0].rules[0]).toEqual({ hourRanges: [], daysOfWeek: [1, 2], months: [3] });
  });

  it('drops unknown holiday keys and malformed extra dates instead of rejecting', () => {
    const out = sanitizePeakSchedule({
      ...valid,
      holidayRules: ['independence', 'boxingDay'],
      extraHolidays: ['2025-08-06', 'whenever'],
    });
    expect(out!.holidayRules).toEqual(['independence']);
    expect(out!.extraHolidays).toEqual(['2025-08-06']);
  });

  it('defaults observeHolidays to true and omits a non-string label', () => {
    const out = sanitizePeakSchedule({ ...valid, observeHolidays: undefined, label: 7 });
    expect(out!.observeHolidays).toBe(true);
    expect(out!.label).toBeUndefined();
  });
});

describe('parsePeakScheduleJson', () => {
  const json = JSON.stringify({
    version: 1, periods: [], observeHolidays: false, holidayRules: [], extraHolidays: [],
  });

  it('parses a bare schedule document', () => {
    expect(parsePeakScheduleJson(json)!.observeHolidays).toBe(false);
  });

  it('unwraps a schedule embedded in a native data file', () => {
    expect(parsePeakScheduleJson(JSON.stringify({ format: 'energy-meter', peakSchedule: JSON.parse(json) }))).not.toBeNull();
  });

  it('returns null for unparseable or unrelated JSON', () => {
    expect(parsePeakScheduleJson('not json')).toBeNull();
    expect(parsePeakScheduleJson('{"hello":"world"}')).toBeNull();
  });
});

describe('scheduleFingerprint', () => {
  it('ignores presentation-only differences', () => {
    const a = seasonal;
    const b: PeakSchedule = {
      ...seasonal,
      label: 'A different name',
      periods: seasonal.periods.map(p => ({ ...p, id: 'other', name: 'Renamed', colorKey: 'blue' as const })),
    };
    expect(scheduleFingerprint(a)).toBe(scheduleFingerprint(b));
  });

  it('ignores the order holidays happen to be listed in', () => {
    const a = schedule([], { holidayRules: ['christmas', 'labor'], extraHolidays: ['2025-02-01', '2025-01-01'] });
    const b = schedule([], { holidayRules: ['labor', 'christmas'], extraHolidays: ['2025-01-01', '2025-02-01'] });
    expect(scheduleFingerprint(a)).toBe(scheduleFingerprint(b));
  });

  it('differs when the rules differ', () => {
    const narrowed: PeakSchedule = {
      ...seasonal,
      periods: [{ ...seasonal.periods[0], rules: [seasonal.periods[0].rules[0]] }],
    };
    expect(scheduleFingerprint(seasonal)).not.toBe(scheduleFingerprint(narrowed));
  });

  it('differs when the holiday configuration differs', () => {
    expect(scheduleFingerprint(schedule([], { observeHolidays: true })))
      .not.toBe(scheduleFingerprint(schedule([], { observeHolidays: false })));
  });
});

describe('peakBandGate', () => {
  const hour = 3600;
  const week = 7 * 86400;

  it('passes a RAW or HOURLY view whose points still resolve each hour', () => {
    expect(peakBandGate('RAW', 900, week)).toBe('ok');    // 15-minute readings
    expect(peakBandGate('HOURLY', hour, week)).toBe('ok');
  });

  it('blocks aggregated resolutions, whose buckets each span several periods', () => {
    expect(peakBandGate('DAILY', hour, week)).toBe('resolution');
    expect(peakBandGate('WEEKLY', hour, week)).toBe('resolution');
  });

  it('blocks a series downsampled coarser than hourly, where band edges would be wrong', () => {
    expect(peakBandGate('HOURLY', hour + 1, week)).toBe('density');
    expect(peakBandGate('RAW', 6 * hour, week)).toBe('density');
  });

  it('blames the span, not the resolution, when no resolution could resolve hours', () => {
    // A year can't fit hourly points inside the chart-point cap, so telling the
    // user to switch resolution would send them somewhere that doesn't help.
    expect(peakBandGate('DAILY', 86400, 365 * 86400)).toBe('density');
    expect(peakBandGate('HOURLY', 86400, 365 * 86400)).toBe('density');
  });

  it('still blames the resolution while the span is short enough to fix it', () => {
    expect(peakBandGate('DAILY', 86400, 14 * 86400)).toBe('resolution');
  });
});

describe('medianPointStep', () => {
  const at = (...offsets: number[]) => offsets.map((o) => ({ timestamp: 1000 + o }));

  it('returns the typical gap for an evenly spaced series', () => {
    expect(medianPointStep(at(0, 3600, 7200, 10800))).toBe(3600);
  });

  it('ignores a single long gap rather than letting it suppress the whole view', () => {
    expect(medianPointStep(at(0, 3600, 7200, 700000, 703600))).toBe(3600);
  });

  it('returns 0 for a series too short to have a step', () => {
    expect(medianPointStep([])).toBe(0);
    expect(medianPointStep(at(0))).toBe(0);
  });
});

describe('computePeakSplit', () => {
  // 2p–5p on weekdays, so a whole weekday's hourly readings split 3/21.
  const afternoons = schedule([
    period('On-Peak', [rule({ hourRanges: [{ start: 14, end: 16 }], daysOfWeek: WEEKDAYS })]),
  ]);

  const dayOfHours = (year: number, month: number, day: number, value = 100, cost = 1200) =>
    Array.from({ length: 24 }, (_, h) => ({ timestamp: ts(year, month, day, h), value, cost }));

  it('splits energy and cost between the period and the implicit off-peak', () => {
    const [onPeak, offPeak] = computePeakSplit(dayOfHours(2025, 5, 10), afternoons);

    expect(onPeak.name).toBe('On-Peak');
    expect(onPeak.readings).toBe(3);
    expect(onPeak.energy).toBe(300);
    expect(onPeak.cost).toBe(3600);
    expect(onPeak.energyShare).toBeCloseTo(3 / 24);
    expect(onPeak.costShare).toBeCloseTo(3 / 24);

    expect(offPeak.periodIdx).toBe(OFF_PEAK);
    expect(offPeak.readings).toBe(21);
    expect(offPeak.colorKey).toBeNull();
  });

  it('always puts off-peak last', () => {
    const split = computePeakSplit(dayOfHours(2025, 5, 10), afternoons);
    expect(split[split.length - 1].periodIdx).toBe(OFF_PEAK);
  });

  it('sums the shares to one', () => {
    const split = computePeakSplit(dayOfHours(2025, 5, 10), afternoons);
    expect(split.reduce((sum, e) => sum + e.energyShare, 0)).toBeCloseTo(1);
    expect(split.reduce((sum, e) => sum + e.costShare, 0)).toBeCloseTo(1);
  });

  it('puts a whole weekend day in off-peak', () => {
    const [onPeak, offPeak] = computePeakSplit(dayOfHours(2025, 5, 14), afternoons); // Saturday
    expect(onPeak.readings).toBe(0);
    expect(onPeak.energyShare).toBe(0);
    expect(offPeak.readings).toBe(24);
  });

  it('keeps a period with no matching readings as a zeroed row', () => {
    const twoTier = schedule([
      period('Critical', [rule({ hourRanges: [{ start: 3, end: 3 }], months: [11] })]),
      ...afternoons.periods,
    ]);
    const split = computePeakSplit(dayOfHours(2025, 5, 10), twoTier);
    expect(split).toHaveLength(3);
    expect(split[0]).toMatchObject({ name: 'Critical', readings: 0, energy: 0, energyShare: 0 });
  });

  it('treats a missing cost as zero and leaves shares at zero for an empty series', () => {
    const noCost = [{ timestamp: ts(2025, 5, 10, 15), value: 100 }];
    expect(computePeakSplit(noCost, afternoons)[0].cost).toBe(0);
    for (const entry of computePeakSplit([], afternoons)) {
      expect(entry.energyShare).toBe(0);
      expect(entry.costShare).toBe(0);
    }
  });

  // Demand is what a C&I tariff bills per rate period, so it is a maximum over
  // the period's own readings — never a sum, and never the whole range's peak.
  describe('per-period demand', () => {
    it('takes the highest interval inside each period, not the highest overall', () => {
      // A 400 Wh spike at 3p (inside 2p-5p) and a larger 900 Wh one at 8p (outside).
      const day = dayOfHours(2025, 5, 10).map(p => {
        const hour = new Date(p.timestamp * 1000).getHours();
        if (hour === 15) return { ...p, value: 400 };
        if (hour === 20) return { ...p, value: 900 };
        return p;
      });
      const [onPeak, offPeak] = computePeakSplit(day, afternoons);

      // Hourly readings, so kW = Wh / 1000.
      expect(onPeak.maxDemand).toBeCloseTo(0.4);
      expect(onPeak.maxDemandTs).toBe(ts(2025, 5, 10, 15));
      expect(offPeak.maxDemand).toBeCloseTo(0.9);
      expect(offPeak.maxDemandTs).toBe(ts(2025, 5, 10, 20));
    });

    it('derives kW from each reading\'s own duration', () => {
      // 100 Wh over 15 minutes is 0.4 kW — four times the same energy hourly.
      const quarterHours = [
        { timestamp: ts(2025, 5, 10, 15), value: 100, cost: 0, duration: 900 },
        { timestamp: ts(2025, 5, 10, 16), value: 200, cost: 0, duration: 3600 },
      ];
      const [onPeak] = computePeakSplit(quarterHours, afternoons);
      expect(onPeak.maxDemand).toBeCloseTo(0.4);
      expect(onPeak.maxDemandTs).toBe(ts(2025, 5, 10, 15));
    });

    it('assumes hourly intervals when duration is missing', () => {
      const [onPeak] = computePeakSplit([{ timestamp: ts(2025, 5, 10, 15), value: 250 }], afternoons);
      expect(onPeak.maxDemand).toBeCloseTo(0.25);
    });

    it('leaves a period that matched nothing at zero, with no timestamp', () => {
      const [onPeak] = computePeakSplit(dayOfHours(2025, 5, 14), afternoons); // Saturday
      expect(onPeak.maxDemand).toBe(0);
      expect(onPeak.maxDemandTs).toBe(0);
    });

    it('keeps the first interval when two tie at the maximum', () => {
      const flat = [
        { timestamp: ts(2025, 5, 10, 14), value: 500 },
        { timestamp: ts(2025, 5, 10, 15), value: 500 },
      ];
      const [onPeak] = computePeakSplit(flat, afternoons);
      expect(onPeak.maxDemandTs).toBe(ts(2025, 5, 10, 14));
    });
  });
});

describe('nominalHourPeriods', () => {
  it('marks the hours a period covers, ignoring its day and month scoping', () => {
    // The seasonal schedule is weekday-only, but the hour-of-day view averages
    // weekends in too — so the nominal window is the union of both rules.
    const hours = nominalHourPeriods(seasonal);
    for (const h of [6, 7, 8, 14, 15, 16, 17, 18, 19]) expect(hours[h]).toBe(0);
    for (const h of [0, 5, 9, 13, 20, 23]) expect(hours[h]).toBe(OFF_PEAK);
  });

  it('resolves overlapping periods first-match-wins', () => {
    const tiered = schedule([
      period('Critical', [rule({ hourRanges: [{ start: 16, end: 16 }] })]),
      period('On-Peak', [rule({ hourRanges: [{ start: 14, end: 18 }] })]),
    ]);
    const hours = nominalHourPeriods(tiered);
    expect(hours[16]).toBe(0);
    expect(hours[15]).toBe(1);
  });

  it('treats a rule with no hour window as covering the whole day', () => {
    const allDay = schedule([period('Always', [rule({ daysOfWeek: [1] })])]);
    expect(nominalHourPeriods(allDay).every(h => h === 0)).toBe(true);
  });

  it('follows a window that wraps past midnight', () => {
    const overnight = schedule([period('Night', [rule({ hourRanges: [{ start: 22, end: 2 }] })])]);
    const hours = nominalHourPeriods(overnight);
    for (const h of [22, 23, 0, 1, 2]) expect(hours[h]).toBe(0);
    for (const h of [3, 12, 21]) expect(hours[h]).toBe(OFF_PEAK);
  });

  it('is all off-peak for a schedule with no rules', () => {
    expect(nominalHourPeriods(schedule([period('Empty', [])]))).toHaveLength(24);
    expect(nominalHourPeriods(schedule([period('Empty', [])])).every(h => h === OFF_PEAK)).toBe(true);
  });
});

describe('peakStackSegments', () => {
  const twoTier = schedule([
    period('Critical', [rule({ hourRanges: [{ start: 16, end: 17 }] })]),
    period('On-Peak', [rule({ hourRanges: [{ start: 14, end: 18 }] })]),
  ]);

  it('puts off-peak at the base of the stack in the metric colour', () => {
    const segments = peakStackSegments(twoTier, '#10b981', 3)!;
    expect(segments[0]).toEqual({ slot: 2, name: 'Off-Peak', color: '#10b981' });
  });

  it('maps each period to its own slot and palette colour, in schedule order', () => {
    const segments = peakStackSegments(twoTier, '#10b981', 3)!;
    expect(segments.slice(1)).toEqual([
      { slot: 0, name: 'Critical', color: PEAK_COLORS.red },
      { slot: 1, name: 'On-Peak', color: PEAK_COLORS.red },
    ]);
  });

  it('covers every slot the aggregation produces, so the stack sums to the bar', () => {
    const segments = peakStackSegments(twoTier, '#10b981', 3)!;
    expect(new Set(segments.map(s => s.slot))).toEqual(new Set([0, 1, 2]));
  });

  // The regression this guard exists for: the schedule arrives as a prop while
  // the split arrives through an async aggregation. Stacking across a mismatch
  // reads every segment as zero, which renders an entirely empty chart.
  it('refuses to stack when the rows carry no split at all', () => {
    expect(peakStackSegments(twoTier, '#10b981', 0)).toBeNull();
  });

  it('refuses to stack when the row slot count disagrees with the schedule', () => {
    expect(peakStackSegments(twoTier, '#10b981', 2)).toBeNull();  // stale: one period
    expect(peakStackSegments(twoTier, '#10b981', 4)).toBeNull();  // stale: three periods
  });

  it('refuses to stack with no schedule, or one that defines nothing', () => {
    expect(peakStackSegments(null, '#10b981', 3)).toBeNull();
    expect(peakStackSegments(schedule([]), '#10b981', 1)).toBeNull();
    expect(peakStackSegments(schedule([period('Empty', [])]), '#10b981', 2)).toBeNull();
  });
});
