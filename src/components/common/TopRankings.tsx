import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DollarSign, Zap, Gauge, Flame, Snowflake, ChevronRight } from 'lucide-react';
import type { RankGranularity, RankMetric, RankingEntry } from '../../utils/rankings';
import type { RankingsResponse } from '../../utils/rankings.worker';
import { usePersistentState } from '../../hooks/usePersistentState';
import { PulseLoader } from './PulseLoader';
import type { DataPoint } from '../../types';
import type { HourlyWeatherData } from '../../utils/weatherData';
import { formatCost } from '../../utils/formatters';
import { formatEnergyValue, type EnergyUnit } from '../../utils/energyUnits';
import { formatDemandValue } from '../../utils/demandUnits';

const GRANULARITIES: { id: RankGranularity; label: string }[] = [
  { id: 'hour', label: 'Hours' },
  { id: 'day', label: 'Days' },
  { id: 'week', label: 'Weeks' },
  { id: 'month', label: 'Months' },
];

const METRICS: { id: RankMetric; label: string; icon: React.ReactNode; needsTemp?: boolean }[] = [
  { id: 'cost', label: 'Cost', icon: <DollarSign className="w-3.5 h-3.5" /> },
  { id: 'energy', label: 'Energy', icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'demand', label: 'Demand', icon: <Gauge className="w-3.5 h-3.5" /> },
  { id: 'heat', label: 'Heat', icon: <Flame className="w-3.5 h-3.5" />, needsTemp: true },
  { id: 'cold', label: 'Cold', icon: <Snowflake className="w-3.5 h-3.5" />, needsTemp: true },
];

interface TopRankingsProps {
  data: DataPoint[];
  weather: HourlyWeatherData[];
  hasTemperature: boolean;
  energyUnit: EnergyUnit;
  temperatureUnit: 'C' | 'F';
  onViewRanking: (entry: RankingEntry) => void;
}

function formatValue(
  entry: RankingEntry,
  metric: RankMetric,
  energyUnit: EnergyUnit,
  temperatureUnit: 'C' | 'F',
): string {
  if (metric === 'cost') return formatCost(entry.value);
  if (metric === 'energy') return `${formatEnergyValue(entry.value, energyUnit)} ${energyUnit}`;
  if (metric === 'demand') return `${formatDemandValue(entry.value)} kW`;
  // heat / cold — entry.value is the average temperature in °C
  const temp = temperatureUnit === 'F' ? entry.value * 9 / 5 + 32 : entry.value;
  return `${Math.round(temp)}°${temperatureUnit}`;
}

export const TopRankings = React.memo(function TopRankings({
  data,
  weather,
  hasTemperature,
  energyUnit,
  temperatureUnit,
  onViewRanking,
}: TopRankingsProps) {
  const [granularity, setGranularity] = usePersistentState<RankGranularity>('gb-rankings-granularity', 'day');
  const [metric, setMetric] = usePersistentState<RankMetric>('gb-rankings-metric', 'cost');

  const availableMetrics = useMemo(
    () => METRICS.filter((m) => !m.needsTemp || hasTemperature),
    [hasTemperature],
  );

  // If temperature data disappears while a temp metric is selected, fall back.
  const activeMetric: RankMetric =
    (metric === 'heat' || metric === 'cold') && !hasTemperature ? 'cost' : metric;

  // computeRankings iterates every data point and sorts the buckets, which can
  // block the main thread for a noticeable beat on large datasets. We run it in
  // a Web Worker so opening the modal / switching tabs stays responsive and the
  // standard loading animation shows while results come back. `null` = loading.
  const [rankings, setRankings] = useState<RankingEntry[] | null>(null);
  const workerRef = useRef<Worker | null>(null);
  // Monotonic request id so out-of-order/stale worker responses are ignored.
  const requestIdRef = useRef(0);

  // Lazily create the worker and route its responses (latest request wins).
  useEffect(() => {
    const worker = new Worker(new URL('../../utils/rankings.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<RankingsResponse>) => {
      if (e.data.id === requestIdRef.current) setRankings(e.data.rankings);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Send the dataset to the worker only when it actually changes, so repeated
  // metric/granularity switches don't re-copy the whole array across the wire.
  useEffect(() => {
    workerRef.current?.postMessage({ kind: 'data', data, weather });
  }, [data, weather]);

  // Request a fresh computation whenever the dataset or selection changes.
  useEffect(() => {
    setRankings(null);
    const id = ++requestIdRef.current;
    workerRef.current?.postMessage({
      kind: 'compute',
      id,
      granularity,
      metric: activeMetric,
      limit: 20,
    });
  }, [data, weather, granularity, activeMetric]);

  return (
    <div className="space-y-3">
      {/* Granularity selector */}
      <div className="flex bg-sunken p-1 rounded-lg border border-line">
        {GRANULARITIES.map((g) => (
          <button
            key={g.id}
            onClick={() => setGranularity(g.id)}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
              granularity === g.id
                ? 'bg-surface-3 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Metric selector */}
      <div className="flex flex-wrap gap-1.5">
        {availableMetrics.map((m) => (
          <button
            key={m.id}
            onClick={() => setMetric(m.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              activeMetric === m.id
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'bg-surface-2 text-slate-400 border-line hover:text-slate-200 hover:border-line-2'
            }`}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {/* Rankings list */}
      {rankings === null ? (
        <PulseLoader
          variant="analysis"
          size="sm"
          message="Crunching rankings…"
          subMessage="Sorting your top periods"
          className="py-6"
        />
      ) : rankings.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-8">
          No data available for this ranking.
        </p>
      ) : (
        <ol className="space-y-1">
          {rankings.map((entry, idx) => (
            <li key={entry.periodStart}>
              <button
                onClick={() => onViewRanking(entry)}
                className="w-full flex items-center gap-3 px-3 py-2 bg-surface-2 hover:bg-surface-3 border border-line hover:border-line-2 rounded-lg transition-colors group text-left"
              >
                <span className="text-[11px] font-mono text-slate-500 w-5 text-right flex-shrink-0">
                  {idx + 1}
                </span>
                <span className="flex-1 min-w-0 text-sm text-slate-200 truncate">
                  {entry.label}
                </span>
                <span className="text-sm font-medium text-slate-100 tabular-nums flex-shrink-0">
                  {formatValue(entry, activeMetric, energyUnit, temperatureUnit)}
                </span>
                <span className="flex items-center gap-0.5 text-[11px] text-slate-500 group-hover:text-amber-400 transition-colors flex-shrink-0">
                  View
                  <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});
