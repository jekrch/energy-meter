/// <reference types="bun-types" />
import { describe, it, expect, beforeAll } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  downsampleLTTB,
  processDataAsync,
  parseGreenButtonXML,
  generateSampleData,
  createBrushData
} from './dataUtils';
import type { DataPoint } from '../types';

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
    const result = parseGreenButtonXML(validXML);

    expect(result.length).toBe(2);
    expect(result[0].timestamp).toBe(1704067200);
    expect(result[0].value).toBe(1500);
    expect(result[0].cost).toBe(180);
    expect(result[0].duration).toBe(3600);
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

    const result = parseGreenButtonXML(unsortedXML);

    expect(result[0].timestamp).toBe(1704067200);
    expect(result[1].timestamp).toBe(1704070800);
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

    const result = parseGreenButtonXML(minimalXML);

    expect(result[0].timestamp).toBe(1704067200);
    expect(result[0].value).toBe(1000);
    expect(result[0].cost).toBe(0);
    expect(result[0].duration).toBeUndefined();
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

    const result = parseGreenButtonXML(namespacedXML);
    expect(result.length).toBe(1);
    expect(result[0].value).toBe(500);
  });
});

describe('generateSampleData', () => {
  it('generates two years of hourly data', () => {
    const result = generateSampleData();
    const expectedHours = 2 * 365 * 24;
    expect(result.length).toBe(expectedHours);
  });

  it('generates data with all required fields', () => {
    const result = generateSampleData();

    result.slice(0, 100).forEach(point => {
      expect(point.timestamp).toBeDefined();
      expect(typeof point.timestamp).toBe('number');
      expect(point.value).toBeDefined();
      expect(typeof point.value).toBe('number');
      expect(point.cost).toBeDefined();
      expect(typeof point.cost).toBe('number');
    });
  });

  it('generates chronologically ordered data', () => {
    const result = generateSampleData();

    for (let i = 1; i < Math.min(100, result.length); i++) {
      expect(result[i].timestamp).toBeGreaterThan(result[i - 1].timestamp);
    }
  });

  it('generates hourly intervals (3600 seconds)', () => {
    const result = generateSampleData();

    for (let i = 1; i < Math.min(100, result.length); i++) {
      expect(result[i].timestamp - result[i - 1].timestamp).toBe(3600);
    }
  });

  it('generates non-negative values', () => {
    const result = generateSampleData();
    result.forEach(point => {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.cost).toBeGreaterThanOrEqual(0);
    });
  });

  it('starts from previous year', () => {
    const result = generateSampleData();
    const startDate = new Date(result[0].timestamp * 1000);
    const expectedYear = new Date().getFullYear() - 1;
    expect(startDate.getFullYear()).toBe(expectedYear);
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