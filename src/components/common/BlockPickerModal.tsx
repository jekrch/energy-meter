import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Layers, X, ChevronRight, Zap, DollarSign, Calendar, Hash } from 'lucide-react';
import { useScrollLock } from '../../hooks/useScrollLock';
import type { ParsedBlock } from '../../utils/dataUtils';
import { formatCost } from '../../utils/formatters';
import { formatShortDate } from '../../utils/formatters';

interface BlockPickerModalProps {
  blocks: ParsedBlock[];
  onSelect: (index: number) => void;
  onCancel: () => void;
}

const formatIntervalLength = (seconds: number | undefined): string => {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
};

const formatEnergyTotal = (wh: number): string => {
  const kwh = wh / 1000;
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(1)} MWh`;
  if (kwh >= 1) return `${kwh.toFixed(kwh >= 100 ? 0 : 1)} kWh`;
  return `${wh.toFixed(0)} Wh`;
};

export const BlockPickerModal: React.FC<BlockPickerModalProps> = ({
  blocks,
  onSelect,
  onCancel,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useScrollLock(true);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-start justify-center pt-[8vh] px-4 bg-black/40 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-[84vh] flex flex-col"
      >
        <div className="bg-slate-800/95 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                <Layers className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <span className="text-sm font-medium text-slate-200">
                  Multiple reading sets found
                </span>
                <p className="text-[11px] text-slate-500">
                  This file contains {blocks.length} interval blocks. Pick the one to analyze — combining them would double-count usage.
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-lg transition-colors"
              aria-label="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 p-3 space-y-2">
            {blocks.map((block, idx) => {
              const { meta } = block;
              const start = meta.startTimestamp
                ? formatShortDate(new Date(meta.startTimestamp * 1000))
                : '—';
              const end = meta.endTimestamp
                ? formatShortDate(new Date(meta.endTimestamp * 1000))
                : '—';
              const isGeneration = meta.flowDirection === 19 || meta.flowDirection === 16;
              const isNet = meta.flowDirection === 4 || meta.flowDirection === 20;

              return (
                <button
                  key={meta.id}
                  onClick={() => onSelect(idx)}
                  className="w-full flex items-start gap-3 px-3 py-3 bg-slate-900/50 hover:bg-slate-700/50 border border-slate-700/50 hover:border-emerald-500/40 rounded-lg transition-all group text-left"
                >
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-100 group-hover:text-white transition-colors">
                        {meta.commodityLabel}
                      </span>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          isGeneration
                            ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
                            : isNet
                            ? 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30'
                            : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                        }`}
                      >
                        {meta.flowDirectionLabel}
                      </span>
                      {meta.powerOfTenMultiplier !== 0 && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">
                          ×10^{meta.powerOfTenMultiplier} {meta.uomLabel}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        <span className="truncate">{start} – {end}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Hash className="w-3 h-3 text-slate-500" />
                        <span>
                          {meta.readingCount.toLocaleString()} readings
                          {meta.intervalLength ? ` · ${formatIntervalLength(meta.intervalLength)}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-amber-500/70" />
                        <span>{formatEnergyTotal(meta.totalValue)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="w-3 h-3 text-emerald-500/70" />
                        <span>{formatCost(meta.totalCost)}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1" />
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-slate-900/40 border-t border-slate-700/30 flex-shrink-0">
            <p className="text-[10px] text-slate-500">
              Tip: for a solar/net-metered home, pick the forward (delivered) block to see what you bought from the utility.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
