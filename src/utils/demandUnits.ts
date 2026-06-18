// Demand (kW) helpers — parallel to energyUnits.ts.
//
// Demand is an instantaneous *rate*, not an accumulating quantity like energy.
// For one interval reading: kW = value_Wh / (duration_seconds / 3600) / 1000.
// For 15-min data that is "×4 then ÷1000"; for hourly data it is ×1. We derive
// it from the reading's own `duration` so it stays correct for any interval.

export const DEFAULT_INTERVAL_SECONDS = 3600; // fallback when duration missing

// kW from one interval reading.
export function toDemandKW(valueWh: number, durationSeconds?: number): number {
  const hours = (durationSeconds ?? DEFAULT_INTERVAL_SECONDS) / 3600;
  return hours > 0 ? valueWh / hours / 1000 : 0;
}

export function formatDemandValue(kW: number, decimals = 1): string {
  return kW.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Mirror of formatEnergyAxis — compact axis ticks in kW.
export function formatDemandAxis(kW: number): string {
  if (kW >= 1000) return `${(kW / 1000).toFixed(1)}k`;
  if (kW >= 100) return kW.toFixed(0);
  return kW.toFixed(1);
}
