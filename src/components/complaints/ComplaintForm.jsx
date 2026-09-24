// src/components/complaints/ComplaintForm.jsx
// Installer-only form for reporting a problem that blocks or delays a job.
//
// BACKEND STATUS — read before changing: the Pharez API has NO complaint /
// issue / incident / ticket endpoint (verified against the live OpenAPI spec
// and by probing the production host; see API_GAP_REPORT.md, "Complaints").
// So this form can be filled in and validated for real, and the job list is
// real data (the Installer's shared queue via GET /external/jed/requests/
// installer), but a complaint cannot be *recorded*. Following the app's
// established pattern for unsupported actions (CLAUDE.md rule 12), submitting
// opens an explicit "not sent" notice with a copyable summary — never a fake
// success state and never a localStorage-backed pretend record. The field set
// in utils/complaint.js is the UI's own, not a backend contract.
//
// Access: Installer only (App.jsx route guard + Navigation item both use
// permissions.canSubmitComplaints). The check is repeated here as a second
// layer, matching ExcelUpload.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MessageSquareWarning,
  AlertCircle,
  Loader2,
  RefreshCw,
  Copy,
  Check,
  Info,
} from 'lucide-react';
import jedApi from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import InfoModal from '../common/InfoModal';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  NO_JOB,
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_IMPACTS,
  DESCRIPTION_MAX,
  REMARKS_MAX,
  toLocalDateTimeInputValue,
  validateComplaint,
  buildComplaintSummary,
} from '../../utils/complaint';

// Selected-state look per priority (literal class names so Tailwind emits
// them). Deliberately not the gold brand hue — see CLAUDE.md UI rules.
const PRIORITY_STYLES = {
  LOW: 'peer-checked:bg-green-100 dark:peer-checked:bg-green-900/30 peer-checked:text-green-800 dark:peer-checked:text-green-300 peer-checked:border-green-500',
  MEDIUM: 'peer-checked:bg-blue-100 dark:peer-checked:bg-blue-900/30 peer-checked:text-blue-800 dark:peer-checked:text-blue-300 peer-checked:border-blue-500',
  HIGH: 'peer-checked:bg-orange-100 dark:peer-checked:bg-orange-900/30 peer-checked:text-orange-800 dark:peer-checked:text-orange-300 peer-checked:border-orange-500',
  CRITICAL: 'peer-checked:bg-red-100 dark:peer-checked:bg-red-900/30 peer-checked:text-red-800 dark:peer-checked:text-red-300 peer-checked:border-red-500',
};

const FIELD_IDS = {
  job: 'complaint-job',
  category: 'complaint-category',
  priority: 'complaint-priority-LOW', // first radio, for focus-on-error
  impact: 'complaint-impact',
  issueAt: 'complaint-issueAt',
  description: 'complaint-description',
  remarks: 'complaint-remarks',
};
const FIELD_ORDER = ['job', 'category', 'priority', 'impact', 'issueAt', 'description', 'remarks'];

const newFormValues = () => ({
  job: '',
  category: '',
  priority: '',
  impact: '',
  issueAt: toLocalDateTimeInputValue(),
  description: '',
  remarks: '',
});

