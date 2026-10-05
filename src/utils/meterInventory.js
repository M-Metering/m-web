// src/utils/meterInventory.js
// Which meters an admin may dispatch to an installer, as picker options.
//
// Eligibility (the app's existing two-axis meter model — see CLAUDE.md):
//   - stock status must be AVAILABLE (INSTALLED/FAULTY/RETIRED are never
//     dispatched). Requested server-side with GET /meters?status=AVAILABLE.
//   - assignmentStatus, when the API includes it, must not be ASSIGNED
//     (already with an installer), USED (installed) or LOST. UNASSIGNED and
//     RETURNED are fine. A meter out with an installer keeps status AVAILABLE,
//     which is why this second check exists.
// Serials are strings end to end — "0239110006909" keeps its leading zero.
//
// WHY A METER CAN LOOK "AVAILABLE" AND STILL BE WITH AN INSTALLER (2026-09-27).
// The API documents it outright: "Assignment does not change meters.status"
// (POST /assignments/meters). `status` stays AVAILABLE for a dispatched meter,
// deliberately, so the JED flow that gates on it is untouched. Who holds the
// meter lives on the second axis — `assignmentStatus` — and in the open
// dispatch batches. Meter Schedule used to render `status` alone, so a meter
// it had just dispatched still read "Available". Every screen now reads the
// combined state through meterAvailability(), and "is it free to dispatch?"
// through isAssignableMeter(meter, holder).
//
// `holder` is the meter's entry in the open-dispatch index (indexMeterHolders
// below, loaded by hooks/useMeterHolders.js). It is needed because GET /meters
// does not document `assignmentStatus` at all (API_GAP_REPORT.md, gap G): when
// the list omits it, the batches are the only server record that the meter is
// out. Either source saying "held" is enough to refuse a dispatch.
import { normalizeStatus } from './statusBadge';
import { normalizePhase } from './installationScope';
import { parseIdentifierList } from './identifierList';

const BLOCKED_ASSIGNMENT = new Set(['ASSIGNED', 'USED', 'LOST']);

// A holder entry is an object. Anything else (null, or the array index that
// `list.filter(isAssignableMeter)` passes as the second argument) is 'none'.
const isHolder = (holder) => holder !== null && typeof holder === 'object';

/** A meter's serial as a trimmed string ('' when missing). */
export const meterSerial = (meter) => {
  const value = meter?.meterNumber;
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

/** A meter's phase as the API's enum value where recognisable ('THREE PHASE'). */
export const meterPhase = (meter) => normalizePhase(meter?.phaseType);

/**
 * @param {object} meter - a raw meter record
 * @param {object|null} [holder] - its open-dispatch entry, when one exists
 */
export function isAssignableMeter(meter, holder = null) {
  if (!meterSerial(meter)) return false;
  if (isHolder(holder)) return false;
  if (normalizeStatus(meter.status) !== 'AVAILABLE') return false;
  return !BLOCKED_ASSIGNMENT.has(normalizeStatus(meter.assignmentStatus));
}

/**
 * Why a real meter isn't offered for dispatch. Mirrors isAssignableMeter's
 * rule (status AVAILABLE, not held by anyone) but phrased for the admin
 * looking at an empty search box.
 */
export function undispatchableReason(meter, holder = null) {
  const status = normalizeStatus(meter?.status);
  const assignment = normalizeStatus(meter?.assignmentStatus);
  if (assignment === 'USED' || status === 'INSTALLED') return 'it has already been installed';
  if (isHolder(holder)) return `it is already with ${holder.installerName || 'an installer'}`;
  if (assignment === 'ASSIGNED') return 'it is already dispatched to an installer';
  if (assignment === 'LOST') return 'it is recorded as lost';
  if (status && status !== 'AVAILABLE') return `its status is ${status.toLowerCase()}`;
  return null;
}

// The combined state, in the app's existing vocabulary: the stock statuses
// (Available / Installed / Faulty / Retired) plus the assignment statuses that
// mean "not on the shelf" (Assigned / Lost). No new status is introduced.
export const METER_AVAILABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  ASSIGNED: 'ASSIGNED',
  INSTALLED: 'INSTALLED',
  FAULTY: 'FAULTY',
  RETIRED: 'RETIRED',
  LOST: 'LOST',
});

