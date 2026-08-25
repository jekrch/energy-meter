/// <reference types="bun-types" />
import '../test/happyDom';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  datasetNativeOptions, downloadDatasetFile, downloadNativeFile, serializeNativeFile,
  tryParseNativeJson, NATIVE_FORMAT,
} from './nativeFormat';
import { parseGreenButtonFile } from './dataUtils';
import type { DataPoint, PeakSchedule } from '../types';

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

describe('native format — peak schedule (v2)', () => {
  const schedule: PeakSchedule = {
    version: 1,
    periods: [{
      id: 'p1',
      name: 'On-Peak',
      colorKey: 'red',
      rules: [{ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [1, 2, 3, 4, 5], months: [5, 6, 7, 8] }],
    }],
    observeHolidays: true,
    holidayRules: ['independence', 'christmas'],
    extraHolidays: ['2025-08-06'],
    label: 'Test tariff',
  };

  const opts = { fileName: 'x', resolution: 'RAW', sources: [] };

  it('writes version 2 and round-trips the schedule', () => {
    const json = serializeNativeFile(sample, { ...opts, peakSchedule: schedule });
    expect(JSON.parse(json).version).toBe(2);
    expect(tryParseNativeJson(json)!.peakSchedule).toEqual(schedule);
  });

  it('omits the field entirely when there is no schedule', () => {
    const json = serializeNativeFile(sample, opts);
    expect('peakSchedule' in JSON.parse(json)).toBe(false);
    expect(tryParseNativeJson(json)!.peakSchedule).toBeUndefined();
  });

  it('reads a v1 file — no schedule, and the data still parses', () => {
    const v1 = JSON.stringify({
      format: NATIVE_FORMAT,
      version: 1,
      fileName: 'old',
      createdAt: 0,
      resolution: 'RAW',
      sources: [],
      data: sample.map((d) => ({ t: d.timestamp, v: d.value, c: d.cost, d: d.duration })),
    });
    const parsed = tryParseNativeJson(v1)!;
    expect(parsed.peakSchedule).toBeUndefined();
    expect(parsed.blocks[0].data).toEqual(sample);
  });

  it('tolerates an unknown extra field alongside the schedule', () => {
    const withExtra = JSON.parse(serializeNativeFile(sample, { ...opts, peakSchedule: schedule }));
    withExtra.somethingNewer = { nested: true };
    const parsed = tryParseNativeJson(JSON.stringify(withExtra))!;
    expect(parsed.peakSchedule).toEqual(schedule);
    expect(parsed.blocks[0].data).toEqual(sample);
  });

  it('drops a malformed schedule without failing the data load', () => {
    const broken = JSON.parse(serializeNativeFile(sample, opts));
    broken.peakSchedule = { version: 1, periods: [{ id: 'p', name: 'x', colorKey: 'chartreuse', rules: [] }] };
    const parsed = tryParseNativeJson(JSON.stringify(broken))!;
    expect(parsed.peakSchedule).toBeUndefined();
    expect(parsed.blocks[0].data).toEqual(sample);
  });

  it('survives the full upload dispatch path', () => {
    const json = serializeNativeFile(sample, { ...opts, peakSchedule: schedule });
    expect(parseGreenButtonFile(json).peakSchedule).toEqual(schedule);
  });
});

describe('datasetNativeOptions', () => {
  const schedule: PeakSchedule = {
    version: 1,
    periods: [{
      id: 'p1',
      name: 'On-Peak',
      colorKey: 'red',
      rules: [{ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [1, 2, 3, 4, 5], months: [] }],
    }],
    observeHolidays: true,
    holidayRules: [],
    extraHolidays: [],
  };

  it('describes the dataset as one source spanning its readings', () => {
    const opts = datasetNativeOptions(sample, { fileName: 'meter.csv', resolution: 'RAW' });
    expect(opts.fileName).toBe('meter');
    expect(opts.sources).toEqual([{
      fileName: 'meter',
      startDate: sample[0].timestamp,
      endDate: sample[sample.length - 1].timestamp,
      recordCount: sample.length,
    }]);
  });

  it('falls back to a default name when there is no file name', () => {
    expect(datasetNativeOptions(sample, { fileName: null, resolution: 'RAW' }).fileName).toBe('energy-data');
    expect(datasetNativeOptions(sample, { resolution: 'RAW' }).fileName).toBe('energy-data');
  });

  it('carries the schedule into a file that re-parses with it', () => {
    const opts = datasetNativeOptions(sample, { fileName: 'meter.json', resolution: 'RAW', peakSchedule: schedule });
    expect(tryParseNativeJson(serializeNativeFile(sample, opts))!.peakSchedule).toEqual(schedule);
  });
});


