/// <reference types="bun-types" />
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { computeRankings } from './rankings';
import type { RankingsRequest, RankingsResponse } from './rankings.worker';
import type { DataPoint } from '../types';
import type { HourlyWeatherData } from './weatherData';

// The worker installs itself on `self` at import time and answers by calling
// `self.postMessage`, so the test drives it as a worker host would: stand in for
// those two globals, import the module, then post messages at its handler.

interface WorkerGlobal {
  onmessage: ((e: MessageEvent<RankingsRequest>) => void) | null;
  postMessage: (data: RankingsResponse) => void;
}

let posted: RankingsResponse[] = [];
let handler: (e: MessageEvent<RankingsRequest>) => void;

const realSelf = (globalThis as Record<string, unknown>).self;
const realPost = (globalThis as Record<string, unknown>).postMessage;

const send = (msg: RankingsRequest) => handler({ data: msg } as MessageEvent<RankingsRequest>);

// Three days of hourly readings with a deliberate, findable peak.
const HOUR = 3600;
const START = new Date(2024, 0, 1, 0, 0, 0).getTime() / 1000;
const PEAK_INDEX = 30;

const data: DataPoint[] = Array.from({ length: 72 }, (_, i) => ({
  timestamp: START + i * HOUR,
  value: i === PEAK_INDEX ? 9000 : 100 + i,
  cost: i === PEAK_INDEX ? 90_000 : 1000 + i * 10,
  duration: HOUR,
}));

const weather: HourlyWeatherData[] = Array.from({ length: 72 }, (_, i) => ({
  timestamp: START + i * HOUR,
  temperature: i === PEAK_INDEX ? 40 : 10,
}));

beforeEach(async () => {
  posted = [];
  const stub: WorkerGlobal = {
    onmessage: null,
    postMessage: (d) => { posted.push(d); },
  };
  Object.defineProperty(globalThis, 'self', { value: stub, configurable: true, writable: true });

  // A cache-busted import so each case gets the module's own `currentData`
  // fresh, rather than whatever a previous case left in it.
  const mod = await import(`./rankings.worker.ts?w=${Math.random()}`);
  void mod;
  handler = stub.onmessage!;
});

afterEach(() => {
  Object.defineProperty(globalThis, 'self', { value: realSelf, configurable: true, writable: true });
  (globalThis as Record<string, unknown>).postMessage = realPost;
});

describe('rankings worker', () => {
  it('registers a message handler on import', () => {
    expect(typeof handler).toBe('function');
  });

  it('answers nothing to a data message', () => {
    send({ kind: 'data', data, weather });
    expect(posted).toHaveLength(0);
  });

  it('computes against the dataset it was given', () => {
    send({ kind: 'data', data, weather });
    send({ kind: 'compute', id: 1, granularity: 'day', metric: 'cost', limit: 3 });

    expect(posted).toHaveLength(1);
    expect(posted[0].rankings).toEqual(
      computeRankings(data, weather, 'day', 'cost', 3),
    );
  });

  it('echoes the request id so a stale answer can be discarded', () => {
    send({ kind: 'data', data, weather });
    send({ kind: 'compute', id: 7, granularity: 'day', metric: 'cost', limit: 3 });
    send({ kind: 'compute', id: 8, granularity: 'day', metric: 'energy', limit: 3 });

    expect(posted.map((p) => p.id)).toEqual([7, 8]);
  });

  it('serves repeated queries from the dataset sent once', () => {
    // The whole point of the two-message protocol: switching granularity must
    // not require re-cloning the readings across the wire.
    send({ kind: 'data', data, weather });
    for (const g of ['hour', 'day', 'week', 'month'] as const) {
      send({ kind: 'compute', id: 1, granularity: g, metric: 'energy', limit: 5 });
    }
    expect(posted).toHaveLength(4);
    expect(posted.every((p) => p.rankings.length > 0)).toBe(true);
    expect(posted.map((p) => p.rankings[0].granularity)).toEqual(['hour', 'day', 'week', 'month']);
  });

  it('honours the requested limit', () => {
    send({ kind: 'data', data, weather });
    send({ kind: 'compute', id: 1, granularity: 'hour', metric: 'energy', limit: 4 });
    expect(posted[0].rankings).toHaveLength(4);
  });

  it('finds the seeded peak at the top of an hourly energy ranking', () => {
    send({ kind: 'data', data, weather });
    send({ kind: 'compute', id: 1, granularity: 'hour', metric: 'energy', limit: 1 });
    expect(posted[0].rankings[0].periodStart).toBe(START + PEAK_INDEX * HOUR);
  });

  it('ranks temperature metrics off the weather it was sent', () => {
    send({ kind: 'data', data, weather });
    send({ kind: 'compute', id: 1, granularity: 'hour', metric: 'heat', limit: 1 });
    expect(posted[0].rankings[0].value).toBe(40);
  });

  it('answers an empty ranking when asked to compute before any data arrives', () => {
    send({ kind: 'compute', id: 1, granularity: 'day', metric: 'cost', limit: 5 });
    expect(posted).toEqual([{ id: 1, rankings: [] }]);
  });

  it('replaces the dataset when a second data message arrives', () => {
    send({ kind: 'data', data, weather });
    send({ kind: 'data', data: [], weather: [] });
    send({ kind: 'compute', id: 2, granularity: 'day', metric: 'cost', limit: 5 });
    expect(posted[0].rankings).toEqual([]);
  });
});
