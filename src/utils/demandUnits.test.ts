/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { toDemandKW, formatDemandValue, formatDemandAxis, DEFAULT_INTERVAL_SECONDS } from './demandUnits';

describe('toDemandKW', () => {
  it('converts a 15-min reading as ×4 ÷1000', () => {
    // 1000 Wh over 900s (0.25h) = 4000 W = 4 kW
    expect(toDemandKW(1000, 900)).toBe(4);
  });

  it('converts an hourly reading as ×1 ÷1000', () => {
    // 1500 Wh over 3600s (1h) = 1500 W = 1.5 kW
    expect(toDemandKW(1500, 3600)).toBe(1.5);
  });

  it('falls back to the default interval when duration is missing', () => {
    expect(toDemandKW(2000)).toBe(toDemandKW(2000, DEFAULT_INTERVAL_SECONDS));
    expect(toDemandKW(2000)).toBe(2); // 2000 Wh / 1h / 1000
  });

  it('returns 0 for a zero or negative duration', () => {
    expect(toDemandKW(1000, 0)).toBe(0);
    expect(toDemandKW(1000, -100)).toBe(0);
  });
});

describe('formatDemandValue', () => {
  it('formats to one decimal by default', () => {
    expect(formatDemandValue(4)).toBe('4.0');
    expect(formatDemandValue(12.34)).toBe('12.3');
  });
});

describe('formatDemandAxis', () => {
  it('shows one decimal under 100 kW', () => {
    expect(formatDemandAxis(4.2)).toBe('4.2');
  });
  it('drops decimals between 100 and 1000 kW', () => {
    expect(formatDemandAxis(250)).toBe('250');
  });
  it('compacts thousands with a k suffix', () => {
    expect(formatDemandAxis(1500)).toBe('1.5k');
  });
});
