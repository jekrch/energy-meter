/// <reference types="bun-types" />
import { describe, it, expect, beforeAll } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { readFileSync } from 'node:fs';
import {
  downsampleLTTB,
  processDataAsync,
  parseGreenButtonXML,
  createBrushData,
  detectRateChanges,
  formatRate
} from './dataUtils';
import type { DataPoint } from '../types';

// Load a fixture file from the repo-root /fixtures dir relative to this test.
const loadFixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf-8');

// Register browser APIs (DOMParser, etc.)
GlobalRegistrator.register();

// Mock requestAnimationFrame for Node/Bun environment
beforeAll(() => {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    setTimeout(() => cb(performance.now()), 0);
    return 0;
  };
});

// Helper to create test data points
const createDataPoints = (count: number, startTimestamp = 1000000): DataPoint[] =>
  Array.from({ length: count }, (_, i) => ({
    timestamp: startTimestamp + i * 3600,
    value: Math.floor(Math.random() * 1000) + 100,
    cost: Math.floor(Math.random() * 500)
  }));

describe('downsampleLTTB', () => {
  it('returns original data when below threshold', () => {
    const data = createDataPoints(5);
    const result = downsampleLTTB(data, 10);
    expect(result).toEqual(data);
  });

  it('returns original data when exactly at threshold', () => {
    const data = createDataPoints(10);
    const result = downsampleLTTB(data, 10);
    expect(result).toEqual(data);
  });

  it('downsamples data to threshold size', () => {
    const data = createDataPoints(100);
    const result = downsampleLTTB(data, 20);
    expect(result.length).toBe(20);
  });

  it('preserves first and last points', () => {
    const data = createDataPoints(100);
    const result = downsampleLTTB(data, 20);
    expect(result[0]).toEqual(data[0]);
    expect(result[result.length - 1]).toEqual(data[data.length - 1]);
  });

  it('preserves cost data in downsampled points', () => {
    const data = createDataPoints(100);
    const result = downsampleLTTB(data, 20);
    result.forEach(point => {
      expect(point.cost).toBeDefined();
      expect(typeof point.cost).toBe('number');
    });
  });

  it('handles empty array', () => {
    const result = downsampleLTTB([], 10);
    expect(result).toEqual([]);
  });

  it('handles single point', () => {
    const data = createDataPoints(1);
    const result = downsampleLTTB(data, 10);
    expect(result).toEqual(data);
  });

  it('handles two points', () => {
    const data = createDataPoints(2);
    const result = downsampleLTTB(data, 10);
    expect(result).toEqual(data);
  });
});

