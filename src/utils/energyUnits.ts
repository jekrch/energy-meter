export type EnergyUnit = 'Wh' | 'kWh' | 'MWh';

export const ENERGY_UNITS: { value: EnergyUnit; label: string; divisor: number }[] = [
  { value: 'Wh', label: 'Wh', divisor: 1 },
  { value: 'kWh', label: 'kWh', divisor: 1000 },
  { value: 'MWh', label: 'MWh', divisor: 1000000 },
];

export function convertEnergy(valueInWh: number, unit: EnergyUnit): number {
  const config = ENERGY_UNITS.find(u => u.value === unit)!;
  return valueInWh / config.divisor;
}

export function formatEnergyValue(valueInWh: number, unit: EnergyUnit, decimals?: number): string {
  const converted = convertEnergy(valueInWh, unit);
  
  // Auto-determine decimals based on unit if not specified
  const d = decimals ?? (unit === 'Wh' ? 0 : unit === 'kWh' ? 1 : 2);
  
  if (unit === 'Wh') {
    return Math.round(converted).toLocaleString();
  }
  return converted.toLocaleString(undefined, { 
    minimumFractionDigits: d, 
    maximumFractionDigits: d 
  });
}

export function formatEnergyAxis(valueInWh: number, unit: EnergyUnit): string {
  const converted = convertEnergy(valueInWh, unit);
  
  if (unit === 'MWh') {
    return converted.toFixed(1);
  }
  if (unit === 'kWh') {
    if (converted >= 1000) return `${(converted / 1000).toFixed(1)}k`;
    return converted.toFixed(0);
  }
  // Wh
  if (converted >= 1000000) return `${(converted / 1000000).toFixed(1)}M`;
  if (converted >= 1000) return `${(converted / 1000).toFixed(0)}k`;
  return converted.toFixed(0);
}

// Suggest best unit based on max value in dataset
export function suggestUnit(maxValueInWh: number): EnergyUnit {
  if (maxValueInWh >= 1000000) return 'MWh';
  if (maxValueInWh >= 10000) return 'kWh';
  return 'Wh';
}