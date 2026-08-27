import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, CheckCircle2, ExternalLink, Loader2, Trash2, X,
} from 'lucide-react';
import { Modal, type ModalHandle } from './Modal';
import { DRIVE_FOLDER_NAME } from '../../data/config';
import { DriveAuthError } from '../../data/driveClient';
import { deleteAllDriveData, driveStore } from '../../data/driveStore';
import type { AuthUser } from '../../data/googleAuth';

/**
 * The way out of the Drive integration, in one place: the datasets, the cached
 * copies in this browser, and the grant on the Google account. All three are
 * undone separately otherwise, across two products. Everything it will do is
 * listed before it runs, since this is the only action that reaches into a
 * user's Drive in bulk.
 */

/** Where the grant can be checked, and removed by hand if the revoke silently failed. */
const CONNECTIONS_URL = 'https://myaccount.google.com/connections';

interface DisconnectDriveModalProps {
  /** Snapshotted when the menu item was clicked: the session ends partway
   *  through this flow, and the panel still has to name the account. */
  account: AuthUser;
  /** Revoke the grant and end the session. This is `auth.disconnect`. */
  onDisconnect: () => Promise<boolean>;
  /** The Drive files are gone. Fired before the revoke, so the app can drop a
   *  dataset it has open from there instead of charting deleted readings. */
  onDataDeleted?: () => void;
  onClose: () => void;
}

type Phase = 'confirm' | 'working' | 'done';