describe('processDataAsync', () => {
  it('resolves empty array for empty input', async () => {
    const result = await processDataAsync([], 'RAW');
    expect(result).toEqual([]);
  });

  it('processes RAW resolution with date formatting', async () => {
    const data = createDataPoints(5);
    const result = await processDataAsync(data, 'RAW');

    expect(result.length).toBe(5);
    result.forEach(point => {
      expect(point.date).toBeDefined();
      expect(point.time).toBeDefined();
      expect(point.fullDate).toBeDefined();
    });
  });

  it('aggregates data for HOURLY resolution', async () => {
    // Create data with multiple points per hour
    const baseTimestamp = 1704067200; // 2024-01-01 00:00:00 UTC
    const data: DataPoint[] = [
      { timestamp: baseTimestamp, value: 100, cost: 10 },
      { timestamp: baseTimestamp + 1800, value: 150, cost: 15 }, // +30 min
      { timestamp: baseTimestamp + 3600, value: 200, cost: 20 }, // +1 hour
      { timestamp: baseTimestamp + 5400, value: 250, cost: 25 }  // +1.5 hours
    ];

    const result = await processDataAsync(data, 'HOURLY');

    // Should aggregate into 2 hourly buckets
    expect(result.length).toBe(2);
    expect(result[0].value).toBe(250); // 100 + 150
    expect(result[0].cost).toBe(25);   // 10 + 15
    expect(result[1].value).toBe(450); // 200 + 250
    expect(result[1].cost).toBe(45);   // 20 + 25
  });

  it('aggregates data for DAILY resolution', async () => {
    const baseTimestamp = 1704067200; // 2024-01-01 00:00:00 UTC
    const data: DataPoint[] = [
      { timestamp: baseTimestamp, value: 100, cost: 10 },
      { timestamp: baseTimestamp + 43200, value: 200, cost: 20 },      // +12 hours
      { timestamp: baseTimestamp + 86400, value: 300, cost: 30 },      // +1 day
      { timestamp: baseTimestamp + 86400 + 3600, value: 400, cost: 40 } // +1 day 1 hour
    ];

    const result = await processDataAsync(data, 'DAILY');

    expect(result.length).toBe(2);
    expect(result[0].value).toBe(300); // 100 + 200
    expect(result[0].cost).toBe(30);
    expect(result[1].value).toBe(700); // 300 + 400
    expect(result[1].cost).toBe(70);
  });

  it('populates per-reading demand (kW) on RAW points', async () => {
    const baseTimestamp = 1704067200;
    const data: DataPoint[] = [
      { timestamp: baseTimestamp, value: 1000, cost: 10, duration: 900 },   // 15-min → ×4 → 4 kW
      { timestamp: baseTimestamp + 900, value: 1500, cost: 15, duration: 3600 }, // hourly → ×1 → 1.5 kW
    ];

    const result = await processDataAsync(data, 'RAW');
    expect(result[0].demand).toBe(4);
    expect(result[1].demand).toBe(1.5);
  });

  it('aggregates demand as the bucket PEAK, not the sum', async () => {
    const baseTimestamp = 1704067200; // 2024-01-01 00:00:00 UTC
    const data: DataPoint[] = [
      { timestamp: baseTimestamp, value: 1000, cost: 10, duration: 900 },        // 4 kW
      { timestamp: baseTimestamp + 900, value: 2000, cost: 20, duration: 900 },  // 8 kW (peak)
      { timestamp: baseTimestamp + 1800, value: 500, cost: 5, duration: 900 },   // 2 kW
    ];

    const result = await processDataAsync(data, 'HOURLY');
    expect(result.length).toBe(1);
    // energy still sums…
    expect(result[0].value).toBe(3500);
    // …but demand is the single highest interval, never 4+8+2.
    expect(result[0].demand).toBe(8);
  });

  it('sorts aggregated results chronologically', async () => {
    const baseTimestamp = 1704067200;
    const data: DataPoint[] = [
      { timestamp: baseTimestamp + 7200, value: 100, cost: 10 },
      { timestamp: baseTimestamp, value: 200, cost: 20 },
      { timestamp: baseTimestamp + 3600, value: 300, cost: 30 }
    ];

    const result = await processDataAsync(data, 'HOURLY');

    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp).toBeGreaterThan(result[i - 1].timestamp);
    }
  });
});

