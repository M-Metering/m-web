// src/utils/sealNumber.js
// Seal numbers identify one physical seal and must never be reused.
//
// The live API neither documents a uniqueness constraint on
// `sealNumber`/`sealNo` nor exposes a "find installation by seal" lookup, so
// the frontend CANNOT prove a seal is globally unused (see API_GAP_REPORT.md).
// What it can do, and does here:
//   1. reject the obvious duplicate it can see — a seal already recorded on a
//      job in the installer's own list — before a pointless round trip;
//   2. recognise a duplicate/unique-constraint rejection coming back from the
//      backend and show the same plain message instead of a database string.
// Uniqueness across installers, and the two-simultaneous-submissions race,
// can only be settled by a database constraint on the server.
const DUPLICATE_ERROR_RE =
  /(duplicate|already (?:been )?(?:used|exists|taken|recorded|registered)|must be unique|unique constraint|already in use)/i;
const SEAL_MENTION_RE = /seal/i;

export const DUPLICATE_SEAL_MESSAGE =
  'This seal number has already been used. Please enter a unique seal number.';

/** The seal exactly as it should be sent: accidental whitespace removed, nothing else changed. */
export function normalizeSealNumber(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Comparison key. Seals are compared case-insensitively and ignoring internal
 * whitespace so "aple 0099123" can't slip past "APLE0099123"; the value that
 * is SENT is still whatever the installer typed (trimmed).
 */
export const sealKey = (value) => normalizeSealNumber(value).replace(/\s+/g, '').toUpperCase();

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
 * Validate a seal against what this client can see.
 * @param {unknown} raw
 * @param {Set<string>} [usedKeys]
 * @returns {{ valid: boolean, value: string, error: string|null }}
 */
export function validateSealNumber(raw, usedKeys = new Set()) {
  const value = normalizeSealNumber(raw);
  if (!value) return { valid: false, value, error: 'Seal number is required.' };
  if (usedKeys.has(sealKey(value))) {
    return { valid: false, value, error: DUPLICATE_SEAL_MESSAGE };
  }
  return { valid: true, value, error: null };
}

/**
 * Whether a rejected submission was rejected because the seal is taken.
 * Matched on the raw error text, before getErrorMessage() drops it as a
 * technical database string.
 */
export function isDuplicateSealError(err) {
  const raw = String(err?.message ?? err ?? '');
  if (!raw) return false;
  return DUPLICATE_ERROR_RE.test(raw) && SEAL_MENTION_RE.test(raw);
}

export default { normalizeSealNumber, sealKey, collectSealKeys, validateSealNumber, isDuplicateSealError };
