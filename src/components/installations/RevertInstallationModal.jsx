// src/components/installations/RevertInstallationModal.jsx
// "Unassign installed meter" — the ONE confirmation for
// POST /installations/{id}/revert (SUPERADMIN only), used by Installations,
// Installer Job Status and Meter Schedule → Installed so the wording, the
// identified record and the call can't drift between them.
//
// Names exactly what will change (customer, account, meter, installer,
// installation date) before anything is sent; on success it bumps the app's
// refreshSignal so every mounted screen — Meter Schedule, inventory, Installer
// Job Status, Installations, Dashboard — re-reads from the server. Eligibility
// is utils/installationRevert.js; the role check is the caller's
// (permissions.canRevertInstallations).
import { useEffect, useState } from 'react';
import ConfirmationModal from '../common/ConfirmationModal';
import jedApi from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { assertApiSuccess } from '../../utils/apiResult';
import { getErrorMessage } from '../../utils/errorMessage';
import { formatPlainDate } from '../../utils/date';

const Line = ({ label, value, mono = false }) => (
  <div className="flex gap-2 min-w-0">
    <dt className="text-gray-500 dark:text-gray-400 shrink-0 w-24">{label}</dt>
    <dd className={`text-gray-900 dark:text-white min-w-0 break-words ${mono ? 'font-mono break-all' : ''}`}>{value || 'Not recorded'}</dd>
  </div>
);

/**
 * @param {{ target: ReturnType<typeof import('../../utils/installationRevert').revertTargetOf>,
 *   onClose: () => void, onReverted?: (target: object) => void }} props
 */
export default function RevertInstallationModal({ target, onClose, onReverted }) {
  const { notifyDataChanged } = useDataRefresh();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Fresh form for every record.
  useEffect(() => { setReason(''); setError(null); }, [target?.id]);

  const close = () => { if (!busy) onClose(); };

  const confirm = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      assertApiSuccess(
        await jedApi.revertInstallation(target.id, reason.trim() || undefined),
        'The server did not confirm the change.'
      );
      notifyDataChanged();
      onReverted?.(target);
      onClose();
    } catch (err) {
      console.error('[RevertInstallationModal] Revert failed:', err);
      setError(getErrorMessage(err, 'Could not unassign this meter. Nothing was changed.'));
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
      title="Unassign installed meter?"
      message={'This removes the meter from this customer’s installation. Use it only to correct an installation mistake.\n\n'
        + 'The job goes back to pending and unassigned, the meter returns to stock, and the job’s revenue is removed. '
        + 'The seal number, installation date, GPS location and photo recorded for it are cleared by the server and can’t be recovered.'}
      confirmText="Confirm unassign"
    >
      {target && (
        <div className="space-y-3">
          <dl className="grid grid-cols-1 gap-1 text-xs p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700"
            aria-label="Installation to be changed">
            <Line label="Customer" value={target.customerName} />
            <Line label="Account" value={target.accountNumber} mono />
            <Line label="Meter" value={target.meterNumber} mono />
            <Line label="Installer" value={target.installerName} />
            <Line label="Installed" value={target.installationDate ? formatPlainDate(target.installationDate) : null} />
            {target.disco && <Line label="Disco" value={target.disco} />}
          </dl>
          <div>
            <label htmlFor="revert-reason" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Reason (optional, recorded in the server log)
            </label>
            <input id="revert-reason" type="text" value={reason} maxLength={200}
              onChange={(e) => setReason(e.target.value)} disabled={busy}
              placeholder="e.g. Wrong meter installed for this customer"
              className="form-input w-full px-3 py-2 text-sm" />
          </div>
          {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
        </div>
      )}
    </ConfirmationModal>
  );
}
