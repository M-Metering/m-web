// src/components/installations/MyJobs.jsx
// Installer-only view of the multi-disco installation flow: the jobs an admin
// dispatched to this installer, and the meters currently in their hands.
//
// Both lists come from GET /installations/me/*, which the API scopes to the
// caller's own JWT — there is no installer id to pass, and one installer can
// never see another's work. This is a real per-installer assignment, unlike
// the JED queue on /dashboard, which is shared by every installer and stays
// exactly as it was.
//
// Actions offered per job are driven by getAvailableActions(status): the API
// rejects an illegal transition with a 400 and has no force flag, so the UI
// only ever shows what the current status actually allows.
import { useState, useEffect, useCallback, useMemo, useDeferredValue } from 'react';
import {
  ClipboardList, Package, RefreshCw, Search, AlertCircle, MapPin,
  PlayCircle, CheckCircle, XCircle, Loader2, Inbox, ExternalLink,
  Filter, X, ChevronDown,
} from 'lucide-react';
import jedApi from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { usePermissions } from '../auth/usePermissions';
import StatusTabs from '../common/StatusTabs';
import StatusBadge from '../common/StatusBadge';
import ReportInstallationModal from './ReportInstallationModal';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';
import { formatPlainDate, formatDateTime } from '../../utils/date';
import {
  INSTALLATION_STATUS,
  getAvailableActions,
  installationStatusLabel,
  getCoordinates,
  isOpenJob,
  isInstalledStatus,
} from '../../utils/installationStatus';
import {
  INSTALLER_JOB_FILTERS, EMPTY_JOB_FILTERS,
  toFilterableJobs, applyJobFilters, buildJobFilterOptions, countActiveJobFilters,
} from '../../utils/installerJobFilters';
import { collectSealKeys } from '../../utils/sealNumber';
import { meterSummaryLine } from '../../utils/meterDisplay';
import {
  splitAssignedJobs, matchesInstallerSearch, assignedJobKey,
} from '../../utils/installerQueue';

// Jobs render a page at a time so a large round stays responsive on a phone.
const PAGE_SIZE = 25;

// "Awaiting installation" and "Completed" use the same definitions as the
// Installer Dashboard cards (summarizeInstallerJobs). Completed includes
// EXPORTED — previously an exported job appeared under no filter at all.
const byStatus = (s) => (j) => String(j.status).toUpperCase() === s;
const JOB_FILTERS = [
  { id: 'OPEN', label: 'Awaiting installation', match: (j) => isOpenJob(j.status) },
  { id: INSTALLATION_STATUS.ASSIGNED, label: 'Assigned', match: byStatus(INSTALLATION_STATUS.ASSIGNED) },
  { id: INSTALLATION_STATUS.IN_PROGRESS, label: 'In Progress', match: byStatus(INSTALLATION_STATUS.IN_PROGRESS) },
  { id: 'COMPLETED', label: 'Completed', match: (j) => isInstalledStatus(j.status) },
  { id: INSTALLATION_STATUS.FAILED, label: 'Failed', match: byStatus(INSTALLATION_STATUS.FAILED) },
];

// ---- Fail modal (reason is required by the API) ----
function FailJobModal({ job, isOpen, onClose, onConfirm, loading, error }) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => { if (isOpen) { setReason(''); setTouched(false); } }, [isOpen]);
  if (!isOpen || !job) return null;

  const invalid = !reason.trim();

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="fail-title"
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md">
        <div className="p-4 sm:p-6">
          <h2 id="fail-title" className="text-lg font-semibold text-gray-900 dark:text-white">Record a failed attempt</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {job.customerName} &middot; Acct {job.accountNumber}
          </p>

          {error && (
            <div role="alert" className="mt-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
            </div>
          )}

          <label htmlFor="fail-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mt-4 mb-1.5">
            Why could this not be installed?<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
          </label>
          <textarea
            id="fail-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={loading}
            aria-required="true"
            aria-invalid={touched && invalid}
            placeholder="e.g. Customer premises locked, no access after two visits"
            className={`form-input w-full px-3 py-2.5 text-sm ${touched && invalid ? 'border-red-400 dark:border-red-500' : ''}`}
          />
          {touched && invalid && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">A reason is required.</p>
          )}
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-3 sm:px-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
          <button type="button" onClick={onClose} disabled={loading}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { setTouched(true); if (!invalid) onConfirm(reason.trim()); }}
            disabled={loading || invalid}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Record failure
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-3 text-xs py-0.5">
      <span className="text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className="text-gray-700 dark:text-gray-300 text-right break-words min-w-0">{value}</span>
    </div>
  );
}

