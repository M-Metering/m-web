// src/components/installation/InstallationDetail.jsx
// Detail view reached by clicking a row in InstallerDashboard (or Admin's
// recent installations). Pending jobs show the Complete Installation form;
// completed jobs show a read-only completion summary.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { usePermissions } from '../auth/usePermissions';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import JEDApiService from '../services/api';
import RequestInfoPanel from './RequestInfoPanel';
import CompletionDetails from './CompletionDetails';
import PaymentTimeline from '../common/PaymentTimeline';
import GenerateRRRModal from '../common/GenerateRRRModal';
import StatusBadge from '../common/StatusBadge';
import { buildRrrPayload } from '../../utils/rrrPayload';
import { isCompletedStatus, isAwaitingInstallationStatus, jedStatusLabel } from '../../utils/statusBadge';
import { getErrorMessage } from '../../utils/errorMessage';
import { validateMeterNumber, METER_NUMBER_HINT } from '../../utils/meterNumber';
import { normalizeSealNumber, isDuplicateSealError, DUPLICATE_SEAL_MESSAGE } from '../../utils/sealNumber';
import {
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Loader2,
  MessageSquareWarning,
} from 'lucide-react';

// isCompletedStatus previously lived here as a local, lowercase-only copy.
// Now imported from the shared, case-insensitive src/utils/statusBadge.js
// so this stays consistent with AdminDashboard and InstallerDashboard.

/**
 * Short user-facing reason for a failed completion. The backend's own
 * payment-confirmation check (POST /external/jed/complete-installation
 * documents a 400 for "payment not confirmed") becomes a plain "not yet";
 * the full server message stays in the console. The app has no confirmation
 * rule of its own and cannot bypass the server's (see API_GAP_REPORT.md).
 */
function describeCompletionError(err) {
  // A seal the backend already holds comes back as a duplicate/unique
  // violation — plain words for it, before getErrorMessage drops the raw
  // database text as technical.
  if (isDuplicateSealError(err)) return DUPLICATE_SEAL_MESSAGE;
  const message = getErrorMessage(err, "Couldn't complete this installation. Please try again.");
  if (/confirm/i.test(message) && /pay/i.test(message)) {
    return 'Installation cannot be completed yet. Payment confirmation is still pending.';
  }
  return message;
}

