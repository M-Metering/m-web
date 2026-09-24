// src/utils/statusBadge.js
// Single source of truth for status → badge color mapping, used by
// AdminDashboard, InstallerDashboard, and InstallationDetail. Consolidated
// here after each of those three previously had their own copy of this
// logic, and each copy only matched lowercase status strings ('completed',
// 'pending') while the real API returns uppercase ('INITIATED', 'PAID',
// 'COMPLETED') — meaning every status silently fell through to the same
// fallback color. Comparisons here are case-insensitive so this can't
// happen again regardless of casing drift from the backend.

// Deliberately NOT gold/amber — gold is this app's brand/primary-action
// colour (see tailwind.config.js, integrated from the real ME Metering
// identity), so a status badge never uses it, to avoid a status looking
// like an interactive/primary element. PAID/PENDING moved to blue for
// exactly this reason (blue was the *previous* brand colour and is now
// free — swapping the two avoids introducing a third hue into the status
// palette). INITIATED uses a neutral slate instead (real status enum is
// INITIATED/PAID/COMPLETED — no PROCESSING value the backend actually
// returns, so it isn't a real status entry here; a bare
// `getStatusBadgeClass` call with any other string still falls back to
// the same neutral gray below).
export const STATUS_BADGE_STYLES = {
  INITIATED: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  PENDING: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  PAID: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',             // payment confirmed, ready to install
  COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  PAID_COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  CANCELLED: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',

  // Multi-disco installation flow (2026-09-21). PENDING/FAILED/CANCELLED are
  // shared with the entries above — same meaning, same colour. Same rule as
  // the rest of this map: never gold/amber (the brand hue), and the
  // progression reads left-to-right dispatched → working → done → delivered.
  ASSIGNED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  IN_PROGRESS: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  INSTALLED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  EXPORTED: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',

  // Meter assignmentStatus (who holds the meter) + stock status.
  UNASSIGNED: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  USED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  RETURNED: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  LOST: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  AVAILABLE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  FAULTY: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  RETIRED: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
};

/**
 * Uppercase + trim a status value for case-insensitive comparison.
 */
export const normalizeStatus = (status) => String(status || '').toUpperCase().trim();

/**
 * Tailwind classes for a status badge. Falls back to neutral gray for any
 * status not in the map above, rather than silently reusing a color that
 * implies success/failure.
 */
export const getStatusBadgeClass = (status) =>
  STATUS_BADGE_STYLES[normalizeStatus(status)] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';

/**
 * Whether a status represents a finished installation. Used to split
 * Awaiting Installation vs Completed tabs (InstallerDashboard) and to
 * decide whether to show the complete-installation form or a read-only
 * summary (InstallationDetail).
 */
export const isCompletedStatus = (status) =>
  ['COMPLETED', 'PAID_COMPLETED'].includes(normalizeStatus(status));

/**
 * Whether a status represents a paid request that's ready for an installer
 * to act on. Deliberately excludes INITIATED (not yet paid — nothing for
 * an installer to do) so the installer's "Awaiting Installation" tab only
 * ever shows real, actionable, paid customer accounts.
 */
export const isAwaitingInstallationStatus = (status) =>
  normalizeStatus(status) === 'PAID';

/**
 * The user-facing name of every JedCustomerRequest status — the single
 * mapping, so one screen can't call PAID "Awaiting Installation" while
 * another shows the raw "PAID", and COMPLETED isn't "Completed" in one place
 * and "Paid & Completed" in another. (Both really happened; fixed 2026-09-24.)
 *
 * These are LABELS, not statuses: the backend enum is only
 * INITIATED / PAID / COMPLETED — see CLAUDE.md, "Business workflow".
 */
export const JED_STATUS_LABELS = Object.freeze({
  INITIATED: 'Awaiting Payment',
  PAID: 'Awaiting Installation',
  COMPLETED: 'Completed',
});

/** A JED status as it should be shown to a user, for any casing. */
export const jedStatusLabel = (status) => {
  const key = normalizeStatus(status);
  return JED_STATUS_LABELS[key] || key || 'Unknown';
};