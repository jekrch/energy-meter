import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Clock, AlertTriangle, Calendar, BarChart2 } from 'lucide-react';
import { type DataPoint } from '../../types';
import { detectRateChanges, formatRate, } from '../../utils/dataUtils';
import { formatShortDate } from '../../utils/formatters';

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


const getSeasonLabelShort = (season: 'summer' | 'winter'): string => {
  return season === 'summer' ? 'Summer' : 'Winter';
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

  const yoyComparisons = useMemo(
    () => calculateYoYComparisons(data),
    [data]
  );

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
    return `${formatShortDate(date)}, ${date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })}`;
  };

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-violet-500/10 p-1.5 rounded-lg">
            <DollarSign className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Rate Changes</h3>
            <p className="text-xs text-slate-500">Detected from cost/usage ratio</p>
          </div>
        </div>
        
        {/* Summary Stats */}
        <div className="flex items-center gap-4 text-xs">
          <div className="text-right">
            <span className="text-slate-500">Avg Rate</span>
            <p className="text-violet-400 font-medium">{formatRate(avgRate)}</p>
          </div>
          <div className="text-right">
            <span className="text-slate-500">Range</span>
            <p className="text-slate-300 font-medium">
              {formatRate(minRate)} – {formatRate(maxRate)}
            </p>
          </div>
        </div>
      </div>

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
            <div className="flex flex-wrap gap-2 pb-3 border-b border-slate-800">
              {periods.slice(0, 6).map((period, idx) => (
                <div
                  key={idx}
                  className="bg-slate-800/50 rounded px-2.5 py-1.5 text-xs border border-slate-700/50"
                >
                  <span className="text-violet-400 font-medium">{formatRate(period.rate)}</span>
                  <span className="text-slate-500 ml-1.5">
                    {formatShortDate(new Date(period.startTimestamp * 1000))}
                  </span>
                </div>
              ))}
              {periods.length > 6 && (
                <div className="bg-slate-800/30 rounded px-2.5 py-1.5 text-xs text-slate-500">
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
                  <div className={`p-1.5 rounded ${
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
                      <span className="text-slate-400 text-xs">
                        {formatRate(change.previousRate)}
                      </span>
                      <span className="text-slate-600">→</span>
                      <span className={`text-sm font-medium ${
                        change.direction === 'increase' 
                          ? 'text-red-400' 
                          : 'text-emerald-400'
                      }`}>
                        {formatRate(change.newRate)}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
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
            {yoyComparisons.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-800">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart2 className="w-4 h-4 text-violet-400" />
                  <h4 className="text-xs font-semibold text-slate-300">Year-over-Year Comparison</h4>
                </div>
                <div className="space-y-2">
                  {yoyComparisons.map((comp, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between p-2.5 rounded-lg border ${
                        comp.percentChange > 0
                          ? 'bg-red-500/5 border-red-500/20'
                          : 'bg-emerald-500/5 border-emerald-500/20'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">
                          {getSeasonLabelShort(comp.season)}
                        </span>
                        <span className="text-xs text-slate-500">
                          {comp.year1} → {comp.year2}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">
                          {formatRate(comp.rate1)}
                        </span>
                        <span className="text-slate-600">→</span>
                        <span className={`text-sm font-medium ${
                          comp.percentChange > 0 ? 'text-red-400' : 'text-emerald-400'
                        }`}>
                          {formatRate(comp.rate2)}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
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
            )}

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