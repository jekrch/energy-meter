import React, { useEffect, useRef, useState } from 'react';
import { FilePlus2, GitMerge, Loader2, AlertTriangle, X, FileText } from 'lucide-react';
import { Modal, type ModalHandle } from './Modal';
import { MergeSheet, type MergeActions, type MergeDestination, type MergeDestinationOption } from './MergeSheet';
import type { IncomingFile } from '../../hooks/useEnergyData';
import type { MergePreview } from '../../utils/mergeData';

// Adding a picked file to a dataset you already keep. Reached three ways: the
// per-row action in the library (which names its own target, open or not), the
// toolbar action for the open dataset, and picking a file while one is open —
// where the file is held and the question is asked rather than assumed. Without
// this the only route to a combined history was to load the file, let it land
// in recent files, then merge the two from the library: the same result by a
// longer road, and one that quietly spends a recency slot.

interface IncomingFileModalProps {
  incoming: IncomingFile;
  /**
   * Name of the dataset the file is being added to. Null when that dataset is
   * no longer listed (a Drive listing lost to a dropped connection, say), which
   * leaves the file nowhere to be added and only somewhere to be opened.
   */
  targetName: string | null;
  /** Where that dataset lives, for wording the in-place option. */
  targetKind: 'local' | 'drive';
  /** True when the target is the dataset already on screen. */
  targetIsOpen: boolean;
  /**
   * Skip the ask step. Set when the file was picked through an action that
   * already means "add this to that dataset".
   */
  intent?: 'ask' | 'merge';
  /**
   * Combine the held file with the target dataset. Resolves null when it cannot
   * be built. Async because a target that is not on screen has to be read back
   * from its store first.
   */
  buildPreview: () => Promise<MergePreview | null>;
  destinations: MergeDestinationOption[];
  initialDestination: MergeDestination;
  onMergeConfirm: (preview: MergePreview, name: string, actions: MergeActions) => Promise<void>;
  /** Let the file take over instead — the ordinary load. */
  onReplace: () => void;
  onDismiss: () => void;
}

export const IncomingFileModal: React.FC<IncomingFileModalProps> = ({
  incoming,
  targetName,
  targetKind,
  targetIsOpen,
  intent = 'ask',
  buildPreview,
  destinations,
  initialDestination,
  onMergeConfirm,
  onReplace,
  onDismiss,
}) => {
  const modalRef = useRef<ModalHandle>(null);
  // Built on demand rather than up front: merging a long history is real work,
  // and on the ask path the answer is often "just open it". Picking the file
  // through an action that already means "add this" asks for it immediately.
  const [requested, setRequested] = useState(intent === 'merge');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const building = requested && incoming.status === 'ready' && Boolean(targetName)
    && !preview && !previewError;

  useEffect(() => {
    if (!building) return;
    let live = true;
    void buildPreview().then((result) => {
      if (!live) return;
      if (result) setPreview(result);
      else setPreviewError('Those readings could not be combined with that dataset.');
    });
    return () => { live = false; };
  }, [building, buildPreview]);

  const close = (after?: () => void) => modalRef.current?.close(after ?? onDismiss);

  const where = targetKind === 'drive' ? 'in your Drive' : 'in this browser';
  const title = requested ? 'Add to this dataset' : 'File picked';

  return (
    <Modal
      ref={modalRef}
      onClose={onDismiss}
      overlayClassName="pt-[8vh] bg-black/40 backdrop-blur-[2px]"
      panelClassName="max-w-lg max-h-[84vh]"
      ariaLabel={title}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-header-line flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 bg-emerald-500/10 rounded-lg shrink-0">
            {preview
              ? <GitMerge className="w-4 h-4 text-emerald-400" />
              : <FilePlus2 className="w-4 h-4 text-emerald-400" />}
          </div>
          <div className="min-w-0">
            <span className="text-sm font-medium text-slate-200">{title}</span>
            <p className="text-[11px] text-slate-500 truncate" title={incoming.fileName}>
              {incoming.fileName}
            </p>
          </div>
        </div>
        <button
          onClick={() => close()}
          className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-lg transition-colors shrink-0"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {incoming.status === 'parsing' && (
        <div className="flex-1 py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
          <p className="text-xs">Reading the file…</p>
        </div>
      )}

      {incoming.status === 'error' && (
        <>
          <div className="flex-1 p-4">
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-[12px] text-red-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{incoming.error ?? 'That file could not be read.'}</span>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              Nothing changed{targetName ? `. \u201C${targetName}\u201D is untouched` : ''}.
            </p>
          </div>
          <div className="px-4 py-3 bg-sunken border-t border-header-line flex-shrink-0 flex justify-end">
            <button
              onClick={() => close()}
              className="px-4 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </>
      )}

      {incoming.status === 'ready' && !targetName && (
        <>
          <div className="flex-1 p-4">
            <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-500/10 border border-amber-500/40 rounded-lg text-[12px] text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                That dataset is not listed any more, so there is nothing to add
                these readings to.
              </span>
            </div>
          </div>
          <div className="px-4 py-3 bg-sunken border-t border-header-line flex-shrink-0 flex items-center justify-end gap-2">
            <button
              onClick={() => close()}
              className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => close(onReplace)}
              className="px-4 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium rounded-lg transition-colors"
            >
              Open it on its own
            </button>
          </div>
        </>
      )}

      {incoming.status === 'ready' && targetName && (
        preview ? (
          <MergeSheet
            preview={preview}
            destinations={destinations}
            initialDestination={initialDestination}
            confirmLabel="Add & load"
            onConfirm={onMergeConfirm}
            onDone={() => close()}
            onBack={intent === 'ask' ? () => { setRequested(false); setPreview(null); setPreviewError(null); } : undefined}
            secondaryAction={{
              label: 'Open it on its own',
              onClick: () => close(onReplace),
            }}
          />
        ) : building ? (
          <div className="flex-1 py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
            <p className="text-xs">Combining with “{targetName}”…</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="bg-sunken border border-line rounded-lg p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-[12px] text-slate-300">
                  <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="truncate">
                    “{targetName}” is {targetIsOpen ? 'open, saved' : 'saved'} {where}.
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Adding the new readings writes them back into that same dataset.
                  Overlapping intervals are de-duplicated, not double-counted.
                  Opening the file on its own leaves “{targetName}” alone.
                </p>
              </div>
              {previewError && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-[12px] text-red-300">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{previewError}</span>
                </div>
              )}
            </div>
            <div className="px-4 py-3 bg-sunken border-t border-header-line flex-shrink-0 flex items-center justify-between gap-2">
              <button
                onClick={() => close(onReplace)}
                className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors"
              >
                Open it on its own
              </button>
              <button
                onClick={() => { setPreviewError(null); setRequested(true); }}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-xs font-medium rounded-lg transition-colors"
              >
                <GitMerge className="w-3.5 h-3.5" />
                Add to this dataset
              </button>
            </div>
          </>
        )
      )}
    </Modal>
  );
};