export const METER_AVAILABILITY_LABELS = Object.freeze({
  AVAILABLE: 'Available',
  ASSIGNED: 'Assigned',
  INSTALLED: 'Installed',
  FAULTY: 'Faulty',
  RETIRED: 'Retired',
  LOST: 'Lost',
});

/**
 * Where a meter actually is, as ONE state — what an inventory screen shows.
 *
 * Order matters: a meter reported against an installation is Installed even
 * if its stock status lags (`assignmentStatus` USED), and a dispatched meter
 * is Assigned even though its stock status still reads AVAILABLE.
 *
 * @param {object} meter
 * @param {object|null} [holder] - open-dispatch entry ({ installerName, ... })
 * @returns {{ key: string, label: string, holderName: string|null }}
 */
export function meterAvailability(meter, holder = null) {
  const status = normalizeStatus(meter?.status);
  const assignment = normalizeStatus(meter?.assignmentStatus);
  let key;
  if (status === 'INSTALLED' || assignment === 'USED') key = METER_AVAILABILITY.INSTALLED;
  else if (assignment === 'LOST') key = METER_AVAILABILITY.LOST;
  else if (isHolder(holder) || assignment === 'ASSIGNED') key = METER_AVAILABILITY.ASSIGNED;
  else if (status === 'FAULTY' || status === 'RETIRED' || status === 'AVAILABLE') key = status;
  else key = status || METER_AVAILABILITY.AVAILABLE;
  return {
    key,
    label: METER_AVAILABILITY_LABELS[key] || key,
    holderName: key === METER_AVAILABILITY.ASSIGNED && isHolder(holder) ? (holder.installerName || null) : null,
  };
}

/**
 * Join each meter to its open-dispatch entry. A held meter gets
 * `assignmentStatus: 'ASSIGNED'` (what its batch item says) and `holder`, so
 * every rule that already reads `assignmentStatus` — eligibility, deletion,
 * the badge — sees it. A record that already says USED or LOST keeps that:
 * those are later, more final states than "dispatched".
 * Records are copied, never mutated. With no index (not loaded, or no
 * permission) the list comes back unchanged.
 */
export function withMeterHolders(meters = [], holders = null) {
  if (!holders || holders.size === 0) return meters;
  return meters.map((meter) => {
    const holder = holders.get(meterSerial(meter));
    if (!holder) return meter;
    const assignment = normalizeStatus(meter.assignmentStatus);
    return {
      ...meter,
      assignmentStatus: assignment === 'USED' || assignment === 'LOST' ? meter.assignmentStatus : 'ASSIGNED',
      holder,
    };
  });
}

const OPEN_DISPATCH_BATCH = new Set(['ACTIVE', 'PARTIALLY_RETURNED']);

/**
 * serial → who holds it, from METER dispatch batches WITH their items
 * (GET /assignments/{id}). Only items still ASSIGNED in a batch that is still
 * open count — a returned or used meter is not "held". This is the same rule
 * the per-installer capacity check has always applied, just for every
 * installer at once.
 *
 * @param {object[]} batches - batch detail records ({ id, status, installerId,
 *   installerName, assignedAt, discoCode, items[] })
 * @returns {Map<string, { installerId: string|null, installerName: string|null,
 *   batchId: number|null, batchRef: string|null, discoCode: string|null,
 *   assignedAt: string|null, phaseType: string }>}
 */
