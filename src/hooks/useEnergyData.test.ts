/// <reference types="bun-types" />
import '../test/happyDom'; // DOMParser, for the Green Button XML fixtures
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { act, type ChangeEvent } from 'react';
import { renderHook, advanceTime } from '../test/renderHook';
import { useEnergyData } from './useEnergyData';
import { serializeNativeFile } from '../utils/nativeFormat';
import { SAMPLE_LOAD_DELAY } from '../constants';
import type { DataPoint } from '../types';

// A file's readings only reach the screen when nothing worth keeping is already
// there. `shouldHoldUpload` is what lets App ask "add to the open dataset, or
// replace it?" before the answer is forced.

function readings(startHour: number, count: number): DataPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: (startHour + i) * 3600,
    value: 100 + i,
    cost: 12 * (100 + i),
    duration: 3600,
  }));
}

function nativeFile(name: string, data: DataPoint[]): File {
  const text = serializeNativeFile(data, { fileName: name, resolution: 'RAW', sources: [] });
  return new File([text], name, { type: 'application/json' });
}

// A real Green Button export carrying two IntervalBlocks — the case that puts
// the block picker on screen, since the hook cannot know which series is wanted.
const multiBlockFile = (name: string): File =>
  new File(
    [readFileSync(new URL('../../fixtures/sample-hourly-plus-daily.xml', import.meta.url), 'utf-8')],
    name,
    { type: 'text/xml' },
  );

// The shape `handleFileUpload` reads off a file input's change event.
function uploadEvent(file: File | null): ChangeEvent<HTMLInputElement> {
  return {
    target: { files: file ? [file] : [], value: 'C:\\fakepath\\x' },
  } as unknown as ChangeEvent<HTMLInputElement>;
}

// Pick a file and let the FileReader callback land, all inside act() so the
// resulting state updates are flushed before the assertions run.
async function upload(
  result: { current: ReturnType<typeof useEnergyData> },
  event: ChangeEvent<HTMLInputElement>,
): Promise<void> {
  act(() => result.current.handleFileUpload(event));
  await advanceTime(20);
}

function setup(hold: () => boolean) {
  const loaded: { fileName: string; count: number }[] = [];
  const view = renderHook(() =>
    useEnergyData({
      setResolution: () => {},
      shouldHoldUpload: hold,
      onDataLoaded: (fileName, data) => { loaded.push({ fileName, count: data.length }); },
    }),
  );
  return { ...view, loaded };
}

// A fuller harness that records every callback, for the cases that care which
// of them fired and in what order.
function setupWithSpies(overrides: Partial<Parameters<typeof useEnergyData>[0]> = {}) {
  const calls = {
    resolutions: [] as string[],
    loadStarts: [] as string[],
    loaded: [] as { fileName: string; count: number; resolution: string; interval?: number }[],
    schedules: [] as unknown[],
  };
  const view = renderHook(() =>
    useEnergyData({
      setResolution: (r) => { calls.resolutions.push(r); },
      onLoadStart: (source) => { calls.loadStarts.push(source); },
      onDataLoaded: (fileName, data, resolution, meta) => {
        calls.loaded.push({ fileName, count: data.length, resolution, interval: meta?.intervalLength });
      },
      onPeakScheduleLoaded: (schedule) => { calls.schedules.push(schedule); },
      ...overrides,
    }),
  );
  return { ...view, calls };
}

