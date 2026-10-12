// src/utils/sealNumber.js
// Seal numbers identify one physical seal and must never be reused.
//
// Since 2026-10-12 the API enforces this itself: POST /installations/:id/report
// requires `sealNumber`, refuses one without digits (400), and refuses one
// whose DIGITS another installation already holds, across every disco (409
// "Seal number already exists"). Only the digits identify a seal:
// "SL-004512", "AB004512" and "004512" are the same seal; "4512" is a
// different one, because leading zeros count. The seal is still saved exactly
// as typed.
//
// What the client adds on top:
//   1. reject the duplicate it can already see — a seal recorded on a job in
//      the list on screen — before a pointless round trip;
//   2. recognise the backend's duplicate rejection and show one plain message
//      on the seal field.
// The server is the authority; this is a courtesy check.
const DUPLICATE_ERROR_RE =
  /(duplicate|already (?:been )?(?:used|exists|taken|recorded|registered)|must be unique|unique constraint|already in use)/i;
const SEAL_MENTION_RE = /seal/i;

export const DUPLICATE_SEAL_MESSAGE =
  'This seal number has already been used. Please enter a unique seal number.';
export const SEAL_REQUIRED_MESSAGE = 'Seal number is required.';
export const SEAL_DIGITS_MESSAGE = 'Seal number must contain digits.';

/** The seal exactly as it should be sent: accidental whitespace removed, nothing else changed. */
export function normalizeSealNumber(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Comparison key — the API's own identity rule: the digits only, in order,
 * leading zeros kept. "SL-004512" and "004512" share a key; "4512" does not.
 * '' for a seal with no digits (which the API refuses anyway).
 */
export const sealKey = (value) => normalizeSealNumber(value).replace(/\D+/g, '');

/**
 * Seal numbers already recorded on a set of records, excluding one record
 * (the job being reported, whose own seal is not a clash).
 * @param {object[]} records - job/request records with sealNumber or sealNo
 * @param {string|number|null} [excludeId]
 * @returns {Set<string>} comparison keys
 */
export function collectSealKeys(records = [], excludeId = null) {
  const keys = new Set();
  records.forEach((r) => {
    if (excludeId !== null && excludeId !== undefined && r?.id === excludeId) return;
    const key = sealKey(r?.sealNumber ?? r?.sealNo);
    if (key) keys.add(key);
  });
  return keys;
}

/**
 * Validate a seal against the API's rules and what this client can see.
 * @param {unknown} raw
 * @param {Set<string>} [usedKeys]
 * @returns {{ valid: boolean, value: string, error: string|null }}
 */
export function validateSealNumber(raw, usedKeys = new Set()) {
  const value = normalizeSealNumber(raw);
  if (!value) return { valid: false, value, error: SEAL_REQUIRED_MESSAGE };
  const key = sealKey(value);
  if (!key) return { valid: false, value, error: SEAL_DIGITS_MESSAGE };
  if (usedKeys.has(key)) {
    return { valid: false, value, error: DUPLICATE_SEAL_MESSAGE };
  }
  return { valid: true, value, error: null };
}

/**
 * Whether a rejected submission was rejected because the seal is taken
 * (409 "Seal number already exists"). Matched on the raw error text, before
 * getErrorMessage() can reword or drop it.
 */
export function isDuplicateSealError(err) {
  const raw = String(err?.message ?? err ?? '');
  if (!raw) return false;
  return DUPLICATE_ERROR_RE.test(raw) && SEAL_MENTION_RE.test(raw);
}

/**
 * The seal field's message for a 400 the API raised about the seal itself
 * ("Validation failed: sealNumber Seal number is required" / "... must
 * contain digits"), or null when the error is about something else.
 */
export function sealValidationErrorOf(err) {
  const raw = String(err?.message ?? err ?? '');
  if (!/seal/i.test(raw)) return null;
  if (/must contain digits/i.test(raw)) return SEAL_DIGITS_MESSAGE;
  if (/seal number is required/i.test(raw)) return SEAL_REQUIRED_MESSAGE;
  return null;
}

/**
 * GET /installations/seal-duplicates (SUPERADMIN, 2026-10-12) → the groups to
 * render: one per clashing seal, `{ digits, installations }`, each with at
 * least two installations (a group is resolved once only one job holds the
 * seal). An empty array means there are no duplicates.
 */
export function sealDuplicateGroupsOf(response) {
  const data = Array.isArray(response) ? response : response?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((g) => g && Array.isArray(g.installations) && g.installations.length > 1)
    .map((g) => ({ digits: String(g.digits ?? sealKey(g.installations[0]?.sealNumber)), installations: g.installations }));
}

/**
 * Validate a corrected seal for one job of a duplicate group. Every group's
 * digits are held by at least one OTHER job, so none of them is free — that
 * includes the job's own group, whose digits are the clash being fixed.
 */
export function validateSealCorrection(raw, groups = []) {
  return validateSealNumber(raw, new Set(groups.map((g) => g.digits)));
}

export default { normalizeSealNumber, sealKey, collectSealKeys, validateSealNumber, isDuplicateSealError, sealValidationErrorOf, sealDuplicateGroupsOf, validateSealCorrection };
