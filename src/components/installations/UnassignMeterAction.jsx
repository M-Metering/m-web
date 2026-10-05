// src/components/installations/UnassignMeterAction.jsx
// The "Unassign meter" button for any screen that shows a meter. Give it the
// action from unassignActionFor (utils/meterUnassign.js) — null renders
// nothing — and it opens the right confirmation:
//
//   RETURN  ReturnMeterModal (below): the meter is with an installer, not
//           installed → POST /assignments/meters/return via returnMetersToStock
//   REVERT  RevertInstallationModal: the meter is installed (Super Admin)
//
// Both confirm before sending, keep the dialog open with a plain message on
// failure, never update anything optimistically, and on success bump the
// app's refreshSignal so every mounted screen re-reads from the server.
import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import ConfirmationModal from '../common/ConfirmationModal';
import RevertInstallationModal from './RevertInstallationModal';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { UNASSIGN_KIND, returnMetersToStock } from '../../utils/meterUnassign';
import { getErrorMessage } from '../../utils/errorMessage';
import { formatDateTime } from '../../utils/date';
import { formatPhaseLabel } from '../../utils/installationScope';

const FAILED = 'Unable to unassign this meter. Please try again.';

const Line = ({ label, value, mono = false }) => (
  <div className="flex gap-2 min-w-0">
    <dt className="text-gray-500 dark:text-gray-400 shrink-0 w-28">{label}</dt>
    <dd className={`text-gray-900 dark:text-white min-w-0 break-words ${mono ? 'font-mono break-all' : ''}`}>{value || 'Not recorded'}</dd>
  </div>
);

/** Confirm, then release ONE meter from its installer. */
export function ReturnMeterModal({ target, onClose, onReturned }) {
  const { notifyDataChanged } = useDataRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const close = () => { if (!busy) { setError(null); onClose(); } };
  const confirm = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { rejected } = await returnMetersToStock([target.meterNumber]);
      const refusal = rejected.find((r) => r.meterNumber === target.meterNumber) || (rejected.length ? rejected[0] : null);
      if (refusal) {
        // Nothing changed for this meter: say why, keep the dialog for a retry.
        setError(refusal.reason ? getErrorMessage(new Error(refusal.reason), FAILED) : FAILED);
        notifyDataChanged();
        return;
      }
      notifyDataChanged();
      onReturned?.(target);
      onClose();
    } catch (err) {
      console.error('[ReturnMeterModal] Return failed:', err);
      setError(getErrorMessage(err, FAILED));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmationModal
      isOpen={!!target}
      onClose={close}
      onConfirm={confirm}
      loading={busy}
      title="Unassign meter?"
      message={'The meter goes back to stock and can be assigned again. The meter record is kept, and the '
        + 'installer’s installation jobs and customer records are not changed.'}
      confirmText="Unassign meter"
    >
      {target && (
        <div className="space-y-3">
          <dl className="grid grid-cols-1 gap-1 text-xs p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700"
            aria-label="Meter to be unassigned">
            <Line label="Meter" value={target.meterNumber} mono />
            <Line label="Type" value={target.phaseType ? formatPhaseLabel(target.phaseType) : null} />
            <Line label="Assigned to" value={target.installerName} />
            {target.assignedAt && <Line label="Since" value={formatDateTime(target.assignedAt)} />}
            {target.batchRef && <Line label="Batch" value={target.batchRef} />}
          </dl>
          {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
        </div>
      )}
    </ConfirmationModal>
  );
}

/**
 * @param {{ action: ReturnType<typeof import('../../utils/meterUnassign').unassignActionFor>,
 *   onDone?: () => void, className?: string }} props
 */
export default function UnassignMeterAction({ action, onDone, className = '' }) {
  const [open, setOpen] = useState(false);
  if (!action) return null;
  const installed = action.kind === UNASSIGN_KIND.REVERT;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        title={installed
          ? 'Correct an installation mistake: the job returns to pending and the meter to stock'
          : 'Take this meter back from the installer'}
        aria-label={`Unassign meter ${action.target.meterNumber}`}
        className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors ${className}`}>
        <Undo2 className="w-3.5 h-3.5" />
        Unassign
      </button>
      {open && (installed
        ? <RevertInstallationModal target={action.target} onClose={() => setOpen(false)} onReverted={onDone} />
        : <ReturnMeterModal target={action.target} onClose={() => setOpen(false)} onReturned={onDone} />)}
    </>
  );
}
