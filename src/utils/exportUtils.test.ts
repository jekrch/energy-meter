/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import {
  buildWeatherLookup,
  getBucketKey,
  computeRate,
  buildRawRow,
  buildAggRow,
  rowToCsv,
  type AggBucket,
} from './exportUtils';
import { RATE_UNITS } from '../components/export/exportConstants';
import type { DataPoint } from '../types';
import type { HourlyWeatherData } from './weatherData';

const DOLLAR_PER_KWH = RATE_UNITS.find(u => u.value === '$/kWh')!;
const CENT_PER_KWH = RATE_UNITS.find(u => u.value === '¢/kWh')!;
const DOLLAR_PER_MWH = RATE_UNITS.find(u => u.value === '$/MWh')!;

const identity = (c: number) => c;

describe('rowToCsv', () => {
  it('joins values in header order', () => {
    const row = { a: 1, b: 'two', c: 3 };
    expect(rowToCsv(row, ['a', 'b', 'c'])).toBe('1,two,3');
  });

  it('quotes values containing a comma', () => {
    const row = { label: 'Jan 1 – Jan 7' };
    expect(rowToCsv({ label: 'a,b' }, ['label'])).toBe('"a,b"');
    // no comma → no quoting
    expect(rowToCsv(row, ['label'])).toBe('Jan 1 – Jan 7');
  });

  it('escapes embedded double quotes by doubling them', () => {
    expect(rowToCsv({ v: 'he said "hi"' }, ['v'])).toBe('"he said ""hi"""');
  });

  it('emits empty fields for null/undefined while preserving column positions', () => {
    const row = { a: 'x,y', b: 'he"llo', c: 5, d: null };
    expect(rowToCsv(row, ['a', 'b', 'c', 'd'])).toBe('"x,y","he""llo",5,');
  });

  it('passes numbers through without quoting', () => {
    expect(rowToCsv({ n: 1234.56 }, ['n'])).toBe('1234.56');
  });
});

describe('computeRate', () => {
  it('scales by the rate-unit multiplier and rounds to its decimals', () => {
    // cost is micro-dollars: base $/kWh = (cost / 100_000) / (energy / 1_000)
    //   = (cost / energy) * 0.01; then * multiplier.
    // 12000 micro-$ over 1000 Wh = $0.12/kWh.
    expect(computeRate(12000, 1000, DOLLAR_PER_KWH)).toBe(0.12);
    expect(computeRate(12000, 1000, CENT_PER_KWH)).toBe(12);
    expect(computeRate(12000, 1000, DOLLAR_PER_MWH)).toBe(120);
  });

  it('returns null for zero or negative energy', () => {
    expect(computeRate(100, 0, DOLLAR_PER_KWH)).toBeNull();
    expect(computeRate(100, -50, DOLLAR_PER_KWH)).toBeNull();
  });
});

describe('getBucketKey', () => {
  const ts = 1704070860; // some point mid-hour

  it('floors to the hour for hourly grouping', () => {
    const { key, timestamp, label } = getBucketKey(ts, 'hour');
    expect(timestamp).toBe(Math.floor(ts / 3600) * 3600);
    expect(key.split('-').length).toBe(4); // y-m-day-hour
    expect(label).toBeTruthy();
  });

  it('produces distinct keys for distinct days but a shared key within a day', () => {
    const a = getBucketKey(ts, 'day');
    const b = getBucketKey(ts + 1800, 'day'); // +30 min, same day
    const c = getBucketKey(ts + 86400, 'day'); // +1 day
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });

  it('uses a w- prefix and a range label for weekly grouping', () => {
    const { key, label } = getBucketKey(ts, 'week');
    expect(key.startsWith('w-')).toBe(true);
    expect(label).toContain('–');
  });

  it('groups by year-month for monthly grouping', () => {
    const { key, label } = getBucketKey(ts, 'month');
    expect(key.split('-').length).toBe(2);
    expect(label).toBeTruthy();
  });

  it('returns empty descriptors for the none/default group', () => {
    expect(getBucketKey(ts, 'none')).toEqual({ key: '', timestamp: ts, label: '' });
  });
});

