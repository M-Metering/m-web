// src/utils/userDiscos.js
// Per-disco access (Pharez API update, 2026-10-05). Every staff account is
// profiled for one or more discos and only sees and acts on data in them; the
// API enforces it on every request. A SUPERADMIN is never profiled
// (`discos: []`) and sees every disco.
//
// The user object (login, GET /auth/profile, GET /users, …) carries
// `discos: [{ code, name }]`. This module is the ONE reading of it:
//   - disco pickers list the user's own discos, never GET /discos, for a
//     scoped user (discoOptionsForUser);
//   - a non-SUPERADMIN with `[]` has no access yet (hasNoDiscoAccess) — lists
//     come back empty and actions 403, so the app says so instead of
//     rendering an empty screen as if nothing existed;
//   - the user-account screens decide which discos may be granted
//     (userDiscoFieldMode / createDiscoCodes).
// The client never filters data by disco itself: the server already did.
import { ROLES } from '../components/auth/permissions';

export const NO_DISCO_ACCESS_MESSAGE = 'Ask a super admin to give you access to a disco.';

const isSuperAdminRole = (role) => String(role || '').toUpperCase() === ROLES.SUPERADMIN;

/** A user's discos as `{ code, name }`, or null when the record doesn't say. */
export function userDiscos(user) {
  if (!user || !Array.isArray(user.discos)) return null;
  return user.discos
    .map((d) => (typeof d === 'string' ? { code: d, name: '' } : { code: d?.code || '', name: d?.name || '' }))
    .filter((d) => d.code);
}

/** The codes only; [] when none or unknown. */
export function userDiscoCodes(user) {
  return (userDiscos(user) || []).map((d) => d.code);
}

/**
 * True when the user's disco list decides what they see: any role but
 * SUPERADMIN, on a record that carries `discos`. A record without the field
 * (an older session) is not treated as scoped — the server still is.
 */
export function isDiscoScoped(user) {
  return !!user && !isSuperAdminRole(user.role) && userDiscos(user) !== null;
}

/** A non-SUPERADMIN who hasn't been given any disco yet. */
export function hasNoDiscoAccess(user) {
  return isDiscoScoped(user) && userDiscos(user).length === 0;
}

/**
 * The discos a picker offers this user. A SUPERADMIN (or an unscoped record)
 * gets `allDiscos` (GET /discos); a scoped user gets exactly their own,
 * named from `allDiscos` where that list has the disco, else from the profile.
 */
export function discoOptionsForUser(user, allDiscos = []) {
  if (!isDiscoScoped(user)) return allDiscos;
  const byCode = new Map((allDiscos || []).map((d) => [d.code, d]));
  return userDiscos(user).map((d) => ({ ...d, ...(byCode.get(d.code) || {}), code: d.code, name: d.name || byCode.get(d.code)?.name || d.code }));
}

/** Short display of a user's discos: "ABA_POWER, PHEDC", or null. */
export function discoListLabel(user) {
  const codes = userDiscoCodes(user);
  return codes.length ? codes.join(', ') : null;
}

/**
 * Which disco control the user form shows (§4 of the update):
 *   'none' — the target is a SUPERADMIN (never profiled), or the creator is
 *            an ADMIN with one disco (the new user gets it automatically);
 *   'all'  — a SUPERADMIN chooses from every disco;
 *   'own'  — an ADMIN with several discos chooses among their own.
 * Editing a user's discos later is SUPERADMIN-only (PUT /users/:id/discos),
 * so an ADMIN editing gets 'none'.
 */
export function userDiscoFieldMode({ actor, targetRole, editing = false }) {
  if (isSuperAdminRole(targetRole)) return 'none';
  if (isSuperAdminRole(actor?.role)) return 'all';
  if (editing) return 'none';
  return userDiscoCodes(actor).length > 1 ? 'own' : 'none';
}

/**
 * `discoCodes` for POST /users, or undefined to omit the field.
 * Omitted for a SUPERADMIN target and when the field isn't shown (an ADMIN's
 * new user then gets the ADMIN's discos server-side). A SUPERADMIN always
 * sends it, even empty, so the choice is explicit.
 */
export function createDiscoCodes({ mode, selected = [] }) {
  if (mode === 'none') return undefined;
  return Array.from(new Set(selected.filter(Boolean)));
}

/** Whether two code lists hold the same discos, ignoring order. */
export function sameDiscoSet(a = [], b = []) {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((c) => y.has(c));
}
