// src/utils/meterCapacity.js
// How many meters an installer still needs for the jobs they hold, and
// whether a new meter dispatch fits inside that.
//
// The API has no "required meter quantity" field: an installation request is
// one customer account, installed with exactly one meter (POST
// /installations/{id}/report takes a single meterNumber). So, per installer
// and disco:
//   required  = open jobs assigned to them (ASSIGNED or IN_PROGRESS — the
//               same definition as isOpenJob)
//   assigned  = meters currently in their hands (assignmentStatus ASSIGNED;
//               USED meters are already installed and don't count)
//   remaining = required − assigned, never below zero
// A dispatch may be smaller than `remaining` (partial dispatch is fine) but
// never larger. Serials the installer already holds are not new meters, so
// they are excluded from the count instead of being counted twice.
//
// Phase matters at report time (a three-phase meter can't be reported on a
// single-phase job), so the same figures are also broken down by phase — and
// the dispatch check is applied PER METER TYPE, not only to the total:
// 10 pending three-phase jobs with 6 three-phase meters already out leaves
// room for 1-4 more three-phase meters, whatever the single-phase figures say.
// evaluateMeterDispatch reports which meter type blocked it and how many of
// that type are still needed, so the message can say so exactly.
import { isOpenJob, METER_ASSIGNMENT_STATUS } from './installationStatus';
import { normalizePhase, formatPhaseLabel } from './installationScope';
import { normalizeStatus } from './statusBadge';

const UNSPECIFIED = 'UNSPECIFIED';

/**
 * @param {{ openJobs?: object[], heldMeters?: object[] }} input
 *   openJobs: InstallationRequest records assigned to the installer.
 *   heldMeters: meter items from their dispatch batches.
 */
export function computeMeterCapacity({ openJobs = [], heldMeters = [] } = {}) {
  const jobs = openJobs.filter((j) => isOpenJob(j?.status));
  const meters = heldMeters.filter(
    (m) => normalizeStatus(m?.assignmentStatus) === METER_ASSIGNMENT_STATUS.ASSIGNED
  );

  const byPhase = {};
  const bucket = (phase) => {
    const key = normalizePhase(phase) || UNSPECIFIED;
    if (!byPhase[key]) byPhase[key] = { required: 0, assigned: 0, remaining: 0 };
    return byPhase[key];
  };
  jobs.forEach((j) => { bucket(j.meterType).required += 1; });
  meters.forEach((m) => { bucket(m.phaseType).assigned += 1; });
  Object.values(byPhase).forEach((b) => { b.remaining = Math.max(b.required - b.assigned, 0); });

  const required = jobs.length;
  const assigned = meters.length;
  return {
    required,
    assigned,
    remaining: Math.max(required - assigned, 0),
    surplus: Math.max(assigned - required, 0),
    byPhase,
    heldSerials: meters.map((m) => String(m.meterNumber ?? '')).filter(Boolean),
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The message an over-dispatch gets. It names the real constraint (the
 * installer's pending installations for that meter type) and the real number
 * still needed, both computed — never a hardcoded figure.
 */
export function overCapacityMessage(remaining, phaseKey = null) {
  const named = phaseKey && phaseKey !== UNSPECIFIED;
  const phase = named ? `${formatPhaseLabel(phaseKey)} ` : '';
  const constraint = named
    ? 'The meter assignment exceeds the pending installations assigned to this installer for the selected meter type.'
    : 'The meter assignment exceeds the pending installations assigned to this installer.';
  if (remaining <= 0) {
    return named
      ? `${constraint} No more ${phase}meters are needed.`
      : "This installer doesn't need more meters.";
  }
  return `${constraint} Only ${plural(remaining, `more ${phase}meter`)} ${remaining === 1 ? 'is' : 'are'} needed.`;
}

/**
 * Check a proposed dispatch against the capacity.
 *
 * The rule is per meter type (requirement: pending installations for this
 * installer AND meter type, minus the meters of that type they already hold),
 * with the overall total as a backstop for serials whose phase isn't known.
 * A dispatch smaller than what's needed is always allowed; a larger one never
 * is. `byPhase` comes from computeMeterCapacity, so the numbers in the
 * message are the live ones.
 *
 * @param {ReturnType<typeof computeMeterCapacity>} capacity
 * @param {string[]} serials - de-duplicated serials being dispatched
 * @param {{ phaseBySerial?: Map<string,string>|Record<string,string> }} [options]
 *   phaseBySerial: serial → phase type, from the meter records being
 *   dispatched. Omit it and only the overall total is checked.
 * @returns {{ requested: number, alreadyHeld: string[], remainingAfter: number,
 *   allowed: boolean, message: string|null, phase: string|null }}
 */
export function evaluateMeterDispatch(capacity, serials = [], { phaseBySerial } = {}) {
  const held = new Set(capacity?.heldSerials || []);
  const alreadyHeld = serials.filter((s) => held.has(s));
  const fresh = serials.filter((s) => !held.has(s));
  const requested = fresh.length;
  const remaining = capacity?.remaining ?? 0;

  const lookup = (serial) => {
    if (!phaseBySerial) return null;
    const value = phaseBySerial instanceof Map ? phaseBySerial.get(serial) : phaseBySerial[serial];
    const key = normalizePhase(value);
    return key || null;
  };

  // Per meter type first — that is the constraint the operator needs to hear.
  let phase = null;
  let phaseRemaining = null;
  if (phaseBySerial) {
    const byPhase = capacity?.byPhase || {};
    const counts = new Map();
    fresh.forEach((s) => {
      const key = lookup(s);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    for (const [key, count] of counts) {
      const left = byPhase[key]?.remaining ?? 0;
      if (count > left) { phase = key; phaseRemaining = left; break; }
    }
  }

  const allowed = phase === null && requested <= remaining;

  let message = null;
  if (phase !== null) message = overCapacityMessage(phaseRemaining, phase);
  else if (!allowed) message = overCapacityMessage(remaining);

  return { requested, alreadyHeld, remainingAfter: remaining - requested, allowed, message, phase };
}