describe('parseGreenButtonXML', () => {
  const validXML = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <content>
          <IntervalBlock>
            <IntervalReading>
              <timePeriod>
                <start>1704067200</start>
                <duration>3600</duration>
              </timePeriod>
              <value>1500</value>
              <cost>180</cost>
            </IntervalReading>
            <IntervalReading>
              <timePeriod>
                <start>1704070800</start>
                <duration>3600</duration>
              </timePeriod>
              <value>2000</value>
              <cost>240</cost>
            </IntervalReading>
          </IntervalBlock>
        </content>
      </entry>
    </feed>`;

  it('parses valid Green Button XML', () => {
    const { blocks } = parseGreenButtonXML(validXML);

    expect(blocks.length).toBe(1);
    const data = blocks[0].data;
    expect(data.length).toBe(2);
    expect(data[0].timestamp).toBe(1704067200);
    expect(data[0].value).toBe(1500);
    expect(data[0].cost).toBe(180);
    expect(data[0].duration).toBe(3600);
    expect(blocks[0].meta.readingCount).toBe(2);
    expect(blocks[0].meta.totalValue).toBe(3500);
    expect(blocks[0].meta.totalCost).toBe(420);
  });

  it('sorts results by timestamp', () => {
    const unsortedXML = `<?xml version="1.0"?>
      <feed>
        <IntervalReading>
          <timePeriod><start>1704070800</start></timePeriod>
          <value>200</value>
          <cost>20</cost>
        </IntervalReading>
        <IntervalReading>
          <timePeriod><start>1704067200</start></timePeriod>
          <value>100</value>
          <cost>10</cost>
        </IntervalReading>
      </feed>`;

    const { blocks } = parseGreenButtonXML(unsortedXML);
    const data = blocks[0].data;

    expect(data[0].timestamp).toBe(1704067200);
    expect(data[1].timestamp).toBe(1704070800);
  });

  it('throws on invalid XML', () => {
    expect(() => parseGreenButtonXML('<invalid><unclosed>')).toThrow();
  });

  it('throws when no IntervalReading elements found', () => {
    const emptyXML = '<?xml version="1.0"?><feed></feed>';
    expect(() => parseGreenButtonXML(emptyXML)).toThrow('No IntervalReading data found');
  });

  it('handles missing optional fields gracefully', () => {
    const minimalXML = `<?xml version="1.0"?>
      <feed>
        <IntervalReading>
          <timePeriod><start>1704067200</start></timePeriod>
          <value>1000</value>
        </IntervalReading>
      </feed>`;

    const { blocks } = parseGreenButtonXML(minimalXML);
    const data = blocks[0].data;

    expect(data[0].timestamp).toBe(1704067200);
    expect(data[0].value).toBe(1000);
    expect(data[0].cost).toBe(0);
    expect(data[0].duration).toBeUndefined();
  });

  it('handles namespaced XML elements', () => {
    // Real Green Button XML uses default namespace, not prefix
    const namespacedXML = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <content>
            <IntervalBlock xmlns="http://naesb.org/espi">
              <IntervalReading>
                <timePeriod>
                  <start>1704067200</start>
                  <duration>3600</duration>
                </timePeriod>
                <value>500</value>
                <cost>60</cost>
              </IntervalReading>
            </IntervalBlock>
          </content>
        </entry>
      </feed>`;

    const { blocks } = parseGreenButtonXML(namespacedXML);
    expect(blocks.length).toBe(1);
    expect(blocks[0].data.length).toBe(1);
    expect(blocks[0].data[0].value).toBe(500);
  });

  it('separates multiple IntervalBlocks (e.g. delivered + received for solar)', () => {
    const multiBlockXML = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <link rel="self" href="/ReadingType/1"/>
          <content>
            <ReadingType xmlns="http://naesb.org/espi">
              <flowDirection>1</flowDirection>
              <uom>72</uom>
              <powerOfTenMultiplier>0</powerOfTenMultiplier>
              <commodity>1</commodity>
            </ReadingType>
          </content>
        </entry>
        <entry>
          <link rel="self" href="/ReadingType/19"/>
          <content>
            <ReadingType xmlns="http://naesb.org/espi">
              <flowDirection>19</flowDirection>
              <uom>72</uom>
              <powerOfTenMultiplier>0</powerOfTenMultiplier>
              <commodity>1</commodity>
            </ReadingType>
          </content>
        </entry>
        <entry>
          <link rel="self" href="/IntervalBlock/A"/>
          <link rel="related" href="/ReadingType/1"/>
          <content>
            <IntervalBlock xmlns="http://naesb.org/espi">
              <IntervalReading>
                <timePeriod><start>1704067200</start><duration>3600</duration></timePeriod>
                <value>1000</value>
                <cost>120</cost>
              </IntervalReading>
              <IntervalReading>
                <timePeriod><start>1704070800</start><duration>3600</duration></timePeriod>
                <value>2000</value>
                <cost>240</cost>
              </IntervalReading>
            </IntervalBlock>
          </content>
        </entry>
        <entry>
          <link rel="self" href="/IntervalBlock/B"/>
          <link rel="related" href="/ReadingType/19"/>
          <content>
            <IntervalBlock xmlns="http://naesb.org/espi">
              <IntervalReading>
                <timePeriod><start>1704067200</start><duration>3600</duration></timePeriod>
                <value>500</value>
                <cost>0</cost>
              </IntervalReading>
            </IntervalBlock>
          </content>
        </entry>
      </feed>`;

    const { blocks } = parseGreenButtonXML(multiBlockXML);

    expect(blocks.length).toBe(2);

    // Block A — forward/delivered
    const delivered = blocks.find(b => b.meta.flowDirection === 1);
    expect(delivered).toBeDefined();
    expect(delivered!.data.length).toBe(2);
    expect(delivered!.meta.totalValue).toBe(3000);
    expect(delivered!.meta.flowDirectionLabel).toContain('Forward');

    // Block B — reverse/received
    const received = blocks.find(b => b.meta.flowDirection === 19);
    expect(received).toBeDefined();
    expect(received!.data.length).toBe(1);
    expect(received!.meta.totalValue).toBe(500);
    expect(received!.meta.flowDirectionLabel).toContain('Reverse');
  });

  it('applies powerOfTenMultiplier from ReadingType', () => {
    const scaledXML = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <link rel="self" href="/ReadingType/1"/>
          <content>
            <ReadingType xmlns="http://naesb.org/espi">
              <flowDirection>1</flowDirection>
              <uom>72</uom>
              <powerOfTenMultiplier>3</powerOfTenMultiplier>
            </ReadingType>
          </content>
        </entry>
        <entry>
          <link rel="related" href="/ReadingType/1"/>
          <content>
            <IntervalBlock xmlns="http://naesb.org/espi">
              <IntervalReading>
                <timePeriod><start>1704067200</start></timePeriod>
                <value>2</value>
                <cost>0</cost>
              </IntervalReading>
            </IntervalBlock>
          </content>
        </entry>
      </feed>`;

    const { blocks } = parseGreenButtonXML(scaledXML);
    // value 2 * 10^3 = 2000
    expect(blocks[0].data[0].value).toBe(2000);
    expect(blocks[0].meta.powerOfTenMultiplier).toBe(3);
  });
});

