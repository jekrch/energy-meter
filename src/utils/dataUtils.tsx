import type { BrushDataPoint } from '../components/common/RangeBrush';
import { type DataPoint, RESOLUTIONS } from '../types';
import { formatShortDate } from './formatters';

const CHUNK_SIZE = 2000;

// LTTB Downsampling - now preserves cost data
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

// Mock Data Generator - now includes realistic cost data
export const generateSampleData = (): DataPoint[] => {
  const points: DataPoint[] = [];
  const startYear = new Date().getFullYear() - 1;
  let time = new Date(`${startYear}-01-01T00:00:00`).getTime() / 1000;
  const totalHours = 2 * 365 * 24;

  // Base rate: ~$0.12/kWh = $0.00012/Wh = 12 micro-dollars per Wh
  // With powerOfTenMultiplier=-3, values are in mWh, so we need to adjust
  const BASE_RATE = 12; // micro-dollars per Wh (before multiplier adjustment)

  for (let i = 0; i < totalHours; i++) {
    const currentDate = new Date(time * 1000);
    const month = currentDate.getMonth();
    const hour = currentDate.getHours();
    const dayOfWeek = currentDate.getDay();

    // Seasonal factor
    let seasonalFactor = 1.0;
    if (month >= 5 && month <= 8) {
      seasonalFactor = 1.5 + (Math.random() * 0.4);
    } else if (month === 11 || month === 0 || month === 1) {
      seasonalFactor = 1.2 + (Math.random() * 0.2);
    } else {
      seasonalFactor = 0.8 + (Math.random() * 0.2);
    }

    // Day of week factor
    let dayFactor = 1.0;
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      dayFactor = 1.25;
    }

    // Hourly profile
    let hourlyBase = 300;
    if (hour >= 6 && hour < 9) {
      hourlyBase = 800;
    } else if (hour >= 9 && hour < 17) {
      hourlyBase = 1000;
    } else if (hour >= 17 && hour < 22) {
      hourlyBase = 1600;
    } else if (hour >= 22) {
      hourlyBase = 500;
    }

    // Time-of-use rate multiplier (peak hours cost more)
    let rateMult = 1.0;
    if (hour >= 14 && hour < 19) {
      rateMult = 1.5; // Peak hours: 2pm-7pm
    } else if (hour >= 22 || hour < 6) {
      rateMult = 0.7; // Off-peak: 10pm-6am
    }

    const noise = Math.random() * 200 - 100;
    const finalValue = Math.max(0, Math.floor((hourlyBase * seasonalFactor * dayFactor) + noise));
    
    // Cost = value * base_rate * TOU_multiplier (in micro-dollars)
    const finalCost = Math.floor(finalValue * BASE_RATE * rateMult);

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