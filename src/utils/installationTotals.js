// src/utils/installationTotals.js
// System-wide "Pending Installations" and "Completed Installations" — the
// Admin Dashboard's two installation KPIs — across BOTH installation domains,
// from server-side aggregates only (never from a page of rows).
//
// THE MAPPING (existing statuses only; nothing invented):
//
//                      JED / Remita (JedCustomerRequest)   Imported (InstallationRequest)
//   Pending            PAID                                PENDING, ASSIGNED, IN_PROGRESS, FAILED
//   Completed          COMPLETED                           INSTALLED, EXPORTED
//   Not counted        INITIATED (not paid yet)            CANCELLED (withdrawn)
//
// Why each row is where it is:
//   - PAID is the app-wide "Awaiting Installation" (isAwaitingInstallationStatus):
//     paid, not installed. Payment alone never makes a job completed — only
//     COMPLETED (a submitted installation) does.
//   - INITIATED has an RRR but no payment, so it is not yet an installation
//     anyone owes; it is reported separately as "awaiting payment".
//   - An imported job is commissioned by the disco rather than paid by the
//     customer, so it is pending from import until it is installed, whether
//     or not an installer holds it yet. FAILED is a failed ATTEMPT — the meter
//     still isn't in, and the job goes back for reassignment — so it stays
//     pending. CANCELLED is withdrawn and counts nowhere.
//   - Completed = isInstalledStatus (INSTALLED/EXPORTED) and isCompletedStatus
//     (COMPLETED) — the same predicate the revenue split uses
//     (isCompletedInstallationRow in financeSummary.js), so "completed" means
//     the same thing in the KPI and in "Revenue due to us".
//
// ONE POPULATION, ONE NAME (2026-09-28). "Pending Installations" and
// "Awaiting Installations" are the same population everywhere — Admin
// Dashboard, Installations page, Admin Reports and Installer Job Status —
// counted by `pending` below (server aggregates) or, for one record, by
// isPendingInstallation / isPendingInstallationRow. There is deliberately no
// second, narrower "awaiting" count any more (an assigned-only
// `awaitingAssigned` briefly existed and made the Dashboard disagree with
// the Installations page and Reports).
//
// Every status in both enums is in exactly one row of the table, so
//   pending + completed + awaitingPayment + cancelled = every request.
// `reconciles` checks that against the server's own totals.
import { INSTALLATION_STATUS, STATS_KEY_BY_STATUS } from './installationStatus';
import { sortRows, ROW_SOURCE, applyStatusFilter } from './installationScope';

export const PENDING_INSTALLATION_STATUSES = Object.freeze({
  jed: ['PAID'],
  imported: [
    INSTALLATION_STATUS.PENDING,
    INSTALLATION_STATUS.ASSIGNED,
    INSTALLATION_STATUS.IN_PROGRESS,
    INSTALLATION_STATUS.FAILED,
  ],
});

export const COMPLETED_INSTALLATION_STATUSES = Object.freeze({
  jed: ['COMPLETED'],
  imported: [INSTALLATION_STATUS.INSTALLED, INSTALLATION_STATUS.EXPORTED],
});

const upper = (s) => String(s ?? '').trim().toUpperCase();

/**
 * Per-record form of the mapping above — the ONLY predicate any screen uses
 * to decide "pending" / "completed" for a single request (Installer Job
 * Status' per-installer counts, the pending-value calculation). `domain` is
 * 'jed' or 'imported'.
 */
export const isPendingInstallation = (domain, status) =>
  (PENDING_INSTALLATION_STATUSES[domain] || []).includes(upper(status));
export const isCompletedInstallation = (domain, status) =>
  (COMPLETED_INSTALLATION_STATUSES[domain] || []).includes(upper(status));

/** The same rule for one normalised row (normalizeMultiRow / normalizeJedRow). */
export const isPendingInstallationRow = (row) =>
  isPendingInstallation(row?.source === ROW_SOURCE.JED ? 'jed' : 'imported', row?.status);

/**
 * Status-filter value for "every pending installation" — the group, rather
 * than one API status — so a list can show exactly the records the Pending
 * count counts.
 */
export const PENDING_INSTALLATION_FILTER = '__PENDING_INSTALLATION__';

/** applyStatusFilter, plus the pending-installation group. */
export const filterByInstallationStatus = (rows, status) => (status === PENDING_INSTALLATION_FILTER
  ? rows.filter(isPendingInstallationRow)
  : applyStatusFilter(rows, status));

