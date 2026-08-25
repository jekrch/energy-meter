import React, { useMemo, useRef, useState } from 'react';
import {
  History, X, Calendar, Hash, Loader2, Trash2, ChevronRight, Download,
  GitMerge, Check, Square, CheckSquare, AlertTriangle, Upload, FilePlus2,
  Cloud, CloudUpload, WifiOff, Pencil,
} from 'lucide-react';
import { Modal, type ModalHandle } from './Modal';
import { MAX_DATASET_NAME, type DatasetKey, type DatasetMeta } from '../../data/datasetStore';
import {
  MergeSheet,
  type MergeActions, type MergeDestination, type MergeDestinationOption,
} from './MergeSheet';
import type { MergePreview } from '../../utils/mergeData';
import { formatShortDate } from '../../utils/formatters';

export type { MergeActions, MergeDestination } from './MergeSheet';

type SourceFilter = 'all' | 'local' | 'drive';

interface RecentFilesModalProps {
  entries: DatasetMeta[];
  onLoad: (key: DatasetKey) => Promise<void>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDelete: (key: DatasetKey) => Promise<void> | void;
  // Saves the entry as a compact, re-loadable .json — readings plus whatever
  // peak schedule it holds. Loads it into the app too when `load` is set;
  // otherwise the dataset in front of the user is left alone.
  onDownload?: (key: DatasetKey, opts: { load: boolean }) => Promise<void> | void;
  onClose: () => void;
  onMergePreview?: (keys: DatasetKey[]) => Promise<MergePreview | null>;
  onMergeConfirm?: (
    preview: MergePreview,
    name: string,
    actions: MergeActions,
  ) => Promise<void>;
  /**
   * Add a picked file's readings straight into one saved dataset, writing the
   * combined history back over it in place. The routine "here is this month's
   * bill" job, reachable from the dataset it belongs to rather than by loading
   * the file as a separate entry and merging the two afterwards.
   */
  onAddFile?: (key: DatasetKey, e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Give a dataset a new display name. Absent hides the rename affordance. */
  onRename?: (key: DatasetKey, fileName: string) => Promise<void>;
  /** Signed in to Google Drive — enables the Drive filter and destinations. */
  driveAvailable?: boolean;
  /**
   * Move a dataset from this browser into the Drive folder. A move, not a copy:
   * the browser entry goes away, so the same readings are never listed twice.
   */
  onMoveToDrive?: (key: DatasetKey) => Promise<void>;
  /** Drive rows are unreachable; the list says so rather than failing on click. */
  offline?: boolean;
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
  onDownload,
  onClose,
  onMergePreview,
  onMergeConfirm,
  onAddFile,
  onRename,
  driveAvailable = false,
  onMoveToDrive,
  offline = false,
}) => {
  const modalRef = useRef<ModalHandle>(null);
  const [loadingKey, setLoadingKey] = useState<DatasetKey | null>(null);
  const [savingKey, setSavingKey] = useState<DatasetKey | null>(null);
  // The row whose save options are open, and the choice made in them. Saving is
  // the point of the action; loading is the opt-in extra, since it replaces
  // whatever dataset is currently open.
  const [saveOptionsKey, setSaveOptionsKey] = useState<DatasetKey | null>(null);
  const [alsoLoad, setAlsoLoad] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<DatasetKey | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SourceFilter>('all');
  // The row being retitled, and the name being typed into it.
  const [renamingKey, setRenamingKey] = useState<DatasetKey | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpload(e);
    modalRef.current?.close();
  };

  // Multi-select / merge state
  const mergeEnabled = Boolean(onMergePreview && onMergeConfirm);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<DatasetKey>>(new Set());
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [busy, setBusy] = useState(false);
  // The datasets the open preview was built from, in list order, so the confirm
  // sheet can offer "update one of them in place".
  const [mergeSources, setMergeSources] = useState<DatasetMeta[]>([]);
  const [destination, setDestination] = useState<MergeDestination>({ mode: 'none' });

  const driveEntries = useMemo(() => entries.filter((e) => e.kind === 'drive'), [entries]);
  const showFilter = driveAvailable || driveEntries.length > 0;
  const visibleEntries = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.kind === filter)),
    [entries, filter],
  );

  const handleLoad = async (key: DatasetKey) => {
    setLoadingKey(key);
    setRowError(null);
    try {
      await onLoad(key);
    } catch (err) {
      // A Drive read can fail on a lapsed token or a dropped connection; the
      // row stays put and says why rather than silently doing nothing.
      setRowError(err instanceof Error ? err.message : 'Could not open that dataset');
    } finally {
      setLoadingKey(null);
    }
  };

  const openSaveOptions = (key: DatasetKey) => {
    setSaveOptionsKey((prev) => (prev === key ? null : key));
    setAlsoLoad(false);
  };

  const handleDownload = async (key: DatasetKey) => {
    if (!onDownload) return;
    setSavingKey(key);
    setRowError(null);
    try {
      await onDownload(key, { load: alsoLoad });
      setSaveOptionsKey(null);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not save that dataset');
    } finally {
      setSavingKey(null);
    }
  };

  const handleMoveToDrive = async (key: DatasetKey) => {
    if (!onMoveToDrive) return;
    setUploadingKey(key);
    setRowError(null);
    try {
      await onMoveToDrive(key);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not move it to Drive');
    } finally {
      setUploadingKey(null);
    }
  };

  const startRename = (entry: DatasetMeta) => {
    setRowError(null);
    setSaveOptionsKey(null);
    setRenamingKey(entry.key);
    setRenameDraft(entry.fileName);
  };

  const cancelRename = () => {
    setRenamingKey(null);
    setRenameDraft('');
  };

  const submitRename = async (key: DatasetKey) => {
    if (!onRename) return;
    const name = renameDraft.trim();
    if (!name) return;
    setRenameBusy(true);
    setRowError(null);
    try {
      await onRename(key, name);
      cancelRename();
    } catch (err) {
      // A Drive rename rewrites the file, so it can fail on a lapsed token or a
      // dropped connection — the editor stays open with the typed name intact.
      setRowError(err instanceof Error ? err.message : 'Could not rename that dataset');
    } finally {
      setRenameBusy(false);
    }
  };

  const handleDelete = async (key: DatasetKey) => {
    setRowError(null);
    try {
      await onDelete(key);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not remove that dataset');
    }
  };

  const toggleSelected = (key: DatasetKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
    const sources = entries.filter((e) => selected.has(e.key));
    const result = await onMergePreview(sources.map((e) => e.key));
    setBusy(false);
    if (result) {
      setPreview(result);
      setMergeSources(sources);
      // Exactly one cloud source is the recurring case — pull this month's bill
      // in, stitch it onto the saved history, write it back where it was. Any
      // other shape leaves the destination an explicit choice.
      const cloudSources = sources.filter((e) => e.kind === 'drive');
      setDestination(cloudSources.length === 1 && driveAvailable && !offline
        ? { mode: 'update', key: cloudSources[0].key }
        : { mode: 'none' });
    }
  };

  // The destination choices offered by the confirm sheet. Updating in place is
  // only offered for a dataset that is actually one of the merge sources —
  // writing the result over an unrelated file is never what was meant.
  const mergeDestinations = useMemo(() => {
    const options: MergeDestinationOption[] = [];
    const cloudReachable = driveAvailable && !offline;
    for (const source of mergeSources) {
      if (source.kind === 'drive' && !cloudReachable) continue;
      options.push({
        id: source.key,
        label: source.kind === 'drive'
          ? `Update \u201C${source.fileName}\u201D in Drive`
          : `Update \u201C${source.fileName}\u201D in this browser`,
        hint: source.kind === 'drive'
          ? 'Overwrites that file in place. Drive keeps the previous version in its revision history.'
          : 'Overwrites that entry in place instead of using another recent-files slot.',
        value: { mode: 'update', key: source.key },
      });
    }
    if (cloudReachable) options.push({ id: 'new', label: 'Save as a new file in Drive', value: { mode: 'new' } });
    options.push({
      id: 'none',
      label: 'Keep it in this browser only',
      hint: 'Kept in recent files here, capped at five and cleared with the browser\u2019s storage.',
      value: { mode: 'none' },
    });
    return options;
  }, [mergeSources, driveAvailable, offline]);

  // ── Empty states ──────────────────────────────────────────────────────────
  const renderEmpty = () => {
    if (filter === 'drive') {
      if (offline) {
        return (
          <div className="py-10 flex flex-col items-center gap-2 text-center text-slate-500 text-sm">
            <WifiOff className="w-5 h-5" />
            <p>You’re offline. Reconnect to see your Drive datasets.</p>
          </div>
        );
      }
      return (
        <div className="py-10 flex flex-col items-center gap-2 text-center text-slate-500 text-sm">
          <Cloud className="w-5 h-5" />
          <p>Nothing in Drive yet.</p>
          <p className="text-[12px] text-slate-600 max-w-[280px]">
            Save a dataset from this browser to keep it across devices, then merge
            next month’s file onto it.
          </p>
        </div>
      );
    }
    if (filter === 'local') {
      return (
        <div className="py-10 flex flex-col items-center gap-2 text-center text-slate-500 text-sm">
          <p>Nothing saved in this browser.</p>
        </div>
      );
    }
    return (
      <div className="py-10 flex flex-col items-center gap-4 text-center text-slate-500 text-sm">
        <p>No files yet. Upload one to get started.</p>
        <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors">
          <Upload className="w-3.5 h-3.5" />
          Upload file
          <input type="file" accept=".xml,.csv,.json" onChange={handleUpload} className="hidden" />
        </label>
      </div>
    );
  };

  // ── File list (with optional checkboxes) ──────────────────────────────────
  const renderList = () => (
    <div className="overflow-y-auto flex-1 p-3 space-y-2">
      {showFilter && (
        <div className="flex items-center gap-1 p-0.5 bg-sunken border border-line rounded-lg">
          {([
            { id: 'all', label: 'All' },
            { id: 'local', label: 'This browser' },
            { id: 'drive', label: 'Drive' },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                filter === tab.id
                  ? 'bg-emerald-600/20 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {offline && driveAvailable && filter !== 'local' && (
        <div className="flex items-center gap-2 px-2.5 py-2 bg-sunken border border-line rounded-lg text-[11px] text-slate-400">
          <WifiOff className="w-3.5 h-3.5 shrink-0 text-slate-500" />
          Offline. Drive datasets are hidden until you reconnect.
        </div>
      )}

      {rowError && (
        <div className="flex items-start gap-2 px-2.5 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{rowError}</span>
        </div>
      )}

      {visibleEntries.length === 0 ? renderEmpty() : (
        visibleEntries.map((entry) => {
          // A Drive file dropped in by hand carries no metadata until it is
          // opened; showing 1970 would be worse than showing nothing.
          const hasRange = entry.recordCount > 0;
          const start = formatShortDate(new Date(entry.startDate * 1000));
          const end = formatShortDate(new Date(entry.endDate * 1000));
          const isDrive = entry.kind === 'drive';
          const isUploading = uploadingKey === entry.key;
          const isLoading = loadingKey === entry.key;
          const isSaving = savingKey === entry.key;
          const isSelected = selected.has(entry.key);
          const saveOpen = saveOptionsKey === entry.key && !selectMode;
          const renaming = renamingKey === entry.key && !selectMode;

          return (
            <div
              key={entry.key}
              onClick={selectMode ? () => toggleSelected(entry.key) : undefined}
              className={`bg-sunken border rounded-lg transition-colors group ${
                selectMode
                  ? `cursor-pointer ${isSelected ? 'border-emerald-500/50' : 'border-line hover:border-emerald-500/30'}`
                  : saveOpen || renaming
                    ? 'border-emerald-500/40'
                    : 'border-line hover:border-emerald-500/30'
              }`}
            >
            {renaming ? (
              <form
                onSubmit={(e) => { e.preventDefault(); void submitRename(entry.key); }}
                className="px-2.5 sm:px-3 py-3 flex flex-col sm:flex-row sm:items-center gap-2"
              >
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancelRename(); } }}
                  maxLength={MAX_DATASET_NAME}
                  aria-label="Dataset name"
                  className="flex-1 min-w-0 px-2.5 py-1.5 bg-sunken border border-line rounded-lg text-sm text-slate-100 focus:outline-none focus:border-emerald-500/50"
                />
                <div className="flex items-center justify-end gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={cancelRename}
                    disabled={renameBusy}
                    className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={renameBusy || !renameDraft.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
                  >
                    {renameBusy
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Check className="w-3.5 h-3.5" />}
                    Save name
                  </button>
                </div>
              </form>
            ) : (
              <>
              {/* Five actions and a long meter file name do not share one line
                  on a phone. Below sm the card grows instead: title and dates
                  on top, the actions on a row of their own underneath. */}
              <div className="px-2.5 sm:px-3 py-3 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-2">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 sm:flex-1">
              {selectMode && (
                <span className="shrink-0 text-emerald-400">
                  {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-600" />}
                </span>
              )}

              <div className="flex-1 min-w-0 space-y-1">
                <span className="flex items-center gap-1.5 min-w-0 w-full">
                  {onRename && !selectMode ? (
                    <button
                      type="button"
                      onClick={() => startRename(entry)}
                      title={`Rename \u201C${entry.fileName}\u201D`}
                      className="flex items-center gap-1.5 min-w-0 max-w-full text-left group/name"
                    >
                      <span className="text-sm font-medium text-slate-100 truncate group-hover:text-white transition-colors">
                        {entry.fileName}
                      </span>
                      <Pencil className="w-3 h-3 shrink-0 text-slate-600 group-hover/name:text-emerald-300 transition-colors" />
                    </button>
                  ) : (
                    <span
                      title={entry.fileName}
                      className="text-sm font-medium text-slate-100 truncate group-hover:text-white transition-colors"
                    >
                      {entry.fileName}
                    </span>
                  )}
                </span>
                {/* Badges ride with the dates rather than the title: a meter
                    file name is long, and every pixel one takes off the first
                    line is a pixel of name the row has to cut. */}
                <div className="flex items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-400 flex-wrap">
                  {isDrive && (
                    <span
                      className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-sky-500/10 border border-sky-500/30 text-sky-300 text-[9px] font-medium rounded uppercase tracking-wide"
                      title="Stored in your Google Drive"
                    >
                      <Cloud className="w-2.5 h-2.5" />
                      Drive
                    </span>
                  )}
                  {entry.isMerged && (
                    <span
                      className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[9px] font-medium rounded uppercase tracking-wide"
                      title={entry.sources?.length ? `Merged from ${entry.sources.length} files` : 'Merged dataset'}
                    >
                      <GitMerge className="w-2.5 h-2.5" />
                      Merged
                    </span>
                  )}
                  {hasRange ? (
                    <>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        {start} – {end}
                      </span>
                      <span className="flex items-center gap-1">
                        <Hash className="w-3 h-3 text-slate-500" />
                        {entry.recordCount.toLocaleString()} readings
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500">Details load when you open it</span>
                  )}
                  {entry.uploadedAt > 0 && (
                    <span className="text-slate-600">
                      {formatRelativeDate(entry.uploadedAt)}
                    </span>
                  )}
                </div>
              </div>
              </div>

              {!selectMode && (
                <div className="flex items-center justify-end gap-0.5 sm:gap-2 shrink-0 border-t border-line/70 pt-2 sm:border-t-0 sm:pt-0">
                  {onMoveToDrive && driveAvailable && !isDrive && (
                    <button
                      onClick={() => handleMoveToDrive(entry.key)}
                      disabled={isUploading || offline}
                      title={offline
                        ? 'Offline. Reconnect to move this to Drive'
                        : 'Move this dataset to your Google Drive'}
                      className="shrink-0 p-2 sm:p-1.5 text-slate-600 hover:text-sky-300 hover:bg-sky-500/10 rounded-lg transition-colors disabled:opacity-40"
                      aria-label="Move to Drive"
                    >
                      {isUploading
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <CloudUpload className="w-3.5 h-3.5" />}
                    </button>
                  )}

                  {onAddFile && (
                    <label
                      title={isDrive && offline
                        ? 'Offline. Reconnect to add a file to this dataset'
                        : 'Add a file\u2019s readings to this dataset'}
                      aria-label="Add a file to this dataset"
                      className={`shrink-0 p-2 sm:p-1.5 rounded-lg transition-colors ${
                        isDrive && offline
                          ? 'text-slate-700 cursor-not-allowed'
                          : 'text-slate-600 hover:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer'
                      }`}
                    >
                      <FilePlus2 className="w-3.5 h-3.5" />
                      <input
                        type="file"
                        accept=".xml,.csv,.json"
                        disabled={isDrive && offline}
                        onChange={(e) => { onAddFile(entry.key, e); modalRef.current?.close(); }}
                        className="hidden"
                      />
                    </label>
                  )}

                  {onDownload && (
                    <button
                      onClick={() => openSaveOptions(entry.key)}
                      disabled={isSaving}
                      title="Save as .json: a smaller copy you can reload, with this file's peak rate periods"
                      className={`shrink-0 p-2 sm:p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                        saveOpen
                          ? 'text-emerald-300 bg-emerald-500/10'
                          : 'text-slate-600 hover:text-emerald-300 hover:bg-emerald-500/10'
                      }`}
                      aria-label="Save as JSON"
                      aria-expanded={saveOpen}
                    >
                      {isSaving
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Download className="w-3.5 h-3.5" />}
                    </button>
                  )}

                  <button
                    onClick={() => void handleDelete(entry.key)}
                    disabled={isLoading}
                    title={isDrive
                      ? 'Remove from Drive. Goes to your Drive trash for 30 days'
                      : 'Remove from this browser'}
                    className="shrink-0 p-2 sm:p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-40"
                    aria-label={isDrive ? 'Remove from Drive' : 'Delete'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleLoad(entry.key)}
                    disabled={isLoading || loadingKey !== null}
                    aria-label="Load"
                    className="shrink-0 flex items-center gap-1.5 ml-1 sm:ml-0 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    Load
                  </button>
                </div>
              )}
              </div>
              </>
            )}

              {saveOpen && (
                <div className="px-2.5 sm:px-3 pb-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
                  <label className="flex items-center gap-2 cursor-pointer text-[12px] text-slate-300 select-none">
                    <span
                      className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${
                        alsoLoad ? 'bg-emerald-600/30 border-emerald-500/50' : 'border-line'
                      }`}
                    >
                      {alsoLoad && <Check className="w-3 h-3 text-emerald-300" />}
                    </span>
                    <input
                      type="checkbox"
                      checked={alsoLoad}
                      onChange={(e) => setAlsoLoad(e.target.checked)}
                      className="sr-only"
                    />
                    Open it here too
                  </label>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <button
                      onClick={() => setSaveOptionsKey(null)}
                      disabled={isSaving}
                      className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDownload(entry.key)}
                      disabled={isSaving}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
                    >
                      {isSaving
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Download className="w-3.5 h-3.5" />}
                      Save .json
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  const headerTitle = preview ? 'Merge files' : driveAvailable ? 'Your datasets' : 'Recent Files';
  const localCount = entries.length - driveEntries.length;
  const headerSub = preview
    ? 'Review the combined dataset before loading'
    : driveAvailable
      ? `${localCount} in this browser · ${driveEntries.length} in Drive`
      : `Stored locally in your browser · last ${entries.length} upload${entries.length !== 1 ? 's' : ''}`;

  return (
    <Modal
      ref={modalRef}
      onClose={onClose}
      overlayClassName="pt-[8vh] bg-black/40 backdrop-blur-[2px]"
      panelClassName="max-w-xl max-h-[84vh]"
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
          {preview && onMergeConfirm ? (
            <MergeSheet
              preview={preview}
              destinations={mergeDestinations}
              initialDestination={destination}
              onConfirm={onMergeConfirm}
              onDone={() => modalRef.current?.close()}
              onBack={() => { setPreview(null); setMergeSources([]); }}
            />
          ) : renderList()}

          {/* Footer / actions */}
          {preview ? null : selectMode ? (
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
                {driveAvailable
                  ? 'Your data is processed in this browser. Anything you save to Drive goes to your own account, never to a server of ours.'
                  : 'Your data is processed and stored entirely in this browser. Nothing is uploaded to any server.'}
              </p>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                {visibleEntries.length > 0 && (
                  <label className="shrink-0 cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-slate-300 hover:text-emerald-300 border border-line hover:border-emerald-500/40 text-xs font-medium rounded-lg transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    Upload
                    <input type="file" accept=".xml,.csv,.json" onChange={handleUpload} className="hidden" />
                  </label>
                )}
                {mergeEnabled && visibleEntries.length >= 2 && (
                  <button
                    onClick={() => { setSaveOptionsKey(null); setSelectMode(true); }}
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
