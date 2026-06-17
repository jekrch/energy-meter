import type { BrushDataPoint } from '../components/common/RangeBrush';
import { type DataPoint, type RateChange, type RatePeriod, RESOLUTIONS } from '../types';
import { formatShortDate } from './formatters';

const CHUNK_SIZE = 2000;

// LTTB Downsampling 
export const downsampleLTTB = (data: DataPoint[], threshold: number): DataPoint[] => {
  if (data.length <= threshold) return data;

  const sampled: DataPoint[] = [data[0]];
  const bucketSize = (data.length - 2) / (threshold - 2);
  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    const bucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length - 1);

    let avgX = 0, avgY = 0, count = 0;
    for (let j = bucketStart; j < bucketEnd; j++) {
      avgX += data[j].timestamp;
      avgY += data[j].value;
      count++;
    }
    if (count > 0) { avgX /= count; avgY /= count; }

    const rangeStart = Math.floor(i * bucketSize) + 1;
    let maxArea = -1, maxIdx = rangeStart;

    for (let j = rangeStart; j < bucketStart; j++) {
      const area = Math.abs(
        (data[a].timestamp - avgX) * (data[j].value - data[a].value) -
        (data[a].timestamp - data[j].timestamp) * (avgY - data[a].value)
      );
      if (area > maxArea) { maxArea = area; maxIdx = j; }
    }

    sampled.push(data[maxIdx]);
    a = maxIdx;
  }

  sampled.push(data[data.length - 1]);
  return sampled;
};

