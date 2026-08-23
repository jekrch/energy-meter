/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { buildDefaultColumns, deriveEffectiveColumns } from './exportColumns';
import type { ExportColumn } from './exportConstants';

const keys = (cols: ExportColumn[]) => cols.map((c) => c.key);
const find = (cols: ExportColumn[], key: string) => cols.find((c) => c.key === key);

describe('buildDefaultColumns — peak period', () => {
  it('is absent when no schedule is loaded', () => {
    expect(keys(buildDefaultColumns('kWh', false, 'F'))).not.toContain('peakPeriod');
  });

  it('is offered, but off by default, once a schedule exists', () => {
    const cols = buildDefaultColumns('kWh', false, 'F', true);
    expect(find(cols, 'peakPeriod')).toMatchObject({ enabled: false, category: 'derived' });
  });

  it('sorts before the rate column, which stays last', () => {
    const ordered = keys(deriveEffectiveColumns(
      buildDefaultColumns('kWh', true, 'F', true), 'none', '$/kWh', 'F',
    ));
    expect(ordered.indexOf('peakPeriod')).toBeLessThan(ordered.indexOf('rate'));
    expect(ordered[ordered.length - 1]).toBe('rate');
  });
});

describe('deriveEffectiveColumns — peak period under grouping', () => {
  const withSchedule = () =>
    buildDefaultColumns('kWh', false, 'F', true).map((c) =>
      c.key === 'peakPeriod' ? { ...c, enabled: true } : c);

  it('stays enabled for ungrouped rows', () => {
    expect(find(deriveEffectiveColumns(withSchedule(), 'none', '$/kWh', 'F'), 'peakPeriod')!.enabled).toBe(true);
  });

  it('is disabled once rows are aggregated, since a bucket spans several periods', () => {
    for (const groupBy of ['day', 'month'] as const) {
      expect(find(deriveEffectiveColumns(withSchedule(), groupBy, '$/kWh', 'F'), 'peakPeriod')!.enabled).toBe(false);
    }
  });
});
