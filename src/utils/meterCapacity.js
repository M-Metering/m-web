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
//
// WHO IS CAPPED. This whole requirement — an installation must exist first,
// and of the matching meter type — is an ADMIN rule. A Super Admin assigns
// installations and meters independently, so its dispatches pass `enforce:
// false` and are not capped here. Callers never decide that for themselves:
// `permissions.enforcesMeterCapacity` (auth/usePermissions.jsx) is the single
// source of it, and useMeterDispatch reads it. What `enforce: false` does NOT
// relax is meter integrity — exists, AVAILABLE, not already assigned/used/lost
// — which is utils/meterInventory.js' job and applies to every role.
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

/** The per-meter-type figures, with a zeroed default for a type with no jobs. */
export function phaseCapacity(capacity, phase) {
  const key = normalizePhase(phase) || UNSPECIFIED;
  return capacity?.byPhase?.[key] || { required: 0, assigned: 0, remaining: 0 };
}

/**
 * Whether a meter of this phase may be dispatched to this installer at all.
 * `enforce` is false for a Super Admin, who may dispatch meters independently
 * of any installation assignment (see the WHO IS CAPPED note in the header).
 */
export function canDispatchPhase(capacity, phase, { enforce = true } = {}) {
  if (!enforce) return true;
  return phaseCapacity(capacity, phase).remaining > 0;
}

/**
 * Why a dispatch is refused, in the operator's words.
 *
 * Three distinct situations, because they need three distinct fixes:
 *   1. the installer holds no open installation at all  -> assign a job first;
 *   2. they hold jobs, but none of this meter type      -> wrong meter type;
 *   3. they hold jobs of this type, all already covered -> no room left.
 * Nothing here names an endpoint, a field or a status code.
 *
 * @param {object} input
 * @param {number} input.remaining - meters of this type still needed
 * @param {string|null} [input.phaseKey] - normalised phase, or null/UNSPECIFIED
 * @param {number} [input.phaseRequired] - open jobs of this type
 * @param {number} [input.totalRequired] - open jobs of every type
 */
export function overCapacityMessage({ remaining, phaseKey = null, phaseRequired = 0, totalRequired = 0 }) {
  const named = phaseKey && phaseKey !== UNSPECIFIED;
  const phase = named ? `${formatPhaseLabel(phaseKey)} ` : '';

  // 1. Nothing assigned to this installer at all.
  if (totalRequired <= 0) {
    return 'An installation must be assigned to this installer before assigning a meter.';
  }
  // 2. Jobs, but none that need this meter type.
  if (named && phaseRequired <= 0) {
    return `No pending ${formatPhaseLabel(phaseKey)} installation is assigned to this installer.`;
  }
  // 3. Jobs of this type, but every one of them is already covered.
  if (remaining <= 0) {
    return named
      ? 'Cannot assign this meter. The installer has no remaining installation capacity for this meter type.'
      : 'Cannot assign these meters. The installer has no remaining installation capacity.';
  }
  // 4. Room, but less than was asked for.
  return `Only ${plural(remaining, `more ${phase}meter`)} can be assigned to this installer.`;
}

/**
 * Check a proposed dispatch against the capacity.
 *
 * The rule is per meter type (pending installations for this installer AND
 * meter type, minus the meters of that type they already hold), with the
 * overall total as a backstop for serials whose phase isn't known. Single
 * Phase and Three Phase capacities are therefore independent: exhausting one
 * never consumes the other. A dispatch smaller than what's needed is always
 * allowed; a larger one never is. `byPhase` comes from computeMeterCapacity,
 * so the numbers in the message are the live ones.
 *
 * @param {ReturnType<typeof computeMeterCapacity>} capacity
 * @param {string[]} serials - de-duplicated serials being dispatched
 * @param {object} [options]
 * @param {Map<string,string>|Record<string,string>} [options.phaseBySerial]
 *   serial -> phase type, from the meter records being dispatched. Omit it and
 *   only the overall total is checked.
 * @param {boolean} [options.enforce=true] - false skips the installation
 *   dependency entirely (Super Admin). The meter's own integrity rules —
 *   exists, available, not already assigned/used/lost — are NOT part of this
 *   check and still apply to everyone; they live in utils/meterInventory.js.
 * @returns {{ requested: number, alreadyHeld: string[], remainingAfter: number,
 *   allowed: boolean, message: string|null, phase: string|null, enforced: boolean }}
 */
export function evaluateMeterDispatch(capacity, serials = [], { phaseBySerial, enforce = true } = {}) {
  const held = new Set(capacity?.heldSerials || []);
  const alreadyHeld = serials.filter((s) => held.has(s));
  const fresh = serials.filter((s) => !held.has(s));
  const requested = fresh.length;
  const remaining = capacity?.remaining ?? 0;

  // Super Admin: installations and meters are assigned independently, so the
  // figures are still reported (the summary shows them) but nothing is capped.
  if (!enforce) {
    return {
      requested,
      alreadyHeld,
      remainingAfter: remaining - requested,
      allowed: requested > 0,
      message: null,
      phase: null,
      enforced: false,
    };
  }

  const lookup = (serial) => {
    if (!phaseBySerial) return null;
    const value = phaseBySerial instanceof Map ? phaseBySerial.get(serial) : phaseBySerial[serial];
    const key = normalizePhase(value);
    return key || null;
  };

  // Per meter type first — that is the constraint the operator needs to hear.
  let phase = null;
  let phaseRemaining = null;
  let phaseRequired = 0;
  if (phaseBySerial) {
    const counts = new Map();
    fresh.forEach((s) => {
      const key = lookup(s);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    for (const [key, count] of counts) {
      const bucket = phaseCapacity(capacity, key);
      if (count > bucket.remaining) {
        phase = key;
        phaseRemaining = bucket.remaining;
        phaseRequired = bucket.required;
        break;
      }
    }
  }

  const allowed = phase === null && requested <= remaining;
  const totalRequired = capacity?.required ?? 0;

  let message = null;
  if (phase !== null) {
    message = overCapacityMessage({ remaining: phaseRemaining, phaseKey: phase, phaseRequired, totalRequired });
  } else if (!allowed) {
    message = overCapacityMessage({ remaining, totalRequired });
  }

  return { requested, alreadyHeld, remainingAfter: remaining - requested, allowed, message, phase, enforced: true };
}
