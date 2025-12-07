import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  const [isAnimating, setIsAnimating] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Close with animation and blur to reset mobile zoom
  const closeDropdown = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setIsAnimating(false);
    setTimeout(() => setIsExpanded(false), 150);
  }, []);

  // Open with animation
  const openDropdown = useCallback(() => {
    setIsExpanded(true);
    requestAnimationFrame(() => setIsAnimating(true));
  }, []);

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
        closeDropdown();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded, closeDropdown]);

  // Close on escape key
  useEffect(() => {
    if (!isExpanded) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDropdown();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isExpanded, closeDropdown]);

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
      className={`fixed inset-0 z-[9998] flex items-start justify-center pt-[15vh] px-4 bg-black/20 backdrop-blur-[2px] transition-opacity duration-150 ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={closeDropdown}
    >
      {/* Dropdown */}
      <div 
        ref={dropdownRef}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-[340px] transition-all duration-150 ease-out ${
          isAnimating 
            ? 'opacity-100 translate-y-0 scale-100' 
            : 'opacity-0 -translate-y-4 scale-95'
        }`}
      >
        <div className="bg-slate-800/95 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-sky-500/10 rounded-lg">
                <Thermometer className="w-4 h-4 text-sky-400" />
              </div>
              <span className="text-sm font-medium text-slate-200">Temperature Chart</span>
            </div>
            <button
              onClick={closeDropdown}
              className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4">
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Enter your location to overlay historical temperature data on your energy charts.
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Zip code or city name"
                  className="flex-1 bg-slate-900/80 border border-slate-700/80 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/50 transition-all"
                  style={{ fontSize: '16px' }} // Prevents mobile zoom
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isLoading || !inputValue.trim()}
                  className="px-4 py-2.5 text-sm font-medium bg-sky-600 hover:bg-sky-500 active:bg-sky-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-all disabled:cursor-not-allowed"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Set'}
                </button>
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              {location && (
                <div className="flex items-center justify-between bg-slate-900/60 border border-slate-700/50 rounded-lg px-3 py-2.5 group">
                  <div className="flex items-center gap-2 text-sm text-slate-300 min-w-0">
                    <MapPin className="w-4 h-4 text-sky-400 flex-shrink-0" />
                    <span className="truncate font-medium">{location.name}</span>
                    {location.admin1 && (
                      <span className="text-slate-500 truncate text-xs">{location.admin1}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="p-1 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-md flex-shrink-0 transition-colors"
                    title="Clear location"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </form>

            {location && (
              <div className="mt-4 pt-4 border-t border-slate-700/50">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => onToggle(e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="w-9 h-5 bg-slate-700 rounded-full peer-checked:bg-sky-600 transition-colors" />
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-slate-300 rounded-full shadow-sm peer-checked:translate-x-4 peer-checked:bg-white transition-all" />
                  </div>
                  <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">
                    Show on charts
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-slate-900/40 border-t border-slate-700/30">
            <p className="text-[10px] text-slate-500">
              Data from Open-Meteo • Cached locally
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  // Compact display when location is set
  if (location && !isExpanded) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onToggle(!enabled)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
            enabled
              ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30 shadow-sm shadow-sky-500/10'
              : 'bg-slate-800 text-slate-500 border border-slate-700/50 hover:text-slate-300 hover:border-slate-600'
          }`}
          title={enabled ? 'Hide temperature chart' : 'Show temperature chart'}
        >
          <Thermometer className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{enabled ? 'Temp On' : 'Temp Off'}</span>
        </button>
        
        <button
          ref={buttonRef}
          onClick={openDropdown}
          className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 rounded-lg transition-all"
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
        onClick={() => isExpanded ? closeDropdown() : openDropdown()}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
          isExpanded
            ? 'bg-slate-700 text-slate-200 shadow-inner'
            : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/50 hover:border-slate-600'
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