describe('createBrushData', () => {
  it('returns empty array for empty input', () => {
    const result = createBrushData([]);
    expect(result).toEqual([]);
  });

  it('returns all points when below maxPoints', () => {
    const data = createDataPoints(50);
    const result = createBrushData(data, 200);

    expect(result.length).toBe(50);
    result.forEach((point, i) => {
      expect(point.timestamp).toBe(data[i].timestamp);
      expect(point.value).toBe(data[i].value);
    });
  });

  it('downsamples to maxPoints when data exceeds threshold', () => {
    const data = createDataPoints(500);
    const result = createBrushData(data, 100);
    expect(result.length).toBe(100);
  });

  it('preserves first and last points exactly', () => {
    const data = createDataPoints(500);
    const result = createBrushData(data, 100);

    expect(result[0].timestamp).toBe(data[0].timestamp);
    expect(result[0].value).toBe(data[0].value);
    expect(result[result.length - 1].timestamp).toBe(data[data.length - 1].timestamp);
    expect(result[result.length - 1].value).toBe(data[data.length - 1].value);
  });

  it('uses peak-preserving sampling (max value in bucket)', () => {
    // Create data with known peaks in the middle of buckets
    const data: DataPoint[] = [];
    for (let i = 0; i < 100; i++) {
      // Most values are low (100), but every 10th is a peak (1000)
      const isPeak = i % 10 === 5;
      data.push({
        timestamp: 1000 + i * 100,
        value: isPeak ? 1000 : 100,
        cost: 10
      });
    }

    const result = createBrushData(data, 10);

    // Peak-preserving should capture values of 1000
    // (excluding first/last which are overridden)
    const middlePoints = result.slice(1, -1);
    const hasPeaks = middlePoints.some(p => p.value === 1000);
    expect(hasPeaks).toBe(true);
  });

  it('returns only timestamp and value (no cost)', () => {
    const data = createDataPoints(10);
    const result = createBrushData(data);

    result.forEach(point => {
      expect(Object.keys(point)).toEqual(['timestamp', 'value']);
      expect(point).not.toHaveProperty('cost');
    });
  });

  it('uses default maxPoints of 200', () => {
    const data = createDataPoints(500);
    const result = createBrushData(data);
    expect(result.length).toBe(200);
  });
});

