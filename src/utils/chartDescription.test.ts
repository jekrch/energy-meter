/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { buildChartDescription } from './chartDescription';
import type { AnalysisFilters } from '../types';

const noFilters: AnalysisFilters = {
  daysOfWeek: [],
  months: [],
  hourRanges: [{ start: 0, end: 23 }],
};

describe('buildChartDescription main text', () => {
  it('describes averages views per metric', () => {
    expect(buildChartDescription('averages', 'hour', 'energy', noFilters).main)
      .toBe('Average energy by hour');
    expect(buildChartDescription('averages', 'dayOfWeek', 'demand', noFilters).main)
      .toBe('Average peak demand by day of week');
    expect(buildChartDescription('averages', 'month', 'cost', noFilters).main)
      .toBe('Average cost by month');
  });

  it('describes timeline views with a period label', () => {
    expect(buildChartDescription('timeline', 'hour', 'energy', noFilters).main)
      .toBe('Hourly energy timeline');
    expect(buildChartDescription('timeline', 'dayOfWeek', 'energy', noFilters).main)
      .toBe('Daily energy timeline');
    expect(buildChartDescription('timeline', 'month', 'cost', noFilters).main)
      .toBe('Monthly cost timeline');
  });
});

describe('buildChartDescription day-of-week filters', () => {
  it('collapses Mon-Fri to "weekdays only"', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', {
      ...noFilters,
      daysOfWeek: [1, 2, 3, 4, 5],
    });
    expect(r.filters).toContain('weekdays only');
  });

  it('collapses Sat/Sun to "weekends only"', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', {
      ...noFilters,
      daysOfWeek: [0, 6],
    });
    expect(r.filters).toContain('weekends only');
  });

  it('lists specific days when not a weekday/weekend set', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', {
      ...noFilters,
      daysOfWeek: [1, 3],
    });
    expect(r.filters).toContain('Mon, Wed');
  });

  it('omits the filter when all seven days are selected', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', {
      ...noFilters,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(r.filters).toEqual([]);
  });
});

describe('buildChartDescription month filters', () => {
  it('lists month names when three or fewer', () => {
    const r = buildChartDescription('averages', 'month', 'energy', {
      ...noFilters,
      months: [0, 1, 11],
    });
    expect(r.filters).toContain('Jan, Feb, Dec');
  });

  it('summarizes a count when more than three months', () => {
    const r = buildChartDescription('averages', 'month', 'energy', {
      ...noFilters,
      months: [0, 1, 2, 3, 4],
    });
    expect(r.filters).toContain('5 months');
  });
});

describe('buildChartDescription hour-range filter', () => {
  it('adds a 12-hour formatted range when narrowed', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', {
      ...noFilters,
      hourRanges: [{ start: 0, end: 12 }],
    });
    expect(r.filters).toContain('12 AM–12 PM');
  });

  it('formats afternoon hours with PM', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', {
      ...noFilters,
      hourRanges: [{ start: 9, end: 17 }],
    });
    expect(r.filters).toContain('9 AM–5 PM');
  });

  it('omits the range when it spans the whole day', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', noFilters);
    expect(r.filters).toEqual([]);
  });

  it('lists each window when two ranges are selected', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', {
      ...noFilters,
      hourRanges: [{ start: 6, end: 9 }, { start: 18, end: 21 }],
    });
    expect(r.filters).toContain('6 AM–9 AM, 6 PM–9 PM');
  });

  it('formats a window that wraps past midnight', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', {
      ...noFilters,
      hourRanges: [{ start: 22, end: 5 }],
    });
    expect(r.filters).toContain('10 PM–5 AM');
  });
});

describe('buildChartDescription temperature filter', () => {
  it('adds a rounded temperature range in the chosen unit', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', noFilters, {
      isActive: true,
      min: 18.4,
      max: 24.6,
      unit: 'C',
    });
    expect(r.filters).toContain('18°C–25°C');
  });

  it('uses Fahrenheit symbols when requested', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', noFilters, {
      isActive: true,
      min: 60,
      max: 80,
      unit: 'F',
    });
    expect(r.filters).toContain('60°F–80°F');
  });

  it('omits the filter when inactive or bounds are null', () => {
    const inactive = buildChartDescription('averages', 'hour', 'energy', noFilters, {
      isActive: false,
      min: 10,
      max: 20,
      unit: 'C',
    });
    expect(inactive.filters).toEqual([]);

    const nullBounds = buildChartDescription('averages', 'hour', 'energy', noFilters, {
      isActive: true,
      min: null,
      max: null,
      unit: 'C',
    });
    expect(nullBounds.filters).toEqual([]);
  });
});

describe('buildChartDescription combined filters', () => {
  it('accumulates multiple filter parts in order', () => {
    const r = buildChartDescription('averages', 'hour', 'energy', {
      daysOfWeek: [1, 2, 3, 4, 5],
      months: [0, 1],
      hourRanges: [{ start: 8, end: 18 }],
    }, { isActive: true, min: 15, max: 25, unit: 'C' });
    expect(r.filters).toEqual(['weekdays only', 'Jan, Feb', '8 AM–6 PM', '15°C–25°C']);
  });
});
