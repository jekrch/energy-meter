/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import {
  formatShortDate,
  formatAxisValue,
  formatDateTimeLocal,
  parseDateTimeLocal,
  toDollars,
  formatCost,
  formatCostAxis,
} from './formatters';

describe('formatShortDate', () => {
  it('includes the day, month, and 2-digit year', () => {
    const out = formatShortDate(new Date(2024, 5, 15)); // Jun 15 2024
    expect(out).toContain('6');
    expect(out).toContain('15');
    expect(out).toContain('24');
    expect(out).not.toContain('2024');
  });
});

describe('formatAxisValue', () => {
  it('renders plain numbers below 1,000', () => {
    expect(formatAxisValue(0)).toBe('0');
    expect(formatAxisValue(500)).toBe('500');
    expect(formatAxisValue(999)).toBe('999');
  });

  it('uses one decimal of K between 1,000 and 9,999', () => {
    expect(formatAxisValue(1000)).toBe('1.0K');
    expect(formatAxisValue(1500)).toBe('1.5K');
  });

  it('drops the decimal of K at or above 10,000', () => {
    expect(formatAxisValue(10000)).toBe('10K');
    expect(formatAxisValue(15000)).toBe('15K');
  });

  it('uses one decimal of M at or above 1,000,000', () => {
    expect(formatAxisValue(1000000)).toBe('1.0M');
    expect(formatAxisValue(2500000)).toBe('2.5M');
  });
});

describe('formatDateTimeLocal / parseDateTimeLocal', () => {
  it('returns an empty string for a null or zero timestamp', () => {
    expect(formatDateTimeLocal(null)).toBe('');
    expect(formatDateTimeLocal(0)).toBe('');
  });

  it('formats a timestamp as a zero-padded local datetime-local string', () => {
    const ts = Math.floor(new Date(2024, 0, 5, 9, 7).getTime() / 1000);
    expect(formatDateTimeLocal(ts)).toBe('2024-01-05T09:07');
  });

  it('parses a datetime-local string back to unix seconds', () => {
    const str = '2024-01-05T09:07';
    const expected = Math.floor(new Date(str).getTime() / 1000);
    expect(parseDateTimeLocal(str)).toBe(expected);
  });

  it('returns null when parsing an empty string', () => {
    expect(parseDateTimeLocal('')).toBeNull();
  });

  it('round-trips through format then parse', () => {
    const ts = Math.floor(new Date(2023, 10, 30, 23, 45).getTime() / 1000);
    expect(parseDateTimeLocal(formatDateTimeLocal(ts))).toBe(ts);
  });
});

describe('toDollars', () => {
  it('divides micro-dollar cost integers by 100,000', () => {
    expect(toDollars(100000)).toBe(1);
    expect(toDollars(250000)).toBe(2.5);
    expect(toDollars(0)).toBe(0);
  });
});

describe('formatCost', () => {
  it('formats as USD currency with two decimals', () => {
    expect(formatCost(100000)).toBe('$1.00');
    expect(formatCost(123456)).toBe('$1.23');
  });

  it('adds thousands separators for large values', () => {
    expect(formatCost(150000000)).toBe('$1,500.00');
  });
});

describe('formatCostAxis', () => {
  it('shows cents below a dollar', () => {
    expect(formatCostAxis(50000)).toBe('50¢'); // $0.50
  });

  it('shows whole dollars between $1 and $1000', () => {
    expect(formatCostAxis(5000000)).toBe('$50');
  });

  it('compacts thousands with a k suffix', () => {
    expect(formatCostAxis(150000000)).toBe('$1.5k'); // $1500
  });
});