export function indexMeterHolders(batches = []) {
  const holders = new Map();
  batches.forEach((batch) => {
    if (!batch || (batch.status && !OPEN_DISPATCH_BATCH.has(normalizeStatus(batch.status)))) return;
    const items = Array.isArray(batch.items) ? batch.items : [];
    items.forEach((item) => {
      const serial = meterSerial(item);
      if (!serial || normalizeStatus(item.assignmentStatus) !== 'ASSIGNED') return;
      holders.set(serial, {
        installerId: batch.installerId ?? null,
        installerName: batch.installerName || null,
        batchId: batch.id ?? null,
        batchRef: batch.batchRef || null,
        discoCode: batch.discoCode || null,
        assignedAt: item.assignedAt || batch.assignedAt || batch.createdAt || null,
        phaseType: meterPhase(item),
      });
    });
  });
  return holders;
}

/**
 * Eligible, de-duplicated picker options, sorted by serial.
 * @param {object[]} meters - raw meter records
 * @param {Set<string>} [exclude] - serials to leave out (e.g. dispatched this session)
 * @param {Map<string, object>} [holders] - the open-dispatch index; a meter in
 *   it is out with an installer whatever its own record says
 * `meterMake`/`model` are carried through so the picker can identify a meter
 * by more than its serial — they are the record's own values, shown only when
 * the API recorded them (see utils/meterDisplay.js).
 * @returns {{ serial: string, phaseType: string, simNumber: string, meterMake: string, model: string }[]}
 */
export function toMeterOptions(meters = [], exclude = new Set(), holders = null) {
  const bySerial = new Map();
  meters.forEach((m) => {
    const serial = meterSerial(m);
    if (!isAssignableMeter(m, holders?.get(serial) || null) || exclude.has(serial) || bySerial.has(serial)) return;
    bySerial.set(serial, {
      serial,
      // The canonical phase, so "3 Phase" and "THREE PHASE" are one type in
      // the picker's filter and in the per-type capacity check.
      phaseType: meterPhase(m),
      simNumber: m.simNumber != null ? String(m.simNumber) : '',
      meterMake: m.meterMake ? String(m.meterMake) : '',
      model: m.model ? String(m.model) : '',
    });
  });
  return Array.from(bySerial.values()).sort((a, b) => a.serial.localeCompare(b.serial));
}

// ---------------------------------------------------------------------------
// Deletion eligibility (Super Admin only — see utils/userAccount.js for the
// account rule and MeterInventory for the UI).
//
// DELETE /meters/{meterNumber} is the only delete the API offers for anything
// an upload/import created, and it documents no dependency check of its own
// (only 401/403/404). So the client refuses, up front, the cases that would
// destroy a record another workflow already depends on:
//
//   - status INSTALLED, or any meter carrying an installedAt — it is in
//     service at a customer, and the installation/report history points at it;
//   - assignmentStatus ASSIGNED — physically out with an installer;
//   - assignmentStatus USED — already reported against an installation;
//   - assignmentStatus LOST — a record of a loss, not spare inventory.
//
// FAULTY and RETIRED stock that is not out with anyone stays deletable: those
// are inventory states, not references from another workflow, and removing a
// wrongly-uploaded unit is the case this exists for. The backend stays
// authoritative — a 403 or a future dependency rule there is still obeyed.
// ---------------------------------------------------------------------------

const UNDELETABLE_ASSIGNMENT = Object.freeze({
  ASSIGNED: 'It is currently dispatched to an installer. Return it to stock first.',
  USED: 'It has already been used for an installation.',
  LOST: 'It is recorded as lost. Deleting it would remove that record.',
});

/**
 * Why this meter must not be deleted, or null when it may be.
 * @param {object} meter - a raw meter record
 * @returns {string|null} a short, user-facing reason
 */
export function meterDeletionBlockReason(meter, holder = null) {
  if (!meterSerial(meter)) return 'This record has no meter number.';
  if (normalizeStatus(meter.status) === 'INSTALLED' || meter.installedAt) {
    return 'It is installed at a customer premises.';
  }
  if (isHolder(holder)) return UNDELETABLE_ASSIGNMENT.ASSIGNED;
  return UNDELETABLE_ASSIGNMENT[normalizeStatus(meter.assignmentStatus)] || null;
}

