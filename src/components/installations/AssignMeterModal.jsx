// src/components/installations/AssignMeterModal.jsx
// Dispatch already-chosen meters to an installer, from wherever the meters
// were chosen (today: Meter Schedule's Assign action).
//
// This is NOT a second assignment implementation. Everything that decides
// whether the dispatch is legal, and the call itself, come from
// useMeterDispatch — the same hook the Assignments page uses. The only thing
// this file owns is the modal shell around it: the meters are handed in
// already selected, so there is no serial picker here.
//
// Disco: POST /assignments/meters is scoped by discoCode, and a meter record
// in the shared inventory carries no disco of its own, so the disco is asked
// for here exactly as it is on the Assignments page.
import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, UserPlus } from 'lucide-react';
import InstallerSelect from './InstallerSelect';
import BatchResultSummary from './BatchResultSummary';
import MeterCapacitySummary from './MeterCapacitySummary';
import { useDiscoOptions } from '../../hooks/useDiscoOptions';
import { useMeterDispatch } from '../../hooks/useMeterDispatch';
import { meterSerial } from '../../utils/meterInventory';
import { meterMakeModel } from '../../utils/meterDisplay';

/**
 * @param {object} props
 * @param {object[]} props.meters - raw meter records to dispatch (already eligible)
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {(outcome: { accepted: string[] }) => void} [props.onAssigned] - after a dispatch the API accepted
 */
function AssignMeterModal({ meters = [], isOpen, onClose, onAssigned }) {
  const { discos, loading: discosLoading } = useDiscoOptions();
  const [discoCode, setDiscoCode] = useState('');
  const [installerId, setInstallerId] = useState('');
  const [dispatchRef, setDispatchRef] = useState('');
  const [fieldError, setFieldError] = useState(null);

  const serials = useMemo(
    () => Array.from(new Set(meters.map(meterSerial).filter(Boolean))),
    [meters]
  );
  const phaseBySerial = useMemo(
    () => new Map(meters.map((m) => [meterSerial(m), m?.phaseType]).filter(([s]) => s)),
    [meters]
  );

  const {
    capacity, capacityLoading, capacityError, reloadCapacity,
    check, submit, submitting, result, error, reset,
  } = useMeterDispatch({ discoCode, installerId, serials, phaseBySerial, enabled: isOpen });

  // A fresh dispatch every time the modal opens — never a stale result or a
  // previous selection's installer.
  useEffect(() => {
    if (!isOpen) return;
    setInstallerId('');
    setDispatchRef('');
    setFieldError(null);
    reset();
  }, [isOpen, reset]);

  useEffect(() => {
    if (!discoCode && discos.length > 0) setDiscoCode(discos[0].code);
  }, [discos, discoCode]);

  if (!isOpen) return null;

  const handleAssign = async () => {
    setFieldError(null);
    const outcome = await submit({ dispatchRef });
    if (!outcome.ok) {
      if (outcome.reason) setFieldError(outcome.reason);
      return;
    }
    onAssigned?.({ accepted: outcome.accepted });
  };

  const single = meters.length === 1 ? meters[0] : null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-meter-title"
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col"
      >
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="assign-meter-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              Assign {meters.length === 1 ? 'meter' : `${meters.length} meters`}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-all">
              {single
                ? [meterSerial(single), single.phaseType, meterMakeModel(single)].filter(Boolean).join(' · ')
                : 'Dispatch the selected meters to one installer'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {result ? (
            <BatchResultSummary data={result} acceptedLabel="Meters dispatched" />
          ) : (
            <>
              {meters.length > 1 && (
                <ul className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/60 max-h-32 overflow-y-auto">
                  {meters.map((m) => (
                    <li key={meterSerial(m)} className="px-3 py-1.5 text-xs">
                      <span className="font-mono text-gray-900 dark:text-white break-all">{meterSerial(m)}</span>
                      {m.phaseType && <span className="text-gray-500 dark:text-gray-400"> · {m.phaseType}</span>}
                    </li>
                  ))}
                </ul>
              )}

              <div>
                <label htmlFor="assign-meter-disco" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Disco<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
                </label>
                <select
                  id="assign-meter-disco"
                  value={discoCode}
                  onChange={(e) => { setDiscoCode(e.target.value); setFieldError(null); }}
                  disabled={discosLoading || submitting}
                  className="form-input w-full px-3 py-2.5 text-sm"
                >
                  <option value="">{discosLoading ? 'Loading discos…' : 'Select a disco…'}</option>
                  {discos.map((d) => <option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="assign-meter-installer" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Installer<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
                </label>
                <InstallerSelect
                  id="assign-meter-installer"
                  value={installerId}
                  onChange={(v) => { setInstallerId(v); setFieldError(null); }}
                  disabled={submitting}
                  required
                />
              </div>

              {installerId && discoCode && (
                <MeterCapacitySummary
                  capacity={capacity}
                  loading={capacityLoading}
                  error={capacityError}
                  onRetry={reloadCapacity}
                  addMeters={check?.requested || 0}
                />
              )}

              {check?.alreadyHeld.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {check.alreadyHeld.length} of these {check.alreadyHeld.length === 1 ? 'is' : 'are'} already with this
                  installer and won&apos;t count again.
                </p>
              )}

              <div>
                <label htmlFor="assign-meter-ref" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Dispatch reference
                </label>
                <input
                  id="assign-meter-ref"
                  type="text"
                  value={dispatchRef}
                  onChange={(e) => setDispatchRef(e.target.value)}
                  disabled={submitting}
                  placeholder="Use the same reference as the job dispatch"
                  className="form-input w-full px-3 py-2.5 text-sm"
                />
              </div>

              {(fieldError || error) && (
                <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-sm text-red-800 dark:text-red-300 break-words">{fieldError || error}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 sm:px-6 border-t border-gray-200 dark:border-gray-700 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleAssign}
              disabled={submitting}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-brand-500 text-gray-900 hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {submitting ? 'Assigning…' : 'Assign'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default AssignMeterModal;
