import { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { type DataPoint, type TimeRange } from '../types';
import { parseGreenButtonFile, generateSampleData, type ParsedBlock } from '../utils/dataUtils';
import { BLOCK_DAILY_THRESHOLD, SAMPLE_LOAD_DELAY } from '../constants';

interface UseEnergyDataOptions {
  // The chosen resolution lives with the chart state in App; loading a block
  // decides RAW vs DAILY, so the hook sets it through this.
  setResolution: (resolution: string) => void;
  // Called when a new dataset starts loading (App resets the table page).
  onLoadStart?: () => void;
  // Called after a fresh file is parsed successfully (not triggered by history loads).
  onDataLoaded?: (fileName: string, data: DataPoint[], resolution: string) => void;
}

// Owns the loaded dataset and everything that produces it: upload/sample/block
// handling, parse loading + error state, and the data time bounds. Extracted
// from App so the upload pipeline is isolated from the rendering concerns.
export function useEnergyData({ setResolution, onLoadStart, onDataLoaded }: UseEnergyDataOptions) {
  const [rawData, setRawData] = useState<DataPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingBlocks, setPendingBlocks] = useState<ParsedBlock[] | null>(null);
  const [dataBounds, setDataBounds] = useState<TimeRange>({ start: null, end: null });

  useEffect(() => {
    if (rawData && rawData.length > 0) {
      setDataBounds({ start: rawData[0].timestamp, end: rawData[rawData.length - 1].timestamp });
    }
  }, [rawData]);

  const applyBlock = (block: ParsedBlock, name: string) => {
    const res = block.data.length > BLOCK_DAILY_THRESHOLD ? 'DAILY' : 'RAW';
    setRawData(block.data);
    setResolution(res);
    onDataLoaded?.(name, block.data, res);
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setError(null); setFileName(file.name); onLoadStart?.();
    setPendingBlocks(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { blocks } = parseGreenButtonFile(ev.target?.result as string);
        if (blocks.length === 0) throw new Error('No IntervalReading data found.');
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
    setLoading(true); setFileName("demo.xml"); setError(null); onLoadStart?.();
    setTimeout(() => { setRawData(generateSampleData()); setResolution('DAILY'); setLoading(false); }, SAMPLE_LOAD_DELAY);
  };

  const reset = () => {
    setRawData(null); setFileName(null); setError(null);
  };

  const loadFromHistory = (data: DataPoint[], name: string, savedResolution: string) => {
    onLoadStart?.();
    setFileName(name);
    setRawData(data);
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
    handleFileUpload,
    handleSelectBlock,
    handleCancelBlockPicker,
    loadSampleData,
    loadFromHistory,
    reset,
  };
}
