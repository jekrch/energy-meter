// Efficiency calculation utilities for weather-normalized energy analysis

export interface EfficiencyConfig {
  heatingEnabled: boolean;
  coolingEnabled: boolean;
  balancePointC: number; // Temperature (°C) where no HVAC needed, typically 18°C / 65°F
}

export interface EfficiencyDataPoint {
  timestamp: number;
  energy: number;
  temperature: number; // °C
  hdd: number;  // Heating degree days/hours
  cdd: number;  // Cooling degree days/hours
  degreeDays: number; // Combined based on config
  efficiencyIndex: number | null; // null if no degree days
}

const DEFAULT_CONFIG: EfficiencyConfig = {
  heatingEnabled: true,
  coolingEnabled: true,
  balancePointC: 18, // ~65°F
};

/**
 * Calculate degree days for a single temperature reading
 * For hourly data, this gives "degree hours" - divide by 24 for true degree days
 */
function calcDegreeDays(
  tempC: number,
  balancePoint: number,
  config: EfficiencyConfig
): { hdd: number; cdd: number } {
  const hdd = config.heatingEnabled ? Math.max(0, balancePoint - tempC) : 0;
  const cdd = config.coolingEnabled ? Math.max(0, tempC - balancePoint) : 0;
  return { hdd, cdd };
}

/**
 * Calculate efficiency metrics for a dataset
 * Returns data with efficiency index where 100 = average, >100 = better
 */
export function calculateEfficiency(
  data: Array<{ timestamp: number; value: number }>,
  weatherData: Map<number, number>, // timestamp -> tempC
  config: EfficiencyConfig = DEFAULT_CONFIG
): EfficiencyDataPoint[] {
  // First pass: calculate degree days and collect for baseline
  const withDegreeDays: Array<{
    timestamp: number;
    energy: number;
    temperature: number;
    hdd: number;
    cdd: number;
    degreeDays: number;
  }> = [];

  let totalEnergy = 0;
  let totalDegreeDays = 0;

  for (const point of data) {
    const temp = weatherData.get(point.timestamp);
    if (temp === undefined) continue;

    const { hdd, cdd } = calcDegreeDays(temp, config.balancePointC, config);
    const degreeDays = hdd + cdd;

    withDegreeDays.push({
      timestamp: point.timestamp,
      energy: point.value,
      temperature: temp,
      hdd,
      cdd,
      degreeDays,
    });

    // Only count periods with meaningful HVAC load for baseline
    if (degreeDays > 0.5) {
      totalEnergy += point.value;
      totalDegreeDays += degreeDays;
    }
  }

  // Baseline: average energy per degree day
  const baselineRate = totalDegreeDays > 0 ? totalEnergy / totalDegreeDays : 0;

  // Second pass: calculate efficiency index
  return withDegreeDays.map((point) => {
    let efficiencyIndex: number | null = null;

    if (point.degreeDays > 0.5 && baselineRate > 0) {
      // Actual rate for this period
      const actualRate = point.energy / point.degreeDays;
      // Index: baseline/actual * 100 (so higher = more efficient)
      efficiencyIndex = Math.round((baselineRate / actualRate) * 100);
      // Clamp to reasonable range for display
      efficiencyIndex = Math.max(20, Math.min(200, efficiencyIndex));
    }

    return { ...point, efficiencyIndex };
  });
}

/**
 * Aggregate efficiency data for timeline/averages view
 * Recalculates efficiency based on aggregated totals
 */
export function aggregateEfficiency(
  efficiencyData: EfficiencyDataPoint[],
  groupFn: (ts: number) => string // Returns group key
): Map<string, { avgEfficiency: number | null; totalDD: number; totalEnergy: number }> {
  const groups = new Map<string, { 
    energySum: number; 
    ddSum: number; 
    count: number 
  }>();

  // Group data
  for (const point of efficiencyData) {
    const key = groupFn(point.timestamp);
    const existing = groups.get(key);
    if (existing) {
      existing.energySum += point.energy;
      existing.ddSum += point.degreeDays;
      existing.count++;
    } else {
      groups.set(key, { 
        energySum: point.energy, 
        ddSum: point.degreeDays, 
        count: 1 
      });
    }
  }

  // Calculate overall baseline from aggregated data
  let totalEnergy = 0, totalDD = 0;
  for (const g of groups.values()) {
    if (g.ddSum > 0.5) {
      totalEnergy += g.energySum;
      totalDD += g.ddSum;
    }
  }
  const baselineRate = totalDD > 0 ? totalEnergy / totalDD : 0;

  // Calculate efficiency for each group
  const result = new Map<string, { avgEfficiency: number | null; totalDD: number; totalEnergy: number }>();
  
  for (const [key, g] of groups) {
    let avgEfficiency: number | null = null;
    
    if (g.ddSum > 0.5 && baselineRate > 0) {
      const groupRate = g.energySum / g.ddSum;
      avgEfficiency = Math.round((baselineRate / groupRate) * 100);
      avgEfficiency = Math.max(20, Math.min(200, avgEfficiency));
    }
    
    result.set(key, { 
      avgEfficiency, 
      totalDD: g.ddSum, 
      totalEnergy: g.energySum 
    });
  }

  return result;
}

/**
 * Get a human-readable label for efficiency index
 */
export function getEfficiencyLabel(index: number | null): string {
  if (index === null) return 'N/A (mild weather)';
  if (index >= 130) return 'Excellent';
  if (index >= 110) return 'Good';
  if (index >= 90) return 'Average';
  if (index >= 70) return 'Below Average';
  return 'Poor';
}

/**
 * Get color for efficiency index (for chart display)
 */
export function getEfficiencyColor(index: number | null): string {
  if (index === null) return '#64748b'; // slate
  if (index >= 130) return '#22c55e'; // green
  if (index >= 110) return '#84cc16'; // lime
  if (index >= 90) return '#eab308'; // yellow
  if (index >= 70) return '#f97316'; // orange
  return '#ef4444'; // red
}