// Real-world fixtures shipped in /fixtures — exercise the parser end-to-end on
// the same files a user would actually upload.
describe('parseGreenButtonXML — fixtures', () => {
  it('parses the single-block consumption fixture', () => {
    const { blocks } = parseGreenButtonXML(loadFixture('sample-single-block.xml'));

    expect(blocks.length).toBe(1);
    const block = blocks[0];
    expect(block.data.length).toBe(168);
    expect(block.meta.readingCount).toBe(168);
    expect(block.meta.flowDirection).toBe(1);
    expect(block.meta.flowDirectionLabel).toContain('Forward');
    expect(block.meta.uomLabel).toBe('Wh');
    expect(block.meta.powerOfTenMultiplier).toBe(0);
    expect(block.meta.totalValue).toBeGreaterThan(0);
    expect(block.meta.totalCost).toBeGreaterThan(0);
    // data is sorted ascending by timestamp
    expect(block.meta.startTimestamp).toBeLessThan(block.meta.endTimestamp);
  });

  it('keeps delivered and received separate for the solar net-metered fixture', () => {
    const { blocks } = parseGreenButtonXML(loadFixture('sample-solar-net-metered.xml'));

    expect(blocks.length).toBe(2);

    const delivered = blocks.find(b => b.meta.flowDirection === 1);
    const received = blocks.find(b => b.meta.flowDirection === 19);
    expect(delivered).toBeDefined();
    expect(received).toBeDefined();
    expect(delivered!.meta.flowDirectionLabel).toContain('Forward');
    expect(received!.meta.flowDirectionLabel).toContain('Reverse');
    // Each block carries its own readings — totals are not merged.
    expect(delivered!.data.length).toBe(168);
    expect(received!.data.length).toBe(168);
  });

  it('keeps hourly and daily summary blocks separate (no double-counting)', () => {
    const { blocks } = parseGreenButtonXML(loadFixture('sample-hourly-plus-daily.xml'));

    expect(blocks.length).toBe(2);
    const durations = blocks.map(b => b.meta.intervalLength).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(durations).toEqual([3600, 86400]);

    const hourly = blocks.find(b => b.meta.intervalLength === 3600)!;
    const daily = blocks.find(b => b.meta.intervalLength === 86400)!;
    expect(hourly.data.length).toBe(168);
    expect(daily.data.length).toBe(7);
  });

  it('merges per-day blocks and drops cumulative register reads (non-interval export)', () => {
    const { blocks } = parseGreenButtonXML(loadFixture('sample-noninterval-register-reads.xml'));

    // 5 per-day interval blocks merge into one usage series; the 5 cumulative
    // register-read blocks are dropped, so no picker and no odometer values.
    expect(blocks.length).toBe(1);
    const block = blocks[0];
    expect(block.meta.isCumulative).toBe(false);
    expect(block.meta.accumulationBehaviour).toBe(4);
    expect(block.data.length).toBe(120); // 5 days × 24 hours, merged
    expect(block.meta.intervalLength).toBe(3600);
    expect(block.meta.powerOfTenMultiplier).toBe(-3);

    // The block links to its ReadingType only through the shared
    // MeterReading/<id> path (no rel="related"). If that match fails the
    // ReadingType is lost: flow shows "Unknown flow" and the ×10^-3 multiplier
    // isn't applied, so values balloon to MWh — exactly the reported bug.
    expect(block.meta.flowDirection).toBe(1);
    expect(block.meta.flowDirectionLabel).toContain('Forward');
    const maxValue = Math.max(...block.data.map(d => d.value));
    expect(maxValue).toBeLessThan(10000); // Wh-scale, not MWh
  });
});