function Field({ id, label, required, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
        {required && <span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-gray-500 dark:text-gray-400 mt-1">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className="text-gray-900 dark:text-white font-medium text-right break-words min-w-0">{value}</span>
    </div>
  );
}

function ComplaintForm() {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [searchParams] = useSearchParams();
  const requestedJob = searchParams.get('job');

  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [values, setValues] = useState(newFormValues);
  const [errors, setErrors] = useState({});
  const [summary, setSummary] = useState(null); // non-null => "not sent" modal open
  const [copied, setCopied] = useState(false);

  // The installer's real shared queue: requests awaiting installation (PAID).
  // There is no per-installer assignment on the API, so this is the same list
  // every installer sees — see API_GAP_REPORT.md.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setJobsLoading(true);
      setJobsError(null);
      try {
        const list = await fetchAllPages((params) => jedApi.getMyInstallations(params), { status: 'PAID' });
        if (!cancelled) setJobs(list);
      } catch (err) {
        console.error('[ComplaintForm] Failed to load installations:', err);
        if (!cancelled) setJobsError(getErrorMessage(err, 'Unable to load your installations.'));
      } finally {
        if (!cancelled) setJobsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Preselect from ?job=<accountNumber> (linked from a job's detail page),
  // but only if it matches a job that really is in the loaded list.
  useEffect(() => {
    if (!requestedJob || jobs.length === 0) return;
    if (jobs.some((j) => String(j.accountNumber) === requestedJob)) {
      setValues((prev) => (prev.job ? prev : { ...prev, job: requestedJob }));
    }
  }, [requestedJob, jobs]);

  const selectedJob = useMemo(
    () => (values.job && values.job !== NO_JOB ? jobs.find((j) => String(j.accountNumber) === values.job) || null : null),
    [values.job, jobs]
  );

  const setField = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
  }, []);

  const handleChange = (e) => setField(e.target.name, e.target.value);

  const handleSubmit = (e) => {
    e.preventDefault();
    const found = validateComplaint(values);
    setErrors(found);

    const firstInvalid = FIELD_ORDER.find((f) => found[f]);
    if (firstInvalid) {
      document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      return;
    }

    setCopied(false);
    setSummary(
      buildComplaintSummary({
        values,
        job: selectedJob,
        reportedBy: user?.name || null,
      })
    );
  };

  const handleReset = () => {
    setValues(newFormValues());
    setErrors({});
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
    } catch {
      // Clipboard API unavailable/denied — the text is in the box, selectable.
      setCopied(false);
    }
  };

  // Second layer behind the route guard / nav gating.
  if (!permissions.canSubmitComplaints) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Access Denied</h2>
        <p className="text-gray-600 dark:text-gray-400">Only installers can submit complaints.</p>
      </div>
    );
  }

  const inputClass = (name) =>
    `form-input w-full px-3 py-2.5 text-sm ${errors[name] ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''}`;
  const describedBy = (name, hasHint = false) =>
    errors[name] ? `${FIELD_IDS[name]}-error` : hasHint ? `${FIELD_IDS[name]}-hint` : undefined;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg shrink-0">
          <MessageSquareWarning className="w-6 h-6 text-brand-600 dark:text-brand-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">Complaint Form</h1>
          <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm">
            Report a problem that is blocking or delaying an installation
          </p>
        </div>
      </div>

      <div
        role="status"
        className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 sm:p-4 flex items-start gap-3"
      >
        <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 dark:text-amber-300">
          <span className="font-semibold">Not connected to the system yet.</span> The backend has no complaints
          service, so nothing entered here is saved or sent. When you finish the form you'll get a summary to copy and
          pass to your supervisor or administrator directly.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="card p-4 sm:p-6 space-y-5">
        {/* Installation / job */}
        <div className="space-y-3">
          <Field
            id={FIELD_IDS.job}
            label="Installation / job"
            required
            error={errors.job}
            hint="Jobs currently awaiting installation."
          >
            <select
              id={FIELD_IDS.job}
              name="job"
              value={values.job}
              onChange={handleChange}
              disabled={jobsLoading}
              aria-required="true"
              aria-invalid={!!errors.job}
              aria-describedby={describedBy('job', true)}
              className={inputClass('job')}
            >
              <option value="">{jobsLoading ? 'Loading installations…' : 'Select an installation…'}</option>
              <option value={NO_JOB}>Not related to a specific job</option>
              {jobs.map((j) => (
                <option key={j.id ?? j.accountNumber} value={String(j.accountNumber)}>
                  {(j.custNames || j.applicantName || 'Customer')} — Acct {j.accountNumber}
                </option>
              ))}
            </select>
          </Field>

          {jobsLoading && (
            <p className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your installation queue…
            </p>
          )}

          {jobsError && (
            <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-red-800 dark:text-red-300">{jobsError}</p>
                <button
                  type="button"
                  onClick={() => { jedApi.clearCache(); setRefreshKey((k) => k + 1); }}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:underline"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Try again
                </button>
              </div>
            </div>
          )}

          {!jobsLoading && !jobsError && jobs.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              There are no installations awaiting installation right now. You can still choose "Not related to a specific job".
            </p>
          )}

          {selectedJob && (
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 px-4 py-2 divide-y divide-gray-200 dark:divide-gray-700">
              <DetailRow label="Customer" value={selectedJob.custNames || selectedJob.applicantName} />
              <DetailRow label="Account" value={String(selectedJob.accountNumber)} />
              <DetailRow label="Address" value={selectedJob.address} />
              <DetailRow label="Region" value={selectedJob.region} />
              <DetailRow label="Installation status" value="Awaiting Installation" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id={FIELD_IDS.category} label="Complaint category" required error={errors.category}>
            <select
              id={FIELD_IDS.category}
              name="category"
              value={values.category}
              onChange={handleChange}
              aria-required="true"
              aria-invalid={!!errors.category}
              aria-describedby={describedBy('category')}
              className={inputClass('category')}
            >
              <option value="">Select a category…</option>
              {COMPLAINT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          <Field id={FIELD_IDS.impact} label="Impact on installation" required error={errors.impact}>
            <select
              id={FIELD_IDS.impact}
              name="impact"
              value={values.impact}
              onChange={handleChange}
              aria-required="true"
              aria-invalid={!!errors.impact}
              aria-describedby={describedBy('impact')}
              className={inputClass('impact')}
            >
              <option value="">Select impact…</option>
              {COMPLAINT_IMPACTS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </Field>
        </div>

        {/* Priority — radio group */}
        <fieldset aria-describedby={errors.priority ? 'complaint-priority-error' : undefined}>
          <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Priority<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
            <span className="sr-only"> (required)</span>
          </legend>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {COMPLAINT_PRIORITIES.map((p) => (
              <label key={p.value} className="relative cursor-pointer">
                <input
                  type="radio"
                  id={`complaint-priority-${p.value}`}
                  name="priority"
                  value={p.value}
                  checked={values.priority === p.value}
                  onChange={handleChange}
                  className="peer sr-only"
                />
                <span
                  className={`block text-center px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors
                    border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300
                    hover:bg-gray-50 dark:hover:bg-gray-600
                    peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 ${PRIORITY_STYLES[p.value]}
                    ${errors.priority ? 'border-red-400 dark:border-red-500' : ''}`}
                >
                  {p.label}
                </span>
              </label>
            ))}
          </div>
          {errors.priority && (
            <p id="complaint-priority-error" role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">
              {errors.priority}
            </p>
          )}
        </fieldset>

        <Field
          id={FIELD_IDS.issueAt}
          label="Date and time of the issue"
          required
          error={errors.issueAt}
        >
          <input
            id={FIELD_IDS.issueAt}
            type="datetime-local"
            name="issueAt"
            value={values.issueAt}
            max={toLocalDateTimeInputValue()}
            onChange={handleChange}
            aria-required="true"
            aria-invalid={!!errors.issueAt}
            aria-describedby={describedBy('issueAt')}
            className={inputClass('issueAt')}
          />
        </Field>

        <Field id={FIELD_IDS.description} label="Describe the issue" required error={errors.description}>
          <textarea
            id={FIELD_IDS.description}
            name="description"
            rows={5}
            maxLength={DESCRIPTION_MAX}
            value={values.description}
            onChange={handleChange}
            aria-required="true"
            aria-invalid={!!errors.description}
            aria-describedby={describedBy('description')}
            placeholder="What happened, where, and what is needed to move forward?"
            className={inputClass('description')}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right" aria-live="polite">
            {values.description.length}/{DESCRIPTION_MAX}
          </p>
        </Field>

        <Field id={FIELD_IDS.remarks} label="Additional remarks (optional)" error={errors.remarks}>
          <textarea
            id={FIELD_IDS.remarks}
            name="remarks"
            rows={2}
            maxLength={REMARKS_MAX}
            value={values.remarks}
            onChange={handleChange}
            aria-invalid={!!errors.remarks}
            aria-describedby={describedBy('remarks')}
            className={inputClass('remarks')}
          />
        </Field>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2">
          <button
            type="button"
            onClick={handleReset}
            className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Clear form
          </button>
          <button
            type="submit"
            className="w-full sm:w-auto px-5 py-2.5 text-sm font-semibold rounded-lg bg-brand-500 text-gray-900 hover:bg-brand-600 transition-colors"
          >
            Review &amp; copy details
          </button>
        </div>
      </form>

      <InfoModal
        isOpen={summary !== null}
        onClose={() => setSummary(null)}
        title="Complaint not sent"
      >
        <p className="mb-3">
          <span className="font-semibold text-gray-900 dark:text-white">Nothing was submitted or saved.</span> This
          system can't record complaints yet. Copy the details below and pass them to your supervisor or
          administrator directly. Your entries stay in the form.
        </p>
        <textarea
          readOnly
          value={summary || ''}
          rows={9}
          aria-label="Complaint summary"
          onFocus={(e) => e.target.select()}
          className="form-input w-full px-3 py-2 text-xs font-mono"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-green-600 dark:text-green-400" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy to clipboard'}
        </button>
      </InfoModal>
    </div>
  );
}

export default ComplaintForm;