export const DisconnectDriveModal: React.FC<DisconnectDriveModalProps> = ({
  account,
  onDisconnect,
  onDataDeleted,
  onClose,
}) => {
  const modalRef = useRef<ModalHandle>(null);
  const [deleteFiles, setDeleteFiles] = useState(true);
  // How many datasets are in the folder, so the confirmation names a number
  // rather than an unbounded "everything". Null until known: the listing can
  // fail, and a failed count is no reason to block the exit.
  const [count, setCount] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('confirm');
  const [step, setStep] = useState<'files' | 'access'>('files');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ removed: number | null; revoked: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void driveStore.list()
      .then((entries) => { if (live) setCount(entries.length); })
      .catch(() => { /* the number is a courtesy, not a precondition */ });
    return () => { live = false; };
  }, []);

  const run = async () => {
    setError(null);
    setStep(deleteFiles ? 'files' : 'access');
    setPhase('working');
    try {
      // Files first, while the grant that reaches them is still good.
      const removed = deleteFiles ? await deleteAllDriveData() : null;
      if (removed !== null) onDataDeleted?.();
      setStep('access');
      const revoked = await onDisconnect();
      setResult({ removed, revoked });
      setPhase('done');
    } catch (err) {
      setError(
        err instanceof DriveAuthError
          ? 'Your Google session expired, so your files couldn’t be reached. Sign in again and retry.'
          : err instanceof Error
            ? err.message
            : 'Your Drive files couldn’t be removed.',
      );
      // Back to the confirmation with nothing revoked: a retry needs the grant
      // that disconnecting would have handed back.
      setPhase('confirm');
    }
  };

  const datasets = count === null ? 'your datasets' : `${count} dataset${count === 1 ? '' : 's'}`;

  return (
    <Modal
      ref={modalRef}
      onClose={onClose}
      overlayClassName="pt-[8vh] bg-black/40 backdrop-blur-[2px]"
      panelClassName="max-w-md max-h-[84vh]"
      closeOnOverlayClick={phase !== 'working'}
      closeOnEscape={phase !== 'working'}
      ariaLabel="Delete data and disconnect"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-header-line flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-lg shrink-0 ${phase === 'done' ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
            {phase === 'done'
              ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              : <Trash2 className="w-4 h-4 text-red-400" />}
          </div>
          <div className="min-w-0">
            <span className="text-sm font-medium text-slate-200">
              {phase === 'done' ? 'Disconnected' : 'Delete data & disconnect'}
            </span>
            <p className="text-[11px] text-slate-500 font-mono truncate" title={account.email || account.name}>
              {account.email || account.name}
            </p>
          </div>
        </div>
        {phase !== 'working' && (
          <button
            onClick={() => modalRef.current?.close()}
            className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-lg transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {phase === 'done' && result ? (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <ul className="space-y-2 text-[12px] text-slate-300">
              {result.removed !== null && (
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
                  <span>
                    {result.removed === 0
                      ? `Your “${DRIVE_FOLDER_NAME}” folder was already empty.`
                      : `${result.removed} dataset${result.removed === 1 ? '' : 's'} and the “${DRIVE_FOLDER_NAME}” folder are in your Drive trash.`}
                  </span>
                </li>
              )}
              <li className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
                <span>Cached copies in this browser erased. You’re signed out.</span>
              </li>
              <li className="flex items-start gap-2">
                {result.revoked
                  ? <Check className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
                  : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-400 shrink-0" />}
                <span>
                  {result.revoked
                    ? 'This app’s access to your Google Account was revoked.'
                    : 'Google didn’t confirm the revoke. Remove this app from your connections page below.'}
                </span>
              </li>
            </ul>

            {result.removed !== null && result.removed > 0 && (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Trashed files can be restored for 30 days. Empty your Drive trash to erase
                them now.
              </p>
            )}

            <a
              href={CONNECTIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2.5 bg-sunken border border-line rounded-lg text-[12px] text-slate-300 hover:text-slate-100 hover:border-line-2 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              Check your Google connections
            </a>
          </div>
          <div className="px-4 py-3 bg-sunken border-t border-header-line flex-shrink-0 flex justify-end">
            <button
              onClick={() => modalRef.current?.close()}
              className="px-4 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <label className="flex items-start gap-2 cursor-pointer select-none bg-sunken border border-line rounded-lg p-3">
              <span
                className={`flex items-center justify-center w-4 h-4 mt-0.5 rounded border shrink-0 transition-colors ${
                  deleteFiles ? 'bg-red-600/30 border-red-500/50' : 'border-line-2'
                }`}
              >
                {deleteFiles && <Check className="w-3 h-3 text-red-300" />}
              </span>
              <input
                type="checkbox"
                checked={deleteFiles}
                disabled={phase === 'working'}
                onChange={(e) => setDeleteFiles(e.target.checked)}
                className="sr-only"
              />
              <span className="min-w-0">
                <span className="block text-[12px] text-slate-200">
                  Delete {datasets} from my Drive
                </span>
                <span className="block mt-1 text-[11px] text-slate-500 leading-relaxed">
                  The “{DRIVE_FOLDER_NAME}” folder goes with them. Files stay in your Drive
                  trash for 30 days, so you can still restore them. Uncheck to keep them and
                  only disconnect.
                </span>
              </span>
            </label>

            <div className="px-3 py-2.5 bg-sunken border border-line rounded-lg">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Either way
              </p>
              <ul className="mt-1.5 space-y-1 text-[11px] text-slate-500 leading-relaxed">
                <li>· Cached copies in this browser are erased.</li>
                <li>· This app’s access to your Google Account is revoked.</li>
                <li>· You’re signed out.</li>
              </ul>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Datasets saved only in this browser aren’t touched. Remove those from the
              library.
            </p>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-[12px] text-red-300">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="px-4 py-3 bg-sunken border-t border-header-line flex-shrink-0 flex items-center justify-between gap-2">
            {phase === 'working' ? (
              <span className="flex items-center gap-2 text-[11px] text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                {step === 'files' ? 'Removing files…' : 'Revoking access…'}
              </span>
            ) : (
              <button
                onClick={() => modalRef.current?.close()}
                className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => void run()}
              disabled={phase === 'working'}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:pointer-events-none ${
                deleteFiles
                  ? 'bg-red-600/20 hover:bg-red-600/30 border-red-500/40 hover:border-red-500/60 text-red-300'
                  : 'bg-emerald-600/20 hover:bg-emerald-600/30 border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300'
              }`}
            >
              {deleteFiles && <Trash2 className="w-3.5 h-3.5" />}
              {deleteFiles ? (error ? 'Try again' : 'Delete & disconnect') : 'Disconnect'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
};
