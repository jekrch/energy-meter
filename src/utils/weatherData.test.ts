/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { aggregateWeatherData, type HourlyWeatherData } from './weatherData';

// Build an hourly reading from a local wall-clock time so bucket boundaries
// (which use local getFullYear/getMonth/getDate) line up with assertions.
const reading = (
  y: number, mo: number, d: number, h: number, temperature: number,
): HourlyWeatherData => ({
  timestamp: Math.floor(new Date(y, mo, d, h).getTime() / 1000),
  temperature,
});

const dayTs = (y: number, mo: number, d: number) =>
  new Date(y, mo, d).getTime() / 1000;
const monthTs = (y: number, mo: number) =>
  new Date(y, mo, 1).getTime() / 1000;

describe('aggregateWeatherData', () => {
  it('returns an empty map for no data', () => {
    expect(aggregateWeatherData([], 'daily').size).toBe(0);
  });

  it('keeps each hour as its own bucket at hourly resolution', () => {
    const data = [
      reading(2024, 0, 1, 0, 10),
      reading(2024, 0, 1, 1, 20),
    ];
    const result = aggregateWeatherData(data, 'hourly');
    expect(result.size).toBe(2);
    expect(result.get(data[0].timestamp)).toBe(10);
    expect(result.get(data[1].timestamp)).toBe(20);
  });

  it('averages readings within the same day', () => {
    const data = [
      reading(2024, 0, 1, 0, 10),
      reading(2024, 0, 1, 12, 20),
      reading(2024, 0, 2, 6, 30),
    ];
    const result = aggregateWeatherData(data, 'daily');
    expect(result.size).toBe(2);
    expect(result.get(dayTs(2024, 0, 1))).toBe(15); // (10 + 20) / 2
    expect(result.get(dayTs(2024, 0, 2))).toBe(30);
  });

  it('averages readings within the same month', () => {
    const data = [
      reading(2024, 0, 1, 0, 10),
      reading(2024, 0, 15, 0, 30),
      reading(2024, 1, 1, 0, 5),
    ];
    const result = aggregateWeatherData(data, 'monthly');
    expect(result.size).toBe(2);
    expect(result.get(monthTs(2024, 0))).toBe(20); // (10 + 30) / 2
    expect(result.get(monthTs(2024, 1))).toBe(5);
  });

  it('handles negative temperatures in the average', () => {
    const data = [
      reading(2024, 0, 1, 0, -10),
      reading(2024, 0, 1, 12, 10),
    ];
    const result = aggregateWeatherData(data, 'daily');
    expect(result.get(dayTs(2024, 0, 1))).toBe(0);
  });
});
