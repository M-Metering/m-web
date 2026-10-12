// src/components/installations/DuplicateSeals.jsx
// Installations → Duplicate seals (Super Admin only, 2026-10-12).
//
// Seals reported before the API made them unique may be shared by several
// completed jobs. GET /installations/seal-duplicates lists every clash, grouped
// by the seal's digits (only the digits identify a seal — utils/sealNumber.js),
// oldest report first; PATCH /installations/:id/seal corrects one job's seal
// with the same checks as a report, so a correction can't create a new clash.
// After each correction the list is re-read from the server: a group
// disappears once only one job holds its seal.
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle, Loader2, CheckCircle2, Pencil } from 'lucide-react';
import jedApi from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import StatusBadge from '../common/StatusBadge';
import ConfirmationModal from '../common/ConfirmationModal';
import { getErrorMessage } from '../../utils/errorMessage';
import { assertApiSuccess } from '../../utils/apiResult';
import { formatDateTime } from '../../utils/date';
import { installationStatusLabel, INSTALLATION_STATUS } from '../../utils/installationStatus';
import { normalizeStatus } from '../../utils/statusBadge';
import {
  sealDuplicateGroupsOf, validateSealCorrection, isDuplicateSealError, sealValidationErrorOf,
  DUPLICATE_SEAL_MESSAGE,
} from '../../utils/sealNumber';

function SealEditModal({ target, groups, onClose, onSaved }) {
  const [seal, setSeal] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setSeal(target.sealNumber || '');
    setReason('');
    setError(null);
  }, [target]);

  if (!target) return null;
  const exported = normalizeStatus(target.status) === INSTALLATION_STATUS.EXPORTED;

  const save = async () => {
    if (saving) return;
    const check = validateSealCorrection(seal, groups);
    if (!check.valid) { setError(check.error); return; }
    setSaving(true);
    setError(null);
    try {
      const response = await jedApi.correctInstallationSeal(target.id, { sealNumber: check.value, reason: reason.trim() });
      assertApiSuccess(response, 'The server did not confirm the seal change.');
      onSaved(target, check.value);
    } catch (err) {
      console.error('[DuplicateSeals] Seal correction failed:', err);
      if (isDuplicateSealError(err)) setError(DUPLICATE_SEAL_MESSAGE);
      else setError(sealValidationErrorOf(err) || getErrorMessage(err, 'Could not update the seal number.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmationModal
      isOpen
      onClose={() => { if (!saving) onClose(); }}
      onConfirm={save}
      loading={saving}
      title="Correct seal number"
      message={`Account ${target.accountNumber}${target.customerName ? ` (${target.customerName})` : ''} · ${target.discoCode || 'disco'} · meter ${target.meterNumber || '—'}.`}
      confirmText="Save seal"
    >
      <div className="space-y-3">
        {exported && (
          <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2">
            This job is already exported. The sheet sent to the disco still shows the old seal ({target.sealNumber}); tell the disco about the change.
          </p>
        )}
        <div>
          <label htmlFor="seal-correction" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">New seal number</label>
          <input
            id="seal-correction"
            type="text"
            value={seal}
            onChange={(e) => { setSeal(e.target.value); setError(null); }}
            disabled={saving}
            aria-invalid={!!error}
            className="form-input w-full px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Saved exactly as typed. Only its digits identify the seal.</p>
        </div>
        <div>
          <label htmlFor="seal-reason" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Reason (optional)</label>
          <input
            id="seal-reason"
            type="text"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            disabled={saving}
            placeholder="e.g. Installer mistyped the seal"
            className="form-input w-full px-3 py-2 text-sm"
          />
        </div>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </ConfirmationModal>
  );
}

function DuplicateSeals() {
  const { notifyDataChanged } = useDataRefresh();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGroups(sealDuplicateGroupsOf(await jedApi.getSealDuplicates()));
    } catch (err) {
      console.error('[DuplicateSeals] Load failed:', err);
      setError(getErrorMessage(err, 'Unable to load duplicate seals.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (target, sealNumber) => {
    setEditTarget(null);
    setNotice(`Seal for account ${target.accountNumber} changed to ${sealNumber}.`);
    notifyDataChanged();
    load();
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Completed jobs that share a seal. Only the digits identify a seal, so <span className="font-mono">SL-004512</span> and{' '}
          <span className="font-mono">004512</span> clash. Correct the wrong one; a group disappears when only one job holds its seal.
        </p>
        <button type="button" onClick={load} disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 shrink-0">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {notice && (
        <div role="status" className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          <p className="text-sm text-green-800 dark:text-green-300">{notice}</p>
        </div>
      )}

      {error ? (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      ) : loading && groups.length === 0 ? (
        <div className="py-16 flex items-center justify-center" role="status">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
          <span className="sr-only">Loading…</span>
        </div>
      ) : groups.length === 0 ? (
        <div className="card p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400 mx-auto" />
          <p className="font-medium text-gray-900 dark:text-white mt-2">No duplicate seals</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Every completed job has its own seal.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {groups.length.toLocaleString()} seal{groups.length === 1 ? '' : 's'} shared by more than one job.
          </p>
          {groups.map((group) => (
            <section key={group.digits} className="card overflow-hidden">
              <header className="px-4 py-2 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Seal digits <span className="font-mono">{group.digits}</span>
                </h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">{group.installations.length} jobs</span>
              </header>
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {group.installations.map((job) => (
                  <li key={job.id} className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
                          {job.customerName || `Account ${job.accountNumber}`}
                        </p>
                        <StatusBadge status={job.status} label={installationStatusLabel(job.status)} className="shrink-0 text-[11px]" />
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 space-y-0.5">
                        <p className="truncate">Acct <span className="font-mono">{job.accountNumber}</span>{job.discoCode ? ` · ${job.discoCode}` : ''}</p>
                        <p className="font-mono">Seal {job.sealNumber || '—'} · meter {job.meterNumber || '—'}</p>
                        <p>
                          {job.installerName ? `Installer ${job.installerName}` : 'Installer not recorded'}
                          {job.reportedAt ? ` · reported ${formatDateTime(job.reportedAt)}` : ''}
                        </p>
                      </div>
                    </div>
                    <button type="button" onClick={() => { setNotice(null); setEditTarget(job); }}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 shrink-0">
                      <Pencil className="w-3.5 h-3.5" /> Edit seal
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <SealEditModal target={editTarget} groups={groups} onClose={() => setEditTarget(null)} onSaved={handleSaved} />
    </div>
  );
}

export default DuplicateSeals;
