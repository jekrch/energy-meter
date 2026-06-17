/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import { runChunked, type ScheduleWork } from './chunkedRunner';

// Synchronous scheduler so the chunked walk runs to completion inline.
const syncSchedule: ScheduleWork = (cb) => cb();

const never = () => false;
const noError = (err: unknown) => { throw err; };

describe('runChunked', () => {
  it('processes every item once, in order, across chunk boundaries', () => {
    const data = [1, 2, 3, 4, 5, 6, 7];
    const seen: number[] = [];

    runChunked({
      data,
      chunkSize: 3,
      schedule: syncSchedule,
      processItem: (n) => seen.push(n),
      onDone: () => seen.push(-1),
      isCancelled: never,
      onError: noError,
    });

    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, -1]);
  });

  it('passes the running index to processItem', () => {
    const indices: number[] = [];
    runChunked({
      data: ['a', 'b', 'c'],
      chunkSize: 2,
      schedule: syncSchedule,
      processItem: (_item, i) => indices.push(i),
      onDone: () => {},
      isCancelled: never,
      onError: noError,
    });
    expect(indices).toEqual([0, 1, 2]);
  });

  it('still fires onDone for an empty dataset', () => {
    let done = false;
    runChunked({
      data: [] as number[],
      chunkSize: 10,
      schedule: syncSchedule,
      processItem: () => { throw new Error('should not run'); },
      onDone: () => { done = true; },
      isCancelled: never,
      onError: noError,
    });
    expect(done).toBe(true);
  });

  it('stops and skips onDone when cancelled before the first chunk', () => {
    const seen: number[] = [];
    let done = false;
    runChunked({
      data: [1, 2, 3],
      chunkSize: 1,
      schedule: syncSchedule,
      processItem: (n) => seen.push(n),
      onDone: () => { done = true; },
      isCancelled: () => true,
      onError: noError,
    });
    expect(seen).toEqual([]);
    expect(done).toBe(false);
  });

  it('aborts mid-run once isCancelled flips true between chunks', () => {
    const seen: number[] = [];
    let calls = 0;
    runChunked({
      data: [1, 2, 3, 4, 5, 6],
      chunkSize: 2,
      schedule: syncSchedule,
      processItem: (n) => seen.push(n),
      onDone: () => seen.push(-1),
      // Allow the first chunk, cancel before the second.
      isCancelled: () => calls++ >= 1,
      onError: noError,
    });
    expect(seen).toEqual([1, 2]);
  });

  it('routes a thrown item to onError and stops the loop', () => {
    const seen: number[] = [];
    let captured: unknown = null;
    runChunked({
      data: [1, 2, 3],
      chunkSize: 5,
      schedule: syncSchedule,
      processItem: (n) => {
        if (n === 2) throw new Error('boom');
        seen.push(n);
      },
      onDone: () => seen.push(-1),
      isCancelled: never,
      onError: (err) => { captured = err; },
    });
    expect(seen).toEqual([1]);
    expect((captured as Error).message).toBe('boom');
  });
});