describe('parseGreenButtonXML — cumulative register reads', () => {
  // A ReadingType + IntervalBlock pair, parameterised so tests can dial in
  // accumulationBehaviour, durations and values.
  const buildXML = (
    series: { accumulationBehaviour: number; readings: { start: number; duration: number; value: number }[] }[]
  ): string => {
    const entries = series.map((s, i) => {
      const rtId = i + 1;
      const rt = `
        <entry>
          <link rel="self" href="/ReadingType/${rtId}"/>
          <content>
            <ReadingType xmlns="http://naesb.org/espi">
              <accumulationBehaviour>${s.accumulationBehaviour}</accumulationBehaviour>
              <flowDirection>1</flowDirection>
              <uom>72</uom>
              <powerOfTenMultiplier>0</powerOfTenMultiplier>
            </ReadingType>
          </content>
        </entry>`;
      const reads = s.readings.map(r => `
              <IntervalReading>
                <timePeriod><start>${r.start}</start><duration>${r.duration}</duration></timePeriod>
                <value>${r.value}</value>
                <cost>0</cost>
              </IntervalReading>`).join('');
      const block = `
        <entry>
          <link rel="related" href="/ReadingType/${rtId}"/>
          <content>
            <IntervalBlock xmlns="http://naesb.org/espi">${reads}
            </IntervalBlock>
          </content>
        </entry>`;
      return rt + block;
    }).join('');
    return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;
  };

  const DAY = 86400;

  it('drops the cumulative series when real interval usage is present', () => {
    const xml = buildXML([
      { accumulationBehaviour: 4, readings: [
        { start: 1704067200, duration: 3600, value: 1000 },
        { start: 1704070800, duration: 3600, value: 1200 },
      ] },
      { accumulationBehaviour: 1, readings: [
        { start: 1704067200, duration: 0, value: 50000000 },
        { start: 1704153600, duration: 0, value: 50072000 },
      ] },
    ]);

    const { blocks } = parseGreenButtonXML(xml);
    expect(blocks.length).toBe(1);
    expect(blocks[0].meta.accumulationBehaviour).toBe(4);
    expect(blocks[0].meta.isCumulative).toBe(false);
    expect(blocks[0].data.length).toBe(2);
    expect(blocks[0].meta.totalValue).toBe(2200);
  });

  it('flags cumulative reads via the duration-0 heuristic even without accumulationBehaviour', () => {
    // No accumulationBehaviour given (left undefined); all durations 0.
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><link rel="related" href="/ReadingType/1"/><content>
        <IntervalBlock xmlns="http://naesb.org/espi">
          <IntervalReading><timePeriod><start>1704067200</start><duration>0</duration></timePeriod><value>50000000</value></IntervalReading>
          <IntervalReading><timePeriod><start>1704153600</start><duration>0</duration></timePeriod><value>50072000</value></IntervalReading>
        </IntervalBlock>
      </content></entry>
      <entry><link rel="related" href="/ReadingType/2"/><content>
        <IntervalBlock xmlns="http://naesb.org/espi">
          <IntervalReading><timePeriod><start>1704067200</start><duration>3600</duration></timePeriod><value>1000</value></IntervalReading>
          <IntervalReading><timePeriod><start>1704070800</start><duration>3600</duration></timePeriod><value>1200</value></IntervalReading>
        </IntervalBlock>
      </content></entry>
    </feed>`;

    const { blocks } = parseGreenButtonXML(xml);
    // Only the interval (3600s) series survives.
    expect(blocks.length).toBe(1);
    expect(blocks[0].meta.intervalLength).toBe(3600);
  });

  it('derives usage by differencing reads when the file is cumulative-only', () => {
    const xml = buildXML([
      { accumulationBehaviour: 1, readings: [
        { start: 1704067200, duration: 0, value: 100 },
        { start: 1704067200 + DAY, duration: 0, value: 130 },
        { start: 1704067200 + 2 * DAY, duration: 0, value: 175 },
      ] },
    ]);

    const { blocks } = parseGreenButtonXML(xml);
    expect(blocks.length).toBe(1);
    expect(blocks[0].meta.isCumulative).toBe(false);
    expect(blocks[0].data.map(d => d.value)).toEqual([30, 45]); // diffs of the odometer
    expect(blocks[0].data[0].duration).toBe(DAY);
    expect(blocks[0].meta.totalValue).toBe(75);
  });

  it('skips negative deltas (meter reset / rollover) when differencing', () => {
    const xml = buildXML([
      { accumulationBehaviour: 1, readings: [
        { start: 1704067200, duration: 0, value: 100 },
        { start: 1704067200 + DAY, duration: 0, value: 130 },
        { start: 1704067200 + 2 * DAY, duration: 0, value: 50 },  // reset
        { start: 1704067200 + 3 * DAY, duration: 0, value: 90 },
      ] },
    ]);

    const { blocks } = parseGreenButtonXML(xml);
    expect(blocks[0].data.map(d => d.value)).toEqual([30, 40]); // -80 skipped
  });
});

describe('parseGreenButtonXML — fallback paths', () => {
  it('handles bare IntervalBlock with no entry wrapper', () => {
    const bareBlockXML = `<?xml version="1.0"?>
      <feed>
        <IntervalBlock>
          <IntervalReading>
            <timePeriod><start>1704067200</start><duration>3600</duration></timePeriod>
            <value>800</value>
            <cost>96</cost>
          </IntervalReading>
          <IntervalReading>
            <timePeriod><start>1704070800</start><duration>3600</duration></timePeriod>
            <value>900</value>
            <cost>108</cost>
          </IntervalReading>
        </IntervalBlock>
      </feed>`;

    const { blocks } = parseGreenButtonXML(bareBlockXML);
    expect(blocks.length).toBe(1);
    expect(blocks[0].data.length).toBe(2);
    expect(blocks[0].meta.totalValue).toBe(1700);
  });

  it('handles bare IntervalReadings with no block wrapper', () => {
    const bareReadingsXML = `<?xml version="1.0"?>
      <feed>
        <IntervalReading>
          <timePeriod><start>1704067200</start></timePeriod>
          <value>100</value>
          <cost>10</cost>
        </IntervalReading>
        <IntervalReading>
          <timePeriod><start>1704070800</start></timePeriod>
          <value>200</value>
          <cost>20</cost>
        </IntervalReading>
      </feed>`;

    const { blocks } = parseGreenButtonXML(bareReadingsXML);
    expect(blocks.length).toBe(1);
    expect(blocks[0].data.length).toBe(2);
    expect(blocks[0].meta.totalValue).toBe(300);
  });
});

describe('detectRateChanges', () => {
  // Build hourly readings at a fixed rate (cost = value * rate). A large value
  // keeps cost integers precise so small rate deltas survive Math.round.
  const ratedSeries = (rate: number, count: number, startTs = 1704067200): DataPoint[] =>
    Array.from({ length: count }, (_, i) => ({
      timestamp: startTs + i * 3600,
      value: 10000,
      cost: Math.round(10000 * rate),
    }));

  it('returns no changes for fewer than 2 points', () => {
    expect(detectRateChanges([])).toEqual({ changes: [], periods: [] });
    expect(detectRateChanges(ratedSeries(0.012, 1))).toEqual({ changes: [], periods: [] });
  });

  it('reports a single period when the rate is constant', () => {
    const { changes, periods } = detectRateChanges(ratedSeries(0.012, 24));
    expect(changes.length).toBe(0);
    expect(periods.length).toBe(1);
    expect(periods[0].readings).toBe(24);
  });

  it('detects an increase above the tolerance threshold', () => {
    // 20% jump (> default 8% tolerance) halfway through.
    const data = [...ratedSeries(0.010, 12), ...ratedSeries(0.012, 12, 1704067200 + 12 * 3600)];
    const { changes, periods } = detectRateChanges(data);

    expect(changes.length).toBe(1);
    expect(changes[0].direction).toBe('increase');
    expect(changes[0].percentChange).toBeGreaterThan(8);
    expect(periods.length).toBe(2);
  });

  it('detects a decrease', () => {
    const data = [...ratedSeries(0.014, 12), ...ratedSeries(0.010, 12, 1704067200 + 12 * 3600)];
    const { changes } = detectRateChanges(data);

    expect(changes.length).toBe(1);
    expect(changes[0].direction).toBe('decrease');
    expect(changes[0].percentChange).toBeLessThan(0);
  });

  it('ignores changes within the tolerance band', () => {
    // 5% jump (< default 8% tolerance) — no change reported.
    const data = [...ratedSeries(0.0100, 12), ...ratedSeries(0.0105, 12, 1704067200 + 12 * 3600)];
    const { changes, periods } = detectRateChanges(data);

    expect(changes.length).toBe(0);
    expect(periods.length).toBe(1);
  });

  it('skips low-value/zero-cost readings when deriving rates', () => {
    // value < 50 or cost == 0 are excluded; too few rated points → no result.
    const noise: DataPoint[] = [
      { timestamp: 1704067200, value: 10, cost: 0 },
      { timestamp: 1704070800, value: 5, cost: 0 },
    ];
    expect(detectRateChanges(noise)).toEqual({ changes: [], periods: [] });
  });
});

describe('formatRate', () => {
  // rate is cost(micro-dollars)/value(Wh); display = rate * 0.01 $/kWh.
  it('uses 2 decimals for rates >= $1/kWh', () => {
    // 150 → $1.50/kWh
    expect(formatRate(150)).toBe('$1.50/kWh');
  });

  it('formats a typical residential rate (sub-$1) to 3 decimals', () => {
    // 12 → $0.12/kWh (>= 0.01, < 1) → 3 decimals
    expect(formatRate(12)).toBe('$0.120/kWh');
  });

  it('returns $0.00/kWh for zero', () => {
    expect(formatRate(0)).toBe('$0.00/kWh');
  });

  it('returns $0.00/kWh for non-finite input', () => {
    expect(formatRate(Infinity)).toBe('$0.00/kWh');
    expect(formatRate(NaN)).toBe('$0.00/kWh');
  });

  it('uses 3 decimals for sub-$1/kWh rates', () => {
    // 50 → $0.50/kWh (>= 0.01, < 1) → 3 decimals
    expect(formatRate(50)).toBe('$0.500/kWh');
  });

  it('uses 4 decimals for very small rates', () => {
    // 0.5 → $0.005/kWh (< 0.01) → 4 decimals
    expect(formatRate(0.5)).toBe('$0.0050/kWh');
  });
});