/** Whether this meter may be deleted from inventory. */
export const isDeletableMeter = (meter, holder = null) => meterDeletionBlockReason(meter, holder) === null;

/**
 * Split a selection into what can and cannot be deleted, so the confirmation
 * can state both before anything is sent.
 * @param {object[]} meters
 * @param {Map<string, object>} [holders] - the open-dispatch index
 * @returns {{ deletable: object[], blocked: { meter: object, reason: string }[] }}
 */
export function partitionDeletableMeters(meters = [], holders = null) {
  const deletable = [];
  const blocked = [];
  meters.forEach((meter) => {
    const reason = meterDeletionBlockReason(meter, holders?.get(meterSerial(meter)) || null);
    if (reason) blocked.push({ meter, reason });
    else deletable.push(meter);
  });
  return { deletable, blocked };
}

/**
 * Match pasted serials against the eligible options. Only eligible serials
 * are accepted; anything else is reported back, never silently dispatched.
 * @returns {{ accepted: string[], rejected: string[] }}
 */
export function matchPastedSerials(options, raw) {
  const eligible = new Set(options.map((o) => o.serial));
  const { values: pasted } = parseIdentifierList(raw);
  return {
    accepted: pasted.filter((s) => eligible.has(s)),
    rejected: pasted.filter((s) => !eligible.has(s)),
  };
}

/**
 * Dispatchable meters per canonical phase, from toMeterOptions output.
 * @returns {Map<string, number>} phase ('SINGLE PHASE' | 'THREE PHASE' | other) → count
 */
export function countOptionsByPhase(options = []) {
  const counts = new Map();
  options.forEach((o) => { const p = o.phaseType || ''; counts.set(p, (counts.get(p) || 0) + 1); });
  return counts;
}

/**
 * The picker's count line. It must describe the list the operator is looking
 * at: with a phase selected, that phase's dispatchable meters — never the
 * all-phase total (the 2026-10-05 "418 Three Phase available" report was the
 * all-phase total shown under a Three Phase filter).
 * @param {{ matches: number, total: number, phaseLabel?: string|null,
 *   searching?: boolean, maxShown: number }} args
 */
export function availableCountLabel({ matches, total, phaseLabel = null, searching = false, maxShown }) {
  const what = phaseLabel ? `${phaseLabel} meters` : 'meters';
  if (matches > maxShown) return `Showing ${maxShown.toLocaleString()} of ${matches.toLocaleString()} available ${what} — type to narrow`;
  if (searching) return `${matches.toLocaleString()} matching of ${total.toLocaleString()} available ${what}`;
  return `${matches.toLocaleString()} available ${what}`;
}

/**
 * Meters on the shelf — status AVAILABLE and NOT out with an installer — from
 * GET /meters/statistics' `available` minus the open-dispatch index.
 *
 * The API leaves a dispatched meter at status AVAILABLE by design, so the
 * server's `available` also counts every meter an installer holds; shown as
 * "Available" beside an "Assigned" card, those meters were counted twice.
 * Every held meter is status AVAILABLE (once installed it becomes USED and
 * leaves the index), so the subtraction is exact under the API's own rules.
 * This is the same population the Assignments picker offers ("N available
 * meters", all phases), so the two screens reconcile.
 *
 * @param {number|null} statsAvailable - /meters/statistics `available`
 * @param {Map|null} holders - indexMeterHolders output; null = unknown
 * @returns {number|null} null when either figure is unknown — never a guess
 */
export function shelfAvailableCount(statsAvailable, holders) {
  if (statsAvailable === null || statsAvailable === undefined || !Number.isFinite(Number(statsAvailable))) return null;
  if (!holders) return null;
  return Math.max(0, Number(statsAvailable) - holders.size);
}
