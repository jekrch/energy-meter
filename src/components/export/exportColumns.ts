import type { EnergyUnit } from '../../utils/energyUnits';
import type { ExportColumn, ExportGroupBy, RateUnit } from './exportConstants';

// ─── Column ordering ────────────────────────────────────────────────────────

/** Canonical display order for columns. Rate always comes last. */
const COLUMN_ORDER = ['timestamp', 'date', 'time', 'value', 'demand', 'cost', 'temperature', 'peakPeriod', 'rate'];

function columnSortIndex(key: string): number {
  const idx = COLUMN_ORDER.indexOf(key);
  return idx === -1 ? COLUMN_ORDER.length : idx;
}

// ─── Column factory ─────────────────────────────────────────────────────────

/**
 * Builds the base column list from current props.
 * Rate is always last and disabled by default.
 */
export function buildDefaultColumns(
  energyUnit: EnergyUnit,
  weatherAvailable: boolean,
  temperatureUnit: string,
  peakScheduleAvailable = false,
): ExportColumn[] {
  const cols: ExportColumn[] = [
    { key: 'timestamp', label: 'Timestamp', enabled: true, category: 'core' },
    { key: 'date', label: 'Date', enabled: true, category: 'core' },
    { key: 'time', label: 'Time', enabled: true, category: 'core' },
    { key: 'value', label: `Energy (${energyUnit})`, enabled: true, category: 'core' },
    { key: 'demand', label: 'Demand (kW)', enabled: false, category: 'derived' },
    { key: 'cost', label: 'Cost ($)', enabled: true, category: 'core' },
  ];
  if (weatherAvailable) {
    cols.push({
      key: 'temperature',
      label: `Temperature (°${temperatureUnit})`,
      enabled: true,
      category: 'weather',
    });
  }
  if (peakScheduleAvailable) {
    cols.push({ key: 'peakPeriod', label: 'Peak Period', enabled: false, category: 'derived' });
  }
  // Rate always last — label is a placeholder; deriveEffectiveColumns patches it
  cols.push({ key: 'rate', label: 'Avg Rate', enabled: false, category: 'derived' });
  return cols;
}

// ─── Effective columns derivation ───────────────────────────────────────────

/**
 * Derives the display-ready column list from base columns + current settings.
 *
 * - Patches the rate column label with the current unit selection.
 * - Disables `time` and `peakPeriod` when grouping is active (not meaningful
 *   for aggregates — a bucket spans several rate periods).
 * - Relabels `date` → `Period` and `temperature` → `Avg Temp` when grouped.
 * - Sorts by canonical display order.
 */
export function deriveEffectiveColumns(
  columns: ExportColumn[],
  groupBy: ExportGroupBy,
  rateUnit: RateUnit,
  temperatureUnit: string,
): ExportColumn[] {
  const mapped = columns.map(col => {
    if (col.key === 'rate') return { ...col, label: `Avg Rate (${rateUnit})` };
    if (groupBy === 'none') return col;
    if (col.key === 'time' || col.key === 'peakPeriod') return { ...col, enabled: false };
    if (col.key === 'date') return { ...col, label: 'Period' };
    if (col.key === 'demand') return { ...col, label: 'Peak Demand (kW)' };
    if (col.key === 'temperature') return { ...col, label: `Avg Temp (°${temperatureUnit})` };
    return col;
  });
  return [...mapped].sort((a, b) => columnSortIndex(a.key) - columnSortIndex(b.key));
}