// src/components/admin/AssignmentsPage.jsx
// Admin: hand physical meters to an installer, and review every dispatch batch.
//
// Meters and jobs are assigned SEPARATELY — there is no meter-to-job pairing.
// An installer holds a pool of meters and a list of jobs, and names which
// meter they used at report time. Jobs are dispatched from the Installation
// Requests page; this page covers meters, plus the batch history for both.
//
// A meter out with an installer keeps status 'AVAILABLE' and moves only its
// assignmentStatus to 'ASSIGNED' — the two axes are independent so that the
// JED flow, which gates on status === 'AVAILABLE', is never disturbed.
//
// Capacity: a dispatch may not exceed the meters the installer still needs
// for their open jobs in this disco (see utils/meterCapacity.js). Partial
// dispatches are allowed. The API itself does not enforce this cap (see
// API_GAP_REPORT.md), so it is checked here against live data just before
// submitting.
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Send, PackageCheck, AlertCircle, Loader2, RefreshCw, ChevronRight, X, Undo2,
} from 'lucide-react';
import jedApi from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { usePermissions } from '../auth/usePermissions';
import StatusTabs from '../common/StatusTabs';
import StatusBadge from '../common/StatusBadge';
import InstallerSelect from '../installations/InstallerSelect';
import BatchResultSummary from '../installations/BatchResultSummary';
import MeterCapacitySummary from '../installations/MeterCapacitySummary';
import { useDiscoOptions } from '../../hooks/useDiscoOptions';
import { useMeterDispatch } from '../../hooks/useMeterDispatch';
import { fetchAllPages, fetchAllPagesDetailed } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';
import { formatDateTime } from '../../utils/date';
import { METER_ASSIGNMENT_STATUS } from '../../utils/installationStatus';
import { toMeterOptions } from '../../utils/meterInventory';
import { meterSummaryLine } from '../../utils/meterDisplay';
import MeterSerialPicker from '../installations/MeterSerialPicker';

// GET /meters is ~6,000 rows; 100 pages x 100 covers it with room to spare.
const METER_MAX_PAGES = 100;

