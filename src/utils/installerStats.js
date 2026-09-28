// src/utils/installerStats.js
// Installer Job Status: each installer's workload and progress, from the
// app's existing status vocabulary — nothing here invents a status.
//
// Per installer:
//   assigned     ASSIGNED        (dispatched, not started)
//   inProgress   IN_PROGRESS     (started)
//   awaiting     this installer's share of the system-wide Pending (=
//                Awaiting) Installations: their jobs that satisfy the ONE
//                shared rule isPendingInstallation — ASSIGNED, IN_PROGRESS,
//                or FAILED while still attributed to them (2026-09-28).
//                Pending installations nobody holds yet (unassigned, paid
//                JED) are the rest of the Dashboard's figure; the page says
//                how many.
//   completed    INSTALLED + EXPORTED (isCompletedInstallation)
//   failed       FAILED — shown on its own too; it is part of awaiting
//   total        awaiting + completed — every job this installer holds or did
//   completionRate  completed / total, or null when total is 0 ("no jobs"
//                is not 0%)
//   meters       meters in their hands now (open dispatch batches — see
//                hooks/useMeterHolders.js), per meter type
//   capacity     computeMeterCapacity over their open jobs and held meters:
//                meters still needed, or held beyond their open jobs.
//
// Jobs are keyed by the InstallationRequest's own id (assignedJobKey), so a
// record the server repeats across pages is counted once.
import { INSTALLATION_STATUS, isOpenJob } from './installationStatus';
import { isPendingInstallation, isCompletedInstallation } from './installationTotals';
import { normalizeStatus } from './statusBadge';
import { normalizePhase, localDateOf } from './installationScope';
import { dedupeByKey, assignedJobKey } from './installerQueue';
import { computeMeterCapacity } from './meterCapacity';

/** Statuses that carry an installer — the only ones this module reads. */
export const INSTALLER_JOB_STATUSES = Object.freeze([
  INSTALLATION_STATUS.ASSIGNED,
  INSTALLATION_STATUS.IN_PROGRESS,
  INSTALLATION_STATUS.INSTALLED,
  INSTALLATION_STATUS.EXPORTED,
  INSTALLATION_STATUS.FAILED,
]);

/**
 * The installer a job is assigned to. `assignedTo` is the InstallationRequest
 * field (a user UUID); `installerId` is accepted because that is the name the
 * API uses for the same thing as a query parameter. Never coerced.
 */
export const jobInstallerId = (job) => {
  const id = job?.assignedTo ?? job?.installerId ?? null;
  return id === null || id === undefined || id === '' ? null : String(id);
};

export const installerDisplayName = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  || user?.name || user?.phone || user?.email || String(user?.id ?? '');

const emptyStats = () => ({
  assigned: 0, inProgress: 0, awaiting: 0, completed: 0, failed: 0, total: 0,
  completionRate: null, meters: 0, metersByPhase: {}, capacity: null,
});

/**
 * @param {object} input
 * @param {object[]} input.installers - INSTALLER user records (GET /users?role=INSTALLER)
 * @param {object[]} input.jobs - InstallationRequest records in INSTALLER_JOB_STATUSES
 * @param {Map<string, object>|null} [input.holders] - open-dispatch index
 *   (serial → { installerId, phaseType }); null when it couldn't be read, in
 *   which case meter figures are null rather than 0
 * @returns {{ rows: object[], duplicates: number, unattributed: number }}
 *   rows: one per installer, plus one per installer id found on jobs but not
 *   in the roster (a deactivated account), flagged `inRoster: false`.
 */
