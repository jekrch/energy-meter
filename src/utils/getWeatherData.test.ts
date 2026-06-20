/// <reference types="bun-types" />
import 'fake-indexeddb/auto'; // provides global indexedDB / IDBKeyRange
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { getWeatherData, clearWeatherCache } from './weatherData';

const realFetch = globalThis.fetch;
const realLog = console.log;

// Times at UTC noon so the derived calendar date is timezone-stable.
const ARCHIVE_BODY = {
  hourly: {
    time: ['2024-01-01T12:00', '2024-01-01T13:00', '2024-01-02T12:00'],
    temperature_2m: [5, 6, 7],
  },
};

const LAT = 40.7;
const LON = -74; // <= 2 decimals so cache-key rounding is a no-op
const START = Math.floor(Date.UTC(2024, 0, 1) / 1000);
const END = Math.floor(Date.UTC(2024, 0, 2) / 1000);

function mockArchiveFetch() {
  const fn = mock(async () => ({
    ok: true,
    json: async () => ARCHIVE_BODY,
  } as Response));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(async () => {
  console.log = () => {}; // getWeatherData is chatty; keep output clean
  await clearWeatherCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

describe('getWeatherData', () => {
  it('fetches from the API on a cache miss and returns parsed hourly data', async () => {
    const fetchMock = mockArchiveFetch();
    const data = await getWeatherData(LAT, LON, START, END);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data).toHaveLength(3);
    expect(data[0].temperature).toBe(5);
    expect(data[2].temperature).toBe(7);
    // timestamps are seconds derived from the API time strings
    expect(data[0].timestamp).toBe(new Date('2024-01-01T12:00').getTime() / 1000);
  });

  it('serves a second identical request from cache without re-fetching', async () => {
    const fetchMock = mockArchiveFetch();
    const first = await getWeatherData(LAT, LON, START, END);
    const second = await getWeatherData(LAT, LON, START, END);

    expect(fetchMock).toHaveBeenCalledTimes(1); // no second network call
    expect(second).toEqual(first);
  });

  it('drops readings whose temperature is null', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        hourly: {
          time: ['2024-01-01T12:00', '2024-01-01T13:00'],
          temperature_2m: [10, null],
        },
      }),
    } as Response)) as unknown as typeof fetch;

    const data = await getWeatherData(LAT, LON, START, END);
    expect(data).toHaveLength(1);
    expect(data[0].temperature).toBe(10);
  });

  it('propagates a non-date API error', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ error: true, reason: 'No data available for this location' }),
    } as Response)) as unknown as typeof fetch;

    await expect(getWeatherData(LAT, LON, START, END)).rejects.toThrow('No data available');
  });
});