function InstallationDetail() {
  const { accountNumber } = useParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { notifyDataChanged } = useDataRefresh();

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Complete-installation form state
  const [formData, setFormData] = useState({ actualMeterNo: '', actualSealNo: '', notes: '' });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genResult, setGenResult] = useState(null);
  const [genGeneratedAt, setGenGeneratedAt] = useState(null);

  const fetchDetail = useCallback(async () => {
    // `accountNumber` comes straight from the URL. Account numbers are
    // numeric-only (business rule), so anything else is rejected here
    // without calling the API — a crafted link like
    // /installations/..%2F..%2Fusers used to make the signed-in user's
    // browser send an authenticated request to an unrelated endpoint.
    if (!/^\d+$/.test(accountNumber || '')) {
      setJob(null);
      setError('Unable to load this installation. It may not exist or you may not have access.');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await JEDApiService.getCustomerRequest(accountNumber);
      const data = response?.data || response;
      setJob(data);
      setFormData({
        actualMeterNo: data?.meterNo || data?.meterNumber || '',
        actualSealNo: data?.sealNo || '',
        notes: '',
      });
    } catch (err) {
      console.error('[InstallationDetail] Failed to load request:', err);
      setError('Unable to load this installation. It may not exist or you may not have access.');
    } finally {
      setLoading(false);
    }
  }, [accountNumber]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Live-ish background refresh while this specific job is still open
  // (INITIATED/PAID) — silent (no `loading` spinner, and it never touches
  // `formData`, so an installer mid-way through the completion form never
  // gets it clobbered by a background tick). The real API has no
  // websocket/webhook channel this frontend can subscribe to (see
  // PROJECT_CONTEXT.md/API_GAP_REPORT.md) — a light poll is the closest
  // honest approximation of "live" available here. 45s is comfortably
  // past jedApi's own 30s response cache (so each tick is a real network
  // call, not a cache hit) without being aggressive. Stops entirely once
  // the job reaches COMPLETED, and is cleared on unmount/navigation like
  // any other effect.
  useEffect(() => {
    if (!job || isCompletedStatus(job.status)) return undefined;

    const intervalId = setInterval(async () => {
      try {
        const response = await JEDApiService.getCustomerRequest(accountNumber);
        setJob(response?.data || response);
      } catch (err) {
        // Silent — a background refresh failing shouldn't surface a
        // page-level error over data that already loaded successfully.
        console.error('[InstallationDetail] Background refresh failed:', err);
      }
    }, 45000);

    return () => clearInterval(intervalId);
    // job.status (not the whole `job` object) is the intentional dependency —
    // restarting this interval on every tick's own setJob() would mean it
    // never actually waits the full 45s between calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, accountNumber]);

  // Built from the already-loaded request — every field POST
  // /external/jed/generate-ref needs is already on the record, so there's
  // no separate "form" step; the modal's preview step reviews this same
  // object before it's submitted.
  const rrrPayload = buildRrrPayload(job);

  const openGenerateModal = () => {
    setGenError(null);
    setGenResult(null);
    setGenModalOpen(true);
  };

  const handleGenerateReference = async () => {
    if (!rrrPayload) return;
    setGenLoading(true);
    setGenError(null);

    try {
      const response = await JEDApiService.generatePaymentReference(rrrPayload);
      const data = response?.data || response;
      setGenResult(data);
      setGenGeneratedAt(new Date());

      // Try to extract RRR/payment reference from common fields
      const rrr = data?.RRR || data?.rrr || data?.reference || data?.paymentReference || data?.payment_ref || null;
      if (rrr) {
        setJob((prev) => (prev ? { ...prev, rrr, paymentReference: rrr } : prev));
      }
    } catch (err) {
      console.error('[InstallationDetail] generate payment reference failed:', err);
      setGenError(getErrorMessage(err, 'Failed to generate payment reference'));
    } finally {
      setGenLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) setFormErrors((prev) => ({ ...prev, [name]: '' }));
    if (submitError) setSubmitError(null);
  };

  const validate = () => {
    const errs = {};
    // A meter number is an identifier of 10-13 digits, not a fixed-length
    // number: it is checked against that range and sent exactly as typed,
    // never padded to a length (see utils/meterNumber.js).
    const meter = validateMeterNumber(formData.actualMeterNo);
    if (!meter.valid) errs.actualMeterNo = meter.error;
    if (!normalizeSealNumber(formData.actualSealNo)) {
      errs.actualSealNo = 'Seal Number is required';
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleComplete = async () => {
    if (submitting || !validate()) return;
    // Eligibility is payment, nothing else: any PAID request can be completed.
    // JED's own confirmation step is not a precondition on this side.
    if (!isAwaitingInstallationStatus(job?.status)) {
      setSubmitError('Only paid requests can be completed. This request has not been paid yet.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);

    try {
      // Exactly the documented body of POST /external/jed/complete-installation
      // (sealNo, meterNo, accountNumber — all required strings). This used to
      // also send installationDate/installerName/installerEmployeeId/notes,
      // none of which the endpoint accepts; extra keys risk a validation 400
      // on a strict schema and were never stored anyway.
      const response = await JEDApiService.completeInstallation({
        sealNo: normalizeSealNumber(formData.actualSealNo),
        meterNo: String(formData.actualMeterNo).trim(),
        accountNumber: String(accountNumber),
      });
      if (response?.success === false) {
        throw new Error(response.message || 'The server did not confirm the installation.');
      }

      setSubmitted(true);
      // Show the status the API now reports rather than assuming it.
      JEDApiService.clearCache();
      fetchDetail();
      notifyDataChanged();

      // Back to the queue this job came from, once the success state has been
      // on screen long enough to read. This is a confirmation pause, not an
      // artificial loading delay — navigating instantly would hide the result.
      setTimeout(() => navigate(permissions.isAdmin ? '/installations?view=jed' : '/dashboard'), 1500);
    } catch (err) {
      console.error('[InstallationDetail] Failed to complete installation:', err);
      setSubmitError(describeCompletionError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-brand-600 animate-spin mx-auto mb-3" />
          <p className="text-gray-600 dark:text-gray-400 text-sm">Loading installation details...</p>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-900 dark:text-white mb-4">{error || 'Installation not found'}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-6 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const completed = isCompletedStatus(job.status);

  return (
    <div className="space-y-4 sm:space-y-6 pb-8">
      {/* Sticky-feeling back header — important on mobile so the action is always reachable */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
        >
          <ArrowLeft className="w-5 h-5 text-gray-700 dark:text-gray-300" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
            Account {job.accountNumber}
          </h1>
          <StatusBadge
            status={job.status}
            label={jedStatusLabel(job.status)}
            className="mt-1"
          />
        </div>
      </div>

      {/* Customer / request info — shared panel */}
      <RequestInfoPanel data={job} />

      {/* Installer-only shortcut to the Complaint Form for this job */}
      {permissions.canSubmitComplaints && !completed && (
        <div className="flex justify-end">
          <Link
            to={`/complaints?job=${encodeURIComponent(accountNumber)}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-400 hover:underline"
          >
            <MessageSquareWarning className="w-4 h-4" />
            Report a problem with this job
          </Link>
        </div>
      )}

          {/* Generate payment reference (RRR) — only offered when this
              request genuinely has none yet (an INITIATED record that
              somehow never got one). "Regenerate Reference" was removed:
              once a reference exists, the customer may already have paid
              against it, so silently replacing it here was a real risk —
              see the completed-installation workflow instead for the
              normal path once a request has actually been paid.
              Admin/Super Admin only: this calls the ApiKeyAuth-only
              generate-ref endpoint with the browser's stored admin API key
              (Settings → API Keys), which an Installer neither has nor should
              be able to borrow on a shared device. */}
          {permissions.isAdmin && !completed && !(job.rrr || job.paymentReference || job.paymentRef) && (
            <div className="card p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Payment Reference</h3>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Reference</p>
                  <p className="font-mono text-sm text-gray-900 dark:text-white">No reference generated</p>
                </div>

                <div className="flex-shrink-0">
                  <button
                    type="button"
                    onClick={openGenerateModal}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                  >
                    Generate Reference
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Once a reference exists it's already shown by RequestInfoPanel's
              "Payment Reference / RRR" row above — this section only ever
              needs to render the generate-reference CTA (see the block
              above), not a second read-only copy of the same value. */}

          {/* Payment timeline — built only from real timestamps the API
              returns on this request (dateRequested/datePaid/dateCompleted) */}
          {(job.dateRequested || job.datePaid || job.dateCompleted) && (
            <div className="card p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Payment Timeline</h3>
              <PaymentTimeline
                dateRequested={job.dateRequested}
                datePaid={job.datePaid}
                dateCompleted={job.dateCompleted}
                status={job.status}
              />
            </div>
          )}

      {completed ? (
        // ---- Completed: read-only summary, no form ----
        <>
          <CompletionDetails job={job} />
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-6 text-center">
            <CheckCircle className="w-10 h-10 text-green-600 mx-auto mb-2" />
            <p className="text-green-800 dark:text-green-300 font-semibold">Installation Completed</p>
            <p className="text-green-700 dark:text-green-400 text-sm mt-1">
              This job has been marked as paid and completed. No further action needed.
            </p>
          </div>
        </>
      ) : submitted ? (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-6 text-center">
          <CheckCircle className="w-10 h-10 text-green-600 mx-auto mb-2" />
          <p className="text-green-800 dark:text-green-300 font-semibold">Installation submitted!</p>
          <p className="text-green-700 dark:text-green-400 text-sm mt-1">
            Confirmed by the server. Redirecting…
          </p>
        </div>
      ) : !isAwaitingInstallationStatus(job.status) ? (
        // ---- Not paid yet: nothing to complete ----
        <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-lg p-4 sm:p-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Awaiting payment</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              This request can be completed as soon as its payment is recorded (status Paid). Nothing else is required first.
            </p>
          </div>
        </div>
      ) : !permissions.canCompleteInstallations ? (
        // ---- Paid, but this role only watches the queue (Supervisor) ----
        <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-lg p-4 sm:p-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Awaiting installation</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              This request is paid and waiting for an installer. Your role can view it but not submit the installation.
            </p>
          </div>
        </div>
      ) : (
        // ---- Pending: the actual "execute and mark complete" form ----
        <div className="card p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Complete Installation
          </h2>

          {submitError && (
            <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-800 dark:text-red-300">{submitError}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Actual Meter Number *
              </label>
              <input
                type="text"
                name="actualMeterNo"
                value={formData.actualMeterNo}
                onChange={handleChange}
                inputMode="numeric"
                disabled={submitting}
                className={`form-input w-full px-3 py-2.5 font-mono text-sm ${
                  formErrors.actualMeterNo ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''
                }`}
                placeholder="Meter number exactly as printed"
              />
              <div className="mt-1">
                {formErrors.actualMeterNo ? (
                  <p role="alert" className="text-xs text-red-600 dark:text-red-400">{formErrors.actualMeterNo}</p>
                ) : (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{METER_NUMBER_HINT}</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Actual Seal Number *
              </label>
              <input
                type="text"
                name="actualSealNo"
                value={formData.actualSealNo}
                onChange={handleChange}
                disabled={submitting}
                className={`form-input w-full px-3 py-2.5 text-sm ${
                  formErrors.actualSealNo ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''
                }`}
              />
              {formErrors.actualSealNo && (
                <p className="mt-1 text-xs text-red-600">{formErrors.actualSealNo}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Notes
              </label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                disabled={submitting}
                rows={3}
                className="form-input w-full px-3 py-2.5 text-sm"
                placeholder="Any observations from the field..."
              />
            </div>

            {/* Sticky action bar on mobile keeps the primary action reachable
                without scrolling back up on small screens */}
            <div className="sticky bottom-0 -mx-4 sm:mx-0 sm:static bg-white dark:bg-gray-800 sm:bg-transparent px-4 sm:px-0 pt-3 pb-1 border-t sm:border-0 border-gray-200 dark:border-gray-700 flex gap-3">
              <button
                type="button"
                onClick={handleComplete}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 disabled:bg-green-400 transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Mark as Complete'
                )}
              </button>
              <button
                type="button"
                onClick={() => navigate(-1)}
                disabled={submitting}
                className="px-5 py-3 border border-gray-300 dark:border-gray-600 rounded-lg font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <GenerateRRRModal
        isOpen={genModalOpen}
        onClose={() => setGenModalOpen(false)}
        payload={rrrPayload}
        loading={genLoading}
        error={genError}
        result={genResult}
        generatedAt={genGeneratedAt}
        onConfirm={handleGenerateReference}
      />
    </div>
  );
}

export default InstallationDetail;