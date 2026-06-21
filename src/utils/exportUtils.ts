import type { DataPoint } from '../types';
import { DAYS_OF_WEEK, MONTHS } from '../types';
import { type EnergyUnit, convertEnergy } from './energyUnits';
import { toDemandKW } from './demandUnits';
import { formatShortDate, formatMonthYear } from './formatters';
import type { HourlyWeatherData } from '../utils/weatherData';
import type { ExportGroupBy, RateUnitConfig } from '../components/export/exportConstants';

// ─── Weather interpolation ──────────────────────────────────────────────────

/**
 * Builds a closure that maps any unix timestamp to a temperature
 * by linearly interpolating between surrounding hourly readings.
 * Falls back to nearest-neighbor within ±2 hours at edges/gaps.
 */
export function buildWeatherLookup(
  hourly: HourlyWeatherData[],
): (timestamp: number) => number | null {
  if (!hourly.length) return () => null;

  const sorted = [...hourly].sort((a, b) => a.timestamp - b.timestamp);
  const firstTs = sorted[0].timestamp;
  const lastTs = sorted[sorted.length - 1].timestamp;

  const byHour = new Map<number, number>();
  for (const h of sorted) byHour.set(h.timestamp, h.temperature);

  return (ts: number): number | null => {
    if (ts < firstTs - 7200 || ts > lastTs + 7200) return null;

    const hourFloor = Math.floor(ts / 3600) * 3600;
    const hourCeil = hourFloor + 3600;
    const tempFloor = byHour.get(hourFloor);
    const tempCeil = byHour.get(hourCeil);

    if (tempFloor != null && tempCeil != null) {
      const t = (ts - hourFloor) / 3600;
      return tempFloor + (tempCeil - tempFloor) * t;
    }
    if (tempFloor != null) return tempFloor;
    if (tempCeil != null) return tempCeil;

    let bestDist = Infinity;
    let bestTemp: number | null = null;
    for (let offset = -2; offset <= 2; offset++) {
      const t = byHour.get(hourFloor + offset * 3600);
      if (t != null) {
        const dist = Math.abs(ts - (hourFloor + offset * 3600));
        if (dist < bestDist) { bestDist = dist; bestTemp = t; }
      }
    }
    return bestTemp;
  };
}

// ─── Aggregation ────────────────────────────────────────────────────────────

export interface AggBucket {
  timestamp: number;    // bucket start
  label: string;
  energySum: number;    // Wh
  costSum: number;      // micro-dollars (hundred-thousandths of a dollar)
  demandMax: number;    // peak demand (kW) within the bucket
  tempSum: number;
  tempCount: number;
  count: number;
}

export function getBucketKey(
  ts: number,
  groupBy: ExportGroupBy,
): { key: string; timestamp: number; label: string } {
  const d = new Date(ts * 1000);
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const h = d.getHours();

  switch (groupBy) {
    case 'hour': {
      const bucketTs = Math.floor(ts / 3600) * 3600;
      return {
        key: `${y}-${m}-${day}-${h}`,
        timestamp: bucketTs,
        label: `${formatShortDate(d)} ${h.toString().padStart(2, '0')}:00`,
      };
    }
    case 'day': {
      const bucketTs = new Date(y, m, day).getTime() / 1000;
      return {
        key: `${y}-${m}-${day}`,
        timestamp: bucketTs,
        label: `${DAYS_OF_WEEK[d.getDay()]} ${formatShortDate(d)}`,
      };
    }
    case 'week': {
      const dayOfWeek = d.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(y, m, day + mondayOffset);
      const bucketTs = monday.getTime() / 1000;
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      return {
        key: `w-${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`,
        timestamp: bucketTs,
        label: `${formatShortDate(monday)} – ${formatShortDate(sunday)}`,
      };
    }
    case 'month': {
      const bucketTs = new Date(y, m, 1).getTime() / 1000;
      return {
        key: `${y}-${m}`,
        timestamp: bucketTs,
        label: formatMonthYear(MONTHS[m], y),
      };
    }
    default:
      return { key: '', timestamp: ts, label: '' };
  }
}

// ─── Rate computation ───────────────────────────────────────────────────────

/**
 * Computes a rate value from raw cost (micro-dollars) and energy (Wh),
 * converted to the requested display unit.
 *
 *   base $/kWh = (cost / 100_000) / (energy / 1_000)
 *
 * Returns null when energy is zero or negative.
 */