// Async Data Processing - now includes cost aggregation
export const processDataAsync = (data: DataPoint[], resolution: string): Promise<DataPoint[]> => {
  return new Promise((resolve) => {
    if (!data.length) { resolve([]); return; }

    if (resolution === 'RAW') {
      const result: DataPoint[] = [];
      let i = 0;

      const processChunk = () => {
        const end = Math.min(i + CHUNK_SIZE, data.length);
        for (; i < end; i++) {
          const d = data[i];
          const dateObj = new Date(d.timestamp * 1000);
          result.push({
            ...d,
            date: formatShortDate(dateObj),
            time: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            fullDate: `${formatShortDate(dateObj)}, ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          });
        }
        if (i < data.length) requestAnimationFrame(processChunk);
        else resolve(result);
      };

      requestAnimationFrame(processChunk);
    } else {
      // Aggregation logic - now sums both value AND cost
      requestAnimationFrame(() => {
        const interval = RESOLUTIONS[resolution].seconds;
        // Map<number> keeps the bucket key numeric — no string/number coercion
        // round-trip through Object.keys()/parseInt().
        const groups = new Map<number, { value: number; cost: number }>();

        data.forEach(p => {
          const bucket = Math.floor(p.timestamp / interval) * interval;
          let group = groups.get(bucket);
          if (!group) {
            group = { value: 0, cost: 0 };
            groups.set(bucket, group);
          }
          group.value += p.value;
          group.cost += p.cost;
        });

        const result = [...groups.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([timestamp, agg]) => {
            const dateObj = new Date(timestamp * 1000);
            const dateStr = formatShortDate(dateObj);
            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return {
              timestamp,
              value: agg.value,
              cost: agg.cost,
              date: dateStr,
              time: resolution === 'HOURLY' ? timeStr : '',
              fullDate: resolution === 'HOURLY' ? `${dateStr}, ${timeStr}` : dateStr
            };
          });

        resolve(result);
      });
    }
  });
};

// Green Button XML Parser
//
// A single Green Button download can contain multiple IntervalBlocks — for
// example hourly + daily summary blocks, or consumption + generation for a
// net-metered solar customer. If the parser naively sums all IntervalReading
// elements, totals get double-counted. This parser keeps each IntervalBlock
// separate and attaches the associated ReadingType metadata so the UI can
// surface a picker when more than one block is present.

// NAESB/ESPI code → label mappings (subset of the most common values).
const FLOW_DIRECTION_LABELS: Record<number, string> = {
  1: 'Forward (delivered)',
  2: 'Lagging',
  3: 'Leading',
  4: 'Net',
  5: 'Q1',
  6: 'Q1+Q2',
  7: 'Q1+Q3',
  8: 'Q1+Q4',
  9: 'Q2',
  10: 'Q2+Q3',
  11: 'Q2+Q4',
  12: 'Q3',
  13: 'Q3+Q4',
  14: 'Q4',
  15: 'Quadrantal',
  16: 'Reverse',
  17: 'Total',
  18: 'Total by phase',
  19: 'Reverse (received)',
  20: 'Net',
};

const UOM_LABELS: Record<number, string> = {
  5: 'A', 29: 'V', 31: 'J', 33: 'Hz', 38: 'W', 42: 'm³',
  61: 'VA', 63: 'VAr', 65: 'cosθ', 67: 'V²', 69: 'A²',
  71: 'VAh', 72: 'Wh', 73: 'VArh', 106: 'Ah', 119: 'ft³', 169: 'therms',
};

const COMMODITY_LABELS: Record<number, string> = {
  1: 'Electricity (secondary)',
  2: 'Electricity (primary)',
  4: 'Air',
  7: 'Natural gas',
  9: 'Propane',
  11: 'Water',
  12: 'Steam',
};

export interface IntervalBlockMeta {
  id: string;
  flowDirection?: number;
  flowDirectionLabel: string;
  uom?: number;
  uomLabel: string;
  powerOfTenMultiplier: number;
  commodity?: number;
  commodityLabel: string;
  currency?: number;
  intervalLength?: number;
  startTimestamp: number;
  endTimestamp: number;
  readingCount: number;
  totalValue: number;
  totalCost: number;
}

export interface ParsedBlock {
  meta: IntervalBlockMeta;
  data: DataPoint[];
}

export interface ParsedGreenButton {
  blocks: ParsedBlock[];
}

interface ReadingTypeMeta {
  flowDirection?: number;
  uom?: number;
  powerOfTenMultiplier: number;
  commodity?: number;
  currency?: number;
}

const ns = (root: ParentNode, name: string): Element[] => {
  const r = root as Element;
  const byName = Array.from(r.getElementsByTagName(name));
  if (byName.length) return byName;
  return Array.from(r.getElementsByTagNameNS('*', name));
};

const firstNs = (root: ParentNode, name: string): Element | undefined => ns(root, name)[0];

const parseIntNode = (el: Element | undefined): number | undefined => {
  const t = el?.textContent;
  if (!t) return undefined;
  const n = parseInt(t.trim(), 10);
  return Number.isNaN(n) ? undefined : n;
};

const parseReadingType = (rt: Element): ReadingTypeMeta => ({
  flowDirection: parseIntNode(firstNs(rt, 'flowDirection')),
  uom: parseIntNode(firstNs(rt, 'uom')),
  powerOfTenMultiplier: parseIntNode(firstNs(rt, 'powerOfTenMultiplier')) ?? 0,
  commodity: parseIntNode(firstNs(rt, 'commodity')),
  currency: parseIntNode(firstNs(rt, 'currency')),
});

const readingsToBlock = (
  readings: Element[],
  rt: ReadingTypeMeta | undefined,
  id: string
): ParsedBlock => {
  const multiplier = rt?.powerOfTenMultiplier ?? 0;
  const scale = Math.pow(10, multiplier);

  const data: DataPoint[] = readings.map((r) => {
    const timePeriod = firstNs(r, 'timePeriod');
    const startNode = timePeriod ? firstNs(timePeriod, 'start') : undefined;
    const durationNode = timePeriod ? firstNs(timePeriod, 'duration') : undefined;
    const valueNode = firstNs(r, 'value');
    const costNode = firstNs(r, 'cost');

    const rawValue = parseIntNode(valueNode) ?? 0;
    return {
      timestamp: parseIntNode(startNode) ?? 0,
      value: scale === 1 ? rawValue : Math.round(rawValue * scale),
      cost: parseIntNode(costNode) ?? 0,
      duration: parseIntNode(durationNode),
    };
  }).sort((a, b) => a.timestamp - b.timestamp);

  const first = data[0];
  const last = data[data.length - 1];
  let totalValue = 0;
  let totalCost = 0;
  for (const d of data) { totalValue += d.value; totalCost += d.cost; }

  return {
    meta: {
      id,
      flowDirection: rt?.flowDirection,
      flowDirectionLabel: rt?.flowDirection !== undefined
        ? (FLOW_DIRECTION_LABELS[rt.flowDirection] ?? `Flow ${rt.flowDirection}`)
        : 'Unknown flow',
      uom: rt?.uom,
      uomLabel: rt?.uom !== undefined ? (UOM_LABELS[rt.uom] ?? `UOM ${rt.uom}`) : 'Wh',
      powerOfTenMultiplier: multiplier,
      commodity: rt?.commodity,
      commodityLabel: rt?.commodity !== undefined
        ? (COMMODITY_LABELS[rt.commodity] ?? `Commodity ${rt.commodity}`)
        : 'Electricity',
      currency: rt?.currency,
      intervalLength: first?.duration,
      startTimestamp: first?.timestamp ?? 0,
      endTimestamp: last?.timestamp ?? 0,
      readingCount: data.length,
      totalValue,
      totalCost,
    },
    data,
  };
};

export const parseGreenButtonXML = (xmlText: string): ParsedGreenButton => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText.trim(), 'text/xml');

    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('Invalid XML');
    }

    // First pass: walk atom <entry> elements and split ReadingTypes from
    // IntervalBlocks. IntervalBlock entries reference their ReadingType via
    // a <link rel="related"> pointing at the ReadingType entry's self href.
    const readingTypes = new Map<string, ReadingTypeMeta>();
    const rawBlocks: { ib: Element; relatedHrefs: string[] }[] = [];

    const entries = ns(xmlDoc, 'entry');
    for (const entry of entries) {
      const links = ns(entry, 'link');
      let selfHref: string | undefined;
      const relatedHrefs: string[] = [];
      for (const link of links) {
        const rel = link.getAttribute('rel');
        const href = link.getAttribute('href');
        if (!href) continue;
        if (rel === 'self') selfHref = href;
        else if (rel === 'related') relatedHrefs.push(href);
      }

      const content = firstNs(entry, 'content');
      if (!content) continue;

      const rt = firstNs(content, 'ReadingType');
      if (rt && selfHref) {
        readingTypes.set(selfHref, parseReadingType(rt));
        continue;
      }

      for (const ib of ns(content, 'IntervalBlock')) {
        rawBlocks.push({ ib, relatedHrefs });
      }
    }

    // Fallback: some exports have IntervalBlocks outside of an entry wrapper.
    if (rawBlocks.length === 0) {
      for (const ib of ns(xmlDoc, 'IntervalBlock')) {
        rawBlocks.push({ ib, relatedHrefs: [] });
      }
    }

    // Final fallback: bare IntervalReadings with no block wrapper at all.
    if (rawBlocks.length === 0) {
      const readings = ns(xmlDoc, 'IntervalReading');
      if (!readings.length) throw new Error('No IntervalReading data found.');
      const soleRt = readingTypes.size === 1
        ? readingTypes.values().next().value as ReadingTypeMeta
        : undefined;
      return { blocks: [readingsToBlock(readings, soleRt, 'block-0')] };
    }

    const matchReadingType = (relatedHrefs: string[]): ReadingTypeMeta | undefined => {
      for (const href of relatedHrefs) {
        const direct = readingTypes.get(href);
        if (direct) return direct;
        for (const [key, meta] of readingTypes) {
          if (href.includes(key) || key.includes(href)) return meta;
        }
      }
      // If only one ReadingType exists in the file, assume it applies.
      if (readingTypes.size === 1) return readingTypes.values().next().value as ReadingTypeMeta;
      return undefined;
    };

    const blocks: ParsedBlock[] = [];
    rawBlocks.forEach(({ ib, relatedHrefs }, idx) => {
      const readings = ns(ib, 'IntervalReading');
      if (!readings.length) return;
      const rt = matchReadingType(relatedHrefs);
      blocks.push(readingsToBlock(readings, rt, `block-${idx}`));
    });

    if (blocks.length === 0) throw new Error('No IntervalReading data found.');

    return { blocks };
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'XML Parsing Failed');
  }
};

// Mock Data Generator - realistic energy patterns with stepped rate increases
export const generateSampleData = (): DataPoint[] => {
  const points: DataPoint[] = [];
  const now = Date.now() / 1000; // Current timestamp in seconds
  const startYear = new Date().getFullYear() - 2;
  let time = new Date(`${startYear}-01-01T00:00:00`).getTime() / 1000;
  const totalHours = 2 * 365 * 24;

  const BASE_RATE = 12; // micro-dollars per Wh (~$0.12/kWh), matching the GB parser's cost unit

  // Rate change points (as fraction of total duration)
  const firstChangePoint = Math.floor(totalHours * 0.35);  // ~4.5 months in
  const secondChangePoint = Math.floor(totalHours * 0.70); // ~9 months in

  // Rate multipliers: base → +4% → +5% (compounded)
  const rate1 = BASE_RATE;
  const rate2 = BASE_RATE * 1.04;           // 4% increase
  const rate3 = BASE_RATE * 1.04 * 1.05;    // Additional 5% increase

  // State for correlated noise (brownian motion)
  let noiseState = 0;
  let weatherState = 0; // Multi-day weather patterns
  let lastValue = 400;

  // Simplex-like smooth noise
  const smoothNoise = (seed: number, scale: number = 1): number => {
    const x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453;
    return ((x - Math.floor(x)) - 0.5) * 2 * scale;
  };

  // Daily usage curve - smooth sine-based pattern
  const getDailyProfile = (hour: number): number => {
    const t = hour;

    // Base load (always-on appliances)
    let usage = 250;

    // Morning ramp (6am-9am) - smooth gaussian-like curve
    const morningPeak = Math.exp(-Math.pow(t - 7.5, 2) / 2) * 500;
    usage += morningPeak;

    // Daytime baseline (slightly elevated, people might be home)
    if (t >= 8 && t <= 17) {
      const dayPhase = (t - 8) / 9;
      usage += 200 + Math.sin(dayPhase * Math.PI) * 100;
    }

    // Evening peak (5pm-10pm) - the big one
    const eveningPeak = Math.exp(-Math.pow(t - 19, 2) / 3) * 900;
    usage += eveningPeak;

    // Late night decline
    const nightDip = Math.exp(-Math.pow(t - 3, 2) / 8) * -150;
    usage += nightDip;

    return Math.max(150, usage);
  };

  // Seasonal multiplier with smooth transitions
  const getSeasonalFactor = (dayOfYear: number): number => {
    // Use sine wave for smooth seasonal variation
    // Peak in summer (day ~180), trough in spring/fall
    const summerHeat = Math.sin((dayOfYear - 80) * Math.PI / 182.5);
    const winterHeat = Math.cos((dayOfYear) * Math.PI / 182.5);

    // Summer AC load (peaks in July/August)
    const summerLoad = Math.max(0, summerHeat) * 0.5;

    // Winter heating load (peaks in January)
    const winterLoad = Math.max(0, winterHeat) * 0.25;

    return 1.0 + summerLoad + winterLoad;
  };

  // Get the current rate based on position in data
  const getCurrentRate = (hourIndex: number): number => {
    if (hourIndex < firstChangePoint) return rate1;
    if (hourIndex < secondChangePoint) return rate2;
    return rate3;
  };

  for (let i = 0; i < totalHours; i++) {
    // Stop if we've reached the present
    if (time > now) break;

    const currentDate = new Date(time * 1000);
    const hour = currentDate.getHours();
    const dayOfWeek = currentDate.getDay();
    const dayOfYear = Math.floor((currentDate.getTime() - new Date(currentDate.getFullYear(), 0, 0).getTime()) / 86400000);

    // Update weather state every ~6 hours (creates multi-day patterns)
    if (i % 6 === 0) {
      weatherState += smoothNoise(i * 0.01, 0.1);
      weatherState = Math.max(-1, Math.min(1, weatherState * 0.95)); // Mean reversion
    }

    // Get base daily profile
    let baseUsage = getDailyProfile(hour);

    // Seasonal adjustment
    const seasonalFactor = getSeasonalFactor(dayOfYear);
    baseUsage *= seasonalFactor;

    // Weather variation (hot/cold spells increase usage)
    const weatherMult = 1 + Math.abs(weatherState) * 0.3;
    baseUsage *= weatherMult;

    // Weekend adjustment (more home time = different pattern)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      // Shift morning peak later, increase daytime usage
      const weekendShift = hour >= 8 && hour <= 14 ? 1.2 : 1.0;
      baseUsage *= weekendShift;
    }

    // Correlated noise (brownian motion for natural variation)
    noiseState += smoothNoise(i, 30);
    noiseState *= 0.92; // Mean reversion

    // Add some texture noise
    const textureNoise = smoothNoise(i * 0.5, 50) + smoothNoise(i * 2, 20);

    // Occasional appliance spikes (laundry, oven, etc.)
    let applianceSpike = 0;
    if (Math.random() > 0.97 && hour >= 9 && hour <= 21) {
      // ~3% chance of appliance use during waking hours
      applianceSpike = 300 + Math.random() * 500;
    }

    // Combine everything with smoothing toward previous value
    let finalValue = baseUsage + noiseState + textureNoise + applianceSpike;

    // Smooth transitions (values don't jump dramatically hour to hour)
    finalValue = lastValue * 0.3 + finalValue * 0.7;
    finalValue = Math.max(100, Math.floor(finalValue));
    lastValue = finalValue;

    // Cost calculation with stepped rates
    const currentRate = getCurrentRate(i);
    const finalCost = finalValue * currentRate;

    points.push({
      timestamp: time,
      value: finalValue,
      cost: finalCost
    });

    time += 3600;
  }

  return points;
};

/**
 * Creates a lightweight, downsampled dataset for the brush control.
 * Uses peak-preserving sampling to maintain visual accuracy.
 */
export function createBrushData(data: DataPoint[], maxPoints: number = 200): BrushDataPoint[] {
  if (!data.length) return [];

  if (data.length <= maxPoints) {
    return data.map(d => ({ timestamp: d.timestamp, value: d.value }));
  }

  const result: BrushDataPoint[] = [];
  const step = data.length / maxPoints;

  for (let i = 0; i < maxPoints; i++) {
    const startIdx = Math.floor(i * step);
    const endIdx = Math.floor((i + 1) * step);

    let maxVal = data[startIdx].value;
    let maxIdx = startIdx;

    for (let j = startIdx; j < endIdx && j < data.length; j++) {
      if (data[j].value > maxVal) {
        maxVal = data[j].value;
        maxIdx = j;
      }
    }

    result.push({
      timestamp: data[maxIdx].timestamp,
      value: maxVal
    });
  }

  if (result.length > 0) {
    result[0] = { timestamp: data[0].timestamp, value: data[0].value };
    result[result.length - 1] = {
      timestamp: data[data.length - 1].timestamp,
      value: data[data.length - 1].value
    };
  }

  return result;
}

/**
 * Detects significant rate changes in energy data.
 * Groups consecutive readings with similar rates into periods.
 */
export const detectRateChanges = (
  data: DataPoint[],
  tolerancePercent: number = 8
): { changes: RateChange[]; periods: RatePeriod[] } => {
  const changes: RateChange[] = [];
  const periods: RatePeriod[] = [];

  if (data.length < 2) return { changes, periods };

  const ratedPoints = data
    .filter(p => p.value >= 50 && p.cost > 0)
    .map(p => ({
      timestamp: p.timestamp,
      rate: p.cost / p.value
    }));

  if (ratedPoints.length < 2) return { changes, periods };

  let currentPeriod: RatePeriod = {
    startTimestamp: ratedPoints[0].timestamp,
    endTimestamp: ratedPoints[0].timestamp,
    rate: ratedPoints[0].rate,
    readings: 1
  };

  // Use a rolling median to smooth out noise. The window is fixed at ≤3, so the
  // median comes from direct comparisons rather than slice/map/sort per point.
  const windowSize = 3;
  const getSmoothedRate = (idx: number): number => {
    const start = Math.max(0, idx - Math.floor(windowSize / 2));
    const end = Math.min(ratedPoints.length, idx + Math.ceil(windowSize / 2));
    const a = ratedPoints[start].rate;
    if (end - start === 1) return a;
    const b = ratedPoints[start + 1].rate;
    if (end - start === 2) return Math.max(a, b); // matches sort()[floor(2/2)]
    const c = ratedPoints[start + 2].rate;
    return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  };

  let lastSignificantRate = getSmoothedRate(0);

  for (let i = 1; i < ratedPoints.length; i++) {
    const smoothedRate = getSmoothedRate(i);
    const percentChange = ((smoothedRate - lastSignificantRate) / lastSignificantRate) * 100;

    if (Math.abs(percentChange) > tolerancePercent) {
      periods.push({ ...currentPeriod });

      changes.push({
        timestamp: ratedPoints[i].timestamp,
        previousRate: lastSignificantRate,
        newRate: smoothedRate,
        percentChange,
        direction: percentChange > 0 ? 'increase' : 'decrease'
      });

      currentPeriod = {
        startTimestamp: ratedPoints[i].timestamp,
        endTimestamp: ratedPoints[i].timestamp,
        rate: smoothedRate,
        readings: 1
      };

      lastSignificantRate = smoothedRate;
    } else {
      currentPeriod.endTimestamp = ratedPoints[i].timestamp;
      currentPeriod.readings++;
    }
  }

  periods.push({ ...currentPeriod });

  return { changes, periods };
};

// Convert rate (micro-dollars/Wh) to $/kWh for display
// rate = cost/value where cost is in micro-dollars (1/100000 $) and value is in Wh
// To get $/kWh: rate * 1000 (Wh→kWh) / 100000 (micro-$→$) = rate * 0.01
export const formatRate = (rate: number): string => {
  const dollarsPerKwh = rate * 0.01;

  if (!isFinite(dollarsPerKwh) || dollarsPerKwh === 0) return '$0.00/kWh';
  if (dollarsPerKwh < 0.01) return `$${dollarsPerKwh.toFixed(4)}/kWh`;
  if (dollarsPerKwh < 1) return `$${dollarsPerKwh.toFixed(3)}/kWh`;
  return `$${dollarsPerKwh.toFixed(2)}/kWh`;
};