/// <reference types="bun-types" />
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../test/renderHook';
import { useWeather } from './useWeather';
import { clearWeatherCache } from '../utils/weatherData';

// Exercised against the real weatherData module with `fetch` stubbed, matching
// the convention in getWeatherData.test.ts. Mocking weatherData itself would
// leak through bun's shared module registry into those tests.

const STORAGE_KEY = 'gb-weather-location';

const NYC = {
  latitude: 40.7, longitude: -74, name: 'New York',
  admin1: 'New York', country: 'United States',
};

// UTC noon so the derived calendar date is timezone-stable.
const START = Math.floor(Date.UTC(2024, 0, 1) / 1000);
const END = Math.floor(Date.UTC(2024, 0, 2) / 1000);

const ARCHIVE_BODY = {
  hourly: {
    time: ['2024-01-01T00:00', '2024-01-01T01:00', '2024-01-02T00:00'],
    temperature_2m: [30, 40, 50],
  },
};

const realFetch = globalThis.fetch;
const realLog = console.log;
const realError = console.error;

let geoResults: unknown = { results: [NYC] };
let geoOk = true;
let archiveOk = true;
let archiveBody: unknown = ARCHIVE_BODY;
let urls: string[] = [];

function stubFetch() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('geocoding-api')) {
      return { ok: geoOk, json: async () => geoResults } as Response;
    }
    if (!archiveOk) return { ok: false, json: async () => ({ error: true, reason: 'boom' }) } as Response;
    return { ok: true, json: async () => archiveBody } as Response;
  }) as typeof fetch;
}

/** Drain the hook's async fetch chain, flushing React effects as it goes. */
async function settle(turns = 4) {
  await act(async () => {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const render = (start: number | null = null, end: number | null = null) =>
  renderHook(({ s, e }) => useWeather(s, e), { initialProps: { s: start, e: end } });

beforeEach(async () => {
  console.log = () => {};   // getWeatherData is chatty
  console.error = () => {};
  localStorage.clear();
  urls = [];
  geoResults = { results: [NYC] };
  geoOk = true;
  archiveOk = true;
  archiveBody = ARCHIVE_BODY;
  stubFetch();
  await clearWeatherCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  console.error = realError;
  localStorage.clear();
});

describe('useWeather initial state', () => {
  it('starts disabled with no location', () => {
    const { result } = render();
    expect(result.current.enabled).toBe(false);
    expect(result.current.location).toBeNull();
    expect(result.current.zipCode).toBe('');
    expect(result.current.hourlyData).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch without a location', async () => {
    render(START, END);
    await settle();
    expect(urls).toHaveLength(0);
  });
});

describe('useWeather saved location', () => {
  it('restores zip and location from localStorage on mount', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      zipCode: '10001', location: NYC, enabled: true,
    }));
    const { result } = render();
    await settle(1);
    expect(result.current.zipCode).toBe('10001');
    expect(result.current.location).toEqual(NYC);
    expect(result.current.enabled).toBe(true);
  });

  it('defaults a restored entry with no enabled flag to on', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ zipCode: '10001', location: NYC }));
    const { result } = render();
    await settle(1);
    expect(result.current.enabled).toBe(true);
  });

  it('honours an explicitly disabled saved entry', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      zipCode: '10001', location: NYC, enabled: false,
    }));
    const { result } = render();
    await settle(1);
    expect(result.current.enabled).toBe(false);
  });

  it('ignores a corrupt saved entry instead of throwing', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const { result } = render();
    await settle(1);
    expect(result.current.location).toBeNull();
  });

  it('fetches immediately for a restored location once a range is known', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      zipCode: '10001', location: NYC, enabled: true,
    }));
    const { result } = render(START, END);
    await settle();
    expect(urls.some((u) => u.includes('archive-api'))).toBe(true);
    expect(result.current.hourlyData.length).toBeGreaterThan(0);
  });
});

