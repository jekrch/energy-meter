import { type DataPoint, DAYS_OF_WEEK, MONTHS } from '../types';
import { formatShortDate } from '../utils/formatters';
import type {
  TimelineBucket,
  AnalysisAverageResult,
  AnalysisTimelineResult,
} from './useAnalysis';

export type AnalysisGroupBy = 'dayOfWeek' | 'month' | 'hour';

// Accumulate a single reading into the timeline bucket map (mutates `map`).
// Keyed by calendar period (month / day / hour) so each period aggregates once.
// Extracted from the chunked effect in useAnalysis so the math is unit-testable.
export function accumulateBucket(
  map: Map<string, TimelineBucket>,
  d: DataPoint,
  groupBy: AnalysisGroupBy,
): void {
  const ts = d.timestamp * 1000;
  const date = new Date(ts);

  let categoryKey: number;
  if (groupBy === 'dayOfWeek') categoryKey = date.getDay();
  else if (groupBy === 'month') categoryKey = date.getMonth();
  else categoryKey = date.getHours();

  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const hour = date.getHours();

  let tlKey: string;
  let tlLabel: string;
  let sortTs: number;
  let periodStart: number;
  let periodEnd: number;

  if (groupBy === 'month') {
    tlKey = `${year}-${month}`;
    tlLabel = `${MONTHS[month]} ${year}`;
    sortTs = new Date(year, month, 1).getTime() / 1000;
    periodStart = sortTs;
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
    periodEnd = Math.floor(monthEnd.getTime() / 1000);
  } else if (groupBy === 'dayOfWeek') {
    tlKey = `${year}-${month}-${day}`;
    tlLabel = `${DAYS_OF_WEEK[date.getDay()]} ${formatShortDate(date)}`;
    sortTs = new Date(year, month, day).getTime() / 1000;
    periodStart = sortTs;
    periodEnd = periodStart + 86400 - 1;
  } else {
    tlKey = `${year}-${month}-${day}-${hour}`;
    tlLabel = `${formatShortDate(date)} ${hour}:00`;
    sortTs = new Date(year, month, day, hour).getTime() / 1000;
    periodStart = sortTs;
    periodEnd = periodStart + 3600 - 1;
  }

  const existing = map.get(tlKey);
  if (existing) {
    existing.sum += d.value;
    existing.costSum += d.cost ?? 0;
    existing.count += 1;
  } else {
    map.set(tlKey, {
      sum: d.value,
      costSum: d.cost ?? 0,
      count: 1,
      timestamp: sortTs,
      label: tlLabel,
      categoryKey,
      periodStart,
      periodEnd,
    });
  }
}

// Aggregate an entire dataset in one pass (non-chunked — used for tests and
// small inputs). The effect itself accumulates point-by-point via accumulateBucket.
export function aggregateBuckets(
  data: DataPoint[],
  groupBy: AnalysisGroupBy,
): Map<string, TimelineBucket> {
  const map = new Map<string, TimelineBucket>();
  for (const d of data) accumulateBucket(map, d, groupBy);
  return map;
}

// Turn accumulated buckets into the sorted timeline plus per-category averages.
export function finalizeBuckets(
  timelineMap: Map<string, TimelineBucket>,
  groupCount: number,
  labels: string[],
): { averages: AnalysisAverageResult[]; timeline: AnalysisTimelineResult[] } {
  const timeline: AnalysisTimelineResult[] = Array.from(timelineMap.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(g => ({
      timestamp: g.timestamp,
      value: g.sum,
      cost: g.costSum,
      fullDate: g.label,
      count: g.count,
      categoryKey: g.categoryKey,
      periodStart: g.periodStart,
      periodEnd: g.periodEnd,
    }));

  const categoryTotals: { values: number[]; costs: number[] }[] =
    Array.from({ length: groupCount }, () => ({ values: [], costs: [] }));

  for (const period of timelineMap.values()) {
    const cat = categoryTotals[period.categoryKey];
    if (cat) {
      cat.values.push(period.sum);
      cat.costs.push(period.costSum);
    }
  }

  const averages: AnalysisAverageResult[] = categoryTotals.map((group, idx) => {
    const valueCount = group.values.length;
    const costCount = group.costs.length;

    return {
      key: idx,
      label: labels[idx],
      average: valueCount > 0
        ? Math.round(group.values.reduce((a, b) => a + b, 0) / valueCount)
        : 0,
      avgCost: costCount > 0
        ? Math.round(group.costs.reduce((a, b) => a + b, 0) / costCount)
        : 0,
      count: valueCount,
    };
  });

  return { averages, timeline };
}
