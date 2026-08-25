import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Ban, Calendar, Check, GitMerge, Hash, Loader2,
} from 'lucide-react';
import { DatasetConflictError, type DatasetKey } from '../../data/datasetStore';
import type { MergePreview } from '../../utils/mergeData';
import { formatShortDate } from '../../utils/formatters';

// The confirm step shared by every merge in the app: combining saved datasets
// from the library, and folding a freshly picked file into the one already
// open. Both arrive here with a computed preview and a list of places the
// result may be written; everything after that — the name, the destination
// radio, the conflict dance, the download checkbox — is the same either way.

/** Where a confirmed merge is written, on top of loading it into the app. */
export type MergeDestination =
  | { mode: 'none' }                      // a new entry in this browser's history
  | { mode: 'new' }                       // a new file in the Drive folder
  // Overwrite a saved dataset in place, in whichever store it lives. `force` is
  // set only after the user has seen the conflict warning and chosen to
  // overwrite anyway.
  | { mode: 'update'; key: DatasetKey; force?: boolean };

export interface MergeActions {
  load: boolean;
  download: boolean;
  destination: MergeDestination;
}

export interface MergeDestinationOption {
  id: string;
  label: string;
  hint?: string;
  value: MergeDestination;
}

// The radio id a destination selects, so `update` rows key off the dataset.
function destinationId(destination: MergeDestination): string {
  return destination.mode === 'update' ? destination.key : destination.mode;
}

interface MergeSheetProps {
  preview: MergePreview;
  /** Offered destinations, in order. A single option hides the picker. */
  destinations: MergeDestinationOption[];
  initialDestination: MergeDestination;
  /** Seeds the name field; falls back to the preview's generated name. */
  initialName?: string;
  confirmLabel?: string;
  onConfirm: (preview: MergePreview, name: string, actions: MergeActions) => Promise<void>;
  /** Called once the merge has been written, so the host can close itself. */
  onDone: () => void;
  /** Footer back action. Omitted when there is no earlier step to return to. */
  onBack?: () => void;
  /** Escape hatch offered alongside the confirm button, e.g. "Open it on its own". */
  secondaryAction?: { label: string; onClick: () => void };
}

/**
 * Body + footer for the merge confirm step. Returns a fragment so it drops
 * straight into a `Modal`'s flex column between the host's own header and the
 * panel edge.
 */
