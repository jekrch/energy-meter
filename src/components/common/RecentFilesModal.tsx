import React, { useMemo, useRef, useState } from 'react';
import {
  History, X, Calendar, Hash, Loader2, Trash2, ChevronRight,
  GitMerge, Check, Square, CheckSquare, AlertTriangle, ArrowLeft, Ban, Upload,
} from 'lucide-react';
import { Modal, type ModalHandle } from './Modal';
import type { FileHistoryMeta } from '../../hooks/useFileHistory';
import type { MergePreview } from '../../utils/mergeData';
import { formatShortDate } from '../../utils/formatters';

interface RecentFilesModalProps {
  entries: FileHistoryMeta[];
  onLoad: (id: number) => Promise<void>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
  onMergePreview?: (ids: number[]) => Promise<MergePreview | null>;
  onMergeConfirm?: (
    preview: MergePreview,
    name: string,
    actions: { load: boolean; download: boolean },
  ) => Promise<void>;
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
  onUpload,
  onDelete,
  onClose,
  onMergePreview,
  onMergeConfirm,
}) => {
  const modalRef = useRef<ModalHandle>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpload(e);
    modalRef.current?.close();
  };

  // Multi-select / merge state
  const mergeEnabled = Boolean(onMergePreview && onMergeConfirm);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [mergeName, setMergeName] = useState('');
  const [alsoDownload, setAlsoDownload] = useState(true);
  const [busy, setBusy] = useState(false);

  const handleLoad = async (id: number) => {
    setLoadingId(id);
    await onLoad(id);
    setLoadingId(null);
  };

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const handleStartMerge = async () => {
    if (!onMergePreview || selected.size < 2) return;
    setBusy(true);
    // Preserve the order entries appear in the list (newest first) so tie-breaks
    // are deterministic.
    const ids = entries.map((e) => e.id).filter((id) => selected.has(id));
    const result = await onMergePreview(ids);
    setBusy(false);
    if (result) {
      setPreview(result);
      setMergeName(result.defaultName);
    }
  };

  const handleConfirmMerge = async () => {
    if (!onMergeConfirm || !preview || preview.blockers.length > 0) return;
    const name = mergeName.trim() || preview.defaultName;
    setBusy(true);
    await onMergeConfirm(preview, name, { load: true, download: alsoDownload });
    setBusy(false);
    modalRef.current?.close();
  };

  const previewSummary = useMemo(() => {
    if (!preview || preview.data.length === 0) return null;
    const start = preview.data[0].timestamp;
    const end = preview.data[preview.data.length - 1].timestamp;
    return {
      start: formatShortDate(new Date(start * 1000)),
      end: formatShortDate(new Date(end * 1000)),
      count: preview.data.length,
    };
  }, [preview]);

  // ── Merge preview screen ──────────────────────────────────────────────────
  const renderPreview = (p: MergePreview) => (
    <div className="overflow-y-auto flex-1 p-4 space-y-4">
      <div>
        <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Name</label>
        <input
          type="text"
          value={mergeName}
          onChange={(e) => setMergeName(e.target.value)}
          className="w-full px-3 py-2 bg-sunken border border-line rounded-lg text-sm text-slate-100 focus:outline-none focus:border-emerald-500/50"
          placeholder={p.defaultName}
        />
      </div>

      <div className="bg-sunken border border-line rounded-lg p-3 space-y-2">
        {previewSummary && (
          <>
            <div className="flex items-center gap-2 text-[12px] text-slate-300">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              {previewSummary.start} – {previewSummary.end}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-slate-300">
              <Hash className="w-3.5 h-3.5 text-slate-500" />
              {previewSummary.count.toLocaleString()} readings from {p.sources.length} files
            </div>
          </>
        )}
        {p.overlapCount > 0 && (
          <div className="flex items-start gap-2 text-[12px] text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              {p.overlapCount.toLocaleString()} overlapping interval{p.overlapCount !== 1 ? 's were' : ' was'} de-duplicated to avoid double-counting.
            </span>
          </div>
        )}
        {p.gapCount > 0 && (
          <div className="flex items-start gap-2 text-[12px] text-slate-400">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              {p.gapCount.toLocaleString()} gap{p.gapCount !== 1 ? 's' : ''} in the timeline — missing intervals are left empty, not filled.
            </span>
          </div>
        )}
        {p.warnings.map((w, i) => (
          <div key={i} className="flex items-start gap-2 text-[12px] text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{w}</span>
          </div>
        ))}
        {p.blockers.map((b, i) => (
          <div key={i} className="flex items-start gap-2 text-[12px] text-red-300">
            <Ban className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{b}</span>
          </div>
        ))}
      </div>

      {p.blockers.length === 0 && (
        <label className="flex items-center gap-2 cursor-pointer text-[12px] text-slate-300 select-none">
          <span
            className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${
              alsoDownload ? 'bg-emerald-600/30 border-emerald-500/50' : 'border-line'
            }`}
          >
            {alsoDownload && <Check className="w-3 h-3 text-emerald-300" />}
          </span>
          <input
            type="checkbox"
            checked={alsoDownload}
            onChange={(e) => setAlsoDownload(e.target.checked)}
            className="sr-only"
          />
          Download a re-loadable copy (.json)
        </label>
      )}
    </div>
  );

  // ── File list (with optional checkboxes) ──────────────────────────────────
  const renderList = () => (
    <div className="overflow-y-auto flex-1 p-3 space-y-2">
      {entries.length === 0 ? (
        <div className="py-10 flex flex-col items-center gap-4 text-center text-slate-500 text-sm">
          <p>No files yet — upload one to get started.</p>
          <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors">
            <Upload className="w-3.5 h-3.5" />
            Upload file
            <input type="file" accept=".xml,.csv,.json" onChange={handleUpload} className="hidden" />
          </label>
        </div>
      ) : (
        entries.map((entry) => {
          const start = formatShortDate(new Date(entry.startDate * 1000));
          const end = formatShortDate(new Date(entry.endDate * 1000));
          const isLoading = loadingId === entry.id;
          const isSelected = selected.has(entry.id);

          return (
            <div
              key={entry.id}
              onClick={selectMode ? () => toggleSelected(entry.id) : undefined}
              className={`flex items-center gap-2 px-3 py-3 bg-sunken border rounded-lg transition-colors group ${
                selectMode
                  ? `cursor-pointer ${isSelected ? 'border-emerald-500/50' : 'border-line hover:border-emerald-500/30'}`
                  : 'border-line hover:border-emerald-500/30'
              }`}
            >
              {selectMode && (
                <span className="shrink-0 text-emerald-400">
                  {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-600" />}
                </span>
              )}

              <div className="flex-1 min-w-0 space-y-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium text-slate-100 truncate group-hover:text-white transition-colors">
                    {entry.fileName}
                  </span>
                  {entry.isMerged && (
                    <span
                      className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[9px] font-medium rounded uppercase tracking-wide"
                      title={entry.sources?.length ? `Merged from ${entry.sources.length} files` : 'Merged dataset'}
                    >
                      <GitMerge className="w-2.5 h-2.5" />
                      Merged
                    </span>
                  )}
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

              {!selectMode && (
                <>
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
                </>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  const headerTitle = preview ? 'Merge files' : 'Recent Files';
  const headerSub = preview
    ? 'Review the combined dataset before loading'
    : `Stored locally in your browser · last ${entries.length} upload${entries.length !== 1 ? 's' : ''}`;

  return (
    <Modal
      ref={modalRef}
      onClose={onClose}
      overlayClassName="pt-[8vh] bg-black/40 backdrop-blur-[2px]"
      panelClassName="max-w-lg max-h-[84vh]"
      ariaLabel={headerTitle}
    >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-header-line flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                {preview ? (
                  <GitMerge className="w-4 h-4 text-emerald-400" />
                ) : (
                  <History className="w-4 h-4 text-emerald-400" />
                )}
              </div>
              <div>
                <span className="text-sm font-medium text-slate-200">{headerTitle}</span>
                <p className="text-[11px] text-slate-500">{headerSub}</p>
              </div>
            </div>
            <button
              onClick={() => modalRef.current?.close()}
              className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          {preview ? renderPreview(preview) : renderList()}

          {/* Footer / actions */}
          {preview ? (
            <div className="px-4 py-3 bg-sunken border-t border-header-line flex-shrink-0 flex items-center justify-between gap-2">
              <button
                onClick={() => setPreview(null)}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
              <button
                onClick={handleConfirmMerge}
                disabled={busy || preview.blockers.length > 0}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                Merge &amp; load
              </button>
            </div>
          ) : selectMode ? (
            <div className="px-4 py-3 bg-sunken border-t border-header-line flex-shrink-0 flex items-center justify-between gap-2">
              <button
                onClick={exitSelectMode}
                disabled={busy}
                className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleStartMerge}
                disabled={busy || selected.size < 2}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                Merge {selected.size > 0 ? `${selected.size} ` : ''}files
              </button>
            </div>
          ) : (
            <div className="px-4 py-2.5 bg-sunken border-t border-header-line flex-shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
              <p className="text-[10px] text-slate-500 sm:flex-1">
                Your data is processed and stored entirely in this browser. Nothing is uploaded to any server.
              </p>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                {entries.length > 0 && (
                  <label className="shrink-0 cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-slate-300 hover:text-emerald-300 border border-line hover:border-emerald-500/40 text-xs font-medium rounded-lg transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    Upload
                    <input type="file" accept=".xml,.csv,.json" onChange={handleUpload} className="hidden" />
                  </label>
                )}
                {mergeEnabled && entries.length >= 2 && (
                  <button
                    onClick={() => setSelectMode(true)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-slate-300 hover:text-emerald-300 border border-line hover:border-emerald-500/40 text-xs font-medium rounded-lg transition-colors"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    Merge files
                  </button>
                )}
              </div>
            </div>
          )}
    </Modal>
  );
};
