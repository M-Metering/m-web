// src/utils/userAccount.js
// Who may delete a user account, and the one account nobody may delete.
//
// A Super Admin is the only role that can create another ADMIN/SUPERADMIN
// account (UserCreate rule, enforced server-side too). If the last Super Admin
// deleted their own account the system would be left with no way to create a
// replacement — so self-deletion is refused here, and the request is never
// sent. The real API documents the same rule: DELETE /users/{id} answers
// 400 "Cannot delete own account or invalid ID".
//
// This is a business rule, not a security boundary: the backend stays
// authoritative (see API_GAP_REPORT.md).
import { ROLES } from '../components/auth/permissions';

/**
 * The identifier the user endpoints are addressed by. `id` is what the API
 * returns (a UUID since the 2026-09-21 migration); `userId`/`_id` are
 * tolerated only so a differently-shaped list response can't silently produce
 * a request to `/users/undefined`.
 */
export const userIdOf = (user) => {
  const value = user?.id ?? user?.userId ?? user?._id ?? user?.uuid;
  return value === null || value === undefined ? '' : String(value).trim();
};

const idOf = userIdOf;

export const MISSING_USER_ID_MESSAGE =
  'This account has no identifier, so it cannot be changed. Refresh the list and try again.';
const emailOf = (user) => String(user?.email ?? '').trim().toLowerCase();
const phoneOf = (user) => String(user?.phone ?? '').replace(/[\s()-]/g, '');

/**
 * Whether two user records are the same account. Ids are UUID strings and are
 * authoritative when both sides have one; email/phone are a fallback for a
 * list row that came back without an id.
 */
export function isSameUserAccount(a, b) {
  if (!a || !b) return false;
  const [idA, idB] = [idOf(a), idOf(b)];
  if (idA && idB) return idA === idB;
  const [emailA, emailB] = [emailOf(a), emailOf(b)];
  if (emailA && emailB) return emailA === emailB;
  const [phoneA, phoneB] = [phoneOf(a), phoneOf(b)];
  return !!phoneA && phoneA === phoneB;
}

export const SELF_DELETE_SUPERADMIN_MESSAGE = 'A Super Admin cannot delete their own account.';
export const SELF_DELETE_MESSAGE = 'You cannot delete your own account.';
export const DELETE_NOT_PERMITTED_MESSAGE =
  'Access Restricted: only a Super Administrator can delete user accounts.';

/**
 * @param {{ currentUser: object|null, targetUser: object|null, isSuperAdmin: boolean }} input
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function canDeleteUserAccount({ currentUser, targetUser, isSuperAdmin }) {
  if (!targetUser) return { allowed: false, reason: DELETE_NOT_PERMITTED_MESSAGE };
  if (!isSuperAdmin) return { allowed: false, reason: DELETE_NOT_PERMITTED_MESSAGE };
  if (isSameUserAccount(currentUser, targetUser)) {
    return {
      allowed: false,
      reason: currentUser?.role === ROLES.SUPERADMIN ? SELF_DELETE_SUPERADMIN_MESSAGE : SELF_DELETE_MESSAGE,
    };
  }
  return { allowed: true, reason: null };
}

export default { isSameUserAccount, canDeleteUserAccount };
