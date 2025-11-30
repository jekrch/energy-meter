import { type DataPoint, RESOLUTIONS } from '../types';
import { formatShortDate } from './formatters';

const CHUNK_SIZE = 2000;

// Largest Triangle Three Buckets (LTTB) Downsampling Algorithm
// Reduces visual noise and improves rendering performance for large datasets
export const downsampleLTTB = (data: DataPoint[], threshold: number): DataPoint[] => {
    if (data.length <= threshold) return data;

    const sampled: DataPoint[] = [data[0]]; // Always keep the first point
    const bucketSize = (data.length - 2) / (threshold - 2);

    let a = 0; // The index of the last selected point

    for (let i = 0; i < threshold - 2; i++) {
        // Determine the range for the current bucket
        const bucketStart = Math.floor((i + 1) * bucketSize) + 1;
        const bucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length - 1);

        // Calculate the average point in the *next* bucket
        let avgX = 0, avgY = 0, count = 0;
        for (let j = bucketStart; j < bucketEnd; j++) {
            avgX += data[j].timestamp;
            avgY += data[j].value;
            count++;
        }
        if (count > 0) { avgX /= count; avgY /= count; }

        // Find the point in the *current* range that forms the largest triangle 
        // with the last selected point (a) and the average of the next bucket
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
        a = maxIdx; // Update last selected point
    }

    sampled.push(data[data.length - 1]); // Always keep the last point
    return sampled;
};

// Async Data Processing to prevent UI freezing
// Uses requestAnimationFrame to break work into chunks
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
            // Aggregation logic (Hourly/Daily/Weekly)
            requestAnimationFrame(() => {
                const interval = RESOLUTIONS[resolution].seconds;
                const groups: Record<number, number> = {};

                // Group by interval buckets
                data.forEach(p => {
                    const bucket = Math.floor(p.timestamp / interval) * interval;
                    groups[bucket] = (groups[bucket] || 0) + p.value;
                });

                // Transform back to array and sort
                const result = Object.keys(groups)
                    .sort((a, b) => Number(a) - Number(b))
                    .map(ts => {
                        const timestamp = parseInt(ts);
                        const dateObj = new Date(timestamp * 1000);
                        const dateStr = formatShortDate(dateObj);
                        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                        return {
                            timestamp,
                            value: groups[timestamp],
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

        if (xmlDoc.getElementsByTagName("parsererror").length > 0) throw new Error("Invalid XML");

        // Handle namespaces by checking both standard and NS variants
        let readings = Array.from(xmlDoc.getElementsByTagName("IntervalReading"));
        if (!readings.length) readings = Array.from(xmlDoc.getElementsByTagNameNS("*", "IntervalReading"));

        if (!readings.length) throw new Error("No IntervalReading data found.");

        return readings.map((r) => {
            const valueNode = r.getElementsByTagName("value")[0] || r.getElementsByTagNameNS("*", "value")[0];
            const timePeriod = r.getElementsByTagName("timePeriod")[0] || r.getElementsByTagNameNS("*", "timePeriod")[0];
            const startNode = timePeriod?.getElementsByTagName("start")[0] || timePeriod?.getElementsByTagNameNS("*", "start")[0];

            return {
                timestamp: startNode?.textContent ? parseInt(startNode.textContent, 10) : 0,
                value: valueNode?.textContent ? parseInt(valueNode.textContent, 10) : 0
            };
        }).sort((a, b) => a.timestamp - b.timestamp);

    } catch (err) {
        throw new Error(err instanceof Error ? err.message : "XML Parsing Failed");
    }
};

// Mock Data Generator for demo purposes
export const generateSampleData = (): DataPoint[] => {
    const points: DataPoint[] = [];

    // Start Jan 1st of LAST year to provide historical context
    // This generates data for [Last Year] and [Current Year]
    const startYear = new Date().getFullYear() - 1;
    let time = new Date(`${startYear}-01-01T00:00:00`).getTime() / 1000;

    // Generate 2 full years (approx 17,520 hours)
    const totalHours = 2 * 365 * 24;

    for (let i = 0; i < totalHours; i++) {
        const currentDate = new Date(time * 1000);
        const month = currentDate.getMonth(); // 0 (Jan) to 11 (Dec)
        const hour = currentDate.getHours();
        const dayOfWeek = currentDate.getDay(); // 0 (Sun) to 6 (Sat)

        // 1. Seasonal Multiplier
        // Summer (Jun, Jul, Aug, Sep) gets higher usage (AC load)
        let seasonalFactor = 1.0;

        if (month >= 5 && month <= 8) {
            // Summer: June(5) to Sept(8)
            seasonalFactor = 1.5 + (Math.random() * 0.4);
        } else if (month === 11 || month === 0 || month === 1) {
            // Winter: Dec, Jan, Feb
            seasonalFactor = 1.2 + (Math.random() * 0.2);
        } else {
            // Shoulder seasons
            seasonalFactor = 0.8 + (Math.random() * 0.2);
        }

        // 2. Day of Week Multiplier (Friday & Saturday)
        let dayFactor = 1.0;
        if (dayOfWeek === 5 || dayOfWeek === 6) {
            // Friday (5) or Saturday (6) - 25% higher usage
            dayFactor = 1.25;
        }

        // 3. Daily Profile (Time of Use)
        let hourlyBase = 300; // Base load (fridge, standby)

        if (hour >= 6 && hour < 9) {
            hourlyBase = 800; // Morning routine
        } else if (hour >= 9 && hour < 17) {
            hourlyBase = 1000; // Work day / background AC
        } else if (hour >= 17 && hour < 22) {
            hourlyBase = 1600; // Evening peak (Cooking, TV, Lights)
        } else if (hour >= 22) {
            hourlyBase = 500; // Wind down
        }

        // 4. Random Noise per hour
        const noise = Math.random() * 200 - 100;

        // Calculate final value
        // Combine base * seasonal * day of week + noise
        const finalValue = Math.max(0, Math.floor((hourlyBase * seasonalFactor * dayFactor) + noise));

        points.push({
            timestamp: time,
            value: finalValue
        });

        time += 3600; // Add 1 hour
    }
    return points;
};