/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { computeRankings } from './rankings';
import type { DataPoint } from '../types';
import type { HourlyWeatherData } from './weatherData';

// Build a DataPoint at a local date/time. duration defaults to one hour.
function point(
  y: number, mo: number, d: number, h: number,
  value: number, cost: number, duration = 3600,
): DataPoint {
  return { timestamp: new Date(y, mo, d, h).getTime() / 1000, value, cost, duration };
}

describe('computeRankings — energy/cost/demand', () => {
  const data: DataPoint[] = [
    // Jan 1: two hourly readings
    point(2024, 0, 1, 0, 100, 10),
    point(2024, 0, 1, 1, 300, 30),
    // Jan 2: one big reading
    point(2024, 0, 2, 12, 1000, 5),
  ];

  it('ranks days by summed energy, highest first', () => {
    const r = computeRankings(data, [], 'day', 'energy');
    expect(r.map((e) => e.value)).toEqual([1000, 400]);
    expect(r[0].periodStart).toBe(new Date(2024, 0, 2).getTime() / 1000);
  });

  it('ranks days by summed cost', () => {
    const r = computeRankings(data, [], 'day', 'cost');
    // Jan 1 cost = 40, Jan 2 cost = 5
    expect(r.map((e) => e.value)).toEqual([40, 5]);
  });

  it('ranks hours as individual buckets', () => {
    const r = computeRankings(data, [], 'hour', 'energy');
    expect(r.map((e) => e.value)).toEqual([1000, 300, 100]);
  });

  it('uses peak demand within a bucket for the demand metric', () => {
    const dem: DataPoint[] = [
      point(2024, 0, 1, 0, 1000, 0, 900), // 1000Wh / 0.25h = 4 kW
      point(2024, 0, 1, 1, 1000, 0, 3600), // 1 kW
    ];
    const r = computeRankings(dem, [], 'day', 'demand');
    expect(r[0].value).toBe(4); // peak, not sum
  });

  it('honours the limit', () => {
    const many: DataPoint[] = Array.from({ length: 30 }, (_, i) =>
      point(2024, 0, 1 + i, 0, i + 1, 0),
    );
    expect(computeRankings(many, [], 'day', 'energy', 20)).toHaveLength(20);
  });

  it('groups by calendar week (Sunday start)', () => {
    // 2024-01-01 is a Monday; week start is Sun 2023-12-31.
    const r = computeRankings([point(2024, 0, 1, 0, 50, 0)], [], 'week', 'energy');
    expect(r[0].periodStart).toBe(new Date(2023, 11, 31).getTime() / 1000);
  });
});

describe('computeRankings — heat/cold', () => {
  const weather: HourlyWeatherData[] = [
    { timestamp: new Date(2024, 0, 1, 0).getTime() / 1000, temperature: 10 },
    { timestamp: new Date(2024, 0, 1, 1).getTime() / 1000, temperature: 20 }, // Jan 1 avg 15
    { timestamp: new Date(2024, 0, 2, 0).getTime() / 1000, temperature: 0 },  // Jan 2 avg 0
  ];

  it('ranks hottest days first for heat', () => {
    const r = computeRankings([], weather, 'day', 'heat');
    expect(r.map((e) => e.value)).toEqual([15, 0]);
  });

  it('ranks coldest days first for cold', () => {
    const r = computeRankings([], weather, 'day', 'cold');
    expect(r.map((e) => e.value)).toEqual([0, 15]);
  });
});