describe('useEnergyData upload holding', () => {
  it('loads a picked file straight away when nothing is held back', async () => {
    const { result, loaded } = setup(() => false);
    await upload(result, uploadEvent(nativeFile('jan.json', readings(0, 24))));

    expect(loaded).toEqual([{ fileName: 'jan.json', count: 24 }]);
    expect(result.current.rawData).toHaveLength(24);
    expect(result.current.incoming).toBeNull();
  });

  it('holds the file instead of loading it when asked to', async () => {
    const { result, loaded } = setup(() => true);
    await upload(result, uploadEvent(nativeFile('feb.json', readings(24, 12))));

    // Nothing about the open dataset was touched — the file is only parsed.
    expect(loaded).toEqual([]);
    expect(result.current.rawData).toBeNull();
    expect(result.current.fileName).toBeNull();
    expect(result.current.incoming).toMatchObject({ fileName: 'feb.json', status: 'ready' });
    expect(result.current.incoming?.blocks[0].data).toHaveLength(12);
  });

  it('adopting a held file loads it and clears the hold', async () => {
    const { result, loaded } = setup(() => true);
    await upload(result, uploadEvent(nativeFile('feb.json', readings(24, 12))));

    act(() => result.current.adoptIncoming());
    await advanceTime(20);

    expect(loaded).toEqual([{ fileName: 'feb.json', count: 12 }]);
    expect(result.current.rawData).toHaveLength(12);
    expect(result.current.fileName).toBe('feb.json');
    expect(result.current.incoming).toBeNull();
  });

  it('dismissing a held file leaves the open dataset alone', async () => {
    const { result, loaded } = setup(() => true);
    await upload(result, uploadEvent(nativeFile('feb.json', readings(24, 12))));

    act(() => result.current.dismissIncoming());
    await advanceTime(20);

    expect(loaded).toEqual([]);
    expect(result.current.incoming).toBeNull();
    expect(result.current.rawData).toBeNull();
  });

  it('reports a held file that will not parse without emptying the screen', async () => {
    const { result } = setup(() => true);
    const junk = new File(['<nope/>'], 'junk.xml', { type: 'text/xml' });
    await upload(result, uploadEvent(junk));

    expect(result.current.incoming?.status).toBe('error');
    expect(result.current.incoming?.error).toBeTruthy();
    // The regular error channel — which blanks the dashboard — stays quiet.
    expect(result.current.error).toBeNull();
  });

  it('clears the input so the same file can be picked again', async () => {
    const { result } = setup(() => true);
    const event = uploadEvent(nativeFile('feb.json', readings(24, 4)));
    await upload(result, event);
    expect(event.target.value).toBe('');
  });
});


describe('useEnergyData sample data', () => {
  it('names the demo file and flags the load as a sample', async () => {
    const { result, calls } = setupWithSpies();
    act(() => { result.current.loadSampleData(); });

    expect(result.current.fileName).toBe('demo.xml');
    expect(calls.loadStarts).toEqual(['sample']);
  });

  it('shows the spinner until the readings are generated', async () => {
    const { result } = setupWithSpies();
    act(() => { result.current.loadSampleData(); });
    expect(result.current.loading).toBe(true);
    expect(result.current.rawData).toBeNull();

    await advanceTime(SAMPLE_LOAD_DELAY + 60);
    expect(result.current.loading).toBe(false);
    expect(result.current.rawData!.length).toBeGreaterThan(0);
  });

  it('opens the demo at daily resolution', async () => {
    const { result, calls } = setupWithSpies();
    act(() => { result.current.loadSampleData(); });
    await advanceTime(SAMPLE_LOAD_DELAY + 60);
    expect(calls.resolutions).toContain('DAILY');
  });

  it('bumps the load id so the dashboard replays its entrance', async () => {
    const { result } = setupWithSpies();
    const before = result.current.loadId;
    act(() => { result.current.loadSampleData(); });
    await advanceTime(SAMPLE_LOAD_DELAY + 60);
    expect(result.current.loadId).toBe(before + 1);
  });

  it('publishes the demo bounds once the readings land', async () => {
    const { result } = setupWithSpies();
    act(() => { result.current.loadSampleData(); });
    await advanceTime(SAMPLE_LOAD_DELAY + 60);

    const data = result.current.rawData!;
    expect(result.current.dataBounds).toEqual({
      start: data[0].timestamp,
      end: data[data.length - 1].timestamp,
    });
  });

  it('does not announce the demo as a history row', async () => {
    // App scopes the demo's peak schedule to the demo alone; a history entry
    // would leak it into the user's real datasets.
    const { result, calls } = setupWithSpies();
    act(() => { result.current.loadSampleData(); });
    await advanceTime(SAMPLE_LOAD_DELAY + 60);
    expect(calls.loaded).toHaveLength(0);
  });

  it('clears a previous error', async () => {
    const { result, calls } = setupWithSpies();
    void calls;
    act(() => { result.current.loadSampleData(); });
    await advanceTime(SAMPLE_LOAD_DELAY + 60);
    expect(result.current.error).toBeNull();
  });
});

