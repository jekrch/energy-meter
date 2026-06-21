import { type DataPoint, DAYS_OF_WEEK, MONTHS } from '../types';
import { formatShortDate, formatMonthYear } from './formatters';
import { toDemandKW } from './demandUnits';
import type { HourlyWeatherData } from './weatherData';

export type RankGranularity = 'hour' | 'day' | 'week' | 'month';
export type RankMetric = 'cost' | 'energy' | 'demand' | 'heat' | 'cold';

export interface RankingEntry {
  // Local-time unix seconds at the start of the bucket (hour / day / week / month).
  periodStart: number;
  label: string;
  // Metric value in native units: micro-dollars (cost), Wh (energy), kW (demand),
  // or average °C (heat / cold).
  value: number;
  granularity: RankGranularity;
  metric: RankMetric;
}

// Local-time start of the bucket containing `date`, in unix seconds. Weeks start
// on Sunday to match DAYS_OF_WEEK[0].
function periodStartOf(date: Date, g: RankGranularity): number {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  if (g === 'hour') return new Date(y, m, d, date.getHours()).getTime() / 1000;
  if (g === 'day') return new Date(y, m, d).getTime() / 1000;
  if (g === 'week') return new Date(y, m, d - date.getDay()).getTime() / 1000;
  return new Date(y, m, 1).getTime() / 1000;
}

function labelFor(periodStart: number, g: RankGranularity): string {
  const date = new Date(periodStart * 1000);
  if (g === 'hour') {
    const h = date.getHours();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${formatShortDate(date)}, ${h12}${h < 12 ? 'AM' : 'PM'}`;
  }
  if (g === 'day') return `${DAYS_OF_WEEK[date.getDay()]} ${formatShortDate(date)}`;
  if (g === 'week') {
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 6);
    return `${formatShortDate(date)} – ${formatShortDate(end)}`;
  }
  return formatMonthYear(MONTHS[date.getMonth()], date.getFullYear());
}

interface EnergyBucket {
  periodStart: number;
  sum: number;
  cost: number;
  demand: number;
}

// Rank time buckets by average temperature (heat = hottest first, cold = coldest).
function computeTempRankings(
  weather: HourlyWeatherData[],
  granularity: RankGranularity,
  metric: 'heat' | 'cold',
  limit: number,
): RankingEntry[] {
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const w of weather) {
    const ps = periodStartOf(new Date(w.timestamp * 1000), granularity);
    const b = buckets.get(ps);
    if (b) {
      b.sum += w.temperature;
      b.count += 1;
    } else {
      buckets.set(ps, { sum: w.temperature, count: 1 });
    }
  }

  const entries: RankingEntry[] = Array.from(buckets.entries()).map(([ps, b]) => ({
    periodStart: ps,
    label: labelFor(ps, granularity),
    value: b.sum / b.count,
    granularity,
    metric,
  }));

  entries.sort((a, b) => (metric === 'cold' ? a.value - b.value : b.value - a.value));
  return entries.slice(0, limit);
}

// Build the top-`limit` ranking entries for the given metric and bucket size.
// cost / energy / demand come from the meter data; heat / cold come from weather.
export function computeRankings(
  data: DataPoint[],
  weather: HourlyWeatherData[],
  granularity: RankGranularity,
  metric: RankMetric,
  limit = 20,
): RankingEntry[] {
  if (metric === 'heat' || metric === 'cold') {
    return computeTempRankings(weather, granularity, metric, limit);
  }

  const buckets = new Map<number, EnergyBucket>();
  for (const d of data) {
    const ps = periodStartOf(new Date(d.timestamp * 1000), granularity);
    let b = buckets.get(ps);
    if (!b) {
      b = { periodStart: ps, sum: 0, cost: 0, demand: 0 };
      buckets.set(ps, b);
    }
    b.sum += d.value;
    b.cost += d.cost ?? 0;
    const demand = toDemandKW(d.value, d.duration);
    if (demand > b.demand) b.demand = demand;
  }

  const valueOf =
    metric === 'cost'
      ? (b: EnergyBucket) => b.cost
      : metric === 'energy'
        ? (b: EnergyBucket) => b.sum
        : (b: EnergyBucket) => b.demand;

  return Array.from(buckets.values())
    .map((b) => ({
      periodStart: b.periodStart,
      label: labelFor(b.periodStart, granularity),
      value: valueOf(b),
      granularity,
      metric,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