describe('buildWeatherLookup', () => {
  const hourly: HourlyWeatherData[] = [
    { timestamp: 3600, temperature: 10 },
    { timestamp: 7200, temperature: 20 },
  ];

  it('returns a null lookup when there is no weather data', () => {
    const lookup = buildWeatherLookup([]);
    expect(lookup(3600)).toBeNull();
  });

  it('returns the exact reading on an hour boundary', () => {
    const lookup = buildWeatherLookup(hourly);
    expect(lookup(3600)).toBe(10);
  });

  it('linearly interpolates between two surrounding hours', () => {
    const lookup = buildWeatherLookup(hourly);
    expect(lookup(5400)).toBe(15); // halfway between 10 and 20
  });

  it('falls back to the floor reading at the trailing edge', () => {
    const lookup = buildWeatherLookup(hourly);
    expect(lookup(7200)).toBe(20);
  });

  it('returns null well outside the data range', () => {
    const lookup = buildWeatherLookup(hourly);
    expect(lookup(100000)).toBeNull();
  });
});

describe('buildRawRow', () => {
  const point: DataPoint = { timestamp: 1704067200, value: 2000, cost: 100000 };
  const timeFmt = new Intl.DateTimeFormat();

  it('only emits enabled columns and converts energy to the chosen unit', () => {
    const row = buildRawRow(
      point,
      new Set(['timestamp', 'value', 'cost']),
      'kWh',
      'C',
      null,
      identity,
      timeFmt,
      DOLLAR_PER_KWH,
    );

    expect(row.timestamp).toBe(1704067200);
    expect(row.energy_kwh).toBe(2); // 2000 Wh → 2 kWh
    expect(row.cost_dollars).toBe(1); // 100000 → $1
    expect(row).not.toHaveProperty('time');
    expect(row).not.toHaveProperty('date');
  });

  it('includes a rate column keyed by the rate unit', () => {
    const row = buildRawRow(
      point,
      new Set(['rate']),
      'Wh',
      'C',
      null,
      identity,
      timeFmt,
      DOLLAR_PER_KWH,
    );
    expect(row[DOLLAR_PER_KWH.columnKey]).toBe(computeRate(point.cost, point.value, DOLLAR_PER_KWH));
  });

  it('emits a temperature column only when a weather lookup is provided', () => {
    const withTemp = buildRawRow(
      point,
      new Set(['temperature']),
      'Wh',
      'C',
      () => 21.4,
      identity,
      timeFmt,
      DOLLAR_PER_KWH,
    );
    expect(withTemp.temperature_c).toBe(21.4);

    const withoutTemp = buildRawRow(
      point,
      new Set(['temperature']),
      'Wh',
      'C',
      null,
      identity,
      timeFmt,
      DOLLAR_PER_KWH,
    );
    expect(withoutTemp).not.toHaveProperty('temperature_c');
  });
});

describe('buildAggRow', () => {
  const bucket: AggBucket = {
    timestamp: 1704067200,
    label: 'Jan 2024',
    energySum: 5000,
    costSum: 250000,
    tempSum: 40,
    tempCount: 2,
    count: 24,
  };

  it('sums energy/cost, averages temperature, and always reports readings', () => {
    const row = buildAggRow(
      bucket,
      new Set(['timestamp', 'date', 'value', 'cost', 'temperature']),
      'kWh',
      'C',
      identity,
      DOLLAR_PER_KWH,
    );

    expect(row.timestamp).toBe(1704067200);
    expect(row.period).toBe('Jan 2024');
    expect(row.energy_kwh).toBe(5); // 5000 Wh → 5 kWh
    expect(row.cost_dollars).toBe(2.5); // 250000 → $2.50
    expect(row.avg_temperature_c).toBe(20); // 40 / 2
    expect(row.readings).toBe(24);
  });

  it('emits a null temperature when the bucket has no temperature samples', () => {
    const row = buildAggRow(
      { ...bucket, tempSum: 0, tempCount: 0 },
      new Set(['temperature']),
      'Wh',
      'C',
      identity,
      DOLLAR_PER_KWH,
    );
    expect(row.avg_temperature_c).toBeNull();
  });
});
