// Exports the rows behind the analysis chart as CSV — the summary values the
// bars and tooltip show, not the raw readings the Export modal produces.
//
// Every metric is written regardless of which one the chart is plotting, so a
// single download carries energy, demand and cost side by side. Column names
// spell out the aggregation (average vs. peak vs. total) because the same
// field means different things in the two views.

import { type EnergyUnit, convertEnergy } from './energyUnits';
import { rowToCsv } from './exportUtils';
import type { AnalysisGroupBy } from '../hooks/analysisAggregation';

export type AnalysisView = 'averages' | 'timeline';

// The subset of an analysis chart row this exporter reads. Energy is Wh, cost
// micro-dollars, demand kW, temperature °C — the units the aggregation keeps.
export interface AnalysisCsvRow {
    label?: string;
    fullDate?: string;
    timestamp?: number;
    average?: number;
    avgCost?: number;
    value?: number;
    cost?: number;
    demand?: number;
    temperature?: number;
    count?: number;
}

export interface AnalysisCsvOptions {
    view: AnalysisView;
    groupBy: AnalysisGroupBy;
    energyUnit: EnergyUnit;
    temperatureUnit: 'C' | 'F';
    /** Adds a temperature column; leave off when weather is not shown. */
    includeTemperature: boolean;
}

const GROUP_COLUMN: Record<AnalysisGroupBy, string> = {
    hour: 'hour',
    dayOfWeek: 'day_of_week',
    month: 'month',
};

const round = (n: number, decimals: number) => parseFloat(n.toFixed(decimals));

// Local wall-clock start of a bucket in a form spreadsheets parse as a date.
function periodStart(ts: number, groupBy: AnalysisGroupBy): string {
    const d = new Date(ts * 1000);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return groupBy === 'hour' ? `${date} ${String(d.getHours()).padStart(2, '0')}:00` : date;
}

export function buildAnalysisCsv(rows: AnalysisCsvRow[], options: AnalysisCsvOptions): string {
    const { view, groupBy, energyUnit, temperatureUnit, includeTemperature } = options;
    const unit = energyUnit.toLowerCase();
    const tempUnit = temperatureUnit.toLowerCase();
    const toUnit = (c: number) => (temperatureUnit === 'F' ? c * 9 / 5 + 32 : c);

    let headers: string[];
    let toRow: (r: AnalysisCsvRow) => Record<string, unknown>;

    if (view === 'averages') {
        const group = GROUP_COLUMN[groupBy];
        headers = [group, `avg_energy_${unit}`, 'avg_peak_demand_kw', 'avg_cost_dollars'];
        if (includeTemperature) headers.push(`avg_temperature_${tempUnit}`);
        headers.push('periods_averaged');

        toRow = (r) => {
            const count = r.count ?? 0;
            // A category with no complete periods plots as an empty bar; blank
            // cells keep it from charting as a real zero in the spreadsheet.
            const empty = count === 0;
            return {
                [group]: r.label ?? '',
                [`avg_energy_${unit}`]: empty ? null : round(convertEnergy(r.average ?? 0, energyUnit), 4),
                avg_peak_demand_kw: empty ? null : round(r.demand ?? 0, 3),
                avg_cost_dollars: empty ? null : round((r.avgCost ?? 0) / 100_000, 4),
                [`avg_temperature_${tempUnit}`]: r.temperature != null ? round(toUnit(r.temperature), 1) : null,
                periods_averaged: count,
            };
        };
    } else {
        headers = ['period', 'period_start', `energy_${unit}`, 'peak_demand_kw', 'cost_dollars'];
        if (includeTemperature) headers.push(`temperature_${tempUnit}`);
        headers.push('readings');

        toRow = (r) => ({
            period: r.fullDate ?? '',
            period_start: r.timestamp != null ? periodStart(r.timestamp, groupBy) : null,
            [`energy_${unit}`]: round(convertEnergy(r.value ?? 0, energyUnit), 4),
            peak_demand_kw: round(r.demand ?? 0, 3),
            cost_dollars: round((r.cost ?? 0) / 100_000, 4),
            [`temperature_${tempUnit}`]: r.temperature != null ? round(toUnit(r.temperature), 1) : null,
            readings: r.count ?? 0,
        });
    }

    const lines = [headers.join(',')];
    for (const r of rows) lines.push(rowToCsv(toRow(r), headers));
    return lines.join('\n') + '\n';
}

/** Trigger a browser download of `csv` as `<fileName>.csv`. */
export function downloadCsv(csv: string, fileName: string): void {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
