// src/utils/meterNumber.js
// A meter number is an IDENTIFIER, not a number.
//
// Why this file exists: the app used to treat a meter number as "exactly 13
// digits" and repaired anything shorter by padding it with leading zeros
// (utils/xlsx.js re-padded server-exported cells; InstallationDetail refused
// anything but 13 digits). Real meter numbers are 10-13 digits, so a genuine
// 11-digit serial such as "145345123456" was displayed and exported as
// "00145345123456" — two digits that are not part of the identifier.
//
// Rules, enforced by everything that touches a meter number:
//   - keep the exact characters the API/import source supplied;
//   - never pad, never truncate, never strip a legitimate leading zero;
//   - never put it through Number()/parseInt()/toFixed() — "0239110006909"
//     loses its leading zero and a 19-digit SIM serial loses precision;
//   - length is validated as a RANGE on operator input only, never used to
//     reshape a value that already exists.
export const METER_NUMBER_MIN_DIGITS = 10;
export const METER_NUMBER_MAX_DIGITS = 13;

const DIGITS_ONLY_RE = /^\d+$/;

/**
 * The exact meter number as a string, trimmed of accidental whitespace only.
 * Returns '' for null/undefined so callers can test truthiness.
 * @param {unknown} value
 * @returns {string}
 */
export function meterNumberText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export const METER_NUMBER_HINT =
  `${METER_NUMBER_MIN_DIGITS}-${METER_NUMBER_MAX_DIGITS} digits, exactly as printed on the meter`;

/**
 * Validate a meter number an operator typed. The value is never altered
 * beyond trimming — an invalid length is reported, not "fixed".
 * @param {unknown} raw
 * @returns {{ valid: boolean, value: string, error: string|null }}
 */
export function validateMeterNumber(raw) {
  const value = meterNumberText(raw);
  if (!value) {
    return { valid: false, value, error: 'Meter number is required.' };
  }
  if (!DIGITS_ONLY_RE.test(value)) {
    return { valid: false, value, error: 'Meter number must contain digits only.' };
  }
  if (value.length < METER_NUMBER_MIN_DIGITS || value.length > METER_NUMBER_MAX_DIGITS) {
    return {
      valid: false,
      value,
      error: `Meter number must be ${METER_NUMBER_MIN_DIGITS}-${METER_NUMBER_MAX_DIGITS} digits. Enter it exactly as printed.`,
    };
  }
  return { valid: true, value, error: null };
}

export default { meterNumberText, validateMeterNumber, METER_NUMBER_MIN_DIGITS, METER_NUMBER_MAX_DIGITS };
