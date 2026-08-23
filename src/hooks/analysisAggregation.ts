import { type DataPoint, DAYS_OF_WEEK, MONTHS, OFF_PEAK } from '../types';
import { classify, type PeakIndex } from '../utils/peakSchedule';
import { formatShortDate, formatChartTime, formatMonthYear } from '../utils/formatters';
import { toDemandKW } from '../utils/demandUnits';
import type {
  TimelineBucket,
  AnalysisAverageResult,
  AnalysisTimelineResult,
} from './useAnalysis';

export type AnalysisGroupBy = 'dayOfWeek' | 'month' | 'hour';

// Accumulate a single reading into the timeline bucket map (mutates `map`).
// Keyed by calendar period (month / day / hour) so each period aggregates once.
// Extracted from the chunked effect in useAnalysis so the math is unit-testable.
// Slot a reading's rate period occupies in a bucket's per-period arrays.
// Off-peak is the last slot so the arrays stay dense and index-aligned with
// `schedule.periods`.
export const peakSlot = (index: PeakIndex, timestamp: number): number => {
  const periodIdx = classify(timestamp, index);
  return periodIdx === OFF_PEAK ? index.schedule.periods.length : periodIdx;
};

export const peakSlotCount = (index: PeakIndex | null): number =>
  index ? index.schedule.periods.length + 1 : 0;

export function accumulateBucket(
  map: Map<string, TimelineBucket>,
  d: DataPoint,
  groupBy: AnalysisGroupBy,
  // When present, each bucket also tracks how its energy and cost divide across
  // the rate periods, which is what lets a day or month bar be stacked rather
  // than shaded a single (and therefore wrong) color.
  peakIndex: PeakIndex | null = null,
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
    tlLabel = formatMonthYear(MONTHS[month], year);
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
    tlLabel = `${formatShortDate(date)} ${formatChartTime(new Date(year, month, day, hour))}`;
    sortTs = new Date(year, month, day, hour).getTime() / 1000;
    periodStart = sortTs;
    periodEnd = periodStart + 3600 - 1;
  }

  const demand = toDemandKW(d.value, d.duration);
  const cost = d.cost ?? 0;

  const existing = map.get(tlKey);
  if (existing) {
    existing.sum += d.value;
    existing.costSum += cost;
    if (demand > existing.demandMax) existing.demandMax = demand;
    existing.count += 1;
    if (peakIndex && existing.periodValues && existing.periodCosts) {
      const slot = peakSlot(peakIndex, d.timestamp);
      existing.periodValues[slot] += d.value;
      existing.periodCosts[slot] += cost;
    }
  } else {
    const bucket: TimelineBucket = {
      sum: d.value,
      costSum: cost,
      demandMax: demand,
      count: 1,
      timestamp: sortTs,
      label: tlLabel,
      categoryKey,
      periodStart,
      periodEnd,
    };
    if (peakIndex) {
      const slots = peakSlotCount(peakIndex);
      bucket.periodValues = new Array<number>(slots).fill(0);
      bucket.periodCosts = new Array<number>(slots).fill(0);
      const slot = peakSlot(peakIndex, d.timestamp);
      bucket.periodValues[slot] = d.value;
      bucket.periodCosts[slot] = cost;
    }
    map.set(tlKey, bucket);
  }
}

// Aggregate an entire dataset in one pass (non-chunked — used for tests and
// small inputs). The effect itself accumulates point-by-point via accumulateBucket.
export function aggregateBuckets(
  data: DataPoint[],
  groupBy: AnalysisGroupBy,
  peakIndex: PeakIndex | null = null,
): Map<string, TimelineBucket> {
  const map = new Map<string, TimelineBucket>();
  for (const d of data) accumulateBucket(map, d, groupBy, peakIndex);
  return map;
}

// Turn accumulated buckets into the sorted timeline plus per-category averages.
export function finalizeBuckets(
  timelineMap: Map<string, TimelineBucket>,
  groupCount: number,
  labels: string[],
  // periods.length + 1 (the off-peak slot), or 0 when no schedule is active.
  periodSlots = 0,
): { averages: AnalysisAverageResult[]; timeline: AnalysisTimelineResult[] } {
  const timeline: AnalysisTimelineResult[] = Array.from(timelineMap.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(g => ({
      timestamp: g.timestamp,
      value: g.sum,
      cost: g.costSum,
      demand: g.demandMax,
      fullDate: g.label,
      count: g.count,
      categoryKey: g.categoryKey,
      periodStart: g.periodStart,
      periodEnd: g.periodEnd,
      periodValues: g.periodValues,
      periodCosts: g.periodCosts,
    }));

  const categoryTotals: {
    values: number[];
    costs: number[];
    demands: number[];
    periodValues: number[];
    periodCosts: number[];
  }[] = Array.from({ length: groupCount }, () => ({
    values: [], costs: [], demands: [],
    periodValues: new Array<number>(periodSlots).fill(0),
    periodCosts: new Array<number>(periodSlots).fill(0),
  }));

  for (const period of timelineMap.values()) {
    const cat = categoryTotals[period.categoryKey];
    if (cat) {
      cat.values.push(period.sum);
      cat.costs.push(period.costSum);
      cat.demands.push(period.demandMax);
      if (period.periodValues && period.periodCosts) {
        for (let i = 0; i < periodSlots; i++) {
          cat.periodValues[i] += period.periodValues[i];
          cat.periodCosts[i] += period.periodCosts[i];
        }
      }
    }
  }

  const averages: AnalysisAverageResult[] = categoryTotals.map((group, idx) => {
    const valueCount = group.values.length;
    const costCount = group.costs.length;
    const demandCount = group.demands.length;

    return {
      key: idx,
      label: labels[idx],
      average: valueCount > 0
        ? Math.round(group.values.reduce((a, b) => a + b, 0) / valueCount)
        : 0,
      avgCost: costCount > 0
        ? Math.round(group.costs.reduce((a, b) => a + b, 0) / costCount)
        : 0,
      // Average of each period's peak — the standard load-profile view.
      demand: demandCount > 0
        ? group.demands.reduce((a, b) => a + b, 0) / demandCount
        : 0,
      count: valueCount,
      // Divided by the same denominator as `average`, so the stacked segments
      // still sum to the bar's height.
      periodAverages: periodSlots
        ? group.periodValues.map(v => (valueCount > 0 ? Math.round(v / valueCount) : 0))
        : undefined,
      periodAvgCosts: periodSlots
        ? group.periodCosts.map(c => (costCount > 0 ? Math.round(c / costCount) : 0))
        : undefined,
    };
  });

  return { averages, timeline };
}