function JobCard({ job, onStart, onReport, onFail, busy }) {
  const actions = getAvailableActions(job.status);
  const coords = getCoordinates(job);

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
            {job.customerName || `Account ${job.accountNumber}`}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Acct {job.accountNumber}
            {job.meterType ? ` · ${job.meterType}` : ''}
            {job.discoCode ? ` · ${job.discoCode}` : ''}
          </p>
        </div>
        <StatusBadge
          status={job.status}
          label={installationStatusLabel(job.status)}
          className="shrink-0 text-[11px]"
        />
      </div>

      {job.customerAddress && (
        <p className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1.5">
          <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
          <span className="min-w-0">{job.customerAddress}</span>
        </p>
      )}

      <div className="pt-1">
        <DetailRow label="Area" value={[job.area, job.region].filter(Boolean).join(' · ') || null} />
        <DetailRow label="Feeder" value={job.feederName} />
        <DetailRow label="Transformer" value={job.transformerName || job.transformerCode} />
        <DetailRow label="Position" value={job.installationPosition} />
        <DetailRow label="Phone" value={job.customerPhone} />
      </div>

      {/* Once reported, show what was recorded rather than the action buttons */}
      {(job.meterNumber || job.installationDate || coords || job.discoSupervisor || job.installationPhotoUrl) && (
        <div className="rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 px-3 py-2 mt-2">
          <DetailRow label="Meter" value={job.meterNumber} />
          <DetailRow label="Seal" value={job.sealNumber} />
          <DetailRow label="Installed" value={job.installationDate ? formatPlainDate(job.installationDate) : null} />
          <DetailRow label="Supervisor" value={job.discoSupervisor} />
          {coords && (
            <div className="flex justify-between gap-3 text-xs py-0.5">
              <span className="text-gray-500 dark:text-gray-400 shrink-0">GPS</span>
              <a
                href={`https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-brand-700 dark:text-brand-400 hover:underline"
              >
                {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          {job.installationPhotoUrl && (
            <div className="flex justify-between gap-3 text-xs py-0.5">
              <span className="text-gray-500 dark:text-gray-400 shrink-0">Photo</span>
              <a href={job.installationPhotoUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 hover:underline truncate">
                View <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
          )}
          {job.failureReason && (
            <DetailRow label="Failure" value={job.failureReason} />
          )}
        </div>
      )}

      {(actions.start || actions.report || actions.fail) && (
        <div className="flex flex-wrap gap-2 pt-2">
          {actions.start && (
            <button
              type="button"
              onClick={() => onStart(job)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
              Start
            </button>
          )}
          {actions.report && (
            <button
              type="button"
              onClick={() => onReport(job)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-500 text-gray-900 hover:bg-brand-600 disabled:opacity-50"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Report installation
            </button>
          )}
          {actions.fail && (
            <button
              type="button"
              onClick={() => onFail(job)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              Can't install
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MyJobs() {
  const permissions = usePermissions();
  const { refreshSignal, notifyDataChanged } = useDataRefresh();

  const [activeTab, setActiveTab] = useState('jobs');
  const [filter, setFilter] = useState('OPEN');
  const [searchTerm, setSearchTerm] = useState('');
  const search = useDeferredValue(searchTerm);
  // Area / Meter Type / Feeder / Transformer. Applied client-side: the
  // /installations/me/jobs endpoint has no such query parameters, and the
  // whole (already installer-scoped) list is loaded here anyway.
  const [fieldFilters, setFieldFilters] = useState(EMPTY_JOB_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [refreshKey, setRefreshKey] = useState(0);

  const [jobs, setJobs] = useState([]);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [meters, setMeters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const [reportJob, setReportJob] = useState(null);
  const [failJob, setFailJob] = useState(null);
  const [failLoading, setFailLoading] = useState(false);
  const [failError, setFailError] = useState(null);

  const refreshAll = useCallback(() => {
    jedApi.clearCache();
    setRefreshKey((k) => k + 1);
  }, []);

  // Both lists are small, self-contained payloads, so they're fetched whole
  // rather than paged through in the UI.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [jobList, meterList] = await Promise.all([
          fetchAllPages((p) => jedApi.getMyJobs(p), {}),
          fetchAllPages((p) => jedApi.getMyMeters(p), {}),
        ]);
        if (!cancelled) {
          // Deduplicated at the source, by the job's own id, so every count
          // and list on this page — and the Dashboard card, which summarises
          // the same endpoint the same way — describes distinct jobs.
          const { all, duplicates } = splitAssignedJobs(jobList);
          setJobs(all);
          setDuplicateCount(duplicates);
          setMeters(meterList);
        }
      } catch (err) {
        console.error('[MyJobs] Failed to load:', err);
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load your jobs. Tap refresh to try again.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey, refreshSignal]);

  // Search and the field filters narrow the same list; the status pills then
  // pick a slice of what is left, so their counts always describe exactly what
  // the current search + filters can show.
  const filterable = useMemo(() => toFilterableJobs(jobs), [jobs]);

  const searchedAndFiltered = useMemo(() => {
    const byField = applyJobFilters(filterable, fieldFilters).map((r) => r.job);
    // The same search predicate the Installer Dashboard uses.
    return byField.filter((job) => matchesInstallerSearch(job, search));
  }, [filterable, fieldFilters, search]);

  const visibleJobs = useMemo(() => {
    const match = (JOB_FILTERS.find((f) => f.id === filter) || JOB_FILTERS[0]).match;
    return searchedAndFiltered.filter(match);
  }, [searchedAndFiltered, filter]);

  const filterCounts = useMemo(
    () => Object.fromEntries(JOB_FILTERS.map((f) => [f.id, searchedAndFiltered.filter(f.match).length])),
    [searchedAndFiltered]
  );
  // The tab badge counts everything awaiting installation, not just the
  // filtered slice — it is a workload indicator, not a result count.
  const openCount = useMemo(
    () => jobs.filter((j) => isOpenJob(j.status)).length,
    [jobs]
  );

  const filterOptions = useMemo(
    () => buildJobFilterOptions(filterable, fieldFilters),
    [filterable, fieldFilters]
  );
  const activeFilterCount = countActiveJobFilters(fieldFilters) + (search.trim() ? 1 : 0);
  const clearFilters = useCallback(() => {
    setFieldFilters(EMPTY_JOB_FILTERS);
    setSearchTerm('');
  }, []);

  // Never leave the page scrolled into records that a new filter removed.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filter, fieldFilters, search]);

  // Seals already recorded on this installer's own jobs — the duplicate the
  // client can actually see (see utils/sealNumber.js).
  const usedSealKeys = useMemo(() => collectSealKeys(jobs, reportJob?.id), [jobs, reportJob?.id]);
  const heldMeters = useMemo(
    () => meters.filter((m) => String(m.assignmentStatus || '').toUpperCase() !== 'USED'),
    [meters]
  );

  const runAction = async (job, fn, message) => {
    setBusyId(job.id);
    setActionError(null);
    setSuccessMessage(null);
    try {
      await fn();
      setSuccessMessage(message);
      notifyDataChanged();
      refreshAll();
    } catch (err) {
      console.error('[MyJobs] Action failed:', err);
      setActionError(getErrorMessage(err, 'That action could not be completed.'));
      // A 403 here means the job was reassigned out from under us — the list
      // is stale either way, so pull fresh data.
      refreshAll();
    } finally {
      setBusyId(null);
    }
  };

  const handleStart = (job) =>
    runAction(job, () => jedApi.startInstallation(job.id), 'Job marked as started.');

  const handleFailConfirm = async (reason) => {
    setFailLoading(true);
    setFailError(null);
    try {
      await jedApi.failInstallation(failJob.id, reason);
      setFailJob(null);
      setSuccessMessage('Failed attempt recorded.');
      notifyDataChanged();
      refreshAll();
    } catch (err) {
      console.error('[MyJobs] Fail failed:', err);
      setFailError(getErrorMessage(err, 'Could not record this failure.'));
    } finally {
      setFailLoading(false);
    }
  };

  const handleReported = () => {
    setReportJob(null);
    setSuccessMessage('Installation reported. The meter is now marked as used.');
    notifyDataChanged();
    refreshAll();
  };

  // Second layer behind the route guard and the nav gate.
  if (!permissions.canViewMyJobs) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Access Denied</h2>
        <p className="text-gray-600 dark:text-gray-400">Only installers have dispatched jobs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg shrink-0">
            <ClipboardList className="w-6 h-6 text-brand-600 dark:text-brand-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">My Jobs</h1>
            <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm truncate">
              Installations dispatched to you, and the meters you are carrying
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          disabled={loading}
          aria-label="Refresh"
          className="p-2.5 sm:px-4 sm:py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 disabled:bg-brand-400 shrink-0 flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline text-sm font-medium">Refresh</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 sm:p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}
      {actionError && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-300">{actionError}</p>
        </div>
      )}
      {successMessage && (
        <div role="status" className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          <p className="text-sm text-green-800 dark:text-green-300">{successMessage}</p>
        </div>
      )}
      {/* Said out loud rather than silently swallowed — a server returning the
          same job twice is worth knowing about. */}
      {duplicateCount > 0 && (
        <div role="status" className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {duplicateCount} repeated record{duplicateCount === 1 ? '' : 's'} from the server
            {duplicateCount === 1 ? ' was' : ' were'} shown once.
          </p>
        </div>
      )}

      <div className="card overflow-hidden">
        <StatusTabs
          tabs={[
            { id: 'jobs', label: 'Jobs', icon: ClipboardList, count: openCount },
            { id: 'meters', label: 'My Meters', icon: Package, count: heldMeters.length },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        {activeTab === 'jobs' ? (
          <>
            <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by account, customer, address or meter..."
                    aria-label="Search jobs"
                    className="form-input w-full pl-9 pr-3 py-2 text-sm"
                  />
                </div>
                {/* Collapsed by default on a phone so the job list stays on
                    screen; always expanded from sm up. */}
                <button
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-expanded={filtersOpen}
                  aria-controls="job-filter-panel"
                  className="sm:hidden inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  <Filter className="w-4 h-4" />
                  Filter jobs
                  {activeFilterCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-brand-500 text-gray-900 text-[11px] font-semibold">
                      {activeFilterCount}
                    </span>
                  )}
                  <ChevronDown className={`w-4 h-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              <fieldset
                id="job-filter-panel"
                className={`${filtersOpen ? 'block' : 'hidden'} sm:block`}
              >
                <legend className="sr-only">Filter jobs</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
                  {INSTALLER_JOB_FILTERS.map(({ field, label }) => {
                    const options = filterOptions[field];
                    const id = `mj-filter-${field}`;
                    return (
                      <div key={field}>
                        <label htmlFor={id} className="block text-xs text-gray-600 dark:text-gray-400 mb-1">{label}</label>
                        <select
                          id={id}
                          value={fieldFilters[field]}
                          onChange={(e) => setFieldFilters((prev) => ({ ...prev, [field]: e.target.value }))}
                          disabled={options.length === 0}
                          className="form-input w-full px-3 py-2 text-sm"
                        >
                          <option value="">{options.length === 0 ? 'No data recorded' : `Any ${label.toLowerCase()}`}</option>
                          {options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label} ({o.count})</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
                {activeFilterCount > 0 && (
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
                      {visibleJobs.length.toLocaleString()} of {jobs.length.toLocaleString()} job{jobs.length === 1 ? '' : 's'} shown
                    </p>
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      <X className="w-3.5 h-3.5" /> Clear filters
                    </button>
                  </div>
                )}
              </fieldset>

              <div className="flex flex-wrap gap-2">
                {JOB_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    aria-pressed={filter === f.id}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      filter === f.id
                        ? 'bg-brand-500 text-gray-900'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {f.label} ({filterCounts[f.id]})
                  </button>
                ))}
              </div>
            </div>

            {loading && jobs.length === 0 ? (
              <div className="py-16 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
              </div>
            ) : visibleJobs.length === 0 ? (
              <div className="py-16 text-center px-4">
                <Inbox className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-600 dark:text-gray-400 font-medium">
                  {jobs.length === 0
                    ? 'No jobs have been dispatched to you yet'
                    : 'No jobs match these filters'}
                </p>
                {jobs.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    An administrator assigns jobs to you; they appear here straight away.
                  </p>
                ) : activeFilterCount > 0 && (
                  <button type="button" onClick={clearFilters}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
                    <X className="w-3.5 h-3.5" /> Clear filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {visibleJobs.slice(0, visibleCount).map((job) => (
                    <JobCard
                      key={assignedJobKey(job)}
                      job={job}
                      busy={busyId === job.id}
                      onStart={handleStart}
                      onReport={setReportJob}
                      onFail={(j) => { setFailError(null); setFailJob(j); }}
                    />
                  ))}
                </div>
                {visibleJobs.length > visibleCount && (
                  <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-center gap-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Showing {visibleCount.toLocaleString()} of {visibleJobs.length.toLocaleString()}
                    </p>
                    <button type="button" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
                      Show {Math.min(PAGE_SIZE, visibleJobs.length - visibleCount)} more
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {loading && meters.length === 0 ? (
              <div className="py-16 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
              </div>
            ) : meters.length === 0 ? (
              <div className="py-16 text-center px-4">
                <Package className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-600 dark:text-gray-400 font-medium">No meters are assigned to you</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  An administrator dispatches meters to you before you can report an installation.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {meters.map((m) => (
                  <div key={m.id ?? m.meterNumber} className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-medium text-gray-900 dark:text-white truncate">
                        {m.meterNumber}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {meterSummaryLine(m) || 'No details recorded'}
                      </p>
                      {m.assignedAt && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          Received {formatDateTime(m.assignedAt)}
                        </p>
                      )}
                    </div>
                    <StatusBadge
                      status={m.assignmentStatus}
                      label={String(m.assignmentStatus || '').replace(/_/g, ' ') || 'Unknown'}
                      className="shrink-0 text-[11px]"
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <ReportInstallationModal
        job={reportJob}
        isOpen={!!reportJob}
        onClose={() => setReportJob(null)}
        onReported={handleReported}
        usedSealKeys={usedSealKeys}
      />

      <FailJobModal
        job={failJob}
        isOpen={!!failJob}
        onClose={() => setFailJob(null)}
        onConfirm={handleFailConfirm}
        loading={failLoading}
        error={failError}
      />
    </div>
  );
}

export default MyJobs;