describe('useEnergyData history loads', () => {
  const saved = readings(0, 48);

  it('opens the saved readings at the resolution they were saved with', () => {
    const { result, calls } = setupWithSpies();
    act(() => { result.current.loadFromHistory(saved, 'meter.csv', 'HOURLY'); });

    expect(result.current.rawData).toEqual(saved);
    expect(result.current.fileName).toBe('meter.csv');
    expect(calls.resolutions).toEqual(['HOURLY']);
    expect(calls.loadStarts).toEqual(['history']);
  });

  it('does not re-announce a history load as newly loaded data', () => {
    // It is already a history row; saving it again would duplicate it.
    const { result, calls } = setupWithSpies();
    act(() => { result.current.loadFromHistory(saved, 'meter.csv', 'RAW'); });
    expect(calls.loaded).toHaveLength(0);
  });

  it('bumps the load id', () => {
    const { result } = setupWithSpies();
    const before = result.current.loadId;
    act(() => { result.current.loadFromHistory(saved, 'meter.csv', 'RAW'); });
    expect(result.current.loadId).toBe(before + 1);
  });

  it('clears a block picker left open by a previous file', async () => {
    const { result } = setupWithSpies();
    await upload(result, uploadEvent(multiBlockFile('two.xml')));
    expect(result.current.pendingBlocks).not.toBeNull();

    act(() => { result.current.loadFromHistory(saved, 'meter.csv', 'RAW'); });
    expect(result.current.pendingBlocks).toBeNull();
  });

  it('clears a parse error from a previous upload', async () => {
    const { result } = setupWithSpies();
    await upload(result, uploadEvent(new File(['not data'], 'bad.csv')));
    expect(result.current.error).not.toBeNull();

    act(() => { result.current.loadFromHistory(saved, 'meter.csv', 'RAW'); });
    expect(result.current.error).toBeNull();
  });
});

