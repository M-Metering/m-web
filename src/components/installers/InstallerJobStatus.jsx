// src/components/installers/InstallerJobStatus.jsx
// Installer Job Status (2026-09-27): every installer's workload and progress
// — jobs by status, meters in hand, meters still needed, completion rate —
// and a drill-down into one installer's jobs.
//
// WHO SEES IT: Admin, Super Admin and Supervisor (INSTALLERS.VIEW_STATUS).
// There is no money on this page at all, so no financial permission is
// involved; an Installer is denied (its own view is My Jobs).
//
// WHERE THE NUMBERS COME FROM — all live API reads, nothing cached beyond
// jedApi's 30-second cache, re-read on the app's refreshSignal:
//   installers  GET /users?role=INSTALLER (server-side role filter)
//   jobs        GET /installations?status=… for the five statuses that carry
//               an installer (ASSIGNED, IN_PROGRESS, INSTALLED, EXPORTED,
//               FAILED). PENDING and CANCELLED — the bulk of the table, and
//               never anyone's workload — are never downloaded.
//   meters      the open dispatch batches (hooks/useMeterHolders.js), the
//               same source the Assignments capacity check uses.
// The API has no per-installer aggregate (API_GAP_REPORT.md, gap AG), so the
// counts are built from those filtered reads by utils/installerStats.js. The
// drill-down filters the installer's already-loaded jobs in memory, so it
// costs no further request.
//
// DRILL-DOWN (2026-10-04): two lists for one installer.
//   Jobs    every job assigned to them; each opens its installation record.
//   Meters  every meter assigned to them (installerMeterList): those still in
//           their hands (open dispatch batches) and those installed on one of
//           their jobs. An installed meter opens the record of the customer it
//           was installed for. Both use the SAME record panel as Meter
//           Schedule → Installed (InstallationRecord, fed by
//           installationDetailsOf — the export's own field definitions), so a
//           meter, a job and the workbook can't disagree about a field. The
//           customer's phone is shown to the admin tier only, as everywhere.
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  HardHat, RefreshCw, AlertCircle, Loader2, Search, ArrowLeft, ChevronRight, Inbox, Filter, Gauge, Undo2,
} from 'lucide-react';
import InfoModal from '../common/InfoModal';
import RevertInstallationModal from '../installations/RevertInstallationModal';
import { revertTargetOf } from '../../utils/installationRevert';
import UnassignMeterAction from '../installations/UnassignMeterAction';
import { unassignActionFor } from '../../utils/meterUnassign';
import { InstallationRecord } from '../schedule/MeterDrillDown';
import { installationDetailsOf } from '../../utils/completedInstallationsReport';
import { normalizeMultiRow } from '../../utils/installationScope';
import jedApi from '../services/api';
import { usePermissions } from '../auth/usePermissions';
import { ROLES } from '../auth/permissions';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import StatusBadge from '../common/StatusBadge';
import { useMeterHolders } from '../../hooks/useMeterHolders';
import { useInstallationTotals } from '../../hooks/useDashboardInstallations';
import { fetchAllPages, fetchAllPagesDetailed } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';
import { formatDateTime, formatPlainDate } from '../../utils/date';
import { formatPhaseLabel } from '../../utils/installationScope';
import { installationStatusLabel, METER_PHASE_TYPES } from '../../utils/installationStatus';
import {
  INSTALLER_JOB_STATUSES, JOB_STATUS_FILTERS, summarizeInstallerStats, totalInstallerStats,
  filterInstallerJobs, formatCompletionRate, installerMeterList, openJobsForMeter,
} from '../../utils/installerStats';

// 10,000 jobs per status. Past that the page says the figures are incomplete.
const MAX_PAGES = 100;
const JOB_PAGE_SIZE = 25;

const EMPTY_FILTERS = { status: '', meterType: '', dateBasis: 'assigned', from: '', to: '', account: '', meterNumber: '' };