function AssignmentsPage() {
  const permissions = usePermissions();
  const { notifyDataChanged } = useDataRefresh();
  const { discos, loading: discosLoading } = useDiscoOptions();

  const [activeTab, setActiveTab] = useState('dispatch');

  // --- dispatch form ---
  const [discoCode, setDiscoCode] = useState('');
  const [installerId, setInstallerId] = useState('');
  const [serials, setSerials] = useState([]);
  const [note, setNote] = useState('');
  const [dispatchRef, setDispatchRef] = useState('');
  const [errors, setErrors] = useState({});

  // --- batches ---
  const [batches, setBatches] = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchesError, setBatchesError] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedReturns, setSelectedReturns] = useState(() => new Set());
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState(null);

  // --- dispatchable meters (picker options) ---
  const [meterRecords, setMeterRecords] = useState([]);
  const [metersLoading, setMetersLoading] = useState(false);
  const [metersError, setMetersError] = useState(null);
  const [metersTruncated, setMetersTruncated] = useState(false);
  const [metersReload, setMetersReload] = useState(0);
  // Serials the API accepted in this session. Left out of the picker even if
  // a re-read still lists them (the meter list may not carry assignmentStatus).
  const [dispatched, setDispatched] = useState(() => new Set());

  useEffect(() => {
    if (activeTab !== 'dispatch') return undefined;
    let cancelled = false;
    (async () => {
      setMetersLoading(true);
      setMetersError(null);
      try {
        const list = await fetchAllPagesDetailed(
          (p) => jedApi.getMeters(p),
          { status: 'AVAILABLE' },
          { maxPages: METER_MAX_PAGES, inferNextFromFullPage: true }
        );
        if (!cancelled) {
          setMeterRecords(list.items);
          setMetersTruncated(list.truncated);
        }
      } catch (err) {
        console.error('[Assignments] Failed to load meters:', err);
        if (!cancelled) setMetersError("Couldn't load available meters.");
      } finally {
        if (!cancelled) setMetersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, metersReload]);

  const meterOptions = useMemo(() => toMeterOptions(meterRecords, dispatched), [meterRecords, dispatched]);
  // serial → phase type, so the capacity check can be applied per meter type
  // and the error can name the type and the number still needed.
  const phaseBySerial = useMemo(
    () => new Map(meterOptions.map((o) => [o.serial, o.phaseType])),
    [meterOptions]
  );

  // The dispatch itself — capacity, the per-meter-type cap, the fresh
  // re-check at submit and the API call — lives in useMeterDispatch, shared
  // with Meter Schedule's Assign action. This page owns only the form around it.
  const {
    capacity, capacityLoading, capacityError, reloadCapacity,
    check: dispatchCheck, submit: submitDispatch, submitting, result, error: dispatchError,
  } = useMeterDispatch({ discoCode, installerId, serials, phaseBySerial });

  useEffect(() => {
    if (!discoCode && discos.length > 0) setDiscoCode(discos[0].code);
  }, [discos, discoCode]);

  useEffect(() => {
    if (activeTab !== 'batches') return undefined;
    let cancelled = false;
    (async () => {
      setBatchesLoading(true);
      setBatchesError(null);
      try {
        const list = await fetchAllPages(
          (p) => jedApi.getAssignmentBatches(p),
          typeFilter ? { assignmentType: typeFilter } : {}
        );
        if (!cancelled) setBatches(list);
      } catch (err) {
        console.error('[Assignments] Failed to load batches:', err);
        if (!cancelled) setBatchesError(getErrorMessage(err, 'Unable to load assignment batches.'));
      } finally {
        if (!cancelled) setBatchesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, typeFilter, refreshKey]);

  const handleAssign = async () => {
    // Field-level messages stay page-specific; the rules behind them are the
    // hook's, so this page and Meter Schedule can never disagree.
    const found = {};
    if (!discoCode) found.discoCode = 'Select a disco.';
    if (!installerId) found.installerId = 'Select the installer receiving these meters.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const outcome = await submitDispatch({ note, dispatchRef });
    if (!outcome.ok) {
      if (outcome.reason) setErrors({ serials: outcome.reason });
      return;
    }

    // Only serials the API did not reject leave the picker.
    setDispatched((prev) => new Set([...prev, ...outcome.accepted]));
    setSerials([]);
    setErrors({});
    notifyDataChanged();
    setRefreshKey((k) => k + 1);
  };

  const openDetail = useCallback(async (batch) => {
    setDetail(batch);
    setSelectedReturns(new Set());
    setReturnError(null);
    setDetailLoading(true);
    try {
      const response = await jedApi.getAssignmentBatch(batch.id);
      setDetail(response?.data || response || batch);
    } catch (err) {
      console.error('[Assignments] Failed to load batch:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleReturn = async () => {
    if (returning || selectedReturns.size === 0) return;
    setReturning(true);
    setReturnError(null);
    try {
      const response = await jedApi.returnMeters(Array.from(selectedReturns));
      notifyDataChanged();
      setSelectedReturns(new Set());
      setRefreshKey((k) => k + 1);
      // Re-read the batch so the item statuses reflect the return.
      const fresh = await jedApi.getAssignmentBatch(detail.id);
      setDetail(fresh?.data || fresh || detail);
      const summary = response?.data || response;
      if (summary?.rejected?.length) {
        setReturnError('Some meters could not be returned — reopen the batch to check their status.');
      }
    } catch (err) {
      console.error('[Assignments] Return failed:', err);
      setReturnError(getErrorMessage(err, 'Could not return these meters.'));
    } finally {
      setReturning(false);
    }
  };

  if (!permissions.canManageAssignments) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Access Denied</h2>
        <p className="text-gray-600 dark:text-gray-400">You don't have permission to dispatch meters.</p>
      </div>
    );
  }

  const detailItems = Array.isArray(detail?.items) ? detail.items : [];
  const returnableItems = detailItems.filter(
    (i) => i.meterNumber && String(i.assignmentStatus || '').toUpperCase() === METER_ASSIGNMENT_STATUS.ASSIGNED
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg shrink-0">
          <Send className="w-6 h-6 text-brand-600 dark:text-brand-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">Assignments</h1>
          <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm truncate">
            Dispatch meters to installers and review every batch
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <StatusTabs
          tabs={[
            { id: 'dispatch', label: 'Dispatch meters', icon: Send },
            { id: 'batches', label: 'Batches', icon: PackageCheck, count: batches.length || undefined },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        {activeTab === 'dispatch' ? (
          <div className="p-4 sm:p-6 space-y-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Meters and jobs are dispatched separately. Assign jobs from the Installation Requests page — use the same
              dispatch reference on both to group them.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="assign-disco" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Disco<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
                </label>
                <select
                  id="assign-disco"
                  value={discoCode}
                  onChange={(e) => setDiscoCode(e.target.value)}
                  disabled={discosLoading || submitting}
                  aria-invalid={!!errors.discoCode}
                  className={`form-input w-full px-3 py-2.5 text-sm ${errors.discoCode ? 'border-red-400 dark:border-red-500' : ''}`}
                >
                  <option value="">{discosLoading ? 'Loading discos…' : 'Select a disco…'}</option>
                  {discos.map((d) => <option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}
                </select>
                {errors.discoCode && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.discoCode}</p>}
              </div>

              <div>
                <label htmlFor="assign-installer" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Installer<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
                </label>
                <InstallerSelect
                  id="assign-installer"
                  value={installerId}
                  onChange={setInstallerId}
                  disabled={submitting}
                  error={errors.installerId}
                  required
                />
              </div>
            </div>

            {installerId && discoCode && (
              <MeterCapacitySummary
                capacity={capacity}
                loading={capacityLoading}
                error={capacityError}
                onRetry={reloadCapacity}
                addMeters={dispatchCheck?.requested || 0}
              />
            )}

            <div>
              <label htmlFor="assign-serials" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Meter serial numbers<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
              </label>
              <MeterSerialPicker
                id="assign-serials"
                options={meterOptions}
                loading={metersLoading}
                error={metersError}
                onRetry={() => { jedApi.clearCache(); setMetersReload((k) => k + 1); }}
                value={serials}
                onChange={(next) => { setSerials(next); setErrors((p) => ({ ...p, serials: undefined })); }}
                disabled={submitting}
                invalid={!!errors.serials}
              />
              {metersTruncated && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Not every meter could be listed. Search may miss some.</p>
              )}
              {dispatchCheck?.alreadyHeld.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {dispatchCheck.alreadyHeld.length} of these {dispatchCheck.alreadyHeld.length === 1 ? 'is' : 'are'} already with this installer and won&apos;t count again.
                </p>
              )}
              {errors.serials && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.serials}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="assign-ref" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Dispatch reference
                </label>
                <input
                  id="assign-ref"
                  type="text"
                  value={dispatchRef}
                  onChange={(e) => setDispatchRef(e.target.value)}
                  disabled={submitting}
                  placeholder="e.g. DISP-13OCT"
                  className="form-input w-full px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label htmlFor="assign-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Note
                </label>
                <input
                  id="assign-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={submitting}
                  className="form-input w-full px-3 py-2.5 text-sm"
                />
              </div>
            </div>

            {dispatchError && (
              <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-800 dark:text-red-300">{dispatchError}</p>
              </div>
            )}

            {result && <BatchResultSummary data={result} acceptedLabel="Meters dispatched" />}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleAssign}
                disabled={submitting}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-brand-500 text-gray-900 hover:bg-brand-600 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {submitting ? 'Dispatching…' : `Dispatch ${serials.length || ''} meter${serials.length === 1 ? '' : 's'}`.trim()}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {[
                  { id: '', label: 'All' },
                  { id: 'METER', label: 'Meters' },
                  { id: 'INSTALLATION', label: 'Jobs' },
                ].map((f) => (
                  <button
                    key={f.id || 'all'}
                    type="button"
                    onClick={() => setTypeFilter(f.id)}
                    aria-pressed={typeFilter === f.id}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                      typeFilter === f.id
                        ? 'bg-brand-500 text-gray-900'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => { jedApi.clearCache(); setRefreshKey((k) => k + 1); }}
                disabled={batchesLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${batchesLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {batchesError && (
              <div role="alert" className="m-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-800 dark:text-red-300">{batchesError}</p>
              </div>
            )}

            {batchesLoading && batches.length === 0 ? (
              <div className="py-16 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>
            ) : batches.length === 0 ? (
              <div className="py-16 text-center">
                <PackageCheck className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-600 dark:text-gray-400 font-medium">No dispatch batches yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {batches.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => openDetail(b)}
                      className="w-full text-left p-4 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-xs text-gray-900 dark:text-white truncate">{b.batchRef}</p>
                          <StatusBadge status={b.status} label={String(b.status || '').replace(/_/g, ' ')} className="shrink-0 text-[10px]" />
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {b.assignmentType === 'METER' ? 'Meters' : 'Jobs'} &middot; {b.itemCount} item{b.itemCount === 1 ? '' : 's'}
                          {b.installerName ? ` · ${b.installerName}` : ''} &middot; {formatDateTime(b.assignedAt || b.createdAt)}
                        </p>
                        {b.dispatchRef && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Ref {b.dispatchRef}</p>}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="abatch-title"
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] flex flex-col">
            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="abatch-title" className="text-lg font-semibold text-gray-900 dark:text-white">Dispatch batch</h2>
                <p className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">{detail.batchRef}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  {detail.installerName || '—'} &middot; {formatDateTime(detail.assignedAt || detail.createdAt)}
                </p>
              </div>
              <button type="button" onClick={() => setDetail(null)} aria-label="Close"
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {returnError && (
                <div role="alert" className="mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-sm text-red-800 dark:text-red-300">{returnError}</p>
                </div>
              )}
              {detailLoading ? (
                <div className="py-8 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-600" /></div>
              ) : detailItems.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">This batch has no items to show.</p>
              ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {detailItems.map((item, i) => {
                    const isMeter = !!item.meterNumber;
                    const canReturn = isMeter && String(item.assignmentStatus || '').toUpperCase() === METER_ASSIGNMENT_STATUS.ASSIGNED;
                    return (
                      <li key={item.id ?? item.meterNumber ?? i} className="py-2.5 flex items-center gap-3">
                        {canReturn && (
                          <input
                            type="checkbox"
                            checked={selectedReturns.has(item.meterNumber)}
                            onChange={() => setSelectedReturns((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.meterNumber)) next.delete(item.meterNumber);
                              else next.add(item.meterNumber);
                              return next;
                            })}
                            aria-label={`Select meter ${item.meterNumber} to return`}
                            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 shrink-0"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-mono text-gray-900 dark:text-white truncate">
                            {item.meterNumber || item.accountNumber}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {isMeter
                              ? meterSummaryLine(item)
                              : [item.customerName, item.customerAddress].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <StatusBadge
                          status={item.assignmentStatus || item.status}
                          label={String(item.assignmentStatus || item.status || '').replace(/_/g, ' ')}
                          className="shrink-0 text-[10px]"
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {returnableItems.length > 0 && (
              <div className="p-4 sm:px-6 border-t border-gray-200 dark:border-gray-700 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedReturns.size} of {returnableItems.length} selected
                </p>
                <button
                  type="button"
                  onClick={handleReturn}
                  disabled={returning || selectedReturns.size === 0}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  {returning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                  Return to stock
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AssignmentsPage;
