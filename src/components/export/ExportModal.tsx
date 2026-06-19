import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';
import { Download, X, FileJson, FileSpreadsheet, Check } from 'lucide-react';
import { Dropdown } from '../common/Dropdown';
import { PillGroup, PillButton } from '../common/PillButton';
import type { DataPoint } from '../../types';
import { type EnergyUnit } from '../../utils/energyUnits';
import { toDemandKW } from '../../utils/demandUnits';
import { formatShortDate } from '../../utils/formatters';
import type { HourlyWeatherData } from '../../utils/weatherData';

import type { ExportFormat, ExportGroupBy, RateUnit, ExportColumn } from './exportConstants';
import {
  RATE_UNITS,
  GROUP_OPTIONS,
  RATE_UNIT_OPTIONS,
  EXPORT_CHUNK_SIZE,
  PROGRESS_THROTTLE_MS,
} from './exportConstants';
import { buildDefaultColumns, deriveEffectiveColumns } from './exportColumns';
import {
  buildWeatherLookup,
  getBucketKey,
  buildRawRow,
  buildAggRow,
  rowToCsv,
  type AggBucket,
} from '../../utils/exportUtils';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ExportModalProps {
  data: DataPoint[];
  energyUnit: EnergyUnit;
  weatherAvailable: boolean;
  /** Raw hourly weather data — NOT the resolution-aggregated map */
  hourlyWeatherData?: HourlyWeatherData[];
  temperatureUnit?: 'C' | 'F';
}

// ─── Component ──────────────────────────────────────────────────────────────