const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'awaiting', label: 'Most awaiting' },
  { value: 'completed', label: 'Most completed' },
  { value: 'rate', label: 'Completion rate' },
];

const sortRows = (rows, key) => {
  const list = [...rows];
  if (key === 'awaiting') list.sort((a, b) => b.awaiting - a.awaiting || a.name.localeCompare(b.name));
  else if (key === 'completed') list.sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
  else if (key === 'rate') list.sort((a, b) => (b.completionRate ?? -1) - (a.completionRate ?? -1) || a.name.localeCompare(b.name));
  return list;
};

// Figures are text-gray-900 in the light theme and text-white in the dark one.
// `.card` sets only a background per theme, so any figure without its own
// pair of colours inherits the browser's black — unreadable on dark cards,
// which is what the table cells below used to do.
function Tile({ label, value, hint, loading = false, error = false }) {
  return (
    <div className="card p-3 sm:p-4 min-w-0">
      <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white leading-tight break-words">
        {loading ? <span className="inline-block h-6 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse align-middle" aria-label={`Loading ${label}`} />
          : error ? <span className="text-base text-red-700 dark:text-red-300">Unavailable</span> : value}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

const metersText = (row) => (row.meters === null ? '—' : row.meters.toLocaleString());
const needText = (row) => {
  if (!row.capacity) return '—';
  if (row.capacity.remaining > 0) return `${row.capacity.remaining} needed`;
  if (row.capacity.surplus > 0) return `${row.capacity.surplus} spare`;
  return 'Covered';
};

// One installation's record, from the job itself — no further request. A
// Super Admin can unassign an installed meter from here (the confirmation
// replaces this dialog, so only one is open at a time).
function JobRecordModal({ job, onClose, showPhone, showPayment, canRevert, onRevert }) {
  const row = useMemo(() => (job ? normalizeMultiRow(job) : null), [job]);
  const record = useMemo(() => (row ? installationDetailsOf(row) : null), [row]);
  const target = canRevert && row ? revertTargetOf(row) : null;
  return (
    <InfoModal isOpen={!!job} onClose={onClose}
      title={job ? `${job.customerName || 'Customer'} · Acct ${job.accountNumber}` : ''}>
      {job && (
        <div className="space-y-3 text-left">
          <InstallationRecord record={record} loading={false} error={null} complete showPhone={showPhone} showPayment={showPayment} />
          {target && (
            <button type="button" onClick={() => onRevert(target)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40">
              <Undo2 className="w-3.5 h-3.5" /> Unassign installed meter
            </button>
          )}
        </div>
      )}
    </InfoModal>
  );
}

// A meter still in the installer's hands. The API pairs a meter with a job
// only when the installer reports the installation, so this shows the open
// jobs of its type the meter is for — each opens its record.
function HeldMeterModal({ meter, row, onClose, onOpenJob }) {
  const jobs = useMemo(() => (meter ? openJobsForMeter(row, meter) : []), [meter, row]);
  const type = meter?.phaseType ? formatPhaseLabel(meter.phaseType) : null;
  return (
    <InfoModal isOpen={!!meter} onClose={onClose} title={meter ? `Meter ${meter.meterNumber}` : ''}>
      {meter && (
        <div className="space-y-3 text-left">
          <dl className="grid grid-cols-1 gap-1 text-xs">
            {[
              ['Status', 'Assigned (with the installer, not yet installed)'],
              ['Meter type', type || 'Not recorded'],
              ['Installer', row.name],
              ['Assigned', meter.assignedAt ? formatDateTime(meter.assignedAt) : 'Not recorded'],
              ['Batch', meter.batchRef || 'Not recorded'],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-2 min-w-0">
                <dt className="text-gray-500 dark:text-gray-400 shrink-0 w-24">{label}</dt>
                <dd className="text-gray-900 dark:text-white min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Meters and jobs are dispatched separately, so this meter belongs to a customer only once {row.name} reports
            an installation with it. Until then it is for one of their open{type ? ` ${type}` : ''} jobs:
          </p>
          {jobs.length === 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">No open job{type ? ` of this meter type` : ''} is assigned to {row.name}.</p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg max-h-60 overflow-y-auto"
              aria-label={`Open jobs for meter ${meter.meterNumber}`}>
              {jobs.map((job) => (
                <li key={job.id}>
                  <button type="button" onClick={() => onOpenJob(job)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-gray-900 dark:text-white truncate">{job.customerName || 'Customer'} · Acct <span className="font-mono">{job.accountNumber}</span></span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {[installationStatusLabel(job.status), job.meterType && formatPhaseLabel(job.meterType),
                          job.assignedAt && `Assigned ${formatDateTime(job.assignedAt)}`, job.area || job.customerAddress]
                          .filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </InfoModal>
  );
}

const TAB_CLASS = (active) => `px-3 py-2 text-sm font-medium border-b-2 -mb-px ${active
  ? 'border-brand-500 text-gray-900 dark:text-white'
  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`;

// The same "Unassign" as Meter Schedule and Assignments (utils/meterUnassign.js):
// a meter in hand goes back to stock (the installer's jobs are untouched, so
// only "Meters held" drops); an installed one is a Super Admin revert.
const meterUnassignAction = (m, row, { canReturn, canRevert }) => unassignActionFor({
  meter: { meterNumber: m.meterNumber, phaseType: m.phaseType, status: m.state === 'INSTALLED' ? 'INSTALLED' : '' },
  holder: m.state === 'HELD'
    ? { installerId: row.installerId, installerName: row.name, assignedAt: m.assignedAt, batchRef: m.batchRef, phaseType: m.phaseType }
    : null,
  installationRow: m.job ? normalizeMultiRow(m.job) : null,
  canReturn, canRevert,
});

function InstallerMeters({ row, onOpenJob, onOpenMeter, canReturn = false, canRevert = false }) {
  const meters = useMemo(() => installerMeterList(row), [row]);
  const heldKnown = row.meters !== null;
  const held = meters.filter((m) => m.state === 'HELD').length;
  const installed = meters.length - held;
  return (
    <div>
      <p className="px-3 sm:px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
        {heldKnown ? `${held.toLocaleString()} assigned, not yet installed · ` : ''}{installed.toLocaleString()} installed
        {!heldKnown && ' · meters in hand could not be read, so only installed meters are listed'}
      </p>
      {meters.length === 0 ? (
        <div className="py-12 text-center px-4">
          <Gauge className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-600 dark:text-gray-400">No meters assigned to this installer.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700" aria-label={`Meters for ${row.name}`}>
          {meters.map((m) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-mono text-gray-900 dark:text-white break-all">{m.meterNumber}</p>
                  <span className={`shrink-0 inline-flex px-2 py-0.5 text-[11px] font-semibold rounded-full ${m.state === 'INSTALLED'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'}`}>
                    {m.state === 'INSTALLED' ? 'Installed' : 'Assigned'}
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                  {m.phaseType ? formatPhaseLabel(m.phaseType) : 'Meter type not recorded'}
                  {m.state === 'HELD' && m.assignedAt ? ` · Assigned ${formatDateTime(m.assignedAt)}` : ''}
                  {m.state === 'HELD' && m.batchRef ? ` · Batch ${m.batchRef}` : ''}
                  {m.state === 'INSTALLED' && m.installedOn ? ` · Installed ${formatPlainDate(m.installedOn)}` : ''}
                </p>
                {m.job && (
                  <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5 truncate">
                    {m.job.customerName || 'Customer'} · Acct <span className="font-mono">{m.job.accountNumber}</span>
                  </p>
                )}
              </>
            );
            return (
              <li key={m.meterNumber} className="flex items-center">
                <button type="button" onClick={() => (m.job ? onOpenJob(m.job) : onOpenMeter(m))}
                  aria-label={m.job
                    ? `Meter ${m.meterNumber}: view the installation and customer`
                    : `Meter ${m.meterNumber}: view the jobs it is assigned for`}
                  className="min-w-0 flex-1 text-left p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2">
                  <div className="min-w-0 flex-1">{body}</div>
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                </button>
                <UnassignMeterAction action={meterUnassignAction(m, row, { canReturn, canRevert })} className="mr-3 sm:mr-4" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function InstallerDetail({ row, onBack, showPhone, showPayment, canRevert, canReturn }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [visible, setVisible] = useState(JOB_PAGE_SIZE);
  const [tab, setTab] = useState('jobs');
  const [openJob, setOpenJob] = useState(null);
  const [openMeter, setOpenMeter] = useState(null);
  const [revertTarget, setRevertTarget] = useState(null);
  const meterCount = useMemo(() => installerMeterList(row).length, [row]);
  const set = (key) => (e) => { setFilters((f) => ({ ...f, [key]: e.target.value })); setVisible(JOB_PAGE_SIZE); };

  const filtered = useMemo(() => {
    const list = filterInstallerJobs(row.jobs, filters);
    // Most recently assigned first.
    return [...list].sort((a, b) => String(b.assignedAt || '').localeCompare(String(a.assignedAt || '')));
  }, [row.jobs, filters]);
  const active = Object.entries(filters).some(([k, v]) => k !== 'dateBasis' && v);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-400 hover:underline">
        <ArrowLeft className="w-4 h-4" /> All installers
      </button>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{row.name}</h2>
        {!row.inRoster && (
          <p className="text-xs text-amber-700 dark:text-amber-400">Not on the current installer roster (the account may have been deactivated).</p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <Tile label="Total assigned" value={row.total} />
        <Tile label="Awaiting installation" value={row.awaiting} hint={`${row.inProgress} in progress`} />
        <Tile label="Completed" value={row.completed} />
        <Tile label="Failed attempts" value={row.failed} />
        <Tile label="Meters held" value={metersText(row)}
          hint={row.metersByPhase ? Object.entries(row.metersByPhase).map(([k, n]) => `${n} ${formatPhaseLabel(k)}`).join(' · ') || null : null} />
        <Tile label="Completion rate" value={formatCompletionRate(row.completionRate)} />
      </div>

      <div className="card overflow-hidden">
        <div role="tablist" aria-label="Installer details" className="flex gap-2 px-3 sm:px-4 border-b border-gray-200 dark:border-gray-700">
          <button type="button" role="tab" aria-selected={tab === 'jobs'} onClick={() => setTab('jobs')} className={TAB_CLASS(tab === 'jobs')}>
            Jobs ({row.jobs.length.toLocaleString()})
          </button>
          <button type="button" role="tab" aria-selected={tab === 'meters'} onClick={() => setTab('meters')} className={TAB_CLASS(tab === 'meters')}>
            Meters ({meterCount.toLocaleString()})
          </button>
        </div>
        {tab === 'meters' ? <InstallerMeters row={row} onOpenJob={setOpenJob} onOpenMeter={setOpenMeter} canReturn={canReturn} canRevert={canRevert} /> : (
        <>
        <fieldset className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <legend className="sr-only">Filter jobs</legend>
          <select value={filters.status} onChange={set('status')} aria-label="Filter by status" className="form-input px-3 py-2 text-sm">
            {JOB_STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={filters.meterType} onChange={set('meterType')} aria-label="Filter by meter type" className="form-input px-3 py-2 text-sm">
            <option value="">All meter types</option>
            {METER_PHASE_TYPES.map((p) => <option key={p} value={p}>{formatPhaseLabel(p)}</option>)}
          </select>
          <input type="search" inputMode="numeric" value={filters.account} onChange={set('account')}
            placeholder="Account number" aria-label="Filter by account number" className="form-input px-3 py-2 text-sm font-mono" />
          <input type="search" inputMode="numeric" value={filters.meterNumber} onChange={set('meterNumber')}
            placeholder="Meter number" aria-label="Filter by meter number" className="form-input px-3 py-2 text-sm font-mono" />
          <select value={filters.dateBasis} onChange={set('dateBasis')} aria-label="Date range applies to" className="form-input px-3 py-2 text-sm">
            <option value="assigned">Date assigned</option>
            <option value="installed">Date installed</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            From <input type="date" value={filters.from} onChange={set('from')} aria-label="From date" className="form-input px-2 py-1.5 text-sm flex-1" />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            To <input type="date" value={filters.to} onChange={set('to')} aria-label="To date" className="form-input px-2 py-1.5 text-sm flex-1" />
          </label>
          {active && (
            <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setVisible(JOB_PAGE_SIZE); }}
              className="text-sm font-medium text-brand-700 dark:text-brand-400 hover:underline justify-self-start">
              Clear filters
            </button>
          )}
        </fieldset>

        <p className="px-3 sm:px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
          {filtered.length.toLocaleString()} of {row.jobs.length.toLocaleString()} job{row.jobs.length === 1 ? '' : 's'}
        </p>

        {filtered.length === 0 ? (
          <div className="py-12 text-center px-4">
            <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {row.jobs.length === 0 ? 'No jobs assigned to this installer.' : 'No jobs match these filters.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700" aria-label={`Jobs for ${row.name}`}>
            {filtered.slice(0, visible).map((job) => (
              <li key={job.id}>
                <button type="button" onClick={() => setOpenJob(job)}
                  aria-label={`Account ${job.accountNumber}: view job details`}
                  className="w-full text-left p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {job.customerName || `Account ${job.accountNumber}`}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Acct <span className="font-mono">{job.accountNumber}</span>
                      {job.meterType ? ` · ${formatPhaseLabel(job.meterType)}` : ''}
                      {job.discoCode ? ` · ${job.discoCode}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={job.status} label={installationStatusLabel(job.status)} className="shrink-0 text-[11px]" />
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                  {job.meterNumber && <p>Meter <span className="font-mono">{job.meterNumber}</span></p>}
                  <p>
                    {job.assignedAt ? `Assigned ${formatDateTime(job.assignedAt)}` : 'Assignment date not recorded'}
                    {job.installationDate ? ` · Installed ${formatPlainDate(job.installationDate)}` : ''}
                  </p>
                  {(job.feederName || job.area || job.customerAddress) && (
                    <p className="truncate">{[job.area, job.feederName && `Feeder ${job.feederName}`, job.customerAddress].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {filtered.length > visible && (
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-center">
            <button type="button" onClick={() => setVisible((v) => v + JOB_PAGE_SIZE)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
              Show {Math.min(JOB_PAGE_SIZE, filtered.length - visible)} more
            </button>
          </div>
        )}
        </>
        )}
      </div>

      <HeldMeterModal meter={openMeter} row={row} onClose={() => setOpenMeter(null)}
        onOpenJob={(job) => { setOpenMeter(null); setOpenJob(job); }} />
      <JobRecordModal job={openJob} onClose={() => setOpenJob(null)} showPhone={showPhone} showPayment={showPayment}
        canRevert={canRevert} onRevert={(target) => { setOpenJob(null); setRevertTarget(target); }} />
      {/* Saving bumps the refresh signal; this page re-reads and the row updates. */}
      <RevertInstallationModal target={revertTarget} onClose={() => setRevertTarget(null)} />
    </div>
  );
}

function InstallerJobStatus() {
  const permissions = usePermissions();
  const allowed = permissions.canViewInstallerStatus === true;
  const { refreshSignal } = useDataRefresh();
  const [state, setState] = useState({ installers: [], jobs: [], truncated: false });
  const [loading, setLoading] = useState(allowed);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [selectedId, setSelectedId] = useState(null);

  // The system-wide Pending (= Awaiting) figure, from the SAME hook as the
  // Dashboard — shown only to reconcile the installers' column with it.
  const systemTotals = useInstallationTotals({ enabled: allowed });
  const { holders, loading: holdersLoading, error: holdersError, reload: reloadHolders } =
    useMeterHolders({ enabled: allowed && permissions.canViewAssignments === true });

  useEffect(() => {
    if (!allowed) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [installers, ...byStatus] = await Promise.all([
          fetchAllPages((p) => jedApi.getUsers(p), { role: ROLES.INSTALLER }),
          ...INSTALLER_JOB_STATUSES.map((status) => fetchAllPagesDetailed(
            (p) => jedApi.getInstallations(p), { status }, { maxPages: MAX_PAGES }
          )),
        ]);
        if (cancelled) return;
        setState({
          installers,
          jobs: byStatus.flatMap((r) => r.items),
          truncated: byStatus.some((r) => r.truncated),
        });
      } catch (err) {
        console.error('[InstallerJobStatus] Load failed:', err);
        if (!cancelled) setError(getErrorMessage(err, "Couldn't load installer job status."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed, reloadKey, refreshSignal]);

  const refresh = useCallback(() => {
    jedApi.clearCache();
    setReloadKey((k) => k + 1);
    reloadHolders();
    systemTotals.reload();
  }, [reloadHolders, systemTotals]);

  const { rows, unattributed } = useMemo(
    () => summarizeInstallerStats({ installers: state.installers, jobs: state.jobs, holders }),
    [state.installers, state.jobs, holders]
  );
  const totals = useMemo(() => totalInstallerStats(rows), [rows]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortRows(needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows, sortKey);
  }, [rows, query, sortKey]);
  const selected = selectedId ? rows.find((r) => r.installerId === selectedId) : null;

  if (!allowed) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Access Denied</h2>
        <p className="text-gray-600 dark:text-gray-400">You don&apos;t have permission to view installer job status.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg shrink-0">
            <HardHat className="w-6 h-6 text-brand-600 dark:text-brand-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">Installer Job Status</h1>
            <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm">Each installer&apos;s jobs, meters in hand and completion rate</p>
          </div>
        </div>
        <button type="button" onClick={refresh} disabled={loading} aria-label="Refresh"
          className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 shrink-0">
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div role="alert" className="card p-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
            <button type="button" onClick={refresh} className="mt-1 text-xs font-medium text-red-700 dark:text-red-300 hover:underline">Try again</button>
          </div>
        </div>
      )}

      {(state.truncated || holdersError || unattributed > 0) && !loading && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
          {state.truncated && <p>Not every job could be loaded, so some counts are low. Narrow the data at source or contact support.</p>}
          {holdersError && <p>Meter figures are unavailable: {holdersError}</p>}
          {unattributed > 0 && <p>{unattributed} assigned job{unattributed === 1 ? '' : 's'} came back without an installer and {unattributed === 1 ? 'is' : 'are'} not counted.</p>}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="py-16 flex items-center justify-center" role="status">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
          <span className="sr-only">Loading installer job status</span>
        </div>
      ) : selected ? (
        <InstallerDetail row={selected} onBack={() => setSelectedId(null)} showPhone={permissions.isAdmin === true}
          showPayment={permissions.canViewPayments === true} canRevert={permissions.canRevertInstallations === true}
          canReturn={permissions.canManageAssignments === true} />
      ) : !error && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
            <Tile label="Installers" value={rows.length} />
            {/* Operational figures only — no money on this page. Summed from
                the installer rows below, so a tile equals the sum of its
                column; "Awaiting" is the system's Pending rule applied to each
                installer's jobs (isPendingInstallation). */}
            <Tile label="Awaiting installation" value={totals.awaiting} hint={`${totals.inProgress} in progress · ${totals.failed} after a failed attempt`} />
            <Tile label="Completed" value={totals.completed} />
            <Tile label="Failed attempts" value={totals.failed} />
            <Tile label="Meters with installers" value={totals.meters === null ? (holdersLoading ? '…' : '—') : totals.meters} />
            <Tile label="Overall completion" value={formatCompletionRate(totals.completionRate)} />
          </div>

          {/* Reconciles this page with the Dashboard / Installations / Reports
              figure: the installers' Awaiting column plus the pending
              installations nobody holds yet. */}
          <p className="text-xs text-gray-600 dark:text-gray-300" role="status">
            {systemTotals.loading ? 'Checking the system-wide pending total…'
              : systemTotals.error || !systemTotals.totals ? 'Unable to load the system-wide pending total.'
                : `System-wide pending installations: ${systemTotals.totals.pending.toLocaleString()} (same as the Dashboard) — ${totals.awaiting.toLocaleString()} with installers above, ${Math.max(systemTotals.totals.pending - totals.awaiting, 0).toLocaleString()} not yet held by an installer (unassigned or paid JED).`}
          </p>

          <div className="card overflow-hidden">
            <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find an installer" aria-label="Find an installer"
                  className="form-input w-full pl-9 pr-3 py-2 text-sm" />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <Filter className="w-3.5 h-3.5" /> Sort
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} aria-label="Sort installers"
                  className="form-input px-3 py-2 text-sm">
                  {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
            </div>

            {shown.length === 0 ? (
              <div className="py-12 text-center px-4">
                <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {rows.length === 0 ? 'No installers are registered yet.' : 'No installer matches that name.'}
                </p>
              </div>
            ) : (
              <>
                {/* Table at md+, cards below — no sideways scrolling on a phone. */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900/50">
                      <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        <th className="px-4 py-3">Installer</th>
                        <th className="px-4 py-3 text-right">Assigned</th>
                        <th className="px-4 py-3 text-right">Awaiting</th>
                        <th className="px-4 py-3 text-right">In progress</th>
                        <th className="px-4 py-3 text-right">Completed</th>
                        <th className="px-4 py-3 text-right">Failed</th>
                        <th className="px-4 py-3 text-right">Meters held</th>
                        <th className="px-4 py-3 text-right">Meter need</th>
                        <th className="px-4 py-3 text-right">Completion</th>
                        <th className="px-4 py-3"><span className="sr-only">Open</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-gray-900 dark:text-white">
                      {shown.map((r) => (
                        <tr key={r.installerId} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                          <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">
                            {r.name}
                            {!r.inRoster && <span className="block text-[11px] font-normal text-amber-700 dark:text-amber-400">Not on roster</span>}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.total}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.awaiting}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.inProgress}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.completed}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.failed}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{metersText(r)}</td>
                          <td className="px-4 py-3 text-right text-xs text-gray-600 dark:text-gray-400">{needText(r)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCompletionRate(r.completionRate)}</td>
                          <td className="px-4 py-3 text-right">
                            <button type="button" onClick={() => setSelectedId(r.installerId)}
                              aria-label={`View jobs for ${r.name}`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline">
                              Jobs <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="md:hidden divide-y divide-gray-200 dark:divide-gray-700">
                  {shown.map((r) => (
                    <li key={r.installerId}>
                      <button type="button" onClick={() => setSelectedId(r.installerId)}
                        aria-label={`View jobs for ${r.name}`}
                        className="w-full text-left p-4 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{r.name}</p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            {r.total} assigned · {r.awaiting} awaiting · {r.completed} completed
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Meters {metersText(r)} ({needText(r)}) · {formatCompletionRate(r.completionRate)} complete
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Awaiting = the installer&apos;s pending installations: assigned, in progress, or failed while still theirs.
            Assigned = awaiting + completed. Completion = completed ÷ assigned. Meter need compares open jobs with meters in
            hand, across all discos.
          </p>
        </>
      )}
    </div>
  );
}

export default InstallerJobStatus;
