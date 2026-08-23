/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { DEMO_PEAK_SCHEDULE } from './demoPeakSchedule';
import { buildPeakIndex, classify, sanitizePeakSchedule, scheduleIsEmpty } from './peakSchedule';
import { OFF_PEAK } from '../types';

// A local timestamp for the given date/hour, matching classify's local-time
// reading of the data.
const at = (y: number, m: number, d: number, h: number) =>
  new Date(y, m, d, h).getTime() / 1000;

describe('DEMO_PEAK_SCHEDULE', () => {
  // The demo schedule is a hand-written literal, so nothing else would catch it
  // drifting out of the shape the validator accepts — it would just silently
  // stop shading anything.
  it('survives sanitizing unchanged', () => {
    expect(sanitizePeakSchedule(DEMO_PEAK_SCHEDULE)).toEqual(DEMO_PEAK_SCHEDULE);
    expect(scheduleIsEmpty(DEMO_PEAK_SCHEDULE)).toBe(false);
  });

  it('classifies a weekday into on-peak, mid-peak and off-peak', () => {
    const index = buildPeakIndex(DEMO_PEAK_SCHEDULE);
    // Wednesday, 2026-08-19.
    expect(classify(at(2026, 7, 19, 18), index)).toBe(0);  // 6pm on-peak
    expect(classify(at(2026, 7, 19, 10), index)).toBe(1);  // 10am mid-peak
    expect(classify(at(2026, 7, 19, 22), index)).toBe(1);  // 10pm mid-peak
    expect(classify(at(2026, 7, 19, 3), index)).toBe(OFF_PEAK);
  });

  it('leaves weekends and observed holidays off-peak', () => {
    const index = buildPeakIndex(DEMO_PEAK_SCHEDULE);
    expect(classify(at(2026, 7, 22, 18), index)).toBe(OFF_PEAK);   // Saturday
    expect(classify(at(2026, 6, 3, 18), index)).toBe(OFF_PEAK);    // Fri, July 4th observed
  });
});
