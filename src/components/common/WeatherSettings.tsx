import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Loader2, X, Thermometer } from 'lucide-react';
import type { GeocodingResult } from '../../utils/weatherData';

interface WeatherSettingsProps {
  enabled: boolean;
  zipCode: string;
  location: GeocodingResult | null;
  isLoading: boolean;
  error: string | null;
  onSetZipCode: (zip: string) => void;
  onToggle: (enabled: boolean) => void;
  onClear: () => void;
}

export const WeatherSettings = React.memo(function WeatherSettings({
  enabled, zipCode, location, isLoading, error, onSetZipCode, onToggle, onClear,
}: WeatherSettingsProps) {
  const [inputValue, setInputValue] = useState(zipCode);
  const [isExpanded, setIsExpanded] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Calculate dropdown position
  useEffect(() => {
    if (isExpanded && buttonRef.current) {
      const updatePosition = () => {
        const buttonRect = buttonRef.current!.getBoundingClientRect();
        const dropdownWidth = 260;
        const dropdownHeight = 320;
        const padding = 12;

        let top = buttonRect.bottom + 8;
        let left = buttonRect.left;

        // Check right edge
        if (left + dropdownWidth > window.innerWidth - padding) {
          left = window.innerWidth - dropdownWidth - padding;
        }

        // Check left edge
        if (left < padding) {
          left = padding;
        }

        // Check bottom edge - flip above if needed
        if (top + dropdownHeight > window.innerHeight - padding) {
          top = buttonRect.top - dropdownHeight - 8;
        }

        // If flipped above but still off top, just position at top
        if (top < padding) {
          top = padding;
        }

        setPosition({ top, left });
      };

      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);

      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isExpanded]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsExpanded(false);
      }
    };

    // Use timeout to avoid immediate close on the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded]);

  // Close on escape key
  useEffect(() => {
    if (!isExpanded) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isExpanded]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onSetZipCode(inputValue.trim());
    }
  };

  const handleClear = () => {
    setInputValue('');
    onClear();
  };

  const dropdown = isExpanded ? createPortal(
    <div 
      ref={dropdownRef}
      style={{ top: position.top, left: position.left }}
      className="fixed z-[9999] bg-slate-800 border border-slate-700 rounded-lg shadow-2xl p-3 w-[260px]"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-300">Temperature Overlay</span>
        <button
          onClick={() => setIsExpanded(false)}
          className="text-slate-500 hover:text-slate-300 p-1"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-[10px] text-slate-500 mb-3">
        Enter your location to overlay historical temperature data on charts.
      </p>

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Zip code or city name"
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50"
            autoFocus
          />
          <button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Set'}
          </button>
        </div>

        {error && (
          <p className="text-[10px] text-red-400">{error}</p>
        )}

        {location && (
          <div className="flex items-center justify-between bg-slate-900/50 rounded px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <MapPin className="w-3 h-3 text-sky-400 flex-shrink-0" />
              <span className="truncate">{location.name}</span>
              {location.admin1 && (
                <span className="text-slate-500 truncate">{location.admin1}</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="text-slate-500 hover:text-red-400 p-0.5 flex-shrink-0"
              title="Clear location"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </form>

      {location && (
        <div className="mt-3 pt-2 border-t border-slate-700">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onToggle(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500/50"
            />
            <span className="text-xs text-slate-300">Show on charts</span>
          </label>
        </div>
      )}

      <p className="text-[9px] text-slate-600 mt-2">
        Data from Open-Meteo • Cached locally
      </p>
    </div>,
    document.body
  ) : null;

  // Compact display when location is set
  if (location && !isExpanded) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => onToggle(!enabled)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
            enabled
              ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
              : 'bg-slate-800 text-slate-500 border border-slate-700/50 hover:text-slate-300'
          }`}
          title={enabled ? 'Hide temperature overlay' : 'Show temperature overlay'}
        >
          <Thermometer className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{enabled ? 'Temp On' : 'Temp Off'}</span>
        </button>
        
        <button
          ref={buttonRef}
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          title="Change location"
        >
          <MapPin className="w-3 h-3" />
          <span className="hidden md:inline truncate max-w-[100px]">
            {location.name}
          </span>
        </button>
        {dropdown}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
          isExpanded
            ? 'bg-slate-700 text-slate-200'
            : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/50'
        }`}
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Thermometer className="w-3.5 h-3.5" />
        )}
        <span className="hidden sm:inline">Weather</span>
      </button>
      {dropdown}
    </div>
  );
});