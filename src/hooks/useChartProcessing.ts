import { useState, useEffect, useRef, useMemo } from 'react';
import { type DataPoint } from '../types';
import { processDataAsync, downsampleLTTB } from '../utils/dataUtils';
import { MAX_CHART_POINTS, MIN_LOADING_TIME } from '../constants';

// Owns the chart aggregation pipeline: runs processDataAsync off the main
// paint and gates it behind a minimum loading time. processDataAsync caps the
// series to MAX_CHART_POINTS *before* enriching each point with date strings,
// so a huge RAW/HOURLY view never materializes a full enriched copy (the iOS
// memory crash). The chartData downsample below is then a no-op safety net.
export function useChartProcessing(viewData: DataPoint[], resolution: string) {
  const [aggregatedData, setAggregatedData] = useState<DataPoint[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(0);

  useEffect(() => {
    const currentProcess = ++processingRef.current;
    // Spinner/result state here is an intentional async side effect
    // (processDataAsync below), not derivable render state.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!viewData.length) { setAggregatedData([]); return; }

    setIsProcessing(true);
    /* eslint-enable react-hooks/set-state-in-effect */

    requestAnimationFrame(() => {
      const startTime = Date.now();

      processDataAsync(viewData, resolution, MAX_CHART_POINTS).then(result => {
        if (currentProcess === processingRef.current) {
          const elapsed = Date.now() - startTime;
          const remainingTime = Math.max(0, MIN_LOADING_TIME - elapsed);

          setTimeout(() => {
            if (currentProcess === processingRef.current) {
              setAggregatedData(result);
              setIsProcessing(false);
            }
          }, remainingTime);
        }
      });
    });
  }, [viewData, resolution]);

  const chartData = useMemo(() => downsampleLTTB(aggregatedData, MAX_CHART_POINTS), [aggregatedData]);

  return { aggregatedData, isProcessing, chartData };
}
