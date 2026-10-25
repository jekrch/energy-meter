/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { buildAnalysisCsv, type AnalysisCsvOptions } from './chartDataExport';

const lines = (csv: string) => csv.trimEnd().split('\n');
const localTs = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).getTime() / 1000;

const AVERAGES: AnalysisCsvOptions = {
  view: 'averages', groupBy: 'hour', energyUnit: 'kWh', temperatureUnit: 'F', includeTemperature: false,
};
const TIMELINE: AnalysisCsvOptions = { ...AVERAGES, view: 'timeline' };

describe('buildAnalysisCsv — averages', () => {
  it('writes every metric with headers that name the aggregation', () => {
    const csv = buildAnalysisCsv(
      [{ label: '5PM', average: 1250, demand: 4.56789, avgCost: 18_750, count: 120 }],
      AVERAGES,
    );
    expect(lines(csv)).toEqual([
      'hour,avg_energy_kwh,avg_peak_demand_kw,avg_cost_dollars,periods_averaged',
      '5PM,1.25,4.568,0.1875,120',
    ]);
  });

  it('names the category column after the grouping', () => {
    const header = (groupBy: AnalysisCsvOptions['groupBy']) =>
      lines(buildAnalysisCsv([], { ...AVERAGES, groupBy }))[0].split(',')[0];
    expect(header('hour')).toBe('hour');
    expect(header('dayOfWeek')).toBe('day_of_week');
    expect(header('month')).toBe('month');
  });

  it('leaves metrics blank for a category with no complete periods', () => {
    const csv = buildAnalysisCsv([{ label: '3AM', average: 0, demand: 0, avgCost: 0, count: 0 }], AVERAGES);
    expect(lines(csv)[1]).toBe('3AM,,,,0');
  });

  it('adds temperature in the display unit only when asked', () => {
    const row = { label: 'Jul', average: 1000, demand: 2, avgCost: 0, temperature: 25, count: 3 };
    expect(lines(buildAnalysisCsv([row], AVERAGES))[0]).not.toContain('temperature');

    const f = lines(buildAnalysisCsv([row], { ...AVERAGES, includeTemperature: true }));
    expect(f[0]).toContain('avg_temperature_f');
    expect(f[1]).toBe('Jul,1,2,0,77,3');

    const c = lines(buildAnalysisCsv([row], { ...AVERAGES, includeTemperature: true, temperatureUnit: 'C' }));
    expect(c[0]).toContain('avg_temperature_c');
    expect(c[1]).toBe('Jul,1,2,0,25,3');
  });

  it('follows the chosen energy unit', () => {
    const csv = buildAnalysisCsv([{ label: '1AM', average: 1500, demand: 1, avgCost: 0, count: 1 }], { ...AVERAGES, energyUnit: 'Wh' });
    expect(lines(csv)).toEqual([
      'hour,avg_energy_wh,avg_peak_demand_kw,avg_cost_dollars,periods_averaged',
      '1AM,1500,1,0,1',
    ]);
  });
});

describe('buildAnalysisCsv — timeline', () => {
  it('writes totals, the period peak and a spreadsheet-friendly start', () => {
    const csv = buildAnalysisCsv(
      [{ fullDate: 'Jul 4 5PM', timestamp: localTs(2025, 6, 4, 17), value: 3200, demand: 6.4, cost: 45_000, count: 4 }],
      TIMELINE,
    );
    expect(lines(csv)).toEqual([
      'period,period_start,energy_kwh,peak_demand_kw,cost_dollars,readings',
      'Jul 4 5PM,2025-07-04 17:00,3.2,6.4,0.45,4',
    ]);
  });

  it('drops the time from the start of a day or month bucket', () => {
    const row = { fullDate: 'Mar 2025', timestamp: localTs(2025, 2, 1), value: 0, demand: 0, cost: 0, count: 1 };
    expect(lines(buildAnalysisCsv([row], { ...TIMELINE, groupBy: 'month' }))[1]).toStartWith('Mar 2025,2025-03-01,');
  });

  it('quotes labels that contain a comma', () => {
    const row = { fullDate: 'Sat Jan 4, 2025', timestamp: localTs(2025, 0, 4), value: 0, demand: 0, cost: 0, count: 1 };
    expect(lines(buildAnalysisCsv([row], { ...TIMELINE, groupBy: 'dayOfWeek' }))[1]).toStartWith('"Sat Jan 4, 2025",2025-01-04,');
  });

  it('leaves a missing temperature blank', () => {
    const csv = buildAnalysisCsv(
      [{ fullDate: 'x', timestamp: localTs(2025, 0, 1, 0), value: 0, demand: 0, cost: 0, count: 1 }],
      { ...TIMELINE, includeTemperature: true },
    );
    expect(lines(csv)[1]).toBe('x,2025-01-01 00:00,0,0,0,,1');
  });
});