// The download helpers reach for Blob / object URLs / a click on a detached
// anchor. happy-dom supplies the DOM; the URL pair and the click are recorded
// so the assertions can see the file name and the bytes that would be saved.
describe('downloadNativeFile', () => {
  let created: Blob[] = [];
  let revoked: string[] = [];
  let clicks: { download: string; href: string }[] = [];
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const realClick = HTMLAnchorElement.prototype.click;

  beforeEach(() => {
    created = []; revoked = []; clicks = [];
    URL.createObjectURL = ((b: Blob) => {
      created.push(b);
      return `blob:stub/${created.length - 1}`;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((u: string) => { revoked.push(u); }) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href });
    };
  });

  afterEach(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    HTMLAnchorElement.prototype.click = realClick;
    document.body.innerHTML = '';
  });

  const opts = () => datasetNativeOptions(sample, { fileName: 'meter.csv', resolution: 'RAW' });

  it('saves a JSON blob', async () => {
    downloadNativeFile(sample, opts());
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('application/json');
  });

  it('writes bytes that parse back as the same dataset', async () => {
    downloadNativeFile(sample, opts());
    const parsed = tryParseNativeJson(await created[0].text())!;
    expect(parsed.blocks[0].data).toEqual(sample);
    expect(JSON.parse(await created[0].text()).format).toBe(NATIVE_FORMAT);
  });

  it('defaults to a merged-prefixed name derived from the options', () => {
    downloadNativeFile(sample, opts());
    expect(clicks[0].download).toBe('energy-merged-meter.json');
  });

  it('honours an explicit download name', () => {
    downloadNativeFile(sample, opts(), 'my-export.json');
    expect(clicks[0].download).toBe('my-export.json');
  });

  it('sanitizes a name carrying path separators', () => {
    const o = datasetNativeOptions(sample, { fileName: 'a/b:c*d.csv', resolution: 'RAW' });
    downloadNativeFile(sample, o);
    expect(clicks[0].download).not.toMatch(/[/:*]/);
  });

  it('cleans up the object URL and the anchor', () => {
    downloadNativeFile(sample, opts());
    expect(revoked).toEqual([clicks[0].href]);
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('downloadDatasetFile', () => {
  const savedSchedule: PeakSchedule = {
    version: 1,
    periods: [{
      id: 'p1', name: 'On-Peak', colorKey: 'red',
      rules: [{ hourRanges: [{ start: 14, end: 18 }], daysOfWeek: [1, 2, 3, 4, 5], months: [] }],
    }],
    observeHolidays: true,
    holidayRules: [],
    extraHolidays: [],
  };

  let created: Blob[] = [];
  let clicks: string[] = [];
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const realClick = HTMLAnchorElement.prototype.click;

  beforeEach(() => {
    created = []; clicks = [];
    URL.createObjectURL = ((b: Blob) => { created.push(b); return 'blob:stub'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
  });

  afterEach(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    HTMLAnchorElement.prototype.click = realClick;
    document.body.innerHTML = '';
  });

  it('names the file after the dataset, without the merged prefix', () => {
    downloadDatasetFile(sample, { fileName: 'meter.csv', resolution: 'RAW' });
    expect(clicks).toEqual(['energy-meter.json']);
  });

  it('falls back to a generic name when the dataset is untitled', () => {
    downloadDatasetFile(sample, { fileName: null, resolution: 'RAW' });
    expect(clicks).toEqual(['energy-energy-data.json']);
  });

  it('carries the peak schedule into the saved file', async () => {
    downloadDatasetFile(sample, { fileName: 'meter.csv', resolution: 'RAW', peakSchedule: savedSchedule });
    expect(tryParseNativeJson(await created[0].text())!.peakSchedule).toEqual(savedSchedule);
  });

  it('no-ops on an empty dataset rather than saving an empty file', () => {
    downloadDatasetFile([], { fileName: 'meter.csv', resolution: 'RAW' });
    expect(created).toHaveLength(0);
    expect(clicks).toHaveLength(0);
  });
});
