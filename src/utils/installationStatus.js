// src/utils/installationStatus.js
// Domain rules for the multi-disco installation flow (2026-09-21), taken from
// the backend's integration guide and verified against the live OpenAPI spec.
//
// This is a DIFFERENT resource from the JED/Remita flow: an
// `InstallationRequest` has an integer id, belongs to a disco, and moves
// PENDING → ASSIGNED → IN_PROGRESS → INSTALLED → EXPORTED (with FAILED and
// CANCELLED as side exits). `JedCustomerRequest` (INITIATED → PAID →
// COMPLETED) is unrelated and unchanged — see utils/statusBadge.js's
// isAwaitingInstallationStatus/isCompletedStatus for that one.
//
// The guide is explicit that there is no "force" flag: illegal transitions
// come back as a 400, so the UI must offer only the actions that are valid
// from the record's current status. `getAvailableActions` below is the single
// place that decides which ones those are.
import { normalizeStatus } from './statusBadge';

export const INSTALLATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  INSTALLED: 'INSTALLED',
  EXPORTED: 'EXPORTED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

// Order used for filter dropdowns and the statistics strip.
export const INSTALLATION_STATUS_ORDER = [
  INSTALLATION_STATUS.PENDING,
  INSTALLATION_STATUS.ASSIGNED,
  INSTALLATION_STATUS.IN_PROGRESS,
  INSTALLATION_STATUS.INSTALLED,
  INSTALLATION_STATUS.EXPORTED,
  INSTALLATION_STATUS.FAILED,
  INSTALLATION_STATUS.CANCELLED,
];

export const INSTALLATION_STATUS_LABELS = Object.freeze({
  PENDING: 'Pending',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  INSTALLED: 'Installed',
  EXPORTED: 'Exported',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
});

// `GET /installations/statistics` response key per status.
export const STATS_KEY_BY_STATUS = Object.freeze({
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'inProgress',
  INSTALLED: 'installed',
  EXPORTED: 'exported',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

export const METER_ASSIGNMENT_STATUS = Object.freeze({
  UNASSIGNED: 'UNASSIGNED',
  ASSIGNED: 'ASSIGNED',
  USED: 'USED',
  RETURNED: 'RETURNED',
  LOST: 'LOST',
});

export const METER_PHASE_TYPES = ['SINGLE PHASE', 'THREE PHASE'];

export const ASSIGNMENT_BATCH_STATUS = ['ACTIVE', 'PARTIALLY_RETURNED', 'CLOSED', 'CANCELLED'];

export const installationStatusLabel = (status) =>
  INSTALLATION_STATUS_LABELS[normalizeStatus(status)] || normalizeStatus(status) || 'Unknown';

/**
 * Which transitions the API will accept from this status. Mirrors the
 * lifecycle table in the integration guide exactly.
 *
 * @param {string} status
 * @returns {{assign:boolean, unassign:boolean, start:boolean, report:boolean,
 *            fail:boolean, cancel:boolean, export:boolean}}
 */
export function getAvailableActions(status) {
  const s = normalizeStatus(status);
  return {
    // POST /assignments/installations — also how a FAILED job is reassigned.
    assign: s === INSTALLATION_STATUS.PENDING || s === INSTALLATION_STATUS.FAILED,
    // POST /assignments/installations/unassign
    unassign: s === INSTALLATION_STATUS.ASSIGNED,
    // PATCH /installations/:id/start
    start: s === INSTALLATION_STATUS.ASSIGNED,
    // POST /installations/:id/report
    report: s === INSTALLATION_STATUS.ASSIGNED || s === INSTALLATION_STATUS.IN_PROGRESS,
    // POST /installations/:id/fail
    fail: s === INSTALLATION_STATUS.ASSIGNED || s === INSTALLATION_STATUS.IN_PROGRESS,
    // PATCH /installations/:id/cancel
    cancel: s === INSTALLATION_STATUS.PENDING || s === INSTALLATION_STATUS.ASSIGNED,
    // GET /installations/export/:discoCode?markExported=true
    export: s === INSTALLATION_STATUS.INSTALLED,
  };
}

/** A job the installer still has work to do on. */
export const isOpenJob = (status) =>
  [INSTALLATION_STATUS.ASSIGNED, INSTALLATION_STATUS.IN_PROGRESS].includes(normalizeStatus(status));

/** Reported as installed (or already delivered to the disco). */
export const isInstalledStatus = (status) =>
  [INSTALLATION_STATUS.INSTALLED, INSTALLATION_STATUS.EXPORTED].includes(normalizeStatus(status));

// summarizeInstallerJobs used to live here. It moved to
// utils/installerQueue.js, which owns both installer queues and their
// deduplication, so the counts and the lists come from one function. This
// module keeps the status primitives (isOpenJob / isInstalledStatus) that
// installerQueue builds on — the dependency runs one way only.

/**
 * Valid GPS pair, or null. Latitude/longitude come back as numbers but are
 * nullable, and 0 is a legitimate value — so this checks range, not falsiness.
 */
export function getCoordinates(record) {
  const lat = Number(record?.latitude);
  const lng = Number(record?.longitude);
  if (record?.latitude == null || record?.longitude == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * Partial-success summary for an import or assignment response. The guide is
 * emphatic that a 2xx can still carry rejected rows, and that a 200 (rather
 * than 201) means nothing landed — so every caller reads the counters, never
 * the status code.
 *
 * Handles both response shapes: imports use created/skipped/failed + errors,
 * assignments use assignedCount/rejectedCount + rejected.
 */
export function summarizeBatchResult(data) {
  const d = data || {};
  const accepted = Number(d.created ?? d.assignedCount ?? 0);
  const rejected = Number(d.failed ?? d.rejectedCount ?? 0);
  const skipped = Number(d.skipped ?? 0);
  const rows = Array.isArray(d.errors) ? d.errors : Array.isArray(d.rejected) ? d.rejected : [];
  return {
    accepted,
    skipped,
    rejected,
    total: Number(d.totalRows ?? accepted + skipped + rejected),
    // Normalised [{ label, reason }] for rendering, whichever shape came back.
    rejections: rows.map((r) => {
      if (typeof r === 'string') return { label: r, reason: '' };
      const label = r.key ?? r.accountNumber ?? r.meterNumber ?? (r.row != null ? `Row ${r.row}` : '') ?? '';
      return { label: String(label || '—'), reason: r.error || r.reason || '' };
    }),
    hasRejections: rejected > 0 || rows.length > 0,
    nothingLanded: accepted === 0,
  };
}