describe('useEnergyData rename and reset', () => {
  it('retitles the open dataset without touching its readings', () => {
    const { result } = setupWithSpies();
    const saved = readings(0, 10);
    act(() => { result.current.loadFromHistory(saved, 'old.csv', 'RAW'); });

    const before = result.current.rawData;
    act(() => { result.current.renameLoaded('new name'); });
    expect(result.current.fileName).toBe('new name');
    expect(result.current.rawData).toBe(before);
  });

  it('clears the dataset, its name, and any error on reset', async () => {
    const { result } = setupWithSpies();
    act(() => { result.current.loadFromHistory(readings(0, 10), 'meter.csv', 'RAW'); });

    act(() => { result.current.reset(); });
    expect(result.current.rawData).toBeNull();
    expect(result.current.fileName).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe('useEnergyData block picker', () => {
  it('offers the blocks instead of guessing when a file carries several', async () => {
    const { result, calls } = setupWithSpies();
    await upload(result, uploadEvent(multiBlockFile('two.xml')));

    expect(result.current.pendingBlocks).toHaveLength(2);
    expect(result.current.rawData).toBeNull();
    expect(calls.loaded).toHaveLength(0);
  });

  it('loads the chosen block and closes the picker', async () => {
    const { result, calls } = setupWithSpies();
    await upload(result, uploadEvent(multiBlockFile('two.xml')));

    act(() => { result.current.handleSelectBlock(1); });
    expect(result.current.pendingBlocks).toBeNull();
    expect(result.current.rawData).not.toBeNull();
    expect(calls.loaded).toHaveLength(1);
    expect(calls.loaded[0].fileName).toBe('two.xml');
  });

  it('keeps the blocks distinguishable — picking the other one loads other readings', async () => {
    const first = setupWithSpies();
    await upload(first.result, uploadEvent(multiBlockFile('two.xml')));
    act(() => { first.result.current.handleSelectBlock(0); });

    const second = setupWithSpies();
    await upload(second.result, uploadEvent(multiBlockFile('two.xml')));
    act(() => { second.result.current.handleSelectBlock(1); });

    expect(first.result.current.rawData).not.toEqual(second.result.current.rawData);
  });

  it('abandons the file entirely when the picker is cancelled', async () => {
    const { result } = setupWithSpies();
    await upload(result, uploadEvent(multiBlockFile('two.xml')));

    act(() => { result.current.handleCancelBlockPicker(); });
    expect(result.current.pendingBlocks).toBeNull();
    expect(result.current.fileName).toBeNull();
    expect(result.current.rawData).toBeNull();
  });

  it('ignores a selection once the picker has been cancelled', async () => {
    const { result } = setupWithSpies();
    await upload(result, uploadEvent(multiBlockFile('two.xml')));
    act(() => { result.current.handleCancelBlockPicker(); });

    act(() => { result.current.handleSelectBlock(0); });
    expect(result.current.rawData).toBeNull();
  });
});

describe('useEnergyData adopting a held file', () => {
  it('does nothing when there is nothing held', () => {
    const { result } = setupWithSpies();
    act(() => { result.current.adoptIncoming(); });
    expect(result.current.rawData).toBeNull();
  });

  it('does nothing while the held file is still parsing', async () => {
    // `hold` is answered before the read finishes, so `incoming` is briefly
    // in the 'parsing' state; adopting then must not load an empty dataset.
    const { result } = setupWithSpies({ shouldHoldUpload: () => true });
    act(() => result.current.handleFileUpload(uploadEvent(nativeFile('a.json', readings(0, 5)))));
    expect(result.current.incoming!.status).toBe('parsing');

    act(() => { result.current.adoptIncoming(); });
    expect(result.current.rawData).toBeNull();
    await advanceTime(20);
  });

  it('does nothing when the held file failed to parse', async () => {
    const { result } = setupWithSpies({ shouldHoldUpload: () => true });
    await upload(result, uploadEvent(new File(['not data'], 'bad.csv')));
    expect(result.current.incoming!.status).toBe('error');

    act(() => { result.current.adoptIncoming(); });
    expect(result.current.rawData).toBeNull();
    expect(result.current.incoming).not.toBeNull();
  });

  it('takes the held file over as an upload, clearing the hold', async () => {
    const { result, calls } = setupWithSpies({ shouldHoldUpload: () => true });
    await upload(result, uploadEvent(nativeFile('feb.json', readings(0, 12))));

    act(() => { result.current.adoptIncoming(); });
    expect(result.current.incoming).toBeNull();
    expect(result.current.fileName).toBe('feb.json');
    expect(result.current.rawData).toHaveLength(12);
    expect(calls.loadStarts).toEqual(['upload']);
  });

  it('narrows a multi-block held file to the block it is given', async () => {
    const { result } = setupWithSpies({ shouldHoldUpload: () => true });
    await upload(result, uploadEvent(multiBlockFile('two.xml')));
    const blocks = result.current.incoming!.blocks;
    expect(blocks).toHaveLength(2);

    act(() => { result.current.adoptIncoming(blocks[1]); });
    // One block was named, so the picker is skipped entirely.
    expect(result.current.pendingBlocks).toBeNull();
    expect(result.current.rawData).toEqual(blocks[1].data);
  });

  it('opens the picker when a multi-block held file is adopted whole', async () => {
    const { result } = setupWithSpies({ shouldHoldUpload: () => true });
    await upload(result, uploadEvent(multiBlockFile('two.xml')));

    act(() => { result.current.adoptIncoming(); });
    expect(result.current.pendingBlocks).toHaveLength(2);
  });

  it('clears an error left over from an earlier failed upload', async () => {
    let hold = false;
    const { result } = setupWithSpies({ shouldHoldUpload: () => hold });
    await upload(result, uploadEvent(new File(['not data'], 'bad.csv')));
    expect(result.current.error).not.toBeNull();

    // A later pick is held rather than loaded, then adopted.
    hold = true;
    await upload(result, uploadEvent(nativeFile('good.json', readings(0, 6))));
    act(() => { result.current.adoptIncoming(); });
    expect(result.current.error).toBeNull();
  });
});