export const ExportModal = React.memo(function ExportModal({
  data,
  energyUnit,
  weatherAvailable,
  hourlyWeatherData,
  temperatureUnit = 'F',
}: ExportModalProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  useScrollLock(isExpanded);
  const [isAnimating, setIsAnimating] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [columns, setColumns] = useState<ExportColumn[]>([]);
  const [groupBy, setGroupBy] = useState<ExportGroupBy>('none');
  const [rateUnit, setRateUnit] = useState<RateUnit>('$/kWh');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const ratePickerRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  const lastProgressUpdate = useRef(0);

  const rateUnitConfig = useMemo(
    () => RATE_UNITS.find(u => u.value === rateUnit)!,
    [rateUnit],
  );

  const dateRangeLabel = useMemo(() => {
    if (!data.length) return '';
    const first = new Date(data[0].timestamp * 1000);
    const last = new Date(data[data.length - 1].timestamp * 1000);
    return `${formatShortDate(first)} – ${formatShortDate(last)}`;
  }, [data]);

  // Rebuild columns when props change.
  // NOTE: rateUnit is intentionally excluded so that changing the rate unit
  // doesn't reset the enabled state of all columns. The rate column label is
  // patched in deriveEffectiveColumns instead.
  useEffect(() => {
    setColumns(buildDefaultColumns(energyUnit, weatherAvailable, temperatureUnit));
  }, [energyUnit, weatherAvailable, temperatureUnit]);

  const effectiveColumns = useMemo(
    () => deriveEffectiveColumns(columns, groupBy, rateUnit, temperatureUnit),
    [columns, groupBy, rateUnit, temperatureUnit],
  );

  // ── Open / close ────────────────────────────────────────────────────────

  const closeDropdown = useCallback(() => {
    if (isExporting) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setIsAnimating(false);
    setTimeout(() => setIsExpanded(false), 150);
  }, [isExporting]);

  const openDropdown = useCallback(() => {
    setIsExpanded(true);
    setExportProgress(0);
    setIsExporting(false);
    cancelRef.current = false;
    requestAnimationFrame(() => setIsAnimating(true));
  }, []);

  // Click-outside
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (isExporting) return;
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        closeDropdown();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded, isExporting, closeDropdown]);

  // Escape
  useEffect(() => {
    if (!isExpanded) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isExporting) cancelRef.current = true;
        else closeDropdown();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isExpanded, isExporting, closeDropdown]);

  // ── Column toggling ─────────────────────────────────────────────────────

  const toggleColumn = (key: string) => {
    if (groupBy !== 'none' && key === 'time') return;
    setColumns(prev =>
      prev.map(col => (col.key === key ? { ...col, enabled: !col.enabled } : col)),
    );
  };

  const enabledColumns = effectiveColumns.filter(c => c.enabled);
  const toggleableColumns = effectiveColumns.filter(c => !(groupBy !== 'none' && c.key === 'time'));
  const allEnabled = toggleableColumns.every(c => c.enabled);
  const rateEnabled = effectiveColumns.find(c => c.key === 'rate')?.enabled ?? false;

  // Auto-scroll to the rate unit picker when the rate column is toggled on
  useEffect(() => {
    if (rateEnabled && ratePickerRef.current && scrollContainerRef.current) {
      requestAnimationFrame(() => {
        ratePickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [rateEnabled]);

  const toggleAll = () => {
    const next = !allEnabled;
    setColumns(prev => prev.map(col => {
      if (groupBy !== 'none' && col.key === 'time') return { ...col, enabled: false };
      return { ...col, enabled: next };
    }));
  };

  // ── Temperature conversion ──────────────────────────────────────────────

  const celsiusToUnit = useCallback((celsius: number): number => {
    return temperatureUnit === 'F' ? celsius * 9 / 5 + 32 : celsius;
  }, [temperatureUnit]);

  // ── Export handler ──────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    if (enabledColumns.length === 0 || isExporting) return;

    setIsExporting(true);
    setExportProgress(0);
    cancelRef.current = false;
    lastProgressUpdate.current = 0;

    const enabledKeys = new Set(enabledColumns.map(c => c.key));
    const includeWeather = enabledKeys.has('temperature') && hourlyWeatherData?.length;
    const weatherLookup = includeWeather
      ? buildWeatherLookup(hourlyWeatherData!)
      : null;

    const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

    try {
      const totalRows = data.length;
      const parts: string[] = [];
      let headerKeys: string[] | null = null;

      if (groupBy === 'none') {
        const sampleRow = buildRawRow(data[0], enabledKeys, energyUnit, temperatureUnit, weatherLookup, celsiusToUnit, timeFmt, rateUnitConfig);
        headerKeys = Object.keys(sampleRow);

        if (format === 'csv' && includeHeaders) parts.push(headerKeys.join(',') + '\n');
        if (format === 'json') parts.push('[\n');

        let firstJsonRow = true;

        for (let offset = 0; offset < totalRows; offset += EXPORT_CHUNK_SIZE) {
          if (cancelRef.current) { setIsExporting(false); setExportProgress(0); return; }

          const end = Math.min(offset + EXPORT_CHUNK_SIZE, totalRows);
          const lines: string[] = [];

          for (let i = offset; i < end; i++) {
            const row = buildRawRow(data[i], enabledKeys, energyUnit, temperatureUnit, weatherLookup, celsiusToUnit, timeFmt, rateUnitConfig);
            if (format === 'csv') {
              lines.push(rowToCsv(row, headerKeys!));
            } else {
              const prefix = firstJsonRow ? '' : ',\n';
              firstJsonRow = false;
              lines.push(prefix + JSON.stringify(row));
            }
          }

          parts.push(lines.join(format === 'csv' ? '\n' : ''));

          const now = performance.now();
          if (now - lastProgressUpdate.current > PROGRESS_THROTTLE_MS || end === totalRows) {
            lastProgressUpdate.current = now;
            setExportProgress(Math.round((end / totalRows) * 100));
          }
          if (end < totalRows) await new Promise(r => setTimeout(r, 0));
        }

        if (format === 'json') parts.push('\n]');

      } else {
        const buckets = new Map<string, AggBucket>();

        for (let offset = 0; offset < totalRows; offset += EXPORT_CHUNK_SIZE) {
          if (cancelRef.current) { setIsExporting(false); setExportProgress(0); return; }

          const end = Math.min(offset + EXPORT_CHUNK_SIZE, totalRows);

          for (let i = offset; i < end; i++) {
            const point = data[i];
            const { key, timestamp, label } = getBucketKey(point.timestamp, groupBy);

            const demand = toDemandKW(point.value, point.duration);
            const existing = buckets.get(key);
            if (existing) {
              existing.energySum += point.value;
              existing.costSum += point.cost;
              if (demand > existing.demandMax) existing.demandMax = demand;
              existing.count++;
              if (weatherLookup) {
                const temp = weatherLookup(point.timestamp);
                if (temp != null) {
                  existing.tempSum += temp;
                  existing.tempCount++;
                }
              }
            } else {
              let tempSum = 0, tempCount = 0;
              if (weatherLookup) {
                const temp = weatherLookup(point.timestamp);
                if (temp != null) { tempSum = temp; tempCount = 1; }
              }
              buckets.set(key, {
                timestamp,
                label,
                energySum: point.value,
                costSum: point.cost,
                demandMax: demand,
                tempSum,
                tempCount,
                count: 1,
              });
            }
          }

          const now = performance.now();
          if (now - lastProgressUpdate.current > PROGRESS_THROTTLE_MS || end === totalRows) {
            lastProgressUpdate.current = now;
            setExportProgress(Math.round((end / totalRows) * 70));
          }
          if (end < totalRows) await new Promise(r => setTimeout(r, 0));
        }

        const sortedBuckets = Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);

        const sampleRow = buildAggRow(sortedBuckets[0], enabledKeys, energyUnit, temperatureUnit, celsiusToUnit, rateUnitConfig);
        headerKeys = Object.keys(sampleRow);

        if (format === 'csv' && includeHeaders) parts.push(headerKeys.join(',') + '\n');
        if (format === 'json') parts.push('[\n');

        const lines: string[] = [];
        for (let i = 0; i < sortedBuckets.length; i++) {
          const row = buildAggRow(sortedBuckets[i], enabledKeys, energyUnit, temperatureUnit, celsiusToUnit, rateUnitConfig);
          if (format === 'csv') {
            lines.push(rowToCsv(row, headerKeys));
          } else {
            lines.push((i > 0 ? ',\n' : '') + JSON.stringify(row));
          }
        }
        parts.push(lines.join(format === 'csv' ? '\n' : ''));
        if (format === 'json') parts.push('\n]');

        setExportProgress(100);
      }

      if (cancelRef.current) { setIsExporting(false); setExportProgress(0); return; }

      const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
      const groupSuffix = groupBy !== 'none' ? `-${groupBy}` : '';
      const blob = new Blob(parts, { type: mimeType });
      const filename = `energy-data${groupSuffix}.${format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportProgress(100);
      await new Promise(r => setTimeout(r, 350));

      setIsExporting(false);
      setExportProgress(0);
      closeDropdown();
    } catch (err) {
      console.error('Export failed:', err);
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [enabledColumns, isExporting, data, format, groupBy, energyUnit, temperatureUnit, hourlyWeatherData, includeHeaders, celsiusToUnit, closeDropdown, rateUnitConfig]);

  // ── Render ──────────────────────────────────────────────────────────────

  const modal = isExpanded ? createPortal(
    <div
      className={`fixed inset-0 z-[9998] flex items-start justify-center px-4 bg-black/20 backdrop-blur-[2px] transition-opacity duration-150 ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ overscrollBehavior: 'contain', touchAction: 'none' }}
      onClick={closeDropdown}
    >
      <div
        ref={dropdownRef}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-[380px] md:max-w-lg mt-[8vh] max-h-[84vh] flex flex-col transition-[opacity,transform] duration-150 ease-out ${
          isAnimating ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95'
        }`}
        style={{ touchAction: 'auto' }}
      >
        <div className="bg-surface border border-line rounded-2xl shadow-float overflow-hidden flex flex-col max-h-[84vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-header-line flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                <Download className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-sm font-medium text-slate-200">Export Data</span>
            </div>
            {!isExporting && (
              <button
                onClick={closeDropdown}
                className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Fixed sections: summary, format, group-by */}
          <div className="px-4 pt-4 pb-2 space-y-4 flex-shrink-0">
            {/* Summary */}
            <div className="bg-sunken border border-line rounded-lg px-3 py-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Rows</span>
                <span className="text-sm font-medium text-slate-200 font-mono tabular-nums">
                  {data.length.toLocaleString()}
                </span>
              </div>
              {dateRangeLabel && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Range</span>
                  <span className="text-xs text-slate-400 font-mono tabular-nums">{dateRangeLabel}</span>
                </div>
              )}
            </div>

            {/* Format */}
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
                Format
              </label>
              <PillGroup className="bg-sunken rounded-lg">
                <PillButton
                  active={format === 'csv'}
                  onClick={() => setFormat('csv')}
                  disabled={isExporting}
                  activeClassName="bg-emerald-500/15 text-emerald-400"
                  className="flex items-center justify-center gap-1.5 flex-1 px-3 py-2 text-xs rounded-md"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  CSV
                </PillButton>
                <PillButton
                  active={format === 'json'}
                  onClick={() => setFormat('json')}
                  disabled={isExporting}
                  activeClassName="bg-emerald-500/15 text-emerald-400"
                  className="flex items-center justify-center gap-1.5 flex-1 px-3 py-2 text-xs rounded-md"
                >
                  <FileJson className="w-3.5 h-3.5" />
                  JSON
                </PillButton>
              </PillGroup>
            </div>

            {/* Group by */}
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
                Group By
              </label>
              <Dropdown
                options={GROUP_OPTIONS}
                value={groupBy}
                onChange={(v) => !isExporting && setGroupBy(v)}
                disabled={isExporting}
              />
            </div>
          </div>

          {/* Columns header */}
          <div className="px-4 pt-2 pb-1 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Columns
              </label>
              {!isExporting && (
                <button
                  onClick={toggleAll}
                  className="text-[10px] text-slate-500 hover:text-emerald-400 transition-colors"
                >
                  {allEnabled ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
          </div>

          {/* Columns list — scrollable */}
          <div
            ref={scrollContainerRef}
            className="px-4 overflow-y-auto min-h-0 flex-1"
            style={{ overscrollBehavior: 'contain' }}
          >
            <div className="space-y-1 pb-2">
              {effectiveColumns.map(col => {
                const isDisabled = isExporting || (groupBy !== 'none' && col.key === 'time');
                return (
                  <button
                    key={col.key}
                    onClick={() => !isDisabled && toggleColumn(col.key)}
                    disabled={isDisabled}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                      col.enabled
                        ? 'bg-surface-2 border border-line-2'
                        : 'bg-transparent border border-transparent hover:bg-white/5'
                    } ${isDisabled ? 'pointer-events-none opacity-40' : ''}`}
                  >
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                        col.enabled
                          ? 'bg-emerald-500/20 border border-emerald-500/50'
                          : 'border border-line-2'
                      }`}
                    >
                      {col.enabled && <Check className="w-3 h-3 text-emerald-400" />}
                    </div>
                    <span className={`text-sm transition-colors ${col.enabled ? 'text-slate-200' : 'text-slate-500'}`}>
                      {col.label}
                    </span>
                    {col.category === 'weather' && (
                      <span className="ml-auto text-[10px] text-sky-400/60 font-medium">weather</span>
                    )}
                    {col.category === 'derived' && (
                      <span className="ml-auto text-[10px] text-amber-400/60 font-medium">derived</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Rate unit picker */}
            {rateEnabled && (
              <div ref={ratePickerRef} className="pb-2 pt-1">
                <div className="bg-sunken border border-line rounded-lg px-3 py-2.5">
                  <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">
                    Rate Unit
                  </label>
                  <PillGroup className="bg-sunken rounded-md">
                    {RATE_UNIT_OPTIONS.map(opt => (
                      <PillButton
                        key={opt.value}
                        active={rateUnit === opt.value}
                        onClick={() => setRateUnit(opt.value)}
                        disabled={isExporting}
                        activeClassName="bg-amber-500/15 text-amber-400"
                        inactiveClassName="text-slate-500 hover:text-slate-300"
                        className="flex-1 px-2 py-1.5 text-[11px] rounded"
                      >
                        {opt.label}
                      </PillButton>
                    ))}
                  </PillGroup>
                </div>
              </div>
            )}
          </div>

          {/* Footer: options + export button */}
          <div className="px-4 pt-2 pb-4 space-y-3 flex-shrink-0 border-t border-header-line">
            {format === 'csv' && (
              <label className={`flex items-center gap-3 cursor-pointer group ${isExporting ? 'pointer-events-none opacity-60' : ''}`}>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={includeHeaders}
                    onChange={(e) => setIncludeHeaders(e.target.checked)}
                    className="peer sr-only"
                    disabled={isExporting}
                  />
                  <div className="w-8 h-[18px] bg-surface-2 rounded-full peer-checked:bg-emerald-600/80 transition-colors" />
                  <div className="absolute top-[1px] left-[1px] w-4 h-4 bg-slate-300 rounded-full shadow-sm peer-checked:translate-x-[14px] peer-checked:bg-white transition-[transform,background-color] duration-150" />
                </div>
                <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors">Include header row</span>
              </label>
            )}

            {isExporting ? (
              <div className="space-y-2">
                <div className="relative h-9 bg-sunken border border-line rounded-lg overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-emerald-500/20"
                    style={{ width: `${exportProgress}%`, transition: 'width 120ms linear' }}
                  />
                  <div className="relative z-10 flex items-center justify-center h-full gap-2">
                    <svg className="w-3.5 h-3.5 text-emerald-400 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-20" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    <span className="text-xs font-medium text-emerald-400 font-mono tabular-nums">
                      {exportProgress}%
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => { cancelRef.current = true; }}
                  className="w-full text-center text-[11px] text-slate-500 hover:text-slate-400 transition-colors py-1"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={handleExport}
                disabled={enabledColumns.length === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 disabled:bg-sunken disabled:text-slate-600 disabled:border-line rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Export {enabledColumns.length > 0
                  ? `${enabledColumns.length} column${enabledColumns.length !== 1 ? 's' : ''}`
                  : ''}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={openDropdown}
        className="flex items-center justify-center gap-1.5 px-2 py-1 rounded-md bg-surface-2 border border-line-2 text-slate-400 hover:text-emerald-400 hover:border-line-2 hover:bg-white/5 transition-colors"
        title="Export data"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="text-[10px] font-medium hidden sm:inline">Export</span>
      </button>
      {modal}
    </>
  );
});