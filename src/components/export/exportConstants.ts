// ─── Export configuration types ─────────────────────────────────────────────

export type ExportFormat = 'json' | 'csv' | 'native';
export type ExportGroupBy = 'none' | 'hour' | 'day' | 'week' | 'month';

/**
 * Rate display units. Internally, cost is stored in Green Button "micro-dollars"
 * (hundred-thousandths of a dollar, i.e. divide by 100 000 to get $) and energy
 * is in Wh.  The base rate is therefore:
 *
 *   dollars = cost / 100_000
 *   kWh     = value / 1_000
 *   $/kWh   = dollars / kWh
 *
 * From that base we derive the other units:
 *   ¢/kWh  = $/kWh × 100
 *   $/MWh  = $/kWh × 1_000
 */
export type RateUnit = '$/kWh' | '¢/kWh' | '$/MWh';

export interface RateUnitConfig {
  value: RateUnit;
  label: string;
  /** Column header key suffix */
  columnKey: string;
  /** Multiply base $/kWh by this to get the display value */
  multiplier: number;
  decimals: number;
}

export const RATE_UNITS: RateUnitConfig[] = [
  { value: '$/kWh',  label: '$/kWh',  columnKey: 'rate_dollar_per_kwh', multiplier: 1,    decimals: 4 },
  { value: '¢/kWh',  label: '¢/kWh',  columnKey: 'rate_cent_per_kwh',   multiplier: 100,  decimals: 2 },
  { value: '$/MWh',  label: '$/MWh',  columnKey: 'rate_dollar_per_mwh', multiplier: 1000, decimals: 2 },
];

export interface ExportColumn {
  key: string;
  label: string;
  enabled: boolean;
  category: 'core' | 'derived' | 'weather';
}

// ─── Dropdown / picker options ──────────────────────────────────────────────

export const GROUP_OPTIONS: { value: ExportGroupBy; label: string }[] = [
  { value: 'none', label: 'None (raw readings)' },
  { value: 'hour', label: 'Hourly' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

export const RATE_UNIT_OPTIONS: { value: RateUnit; label: string }[] = [
  { value: '$/kWh', label: '$/kWh' },
  { value: '¢/kWh', label: '¢/kWh' },
  { value: '$/MWh', label: '$/MWh' },
];

// ─── Export processing constants ────────────────────────────────────────────

export const EXPORT_CHUNK_SIZE = 15_000;
export const PROGRESS_THROTTLE_MS = 80;