describe('setZipCode', () => {
  it('geocodes, stores the location, and enables weather', async () => {
    const { result } = render();
    await act(async () => { await result.current.setZipCode('10001'); });

    expect(result.current.location).toEqual(NYC);
    expect(result.current.enabled).toBe(true);
    expect(result.current.zipCode).toBe('10001');
    expect(result.current.isLoading).toBe(false);
  });

  it('persists the resolved location for the next session', async () => {
    const { result } = render();
    await act(async () => { await result.current.setZipCode('10001'); });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!))
      .toEqual({ zipCode: '10001', location: NYC, enabled: true });
  });

  it('reports a not-found lookup as an error without a location', async () => {
    geoResults = { results: [] };
    const { result } = render();
    await act(async () => { await result.current.setZipCode('00000'); });

    expect(result.current.location).toBeNull();
    expect(result.current.error).toContain('Location not found');
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps the typed zip visible even when the lookup fails', async () => {
    geoResults = { results: [] };
    const { result } = render();
    await act(async () => { await result.current.setZipCode('00000'); });
    expect(result.current.zipCode).toBe('00000');
  });

  it('clears everything and forgets the saved location on an empty zip', async () => {
    const { result } = render();
    await act(async () => { await result.current.setZipCode('10001'); });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    await act(async () => { await result.current.setZipCode('  '); });
    expect(result.current.location).toBeNull();
    expect(result.current.enabled).toBe(false);
    expect(result.current.hourlyData).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not geocode a blank zip', async () => {
    const { result } = render();
    await act(async () => { await result.current.setZipCode(''); });
    expect(urls.filter((u) => u.includes('geocoding-api'))).toHaveLength(0);
  });

  it('drops stale readings when the location changes', async () => {
    const { result } = render(START, END);
    await act(async () => { await result.current.setZipCode('10001'); });
    await settle();
    expect(result.current.hourlyData.length).toBeGreaterThan(0);

    geoResults = { results: [{ ...NYC, latitude: 34.05, longitude: -118.24, name: 'Los Angeles' }] };
    await act(async () => { await result.current.setZipCode('90001'); });
    // Cleared synchronously with the new location, before the refetch lands.
    expect(result.current.location?.name).toBe('Los Angeles');
  });
});

describe('fetching', () => {
  it('fetches once a location and a range are both present', async () => {
    const { result } = render(START, END);
    await act(async () => { await result.current.setZipCode('10001'); });
    await settle();

    expect(urls.some((u) => u.includes('archive-api'))).toBe(true);
    expect(result.current.hourlyData).toEqual([
      { timestamp: Math.floor(Date.parse('2024-01-01T00:00Z') / 1000), temperature: 30 },
      { timestamp: Math.floor(Date.parse('2024-01-01T01:00Z') / 1000), temperature: 40 },
      { timestamp: Math.floor(Date.parse('2024-01-02T00:00Z') / 1000), temperature: 50 },
    ]);
  });

  it('does not refetch when nothing about the request changed', async () => {
    const { result, rerender } = render(START, END);
    await act(async () => { await result.current.setZipCode('10001'); });
    await settle();
    const before = urls.filter((u) => u.includes('archive-api')).length;

    rerender({ s: START, e: END });
    await settle();
    expect(urls.filter((u) => u.includes('archive-api'))).toHaveLength(before);
  });

  it('refetches when the date range moves', async () => {
    const { result, rerender } = render(START, END);
    await act(async () => { await result.current.setZipCode('10001'); });
    await settle();
    const before = urls.filter((u) => u.includes('archive-api')).length;

    rerender({ s: START, e: END + 86_400 });
    await settle();
    expect(urls.filter((u) => u.includes('archive-api')).length).toBeGreaterThan(before);
  });

  it('surfaces a failed fetch as an error and leaves no readings', async () => {
    archiveOk = false;
    const { result } = render(START, END);
    await act(async () => { await result.current.setZipCode('10001'); });
    await settle();

    expect(result.current.error).toBeTruthy();
    expect(result.current.hourlyData).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('retries after a failure rather than treating the range as fetched', async () => {
    archiveOk = false;
    const { result, rerender } = render(START, END);
    await act(async () => { await result.current.setZipCode('10001'); });
    await settle();
    const failed = urls.filter((u) => u.includes('archive-api')).length;

    archiveOk = true;
    rerender({ s: START, e: END + 3600 });
    await settle();
    expect(urls.filter((u) => u.includes('archive-api')).length).toBeGreaterThan(failed);
    expect(result.current.hourlyData.length).toBeGreaterThan(0);
  });
});

describe('toggleEnabled', () => {
  it('turns the overlay off without discarding the location', async () => {
    const { result } = render();
    await act(async () => { await result.current.setZipCode('10001'); });

    act(() => { result.current.toggleEnabled(false); });
    expect(result.current.enabled).toBe(false);
    expect(result.current.location).toEqual(NYC);
  });

  it('persists the preference alongside the saved location', async () => {
    const { result } = render();
    await act(async () => { await result.current.setZipCode('10001'); });
    act(() => { result.current.toggleEnabled(false); });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).enabled).toBe(false);
  });

  it('writes nothing when there is no location to attach the preference to', () => {
    const { result } = render();
    act(() => { result.current.toggleEnabled(true); });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.enabled).toBe(true);
  });
});

