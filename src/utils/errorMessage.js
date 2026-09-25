// src/utils/errorMessage.js
// Turns whatever a jedApi call threw into a short, safe, user-facing string.
// jedApi encodes an error's class as a `TYPE:` prefix on the message
// (AUTH_ERROR:, VALIDATION_ERROR:, NETWORK_ERROR:, …). Components previously
// stripped that ad hoc (`message.split(':')[1]` truncated any message that
// itself contained a colon, and several showed the raw prefixed string).
//
// Users see a short message; the full error stays in the console (every
// caller already console.error()s it). So this deliberately drops:
//   - any SERVER_ERROR body (a 500's message can be a database or runtime
//     error) — the caller's fallback is shown instead;
//   - the per-field detail jedApi appends to validation errors
//     ("Validation failed (installationDate: "x" is not allowed)"), which
//     describes backend validation internals rather than what to do;
//   - anything that looks like markup, a stack trace, a database/driver
//     error or a transport detail, or is simply too long to be a message.
const TYPE_PREFIX_RE = /^(AUTH_ERROR|VALIDATION_ERROR|PERMISSION_ERROR|NOT_FOUND|SERVER_ERROR|NETWORK_ERROR|VERIFICATION_ERROR):\s*/;
const MAX_LENGTH = 160;
const FIELD_DETAIL_RE = /\s*\((?:[\w.[\]-]+:\s[^)]*)\)\s*$/;
const TECHNICAL_RE = new RegExp([
  '<\\s*\\/?\\s*[a-z!][^>]*>', // markup
  '\\bat\\s+\\S+\\s+\\(', // stack frame
  '\\b(?:sequelize|prisma|mongo\\w*|postgres\\w*|sql\\w*|knex|typeorm)\\b',
  '\\b(?:constraint|violates|duplicate key|foreign key|relation\\s+"|column\\s+")',
  '\\b(?:ECONN\\w+|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\\b',
  '\\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\\b',
  'cannot read propert',
  '\\bundefined\\b',
  '\\[object ',
  '\\bHTTP \\d{3}\\b',
  '\\bCORS\\b',
  'internal server error',
  'invalid response format',
  'empty response',
  'jwt\\b',
  '"\\w+" is (?:not allowed|required|not a valid)', // Joi-style schema text
].join('|'), 'i');

export const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * @param {unknown} err
 * @param {string} [fallback] - the short, caller-specific message shown when
 *   the server's own text isn't fit to display.
 * @param {{ maxLength?: number }} [options] - raise `maxLength` only where the
 *   endpoint is known to return a long message that is genuinely FOR the user.
 *   POST /meters/upload is the one such case today: it answers 400 with the
 *   exact row, the exact column and the fix ("Format the METER NUMBER column
 *   as Text in Excel and re-upload"), which is worth more than any fallback
 *   and runs past the default cap. Every other filter still applies, so this
 *   never lets stack traces, SQL or schema internals through.
 */
export function getErrorMessage(err, fallback = GENERIC_ERROR, { maxLength = MAX_LENGTH } = {}) {
  const raw = String(err?.message ?? err ?? '').trim();
  if (!raw) return fallback;

  const match = raw.match(TYPE_PREFIX_RE);
  const type = match ? match[1] : null;
  const body = (match ? raw.slice(match[0].length) : raw).replace(FIELD_DETAIL_RE, '').trim();

  if (type === 'NETWORK_ERROR') {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  if (type === 'SERVER_ERROR') {
    return fallback;
  }

  const safe = body && body.length <= maxLength && !TECHNICAL_RE.test(body) ? body : null;

  if (type === 'PERMISSION_ERROR') {
    return safe || 'You do not have permission to do that.';
  }
  if (type === 'AUTH_ERROR') {
    return safe || 'Your session has expired. Please sign in again.';
  }
  return safe || fallback;
}

export default getErrorMessage;
