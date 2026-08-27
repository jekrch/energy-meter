import { useState } from 'react';
import { CalendarClock, DollarSign, Gauge, Settings2, Zap } from 'lucide-react';
import { type MetricMode, type PeakSchedule, RESOLUTIONS } from '../../types';
import { type EnergyUnit, ENERGY_UNITS } from '../../utils/energyUnits';
import { PillGroup, PillButton } from '../common/PillButton';
import { WeatherSettings } from '../common/WeatherSettings';
import { PeakRatesModal } from '../common/PeakRatesModal';
import { describeSchedule } from '../../utils/peakScheduleFormat';
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
  peakSchedule: PeakSchedule | null;
  setPeakSchedule: (schedule: PeakSchedule | null) => void;
  showPeakBands: boolean;
  setShowPeakBands: (show: boolean) => void;
  // Passed straight through to the peak editor's "Save data file" action.
  onSaveDataFile?: () => void;
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
  peakSchedule,
  setPeakSchedule,
  showPeakBands,
  setShowPeakBands,
  onSaveDataFile,
}: ChartToolbarProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const hasSchedule = (peakSchedule?.periods.length ?? 0) > 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <PillGroup className="bg-sunken rounded-lg" activeId={metricMode}>

        <PillButton
          id="cost"
          active={metricMode === 'cost'}
          onClick={() => setMetricMode('cost')}
          activeClassName="bg-emerald-500/15 text-emerald-400"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md"
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Cost</span>
        </PillButton>
        <PillButton
          id="energy"
          active={metricMode === 'energy'}
          onClick={() => setMetricMode('energy')}
          activeClassName="bg-amber-500/15 text-amber-400"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md"
        >
          <Zap className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Energy</span>
        </PillButton>
        <PillButton
          id="demand"
          active={metricMode === 'demand'}
          onClick={() => setMetricMode('demand')}
          activeClassName="bg-violet-500/15 text-violet-400"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md"
        >
          <Gauge className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Demand</span>
        </PillButton>

      </PillGroup>

      {metricMode === 'demand' && (
        <PillGroup className="bg-sunken rounded-lg">
          <span className="px-2 py-1.5 text-xs text-violet-400 font-medium">kW</span>
        </PillGroup>
      )}

      {metricMode === 'energy' && (
        <PillGroup className="bg-sunken rounded-lg" activeId={energyUnit}>
          {ENERGY_UNITS.map(({ value, label }) => (
            <PillButton
              key={value}
              id={value}
              active={energyUnit === value}
              onClick={() => setEnergyUnit(value)}
              activeClassName="bg-amber-500/15 text-amber-400"
              className="px-2 py-1.5 text-xs rounded-md"
            >
              {label}
            </PillButton>
          ))}
        </PillGroup>
      )}

      {activeTab === 'chart' && (
        <PillGroup className="bg-sunken rounded-lg" activeId={resolution}>
          {Object.keys(RESOLUTIONS).map((key) => (
            <PillButton
              key={key}
              id={key}
              active={resolution === key}
              onClick={() => setResolution(key)}
              activeClassName="bg-emerald-500/15 text-emerald-400"
              className="px-2.5 py-1.5 text-xs rounded-md"
            >
              {RESOLUTIONS[key].label.split(' ')[0]}
            </PillButton>
          ))}
        </PillGroup>
      )}

      <div className="flex-1 min-w-0" />

      <div className="flex items-center gap-1.5">
        {/* Peak rates: the pill toggles the bands, the gear opens the editor.
            With no schedule yet there is nothing to toggle, so the whole pill
            opens the editor instead. */}
        <PillGroup className="bg-sunken rounded-lg">
          <PillButton
            active={hasSchedule && showPeakBands}
            onClick={() => (hasSchedule ? setShowPeakBands(!showPeakBands) : setEditorOpen(true))}
            activeClassName="bg-red-500/15 text-red-400"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md"
          >
            <CalendarClock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {hasSchedule ? describeSchedule(peakSchedule!) : 'Peak rates'}
            </span>
          </PillButton>
          {hasSchedule && (
            <PillButton
              active={false}
              onClick={() => setEditorOpen(true)}
              activeClassName=""
              className="px-2 py-1.5 rounded-md"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </PillButton>
          )}
        </PillGroup>

        {editorOpen && (
          <PeakRatesModal
            schedule={peakSchedule}
            onChange={setPeakSchedule}
            onClose={() => setEditorOpen(false)}
            onSaveDataFile={onSaveDataFile}
          />
        )}

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
          <PillGroup className="bg-sunken rounded-lg" activeId={temperatureUnit}>
            <PillButton
              id="F"
              active={temperatureUnit === 'F'}
              onClick={() => setTemperatureUnit('F')}
              activeClassName="bg-sky-500/15 text-sky-400"
              className="px-2 py-1.5 text-xs rounded-md"
            >
              °F
            </PillButton>
            <PillButton
              id="C"
              active={temperatureUnit === 'C'}
              onClick={() => setTemperatureUnit('C')}
              activeClassName="bg-sky-500/15 text-sky-400"
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