/** A non-negative integer count, or null when the value isn't one. */
const countOf = (value) => {
  // Number(null) and Number('') are 0 — a missing count must stay unknown.
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/**
 * One status's count from GET /installations/statistics. The documented keys
 * are camelCase (STATS_KEY_BY_STATUS); the upper-case status name is accepted
 * too. Missing → null (unknown), never 0.
 */
export function importedStatusCount(stats, status) {
  const data = stats?.data ?? stats ?? {};
  return countOf(data[STATS_KEY_BY_STATUS[status]] ?? data[status]);
}

/** `pagination.totalCount` of a JED list response — the server's own count. */
export function jedTotalCount(response) {
  return countOf(response?.pagination?.totalCount ?? response?.data?.pagination?.totalCount);
}

/**
 * @param {object} input
 * @param {object} input.importedStats - GET /installations/statistics (all discos)
 * @param {{ PAID: number|null, COMPLETED: number|null, INITIATED: number|null }} input.jedCounts
 * @returns {{ pending: number, completed: number, awaitingPayment: number,
 *   cancelled: number, breakdown: object, reconciles: boolean|null }}
 * @throws {Error} when any count needed for pending/completed is missing — an
 *   unknown count must surface as an error, not as 0.
 */
export function summarizeInstallationTotals({ importedStats, jedCounts }) {
  const imported = {};
  Object.values(INSTALLATION_STATUS).forEach((s) => { imported[s] = importedStatusCount(importedStats, s); });
  const jed = { PAID: countOf(jedCounts?.PAID), COMPLETED: countOf(jedCounts?.COMPLETED), INITIATED: countOf(jedCounts?.INITIATED) };

  const needed = [
    ...PENDING_INSTALLATION_STATUSES.imported.map((s) => imported[s]),
    ...COMPLETED_INSTALLATION_STATUSES.imported.map((s) => imported[s]),
    jed.PAID, jed.COMPLETED,
  ];
  if (needed.some((n) => n === null)) {
    throw new Error('Installation counts were incomplete in the server response.');
  }

  const sum = (list) => list.reduce((a, n) => a + n, 0);
  const pendingImported = sum(PENDING_INSTALLATION_STATUSES.imported.map((s) => imported[s]));
  const completedImported = sum(COMPLETED_INSTALLATION_STATUSES.imported.map((s) => imported[s]));
  const cancelled = imported.CANCELLED ?? 0;
  const importedTotal = countOf((importedStats?.data ?? importedStats ?? {}).total);

  return {
    pending: pendingImported + jed.PAID,
    completed: completedImported + jed.COMPLETED,
    awaitingPayment: jed.INITIATED ?? 0,
    cancelled,
    breakdown: {
      pending: { jedPaid: jed.PAID, imported: pendingImported, unassigned: imported.PENDING, withInstaller: imported.ASSIGNED + imported.IN_PROGRESS, failed: imported.FAILED },
      completed: { jed: jed.COMPLETED, imported: completedImported },
    },
    // Every imported status is accounted for exactly once, if the server
    // reported a total to check against.
    reconciles: importedTotal === null ? null : pendingImported + completedImported + cancelled === importedTotal,
  };
}

// ---------------------------------------------------------------------------
// Recent installation requests
//
// "Recent" = most recently REQUESTED — the date the request entered the
// system: `dateRequested` for a JED request (generate-ref), `createdAt` for an
// imported job (the import). It is the Installations page's own "Request
// date" (normalizeJedRow/normalizeMultiRow → requestedAt), so the Dashboard's
// "recent" and that page's newest-first sort are the same ordering. Payment
// and installation dates are later events of an existing request, not what
// makes it recent.
//
// The API documents no sort parameter on either list, so the order of page 1
// is not guaranteed to be newest-first. edgePages() therefore reads the FIRST
// page and the LAST two: whether the server orders ascending or descending,
// the newest rows are in one of those, and the client sorts them by date.
// API_GAP_REPORT.md gap AI asks for a sort parameter to make this one request.
// ---------------------------------------------------------------------------

/** Pages that must hold the newest rows under either ordering. */
export function edgePages(totalPages) {
  const n = Number(totalPages);
  if (!Number.isInteger(n) || n <= 1) return [1];
  return Array.from(new Set([1, n - 1, n])).filter((p) => p >= 1);
}

/**
 * The newest `limit` requests across both domains, newest first.
 * @param {object[]} rows - rows already normalised with normalizeMultiRow /
 *   normalizeJedRow (each carries `key` and `requestedAt`)
 */
export function pickRecentRequests(rows = [], limit = 5) {
  const byKey = new Map();
  rows.forEach((r) => { if (r?.key && !byKey.has(r.key)) byKey.set(r.key, r); });
  return sortRows(Array.from(byKey.values()), 'requestedAt', 'desc').slice(0, limit);
}

export default summarizeInstallationTotals;
