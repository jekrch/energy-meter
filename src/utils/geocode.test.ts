/// <reference types="bun-types" />
import { describe, it, expect, afterEach, mock } from 'bun:test';
import { geocodeZipCode } from './weatherData';

const realFetch = globalThis.fetch;
const realError = console.error;

// Build a fetch mock that returns queued JSON bodies in order.
function mockFetchSequence(...responses: Array<{ ok?: boolean; body: unknown }>) {
  let call = 0;
  const fn = mock(async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    return {
      ok: r.ok ?? true,
      json: async () => r.body,
    } as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

describe('geocodeZipCode', () => {
  it('returns the first result of a successful lookup', async () => {
    mockFetchSequence({
      body: {
        results: [
          { latitude: 40.7, longitude: -74, name: 'New York', admin1: 'New York', country: 'United States' },
        ],
      },
    });

    const result = await geocodeZipCode('10001');
    expect(result).toEqual({
      latitude: 40.7,
      longitude: -74,
      name: 'New York',
      admin1: 'New York',
      country: 'United States',
    });
  });

  it('retries with a USA-qualified query for 5-digit US zips when the first lookup is empty', async () => {
    const fetchMock = mockFetchSequence(
      { body: { results: [] } }, // first attempt: no results
      { body: { results: [{ latitude: 34, longitude: -118, name: 'Los Angeles', admin1: 'California', country: 'United States' }] } },
    );

    const result = await geocodeZipCode('90001');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.name).toBe('Los Angeles');
    // The retry URL should carry the USA qualifier.
    const secondUrl = String((fetchMock.mock.calls[1] as unknown[])[0]);
    expect(secondUrl).toContain('USA');
  });

  it('returns null when a non-US query yields no results', async () => {
    const fetchMock = mockFetchSequence({ body: { results: [] } });
    const result = await geocodeZipCode('not-a-zip');
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no USA retry for non 5-digit input
  });

  it('returns null and swallows network errors', async () => {
    console.error = () => {}; // the catch path logs; keep test output clean
    globalThis.fetch = mock(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await geocodeZipCode('10001');
    expect(result).toBeNull();
  });
});
