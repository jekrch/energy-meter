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
        const groups: Record<number, { value: number; cost: number }> = {};

        data.forEach(p => {
          const bucket = Math.floor(p.timestamp / interval) * interval;
          if (!groups[bucket]) {
            groups[bucket] = { value: 0, cost: 0 };
          }
          groups[bucket].value += p.value;
          groups[bucket].cost += p.cost;
        });

        const result = Object.keys(groups)
          .sort((a, b) => Number(a) - Number(b))
          .map(ts => {
            const timestamp = parseInt(ts);
            const dateObj = new Date(timestamp * 1000);
            const dateStr = formatShortDate(dateObj);
            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return {
              timestamp,
              value: groups[timestamp].value,
              cost: groups[timestamp].cost,
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
export const parseGreenButtonXML = (xmlText: string): DataPoint[] => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText.trim(), "text/xml");

    if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
      throw new Error("Invalid XML");
    }

    let readings = Array.from(xmlDoc.getElementsByTagName("IntervalReading"));
    if (!readings.length) {
      readings = Array.from(xmlDoc.getElementsByTagNameNS("*", "IntervalReading"));
    }

    if (!readings.length) throw new Error("No IntervalReading data found.");

    return readings.map((r) => {
      const valueNode = r.getElementsByTagName("value")[0] ||
        r.getElementsByTagNameNS("*", "value")[0];
      const costNode = r.getElementsByTagName("cost")[0] ||
        r.getElementsByTagNameNS("*", "cost")[0];
      const timePeriod = r.getElementsByTagName("timePeriod")[0] ||
        r.getElementsByTagNameNS("*", "timePeriod")[0];
      const startNode = timePeriod?.getElementsByTagName("start")[0] ||
        timePeriod?.getElementsByTagNameNS("*", "start")[0];
      const durationNode = timePeriod?.getElementsByTagName("duration")[0] ||
        timePeriod?.getElementsByTagNameNS("*", "duration")[0];

      return {
        timestamp: startNode?.textContent ? parseInt(startNode.textContent, 10) : 0,
        value: valueNode?.textContent ? parseInt(valueNode.textContent, 10) : 0,
        cost: costNode?.textContent ? parseInt(costNode.textContent, 10) : 0,
        duration: durationNode?.textContent ? parseInt(durationNode.textContent, 10) : undefined
      };
    }).sort((a, b) => a.timestamp - b.timestamp);

  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "XML Parsing Failed");
  }
};

// Mock Data Generator - realistic energy patterns with smooth curves
export const generateSampleData = (): DataPoint[] => {
  const points: DataPoint[] = [];
  const startYear = new Date().getFullYear() - 1;
  let time = new Date(`${startYear}-01-01T00:00:00`).getTime() / 1000;
  const totalHours = 2 * 365 * 24;

  const BASE_RATE = 12; // micro-dollars per Wh

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
  const getDailyProfile = (hour: number, minute: number = 0): number => {
    const t = hour + minute / 60;

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

  // Time-of-use rate with smooth transitions
  const getTOURate = (hour: number): number => {
    // Smooth transition into peak hours
    const peakCenter = 16.5; // 4:30pm
    const peakWidth = 2.5;
    const peakFactor = Math.exp(-Math.pow(hour - peakCenter, 2) / (2 * peakWidth * peakWidth));

    // Off-peak overnight
    const offPeakFactor = hour < 6 || hour >= 22 ? 0.7 : 1.0;

    return offPeakFactor + peakFactor * 0.5;
  };

  for (let i = 0; i < totalHours; i++) {
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
    const spikeChance = Math.random();
    if (spikeChance > 0.97 && hour >= 9 && hour <= 21) {
      // ~3% chance of appliance use during waking hours
      applianceSpike = 300 + Math.random() * 500;
    }

    // Combine everything with smoothing toward previous value
    let finalValue = baseUsage + noiseState + textureNoise + applianceSpike;

    // Smooth transitions (values don't jump dramatically hour to hour)
    finalValue = lastValue * 0.3 + finalValue * 0.7;
    finalValue = Math.max(100, Math.floor(finalValue));
    lastValue = finalValue;

    // Cost calculation with TOU rates
    const touRate = getTOURate(hour);
    const finalCost = Math.floor(finalValue * BASE_RATE * touRate);

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

    // Find max value in this bucket for peak visibility
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

  // Ensure first and last points match exactly
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

  // Calculate rates, filtering out low-value readings
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

  // Use a rolling median to smooth out noise
  const windowSize = 3;
  const getSmoothedRate = (idx: number): number => {
    const start = Math.max(0, idx - Math.floor(windowSize / 2));
    const end = Math.min(ratedPoints.length, idx + Math.ceil(windowSize / 2));
    const rates = ratedPoints.slice(start, end).map(p => p.rate).sort((a, b) => a - b);
    return rates[Math.floor(rates.length / 2)];
  };

  let lastSignificantRate = getSmoothedRate(0);

  for (let i = 1; i < ratedPoints.length; i++) {
    const smoothedRate = getSmoothedRate(i);
    const percentChange = ((smoothedRate - lastSignificantRate) / lastSignificantRate) * 100;

    if (Math.abs(percentChange) > tolerancePercent) {
      // Close current period
      periods.push({ ...currentPeriod });

      // Record the change
      changes.push({
        timestamp: ratedPoints[i].timestamp,
        previousRate: lastSignificantRate,
        newRate: smoothedRate,
        percentChange,
        direction: percentChange > 0 ? 'increase' : 'decrease'
      });

      // Start new period
      currentPeriod = {
        startTimestamp: ratedPoints[i].timestamp,
        endTimestamp: ratedPoints[i].timestamp,
        rate: smoothedRate,
        readings: 1
      };

      lastSignificantRate = smoothedRate;
    } else {
      // Extend current period
      currentPeriod.endTimestamp = ratedPoints[i].timestamp;
      currentPeriod.readings++;
    }
  }

  // Close final period
  periods.push({ ...currentPeriod });

  return { changes, periods };
};

// Convert rate (cents/Wh) to $/kWh for display
// rate = cost/value where cost is in cents and value is in Wh
// To get $/kWh: rate * 1000 (Wh→kWh) / 100 (cents→$) = rate * 10
export const formatRate = (rate: number): string => {
  const dollarsPerKwh = rate * 10;
  
  if (!isFinite(dollarsPerKwh) || dollarsPerKwh === 0) return '$0.00/kWh';
  if (dollarsPerKwh < 0.01) return `${dollarsPerKwh.toFixed(4)}/kWh`;
  if (dollarsPerKwh < 1) return `${dollarsPerKwh.toFixed(3)}/kWh`;
  return `${dollarsPerKwh.toFixed(2)}/kWh`;
};

