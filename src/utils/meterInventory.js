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
import { normalizeStatus } from './statusBadge';

const BLOCKED_ASSIGNMENT = new Set(['ASSIGNED', 'USED', 'LOST']);

/** A meter's serial as a trimmed string ('' when missing). */
export const meterSerial = (meter) => {
  const value = meter?.meterNumber;
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

export function isAssignableMeter(meter) {
  if (!meterSerial(meter)) return false;
  if (normalizeStatus(meter.status) !== 'AVAILABLE') return false;
  return !BLOCKED_ASSIGNMENT.has(normalizeStatus(meter.assignmentStatus));
}

/**
 * Eligible, de-duplicated picker options, sorted by serial.
 * @param {object[]} meters - raw meter records
 * @param {Set<string>} [exclude] - serials to leave out (e.g. dispatched this session)
 * `meterMake`/`model` are carried through so the picker can identify a meter
 * by more than its serial — they are the record's own values, shown only when
 * the API recorded them (see utils/meterDisplay.js).
 * @returns {{ serial: string, phaseType: string, simNumber: string, meterMake: string, model: string }[]}
 */
export function toMeterOptions(meters = [], exclude = new Set()) {
  const bySerial = new Map();
  meters.forEach((m) => {
    const serial = meterSerial(m);
    if (!isAssignableMeter(m) || exclude.has(serial) || bySerial.has(serial)) return;
    bySerial.set(serial, {
      serial,
      phaseType: normalizeStatus(m.phaseType).replace(/[_-]+/g, ' '),
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
export function meterDeletionBlockReason(meter) {
  if (!meterSerial(meter)) return 'This record has no meter number.';
  if (normalizeStatus(meter.status) === 'INSTALLED' || meter.installedAt) {
    return 'It is installed at a customer premises.';
  }
  return UNDELETABLE_ASSIGNMENT[normalizeStatus(meter.assignmentStatus)] || null;
}

/** Whether this meter may be deleted from inventory. */
export const isDeletableMeter = (meter) => meterDeletionBlockReason(meter) === null;

/**
 * Split a selection into what can and cannot be deleted, so the confirmation
 * can state both before anything is sent.
 * @returns {{ deletable: object[], blocked: { meter: object, reason: string }[] }}
 */
export function partitionDeletableMeters(meters = []) {
  const deletable = [];
  const blocked = [];
  meters.forEach((meter) => {
    const reason = meterDeletionBlockReason(meter);
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
  const pasted = Array.from(new Set(String(raw || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)));
  return {
    accepted: pasted.filter((s) => eligible.has(s)),
    rejected: pasted.filter((s) => !eligible.has(s)),
  };
}
