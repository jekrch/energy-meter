import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Clock, AlertTriangle, Calendar } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { type DataPoint } from '../../types';
import { detectRateChanges, formatRate, } from '../../utils/dataUtils';
import { formatShortDate, formatChartTime } from '../../utils/formatters';

// Axis tick text is mono (JetBrains Mono) to match the main analysis chart.
const AXIS_TICK = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" };

// Compact $/kWh formatter for the rate chart's Y axis. One decimal of a cent so
// narrow ranges (where the domain spans well under a cent) get distinct labels
// instead of every tick rounding to the same whole-cent value.
const formatRateAxis = (dollarsPerKwh: number): string => {
  if (!isFinite(dollarsPerKwh)) return '';
  if (dollarsPerKwh > 0 && dollarsPerKwh < 1) return `${(dollarsPerKwh * 100).toFixed(1)}¢`;
  return `$${dollarsPerKwh.toFixed(2)}`;
};

// Custom X-axis tick that anchors the first/last labels inward so the edge
// dates don't overflow the chart bounds (Recharts centers labels by default).
const RateAxisTick = (props: any) => {
  const { x, y, payload, index, visibleTicksCount } = props;
  const anchor = index === 0 ? 'start' : index === visibleTicksCount - 1 ? 'end' : 'middle';
  return (
    <text x={x} y={y} dy={10} textAnchor={anchor} fill="#94a3b8" fontSize={10} style={AXIS_TICK}>
      {formatShortDate(new Date(payload.value * 1000))}
    </text>
  );
};

interface RateChartTooltipProps {
  active?: boolean;
  payload?: any[];
}

const RateChartTooltip: React.FC<RateChartTooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="bg-surface-2 border border-line-2 rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-slate-400 mb-0.5">{point.fullLabel}</p>
      <p className="text-sm font-mono tabular-nums text-emerald-400 font-medium">
        {formatRate(point.rate)}
      </p>
    </div>
  );
};

// Check if a timestamp falls near a month boundary (within first 2 days)
const isMonthBoundary = (timestamp: number): boolean => {
  const date = new Date(timestamp * 1000);
  return date.getDate() <= 2;
};

// Season definitions
type Season = 'summer' | 'winter';
const getSeason = (month: number): Season => {
  // Summer: June-September (months 5-8), Winter: October-May
  return month >= 5 && month <= 8 ? 'summer' : 'winter';
};

export interface YearOverYearComparison {
  season: Season;
  year1: number;
  year2: number;
  rate1: number;
  rate2: number;
  percentChange: number;
  readingCount1: number;
  readingCount2: number;
}

/**
 * Calculates year-over-year rate comparisons by season
 */
export const calculateYoYComparisons = (data: DataPoint[]): YearOverYearComparison[] => {
  if (data.length < 2) return [];

  // Group readings by year and season
  const seasonalRates: Record<string, { totalCost: number; totalValue: number; count: number }> = {};

  for (const point of data) {
    if (point.value < 50 || point.cost <= 0) continue;
    
    const date = new Date(point.timestamp * 1000);
    const year = date.getFullYear();
    const season = getSeason(date.getMonth());
    const key = `${year}-${season}`;

    if (!seasonalRates[key]) {
      seasonalRates[key] = { totalCost: 0, totalValue: 0, count: 0 };
    }
    seasonalRates[key].totalCost += point.cost;
    seasonalRates[key].totalValue += point.value;
    seasonalRates[key].count++;
  }

  // Find YoY comparisons
  const comparisons: YearOverYearComparison[] = [];
  const seasons: Season[] = ['summer', 'winter'];

  for (const season of seasons) {
    // Get all years that have this season
    const yearsWithSeason = Object.keys(seasonalRates)
      .filter(k => k.endsWith(`-${season}`))
      .map(k => parseInt(k.split('-')[0]))
      .sort();

    // Compare consecutive years
    for (let i = 0; i < yearsWithSeason.length - 1; i++) {
      const year1 = yearsWithSeason[i];
      const year2 = yearsWithSeason[i + 1];
      
      const data1 = seasonalRates[`${year1}-${season}`];
      const data2 = seasonalRates[`${year2}-${season}`];

      // Require at least 100 readings for reliable comparison
      if (data1.count < 100 || data2.count < 100) continue;

      const rate1 = data1.totalCost / data1.totalValue;
      const rate2 = data2.totalCost / data2.totalValue;
      const percentChange = ((rate2 - rate1) / rate1) * 100;

      comparisons.push({
        season,
        year1,
        year2,
        rate1,
        rate2,
        percentChange,
        readingCount1: data1.count,
        readingCount2: data2.count
      });
    }
  }

  // Sort by year2 descending (most recent first)
  return comparisons.sort((a, b) => b.year2 - a.year2 || (a.season === 'summer' ? -1 : 1));
};

interface RateChangesCardProps {
  data: DataPoint[];
  tolerancePercent?: number;
}