export function computeRate(
  costRaw: number,
  energyWh: number,
  rateUnit: RateUnitConfig,
): number | null {
  const kWh = energyWh / 1000;
  if (kWh <= 0) return null;
  const baseDollarsPerKwh = (costRaw / energyWh) * 0.01;
  return parseFloat((baseDollarsPerKwh * rateUnit.multiplier).toFixed(rateUnit.decimals));
}

// ─── Row building ───────────────────────────────────────────────────────────

export function buildRawRow(
  point: DataPoint,
  enabledKeys: Set<string>,
  energyUnit: EnergyUnit,
  temperatureUnit: string,
  weatherLookup: ((ts: number) => number | null) | null,
  celsiusToUnit: (c: number) => number,
  timeFmt: Intl.DateTimeFormat,
  rateUnit: RateUnitConfig,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const dateObj = new Date(point.timestamp * 1000);

  if (enabledKeys.has('timestamp')) row.timestamp = point.timestamp;
  if (enabledKeys.has('date')) row.date = formatShortDate(dateObj);
  if (enabledKeys.has('time')) row.time = timeFmt.format(dateObj);
  if (enabledKeys.has('value')) {
    row[`energy_${energyUnit.toLowerCase()}`] = parseFloat(
      convertEnergy(point.value, energyUnit).toFixed(4),
    );
  }
  if (enabledKeys.has('demand')) {
    row.demand_kw = parseFloat(toDemandKW(point.value, point.duration).toFixed(3));
  }
  if (enabledKeys.has('cost')) {
    row.cost_dollars = parseFloat((point.cost / 100_000).toFixed(4));
  }
  if (weatherLookup && enabledKeys.has('temperature')) {
    const temp = weatherLookup(point.timestamp);
    row[`temperature_${temperatureUnit.toLowerCase()}`] = temp != null
      ? parseFloat(celsiusToUnit(temp).toFixed(1))
      : null;
  }
  if (enabledKeys.has('rate')) {
    row[rateUnit.columnKey] = computeRate(point.cost, point.value, rateUnit);
  }

  return row;
}

export function buildAggRow(
  bucket: AggBucket,
  enabledKeys: Set<string>,
  energyUnit: EnergyUnit,
  temperatureUnit: string,
  celsiusToUnit: (c: number) => number,
  rateUnit: RateUnitConfig,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (enabledKeys.has('timestamp')) row.timestamp = bucket.timestamp;
  if (enabledKeys.has('date')) row.period = bucket.label;
  if (enabledKeys.has('value')) {
    row[`energy_${energyUnit.toLowerCase()}`] = parseFloat(
      convertEnergy(bucket.energySum, energyUnit).toFixed(4),
    );
  }
  if (enabledKeys.has('demand')) {
    row.peak_demand_kw = parseFloat(bucket.demandMax.toFixed(3));
  }
  if (enabledKeys.has('cost')) {
    row.cost_dollars = parseFloat((bucket.costSum / 100_000).toFixed(4));
  }
  if (enabledKeys.has('temperature') && bucket.tempCount > 0) {
    const avgC = bucket.tempSum / bucket.tempCount;
    row[`avg_temperature_${temperatureUnit.toLowerCase()}`] = parseFloat(
      celsiusToUnit(avgC).toFixed(1),
    );
  } else if (enabledKeys.has('temperature')) {
    row[`avg_temperature_${temperatureUnit.toLowerCase()}`] = null;
  }
  row.readings = bucket.count;
  if (enabledKeys.has('rate')) {
    row[`avg_${rateUnit.columnKey}`] = computeRate(bucket.costSum, bucket.energySum, rateUnit);
  }

  return row;
}

// ─── CSV serialization ──────────────────────────────────────────────────────

export function rowToCsv(row: Record<string, unknown>, headerKeys: string[]): string {
  let line = '';
  for (let i = 0; i < headerKeys.length; i++) {
    if (i > 0) line += ',';
    const val = row[headerKeys[i]];
    if (val == null) continue;
    if (typeof val === 'string') {
      if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1) {
        line += '"' + val.replace(/"/g, '""') + '"';
      } else {
        line += val;
      }
    } else {
      line += val;
    }
  }
  return line;
}