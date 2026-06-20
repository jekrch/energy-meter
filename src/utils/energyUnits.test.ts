/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import {
  convertEnergy,
  formatEnergyValue,
  formatEnergyAxis,
  suggestUnit,
} from './energyUnits';

describe('convertEnergy', () => {
  it('leaves Wh unchanged', () => {
    expect(convertEnergy(1500, 'Wh')).toBe(1500);
  });
  it('divides by 1,000 for kWh', () => {
    expect(convertEnergy(1500, 'kWh')).toBe(1.5);
  });
  it('divides by 1,000,000 for MWh', () => {
    expect(convertEnergy(2500000, 'MWh')).toBe(2.5);
  });
});

describe('formatEnergyValue', () => {
  it('rounds and groups Wh with no decimals', () => {
    expect(formatEnergyValue(1500.6, 'Wh')).toBe('1,501');
  });
  it('uses one decimal for kWh by default', () => {
    expect(formatEnergyValue(1500, 'kWh')).toBe('1.5');
  });
  it('uses two decimals for MWh by default', () => {
    expect(formatEnergyValue(1500000, 'MWh')).toBe('1.50');
  });
  it('respects an explicit decimals override', () => {
    expect(formatEnergyValue(1500, 'kWh', 3)).toBe('1.500');
  });
});

describe('formatEnergyAxis', () => {
  it('formats MWh to one decimal', () => {
    expect(formatEnergyAxis(2500000, 'MWh')).toBe('2.5');
  });

  it('formats kWh as whole numbers below 1,000', () => {
    expect(formatEnergyAxis(500000, 'kWh')).toBe('500');
  });
  it('compacts kWh at or above 1,000 with a k suffix', () => {
    expect(formatEnergyAxis(1500000, 'kWh')).toBe('1.5k'); // 1500 kWh
  });

  it('formats small Wh as whole numbers', () => {
    expect(formatEnergyAxis(500, 'Wh')).toBe('500');
  });
  it('compacts Wh thousands with a k suffix', () => {
    expect(formatEnergyAxis(1500, 'Wh')).toBe('2k'); // toFixed(0) of 1.5
  });
  it('compacts Wh millions with an M suffix', () => {
    expect(formatEnergyAxis(2500000, 'Wh')).toBe('2.5M');
  });
});

describe('suggestUnit', () => {
  it('suggests Wh for small values', () => {
    expect(suggestUnit(0)).toBe('Wh');
    expect(suggestUnit(9999)).toBe('Wh');
  });
  it('suggests kWh at or above 10,000 Wh', () => {
    expect(suggestUnit(10000)).toBe('kWh');
    expect(suggestUnit(999999)).toBe('kWh');
  });
  it('suggests MWh at or above 1,000,000 Wh', () => {
    expect(suggestUnit(1000000)).toBe('MWh');
  });
});
