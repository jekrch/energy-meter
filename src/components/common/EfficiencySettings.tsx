import React from 'react';
import { Gauge, Flame, Snowflake, Thermometer } from 'lucide-react';

export interface EfficiencyConfig {
  heatingEnabled: boolean;
  coolingEnabled: boolean;
  balancePointC: number;
}

interface EfficiencySettingsProps {
  config: EfficiencyConfig;
  onChange: (config: EfficiencyConfig) => void;
  showEfficiency: boolean;
  onToggleShow: () => void;
  temperatureUnit: 'C' | 'F';
}

export function EfficiencySettings({
  config,
  onChange,
  showEfficiency,
  onToggleShow,
  temperatureUnit,
}: EfficiencySettingsProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const balancePointDisplay = temperatureUnit === 'F'
    ? Math.round(config.balancePointC * 9/5 + 32)
    : config.balancePointC;

  const handleBalancePointChange = (displayValue: number) => {
    const celsius = temperatureUnit === 'F'
      ? Math.round((displayValue - 32) * 5/9)
      : displayValue;
    onChange({ ...config, balancePointC: celsius });
  };

  return (
    <div className="relative">
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all border ${
          showEfficiency
            ? 'bg-violet-500/15 text-violet-400 border-violet-500/30'
            : 'bg-slate-800/80 text-slate-400 border-slate-700/50 hover:text-slate-200'
        }`}
      >
        <Gauge className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Efficiency</span>
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-slate-800 rounded-lg border border-slate-700 shadow-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-200">
                Efficiency Index
              </span>
              <button
                onClick={onToggleShow}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  showEfficiency
                    ? 'bg-violet-500/20 text-violet-400'
                    : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {showEfficiency ? 'On' : 'Off'}
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Shows energy efficiency normalized for weather. 100 = average, 
              higher = more efficient.
            </p>

            {/* HVAC Type Selection */}
            <div className="space-y-2">
              <label className="text-xs text-slate-400 font-medium">
                Electric HVAC Type
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => onChange({ ...config, heatingEnabled: !config.heatingEnabled })}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all border ${
                    config.heatingEnabled
                      ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                      : 'bg-slate-700/50 text-slate-500 border-slate-600/50 hover:text-slate-300'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" />
                  Heating
                </button>
                <button
                  onClick={() => onChange({ ...config, coolingEnabled: !config.coolingEnabled })}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all border ${
                    config.coolingEnabled
                      ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                      : 'bg-slate-700/50 text-slate-500 border-slate-600/50 hover:text-slate-300'
                  }`}
                >
                  <Snowflake className="w-3.5 h-3.5" />
                  Cooling
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                Select which systems use electricity
              </p>
            </div>

            {/* Balance Point */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                  <Thermometer className="w-3.5 h-3.5" />
                  Balance Point
                </label>
                <span className="text-xs text-slate-300 font-mono">
                  {balancePointDisplay}°{temperatureUnit}
                </span>
              </div>
              <input
                type="range"
                min={temperatureUnit === 'F' ? 55 : 12}
                max={temperatureUnit === 'F' ? 75 : 24}
                value={balancePointDisplay}
                onChange={(e) => handleBalancePointChange(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
              />
              <p className="text-[10px] text-slate-500">
                Temperature where no heating/cooling is needed (typically 65°F / 18°C)
              </p>
            </div>

            {/* Legend */}
            <div className="pt-2 border-t border-slate-700">
              <div className="text-xs text-slate-400 font-medium mb-2">Index Scale</div>
              <div className="grid grid-cols-5 gap-1 text-[10px]">
                {[
                  { label: '≥130', color: 'bg-green-500', text: 'Excellent' },
                  { label: '110+', color: 'bg-lime-500', text: 'Good' },
                  { label: '90-109', color: 'bg-yellow-500', text: 'Average' },
                  { label: '70-89', color: 'bg-orange-500', text: 'Below' },
                  { label: '<70', color: 'bg-red-500', text: 'Poor' },
                ].map((item) => (
                  <div key={item.label} className="text-center">
                    <div className={`h-1.5 rounded ${item.color} mb-1`} />
                    <div className="text-slate-500">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}