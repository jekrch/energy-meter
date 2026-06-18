import { DollarSign, Zap, Gauge } from 'lucide-react';
import { type MetricMode, RESOLUTIONS } from '../../types';
import { type EnergyUnit, ENERGY_UNITS } from '../../utils/energyUnits';
import { PillGroup, PillButton } from '../common/PillButton';
import { WeatherSettings } from '../common/WeatherSettings';
import type { useWeather } from '../../hooks/useWeather';

interface ChartToolbarProps {
  activeTab: 'chart' | 'table' | 'analysis';
  metricMode: MetricMode;
  setMetricMode: (mode: MetricMode) => void;
  energyUnit: EnergyUnit;
  setEnergyUnit: (unit: EnergyUnit) => void;
  resolution: string;
  setResolution: (resolution: string) => void;
  temperatureUnit: 'C' | 'F';
  setTemperatureUnit: (unit: 'C' | 'F') => void;
  weather: ReturnType<typeof useWeather>;
}

// The metric / energy-unit / resolution / weather control row that sits above
// the chart and analysis views. Extracted from App with behavior unchanged; the
// repeated pill buttons now go through the shared PillButton primitive.
export function ChartToolbar({
  activeTab,
  metricMode,
  setMetricMode,
  energyUnit,
  setEnergyUnit,
  resolution,
  setResolution,
  temperatureUnit,
  setTemperatureUnit,
  weather,
}: ChartToolbarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <PillGroup className="bg-slate-800/80 rounded-lg">

        <PillButton
          active={metricMode === 'cost'}
          onClick={() => setMetricMode('cost')}
          activeClassName="bg-emerald-500/15 text-emerald-400 shadow-sm"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md"
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Cost</span>
        </PillButton>
        <PillButton
          active={metricMode === 'energy'}
          onClick={() => setMetricMode('energy')}
          activeClassName="bg-amber-500/15 text-amber-400 shadow-sm"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md"
        >
          <Zap className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Energy</span>
        </PillButton>
        <PillButton
          active={metricMode === 'demand'}
          onClick={() => setMetricMode('demand')}
          activeClassName="bg-violet-500/15 text-violet-400 shadow-sm"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md"
        >
          <Gauge className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Demand</span>
        </PillButton>

      </PillGroup>

      {metricMode === 'demand' && (
        <PillGroup className="bg-slate-800/80 rounded-lg">
          <span className="px-2 py-1.5 text-xs text-violet-400 font-medium">kW</span>
        </PillGroup>
      )}

      {metricMode === 'energy' && (
        <PillGroup className="bg-slate-800/80 rounded-lg">
          {ENERGY_UNITS.map(({ value, label }) => (
            <PillButton
              key={value}
              active={energyUnit === value}
              onClick={() => setEnergyUnit(value)}
              activeClassName="bg-amber-500/15 text-amber-400 shadow-sm"
              className="px-2 py-1.5 text-xs rounded-md"
            >
              {label}
            </PillButton>
          ))}
        </PillGroup>
      )}

      {activeTab === 'chart' && (
        <PillGroup className="bg-slate-800/80 rounded-lg">
          {Object.keys(RESOLUTIONS).map((key) => (
            <PillButton
              key={key}
              active={resolution === key}
              onClick={() => setResolution(key)}
              activeClassName="bg-slate-700 text-emerald-400 shadow-sm"
              className="px-2.5 py-1.5 text-xs rounded-md"
            >
              {RESOLUTIONS[key].label.split(' ')[0]}
            </PillButton>
          ))}
        </PillGroup>
      )}

      <div className="flex-1 min-w-0" />

      <div className="flex items-center gap-1.5">
        <WeatherSettings
          enabled={weather.enabled}
          zipCode={weather.zipCode}
          location={weather.location}
          isLoading={weather.isLoading}
          error={weather.error}
          onSetZipCode={weather.setZipCode}
          onToggle={weather.toggleEnabled}
          onClear={weather.clearLocation}
        />

        {weather.enabled && weather.location && (
          <PillGroup className="bg-slate-800/80 rounded-lg">
            <PillButton
              active={temperatureUnit === 'F'}
              onClick={() => setTemperatureUnit('F')}
              activeClassName="bg-sky-500/15 text-sky-400 shadow-sm"
              className="px-2 py-1.5 text-xs rounded-md"
            >
              °F
            </PillButton>
            <PillButton
              active={temperatureUnit === 'C'}
              onClick={() => setTemperatureUnit('C')}
              activeClassName="bg-sky-500/15 text-sky-400 shadow-sm"
              className="px-2 py-1.5 text-xs rounded-md"
            >
              °C
            </PillButton>
          </PillGroup>
        )}
      </div>
    </div>
  );
}