export function summarizeInstallerStats({ installers = [], jobs = [], holders = null } = {}) {
  const { items, duplicates } = dedupeByKey(jobs, assignedJobKey);
  const rows = new Map();
  const rowFor = (id, name, inRoster) => {
    if (!rows.has(id)) rows.set(id, { installerId: id, name, inRoster, jobs: [], heldMeters: [], ...emptyStats() });
    return rows.get(id);
  };
  installers.forEach((u) => {
    if (u?.id != null) rowFor(String(u.id), installerDisplayName(u), true);
  });

  let unattributed = 0;
  items.forEach((job) => {
    const id = jobInstallerId(job);
    if (!id) { unattributed += 1; return; }
    rowFor(id, job.assigneeName || 'Unknown installer', false).jobs.push(job);
  });

  if (holders) {
    holders.forEach((holder, serial) => {
      const id = holder?.installerId != null ? String(holder.installerId) : null;
      if (!id) return;
      rowFor(id, holder.installerName || 'Unknown installer', false).heldMeters.push({
        meterNumber: serial, phaseType: holder.phaseType, assignmentStatus: 'ASSIGNED',
      });
    });
  }

  const out = Array.from(rows.values()).map((row) => {
    row.jobs.forEach((job) => {
      const status = normalizeStatus(job.status);
      if (status === INSTALLATION_STATUS.ASSIGNED) row.assigned += 1;
      else if (status === INSTALLATION_STATUS.IN_PROGRESS) row.inProgress += 1;
      else if (status === INSTALLATION_STATUS.FAILED) row.failed += 1;
      if (isCompletedInstallation('imported', status)) row.completed += 1;
      if (isPendingInstallation('imported', status)) row.awaiting += 1;
    });
    row.total = row.awaiting + row.completed;
    row.completionRate = row.total > 0 ? row.completed / row.total : null;
    if (holders) {
      row.meters = row.heldMeters.length;
      row.heldMeters.forEach((m) => {
        const key = normalizePhase(m.phaseType) || 'UNSPECIFIED';
        row.metersByPhase[key] = (row.metersByPhase[key] || 0) + 1;
      });
      row.capacity = computeMeterCapacity({ openJobs: row.jobs.filter((j) => isOpenJob(j.status)), heldMeters: row.heldMeters });
    } else {
      row.meters = null;
      row.metersByPhase = null;
    }
    return row;
  });

  out.sort((a, b) => a.name.localeCompare(b.name));
  return { rows: out, duplicates, unattributed };
}

/** Totals across every installer row (for the page's summary strip). */
export function totalInstallerStats(rows = []) {
  const t = rows.reduce((acc, r) => ({
    awaiting: acc.awaiting + r.awaiting,
    inProgress: acc.inProgress + r.inProgress,
    completed: acc.completed + r.completed,
    failed: acc.failed + r.failed,
    total: acc.total + r.total,
    meters: r.meters === null || acc.meters === null ? null : acc.meters + r.meters,
  }), { awaiting: 0, inProgress: 0, completed: 0, failed: 0, total: 0, meters: 0 });
  return { ...t, completionRate: t.total > 0 ? t.completed / t.total : null };
}

/** "60%", or "—" when there is nothing to complete. */
export const formatCompletionRate = (rate) =>
  rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;

// Status filter values for the detail list. Two are groups, matching the
// counts above; the rest are the real statuses.
export const JOB_STATUS_FILTERS = Object.freeze([
  { value: '', label: 'All statuses' },
  { value: 'AWAITING', label: 'Awaiting installation' },
  { value: INSTALLATION_STATUS.ASSIGNED, label: 'Assigned (not started)' },
  { value: INSTALLATION_STATUS.IN_PROGRESS, label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: INSTALLATION_STATUS.FAILED, label: 'Failed' },
]);

const matchesStatus = (job, filter) => {
  if (!filter) return true;
  const status = normalizeStatus(job?.status);
  if (filter === 'AWAITING') return isPendingInstallation('imported', status);
  if (filter === 'COMPLETED') return isCompletedInstallation('imported', status);
  return status === filter;
};

/** The date a filter reads: when it was dispatched, or when it was installed. */
export const jobDateOf = (job, basis) => (basis === 'installed'
  ? localDateOf(job?.installationDate || job?.reportedAt)
  : localDateOf(job?.assignedAt));

/**
 * One installer's jobs, filtered. Every filter is AND-ed; an empty one is off.
 * Account and meter number match as substrings of the exact stored string —
 * no padding, no numeric coercion.
 *
 * @param {object[]} jobs
 * @param {{ status?: string, meterType?: string, dateBasis?: 'assigned'|'installed',
 *   from?: string, to?: string, account?: string, meterNumber?: string }} filters
 */
export function filterInstallerJobs(jobs = [], filters = {}) {
  const { status = '', meterType = '', dateBasis = 'assigned', from = '', to = '' } = filters;
  const account = String(filters.account ?? '').trim();
  const meter = String(filters.meterNumber ?? '').trim();
  const phase = meterType ? normalizePhase(meterType) : '';
  return jobs.filter((job) => {
    if (!matchesStatus(job, status)) return false;
    if (phase && normalizePhase(job?.meterType) !== phase) return false;
    if (account && !String(job?.accountNumber ?? '').includes(account)) return false;
    if (meter && !String(job?.meterNumber ?? '').includes(meter)) return false;
    if (from || to) {
      const d = jobDateOf(job, dateBasis);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
    return true;
  });
}

export default summarizeInstallerStats;