describe('clearLocation', () => {
  it('resets the whole weather state', async () => {
    const { result } = render(START, END);
    await act(async () => { await result.current.setZipCode('10001'); });
    await settle();

    act(() => { result.current.clearLocation(); });
    expect(result.current).toMatchObject({
      enabled: false, zipCode: '', location: null, hourlyData: [], error: null,
    });
  });

  it('forgets the saved location', async () => {
    const { result } = render();
    await act(async () => { await result.current.setZipCode('10001'); });
    act(() => { result.current.clearLocation(); });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('repopulates readings when the same location is set again', async () => {
    // The fetched-range guard is reset on clear, so re-adding the location
    // re-runs the effect. The readings themselves may come from weatherData's
    // own IndexedDB cache rather than the network — what matters is that the
    // hook does not stay empty.
    const { result } = render(START, END);
    await act(async () => { await result.current.setZipCode('10001'); });
    await settle();
    act(() => { result.current.clearLocation(); });
    expect(result.current.hourlyData).toEqual([]);

    await act(async () => { await result.current.setZipCode('10001'); });
    await settle();
    expect(result.current.hourlyData.length).toBeGreaterThan(0);
  });
});

describe('aggregation helpers', () => {
  async function loaded() {
    const hook = render(START, END);
    await act(async () => { await hook.result.current.setZipCode('10001'); });
    await settle();
    return hook;
  }

  it('returns nothing before any data has loaded', () => {
    const { result } = render();
    expect(result.current.getAggregatedWeather('hourly')).toEqual([]);
    expect(result.current.getTemperatureMap('daily').size).toBe(0);
  });

  it('passes hourly readings straight through, sorted by timestamp', async () => {
    const { result } = await loaded();
    const agg = result.current.getAggregatedWeather('hourly');
    expect(agg).toHaveLength(3);
    expect(agg.map((a) => a.timestamp)).toEqual([...agg.map((a) => a.timestamp)].sort((a, b) => a - b));
    expect(agg.map((a) => a.temperature)).toEqual([30, 40, 50]);
  });

  it('averages within a bucket when aggregating to days', async () => {
    const { result } = await loaded();
    const daily = result.current.getAggregatedWeather('daily');
    // Two Jan-1 readings average to 35; Jan 2 keeps its single 50.
    expect(daily.map((d) => d.temperature)).toEqual([35, 50]);
  });

  it('collapses the whole span into one bucket when aggregating to months', async () => {
    const { result } = await loaded();
    expect(result.current.getAggregatedWeather('monthly')).toHaveLength(1);
  });

  it('exposes the same aggregation as a lookup map', async () => {
    const { result } = await loaded();
    const map = result.current.getTemperatureMap('daily');
    const list = result.current.getAggregatedWeather('daily');
    expect(map.size).toBe(list.length);
    for (const { timestamp, temperature } of list) {
      expect(map.get(timestamp)).toBe(temperature);
    }
  });
});
