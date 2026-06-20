import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X, Calendar, Hash, Loader2, Trash2, ChevronRight } from 'lucide-react';
import { useScrollLock } from '../../hooks/useScrollLock';
import type { FileHistoryMeta } from '../../hooks/useFileHistory';
import { formatShortDate } from '../../utils/formatters';

interface RecentFilesModalProps {
  entries: FileHistoryMeta[];
  onLoad: (id: number) => Promise<void>;
  onDelete: (id: number) => void;
  onClose: () => void;
}

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return formatShortDate(new Date(ts));
}

export const RecentFilesModal: React.FC<RecentFilesModalProps> = ({
  entries,
  onLoad,
  onDelete,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  useScrollLock(true);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleLoad = async (id: number) => {
    setLoadingId(id);
    await onLoad(id);
    setLoadingId(null);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-start justify-center pt-[8vh] px-4 bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[84vh] flex flex-col"
      >
        <div className="bg-surface border border-line rounded-2xl shadow-float overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-header-line flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                <History className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <span className="text-sm font-medium text-slate-200">Recent Files</span>
                <p className="text-[11px] text-slate-500">
                  Stored locally in your browser · last {entries.length} upload{entries.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 p-3 space-y-2">
            {entries.length === 0 ? (
              <div className="py-10 text-center text-slate-500 text-sm">
                No files yet — upload one to get started.
              </div>
            ) : (
              entries.map((entry) => {
                const start = formatShortDate(new Date(entry.startDate * 1000));
                const end = formatShortDate(new Date(entry.endDate * 1000));
                const isLoading = loadingId === entry.id;

                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-2 px-3 py-3 bg-sunken border border-line hover:border-emerald-500/30 rounded-lg transition-colors group"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <span className="text-sm font-medium text-slate-100 truncate block group-hover:text-white transition-colors">
                        {entry.fileName}
                      </span>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-500" />
                          {start} – {end}
                        </span>
                        <span className="flex items-center gap-1">
                          <Hash className="w-3 h-3 text-slate-500" />
                          {entry.recordCount.toLocaleString()} readings
                        </span>
                        <span className="text-slate-600">
                          {formatRelativeDate(entry.uploadedAt)}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => onDelete(entry.id)}
                      disabled={isLoading}
                      className="shrink-0 p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-40"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleLoad(entry.id)}
                      disabled={isLoading || loadingId !== null}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      Load
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-sunken border-t border-header-line flex-shrink-0">
            <p className="text-[10px] text-slate-500">
              Your data is processed and stored entirely in this browser. Nothing is uploaded to any server.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