export const RateChangesCard: React.FC<RateChangesCardProps> = ({ 
  data, 
  tolerancePercent = 8 
}) => {
  const { changes, periods } = useMemo(
    () => detectRateChanges(data, tolerancePercent),
    [data, tolerancePercent]
  );

  // Rate-over-time series for the selected range. Plots the *detected* rate
  // periods as a step function rather than the raw cost/value of every reading:
  // the per-reading ratio jitters by a fraction of a cent (cost is rounded to
  // whole micro-dollars), which a narrow auto-scaled Y domain amplifies into a
  // jagged line. The periods are the same data the card lists as rate changes,
  // so this is genuinely flat between changes. Rate is kept as raw micro-$/Wh
  // (for the tooltip's formatRate) and as $/kWh (for the chart axis).
  const rateChartData = useMemo(() => {
    if (periods.length === 0) return [];

    const toPoint = (timestamp: number, rate: number) => {
      const date = new Date(timestamp * 1000);
      return {
        timestamp,
        rate,
        dollarsPerKwh: rate * 0.01,
        fullLabel: `${formatShortDate(date)} ${formatChartTime(date)}`,
      };
    };

    // One point at the start of each period; stepAfter holds the rate flat until
    // the next period begins. Close the line at the final period's end so it
    // spans the full selected range.
    const pts = periods.map(p => toPoint(p.startTimestamp, p.rate));
    const last = periods[periods.length - 1];
    if (last.endTimestamp > last.startTimestamp) {
      pts.push(toPoint(last.endTimestamp, last.rate));
    }
    return pts;
  }, [periods]);

  // Padded Y domain so a single flat period isn't a degenerate zero-height
  // domain and the line sits comfortably in the middle of the plot.
  const yDomain = useMemo<[number, number] | undefined>(() => {
    if (rateChartData.length === 0) return undefined;
    const vals = rateChartData.map(d => d.dollarsPerKwh);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1e-9) {
      const pad = Math.max(lo * 0.15, 0.01);
      return [lo - pad, hi + pad];
    }
    const pad = (hi - lo) * 0.25;
    return [lo - pad, hi + pad];
  }, [rateChartData]);

  // Calculate average rate for the period
  const avgRate = useMemo(() => {
    if (!data.length) return 0;
    const validPoints = data.filter(p => p.value >= 50 && p.cost > 0);
    if (!validPoints.length) return 0;
    const totalCost = validPoints.reduce((sum, p) => sum + p.cost, 0);
    const totalValue = validPoints.reduce((sum, p) => sum + p.value, 0);
    return totalCost / totalValue;
  }, [data]);

  // Find min/max rates
  const { minRate, maxRate } = useMemo(() => {
    if (!periods.length) return { minRate: 0, maxRate: 0 };
    const rates = periods.map(p => p.rate);
    return { minRate: Math.min(...rates), maxRate: Math.max(...rates) };
  }, [periods]);

  if (!data.length) return null;

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts * 1000);
    return `${formatShortDate(date)} ${formatChartTime(date)}`;
  };

  return (
    <div className="bg-surface-2 rounded-2xl border border-line hover:border-white/30 transition-colors duration-150 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-header-line flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="bg-violet-500/10 p-1.5 rounded-lg shrink-0">
            <DollarSign className="w-4 h-4 text-violet-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-100">Rate Changes</h3>
            <p className="text-xs text-slate-500 truncate">Detected from cost/usage ratio</p>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="flex items-center gap-4 text-xs shrink-0">
          <div className="text-left sm:text-right">
            <span className="text-slate-500">Avg Rate</span>
            <p className="text-violet-400 font-mono tabular-nums font-medium">{formatRate(avgRate)}</p>
          </div>
          <div className="text-left sm:text-right">
            <span className="text-slate-500">Range</span>
            <p className="text-slate-300 font-mono tabular-nums font-medium whitespace-nowrap">
              {formatRate(minRate)} – {formatRate(maxRate)}
            </p>
          </div>
        </div>
      </div>

      {/* Rate-over-time chart */}
      {rateChartData.length > 1 && (
        <div className="px-4 pt-4 pb-2 border-b border-header-line">
          <div className="text-xs text-slate-400 mb-2">Rate over selected range</div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rateChartData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                <defs>
                  <linearGradient id="rateChartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#475569" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  stroke="#94a3b8"
                  fontSize={10}
                  tick={<RateAxisTick />}
                  tickLine={true}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis
                  dataKey="dollarsPerKwh"
                  stroke="#94a3b8"
                  fontSize={10}
                  tick={AXIS_TICK}
                  tickLine={true}
                  axisLine={false}
                  width={50}
                  domain={yDomain ?? ['auto', 'auto']}
                  tickFormatter={formatRateAxis}
                />
                <Tooltip content={<RateChartTooltip />} />
                <Area
                  type="stepAfter"
                  dataKey="dollarsPerKwh"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#rateChartGradient)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {changes.length === 0 ? (
          <div className="flex items-center gap-3 text-slate-400 py-4">
            <Clock className="w-5 h-5" />
            <div>
              <p className="text-sm">No significant rate changes detected</p>
              <p className="text-xs text-slate-500">
                Rate appears stable at {formatRate(avgRate)} (±{tolerancePercent}% threshold)
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Rate Periods Summary */}
            <div className="flex flex-wrap gap-2 pb-3 border-b border-header-line">
              {periods.slice(0, 6).map((period, idx) => (
                <div
                  key={idx}
                  className="bg-surface-2 rounded px-2.5 py-1.5 text-xs border border-line-2"
                >
                  <span className="text-violet-400 font-mono tabular-nums font-medium">{formatRate(period.rate)}</span>
                  <span className="text-slate-500 font-mono tabular-nums ml-1.5">
                    {formatShortDate(new Date(period.startTimestamp * 1000))}
                  </span>
                </div>
              ))}
              {periods.length > 6 && (
                <div className="bg-surface-2 rounded px-2.5 py-1.5 text-xs text-slate-500">
                  +{periods.length - 6} more periods
                </div>
              )}
            </div>

            {/* Changes List */}
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
              {changes.map((change, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border ${
                    change.direction === 'increase'
                      ? 'bg-red-500/5 border-red-500/20'
                      : 'bg-emerald-500/5 border-emerald-500/20'
                  }`}
                >
                  <div className={`p-1.5 rounded shrink-0 ${
                    change.direction === 'increase'
                      ? 'bg-red-500/10'
                      : 'bg-emerald-500/10'
                  }`}>
                    {change.direction === 'increase' 
                      ? <TrendingUp className="w-4 h-4 text-red-400" />
                      : <TrendingDown className="w-4 h-4 text-emerald-400" />
                    }
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-slate-400 text-xs font-mono tabular-nums">
                        {formatRate(change.previousRate)}
                      </span>
                      <span className="text-slate-600">→</span>
                      <span className={`text-sm font-mono tabular-nums font-medium ${
                        change.direction === 'increase'
                          ? 'text-red-400'
                          : 'text-emerald-400'
                      }`}>
                        {formatRate(change.newRate)}
                      </span>
                      <span className={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded ${
                        change.direction === 'increase'
                          ? 'bg-red-500/10 text-red-400'
                          : 'bg-emerald-500/10 text-emerald-400'
                      }`}>
                        {change.direction === 'increase' ? '+' : ''}
                        {change.percentChange.toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formatTimestamp(change.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Year-over-Year Comparisons */}
            {/* {yoyComparisons.length > 0 && (
              <div className="mt-4 pt-4 border-t border-header-line">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart2 className="w-4 h-4 text-violet-400" />
                  <h4 className="text-xs font-semibold text-slate-300">Year-over-Year Comparison</h4>
                </div>
                <div className="space-y-2">
                  {yoyComparisons.map((comp, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 p-2.5 rounded-lg border ${
                        comp.percentChange > 0
                          ? 'bg-red-500/5 border-red-500/20'
                          : 'bg-emerald-500/5 border-emerald-500/20'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-slate-400">
                          {getSeasonLabelShort(comp.season)}
                        </span>
                        <span className="text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                          {comp.year1} → {comp.year2}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-xs text-slate-400 font-mono tabular-nums">
                          {formatRate(comp.rate1)}
                        </span>
                        <span className="text-slate-600">→</span>
                        <span className={`text-sm font-mono tabular-nums font-medium ${
                          comp.percentChange > 0 ? 'text-red-400' : 'text-emerald-400'
                        }`}>
                          {formatRate(comp.rate2)}
                        </span>
                        <span className={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded whitespace-nowrap ${
                          comp.percentChange > 0
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-emerald-500/10 text-emerald-400'
                        }`}>
                          {comp.percentChange > 0 ? '+' : ''}
                          {comp.percentChange.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-2">
                  Compares average rates for the same season across years to reveal underlying rate changes.
                </p>
              </div>
            )} */}

            {/* TOU Hint */}
            {changes.length >= 2 && !changes.some(c => isMonthBoundary(c.timestamp)) && (
              <div className="flex items-start gap-2 mt-3 p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-200/80">
                  Multiple rate changes detected. This may indicate time-of-use (TOU) pricing 
                  or seasonal rate adjustments from your utility.
                </p>
              </div>
            )}

            {/* Seasonal Rate Hint */}
            {changes.some(c => isMonthBoundary(c.timestamp)) && (
              <div className="flex items-start gap-2 mt-3 p-2.5 bg-sky-500/5 border border-sky-500/20 rounded-lg">
                <Calendar className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
                <p className="text-xs text-sky-200/80">
                  Some rate changes occur at month boundaries, which may reflect seasonal pricing tiers 
                  rather than permanent rate adjustments. Many utilities charge higher rates during 
                  summer months (June–September) due to peak demand.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};