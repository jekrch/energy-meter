import { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { type DataPoint, type PeakSchedule, type TimeRange } from '../types';
import { parseGreenButtonFile, generateSampleData, type ParsedBlock, type IntervalBlockMeta } from '../utils/dataUtils';
import { BLOCK_DAILY_THRESHOLD, SAMPLE_LOAD_DELAY } from '../constants';

export type LoadSource = 'upload' | 'sample' | 'history';

interface UseEnergyDataOptions {
  // The chosen resolution lives with the chart state in App; loading a block
  // decides RAW vs DAILY, so the hook sets it through this.
  setResolution: (resolution: string) => void;
  // Called when a new dataset starts loading (App resets the table page). The
  // source distinguishes the built-in demo from real data, which is what lets
  // App scope the demo's peak schedule to the demo alone.
  onLoadStart?: (source: LoadSource) => void;
  // Called after a fresh file is parsed successfully (not triggered by history
  // loads). The block meta carries provenance (flow direction / commodity /
  // interval) that history persists for later merge-compatibility checks.
  onDataLoaded?: (fileName: string, data: DataPoint[], resolution: string, meta?: IntervalBlockMeta) => void;
  // Called when an uploaded native file carries a peak rate schedule. Fired at
  // parse time rather than per block, because the schedule describes the file
  // rather than any one interval block.
  onPeakScheduleLoaded?: (schedule: PeakSchedule) => void;
}

// Owns the loaded dataset and everything that produces it: upload/sample/block
// handling, parse loading + error state, and the data time bounds. Extracted
// from App so the upload pipeline is isolated from the rendering concerns.
export function useEnergyData({ setResolution, onLoadStart, onDataLoaded, onPeakScheduleLoaded }: UseEnergyDataOptions) {
  const [rawData, setRawData] = useState<DataPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingBlocks, setPendingBlocks] = useState<ParsedBlock[] | null>(null);
  const [dataBounds, setDataBounds] = useState<TimeRange>({ start: null, end: null });
  // Bumped in the same commit as every dataset load so App can use it as the
  // dashboard's `key` to replay the entrance animation. Incrementing it here
  // (rather than in an App effect that runs after the first paint) means the
  // dashboard mounts exactly once with its final key — otherwise it would mount
  // under the stale key, paint, then remount under the new key, restarting the
  // animation mid-flight.
  const [loadId, setLoadId] = useState(0);

  useEffect(() => {
    if (rawData && rawData.length > 0) {
      setDataBounds({ start: rawData[0].timestamp, end: rawData[rawData.length - 1].timestamp });
    }
  }, [rawData]);

  const applyBlock = (block: ParsedBlock, name: string) => {
    const res = block.data.length > BLOCK_DAILY_THRESHOLD ? 'DAILY' : 'RAW';
    setRawData(block.data);
    setLoadId(n => n + 1);
    setResolution(res);
    onDataLoaded?.(name, block.data, res, block.meta);
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setError(null); setFileName(file.name); onLoadStart?.('upload');
    setPendingBlocks(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { blocks, peakSchedule } = parseGreenButtonFile(ev.target?.result as string);
        if (blocks.length === 0) throw new Error('No IntervalReading data found.');
        if (peakSchedule) onPeakScheduleLoaded?.(peakSchedule);
        if (blocks.length === 1) applyBlock(blocks[0], file.name);
        else setPendingBlocks(blocks);
      }
      catch (err) { setError(err instanceof Error ? err.message : 'Error'); setRawData(null); }
      finally { setLoading(false); }
    };
    reader.readAsText(file);
  };

  const handleSelectBlock = (idx: number) => {
    if (!pendingBlocks || !fileName) return;
    applyBlock(pendingBlocks[idx], fileName);
    setPendingBlocks(null);
  };

  const handleCancelBlockPicker = () => {
    setPendingBlocks(null);
    setFileName(null);
  };

  const loadSampleData = () => {
    setLoading(true); setFileName("demo.xml"); setError(null); onLoadStart?.('sample');
    setTimeout(() => { setRawData(generateSampleData()); setLoadId(n => n + 1); setResolution('DAILY'); setLoading(false); }, SAMPLE_LOAD_DELAY);
  };

  const reset = () => {
    setRawData(null); setFileName(null); setError(null);
  };

  const loadFromHistory = (data: DataPoint[], name: string, savedResolution: string) => {
    onLoadStart?.('history');
    setFileName(name);
    setRawData(data);
    setLoadId(n => n + 1);
    setResolution(savedResolution);
    setError(null);
    setPendingBlocks(null);
  };

  return {
    rawData,
    loading,
    error,
    fileName,
    pendingBlocks,
    dataBounds,
    loadId,
    handleFileUpload,
    handleSelectBlock,
    handleCancelBlockPicker,
    loadSampleData,
    loadFromHistory,
    reset,
  };
}
