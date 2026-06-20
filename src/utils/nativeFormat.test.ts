/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { serializeNativeFile, tryParseNativeJson, NATIVE_FORMAT } from './nativeFormat';
import { parseGreenButtonFile } from './dataUtils';
import type { DataPoint } from '../types';

const sample: DataPoint[] = [
  { timestamp: 1735689600, value: 412, cost: 5100, duration: 900 },
  { timestamp: 1735690500, value: 388, cost: 4800, duration: 900 },
  { timestamp: 1735691400, value: 401, cost: 4950, duration: 900 },
];

describe('native format round-trip', () => {
  it('serializes and re-parses DataPoint[] losslessly', () => {
    const json = serializeNativeFile(sample, {
      fileName: 'merged',
      resolution: 'RAW',
      sources: [{ fileName: 'a.xml', startDate: 1735689600, endDate: 1735691400, recordCount: 3 }],
    });
    const parsed = tryParseNativeJson(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.blocks).toHaveLength(1);

    const data = parsed!.blocks[0].data;
    expect(data).toEqual(sample);
  });

  it('writes the magic format string', () => {
    const json = serializeNativeFile(sample, { fileName: 'x', resolution: 'RAW', sources: [] });
    expect(JSON.parse(json).format).toBe(NATIVE_FORMAT);
  });

  it('computes block meta totals', () => {
    const json = serializeNativeFile(sample, { fileName: 'x', resolution: 'RAW', sources: [] });
    const meta = tryParseNativeJson(json)!.blocks[0].meta;
    expect(meta.readingCount).toBe(3);
    expect(meta.totalValue).toBe(412 + 388 + 401);
    expect(meta.totalCost).toBe(5100 + 4800 + 4950);
    expect(meta.startTimestamp).toBe(1735689600);
    expect(meta.endTimestamp).toBe(1735691400);
  });

  it('preserves points whose duration is absent', () => {
    const noDuration: DataPoint[] = [{ timestamp: 1000, value: 10, cost: 120 }];
    const json = serializeNativeFile(noDuration, { fileName: 'x', resolution: 'RAW', sources: [] });
    const data = tryParseNativeJson(json)!.blocks[0].data;
    expect(data[0].duration).toBeUndefined();
  });
});

describe('tryParseNativeJson rejection', () => {
  it('returns null for non-native JSON', () => {
    expect(tryParseNativeJson('{"foo": "bar"}')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(tryParseNativeJson('{ not json')).toBeNull();
  });

  it('returns null when data is empty or missing', () => {
    expect(tryParseNativeJson(JSON.stringify({ format: NATIVE_FORMAT, data: [] }))).toBeNull();
    expect(tryParseNativeJson(JSON.stringify({ format: NATIVE_FORMAT }))).toBeNull();
  });
});

describe('parser dispatch', () => {
  it('routes a native JSON file to the native parser', () => {
    const json = serializeNativeFile(sample, { fileName: 'x', resolution: 'RAW', sources: [] });
    const result = parseGreenButtonFile(json);
    expect(result.blocks[0].data).toEqual(sample);
  });

  it('falls through to CSV for a non-native JSON object without throwing on valid CSV', () => {
    // A plain object that is not our format must not be claimed by the native
    // parser; here we pass actual CSV to confirm the CSV branch still runs.
    const csv = 'Date,Time,Usage (kWh)\n2026-01-01,00:00,1.5\n2026-01-01,01:00,2.0\n';
    const result = parseGreenButtonFile(csv);
    expect(result.blocks[0].data.length).toBeGreaterThan(0);
  });
});