export const MergeSheet: React.FC<MergeSheetProps> = ({
  preview,
  destinations,
  initialDestination,
  initialName,
  confirmLabel = 'Merge & load',
  onConfirm,
  onDone,
  onBack,
  secondaryAction,
}) => {
  const [name, setName] = useState(initialName ?? preview.defaultName);
  const [alsoDownload, setAlsoDownload] = useState(true);
  const [destination, setDestination] = useState<MergeDestination>(initialDestination);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when an in-place write was refused because the stored dataset moved on.
  // Until it is answered, the merge is not written anywhere.
  const [conflictKey, setConflictKey] = useState<DatasetKey | null>(null);

  const selectedId = destinationId(destination);
  const blocked = preview.blockers.length > 0;
  // Updating in place keeps the target's own name, so asking for one would be
  // offering an input that is quietly ignored.
  const showName = destination.mode !== 'update';

  const run = async (target: MergeDestination) => {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(preview, name.trim() || preview.defaultName, {
        load: true,
        download: alsoDownload,
        destination: target,
      });
      onDone();
    } catch (err) {
      if (err instanceof DatasetConflictError) setConflictKey(err.key);
      else setError(err instanceof Error ? err.message : 'The merge could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    if (preview.data.length === 0) return null;
    return {
      start: formatShortDate(new Date(preview.data[0].timestamp * 1000)),
      end: formatShortDate(new Date(preview.data[preview.data.length - 1].timestamp * 1000)),
      count: preview.data.length,
    };
  }, [preview]);

  // The "save a copy instead" answer to a conflict: a new Drive file when Drive
  // is one of the offered destinations, otherwise this browser's history.
  const copyDestination: MergeDestination = destinations.some((d) => d.id === 'new')
    ? { mode: 'new' }
    : { mode: 'none' };

  return (
    <>
      <div className="overflow-y-auto flex-1 p-4 space-y-4">
        {showName && (
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-sunken border border-line rounded-lg text-sm text-slate-100 focus:outline-none focus:border-emerald-500/50"
              placeholder={preview.defaultName}
            />
          </div>
        )}

        <div className="bg-sunken border border-line rounded-lg p-3 space-y-2">
          {summary && (
            <>
              <div className="flex items-center gap-2 text-[12px] text-slate-300">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                {summary.start} – {summary.end}
              </div>
              <div className="flex items-center gap-2 text-[12px] text-slate-300">
                <Hash className="w-3.5 h-3.5 text-slate-500" />
                {summary.count.toLocaleString()} readings from {preview.sources.length} files
              </div>
            </>
          )}
          {preview.overlapCount > 0 && (
            <div className="flex items-start gap-2 text-[12px] text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                {preview.overlapCount.toLocaleString()} overlapping interval{preview.overlapCount !== 1 ? 's were' : ' was'} de-duplicated to avoid double-counting.
              </span>
            </div>
          )}
          {preview.gapCount > 0 && (
            <div className="flex items-start gap-2 text-[12px] text-slate-400">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                {preview.gapCount.toLocaleString()} gap{preview.gapCount !== 1 ? 's' : ''} in the timeline. Missing intervals are left empty, not filled.
              </span>
            </div>
          )}
          {preview.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-[12px] text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
          {preview.blockers.map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-[12px] text-red-300">
              <Ban className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{b}</span>
            </div>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-[12px] text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {conflictKey && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3 space-y-2.5">
            <div className="flex items-start gap-2 text-[12px] text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                This dataset changed in Drive since you opened it, maybe from another
                device. Nothing has been written yet.
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Overwriting keeps the same file. Drive stores the previous version in its
              revision history, so you can recover it there.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { setConflictKey(null); void run({ mode: 'update', key: conflictKey, force: true }); }}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-200 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                Overwrite it
              </button>
              <button
                onClick={() => { setConflictKey(null); void run(copyDestination); }}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {copyDestination.mode === 'new' ? 'Save as a new file' : 'Keep it in this browser'}
              </button>
              <button
                onClick={() => { setConflictKey(null); setDestination({ mode: 'none' }); }}
                disabled={busy}
                className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                Choose somewhere else
              </button>
            </div>
          </div>
        )}

        {!blocked && !conflictKey && (
          <div className="space-y-2.5">
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

            {destinations.length > 1 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-slate-400">Where to save it</p>
                {destinations.map((option) => (
                  <label
                    key={option.id}
                    className="flex items-start gap-2 cursor-pointer text-[12px] text-slate-300 select-none"
                  >
                    <span
                      className={`mt-0.5 flex items-center justify-center w-4 h-4 rounded-full border transition-colors shrink-0 ${
                        option.id === selectedId ? 'bg-emerald-600/30 border-emerald-500/50' : 'border-line'
                      }`}
                    >
                      {option.id === selectedId && <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />}
                    </span>
                    <input
                      type="radio"
                      name="merge-destination"
                      checked={option.id === selectedId}
                      onChange={() => setDestination(option.value)}
                      className="sr-only"
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{option.label}</span>
                      {option.hint && <span className="block text-[11px] text-slate-500">{option.hint}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-3 bg-sunken border-t border-header-line flex-shrink-0 flex items-center justify-between gap-2">
        {onBack ? (
          <button
            onClick={onBack}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        ) : <span />}
        <div className="flex items-center gap-2">
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              disabled={busy}
              className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {secondaryAction.label}
            </button>
          )}
          <button
            onClick={() => void run(destination)}
            disabled={busy || blocked || conflictKey !== null}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
};
