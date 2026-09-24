// src/utils/apiResult.js
// This API can answer 2xx with `{ success: false, message: "..." }`.
//
// jedApi.handleResponse only throws on a non-OK HTTP status, so such a body
// resolves like a success: the caller closes its modal, refetches, and the
// record is unchanged — a mutation that silently did nothing. InstallationDetail
// has guarded against this since 2026-09-21 (see PROJECT_CONTEXT.md, "JED
// completion"); this is that check, shared, for every mutation that needs it.
//
// It is deliberately narrow: only an explicit `success === false` is a failure.
// A response with no `success` key at all is left alone, because several
// endpoints legitimately return bare data.
import { getErrorMessage } from './errorMessage';

/**
 * Throw when the body says the operation failed, otherwise return it.
 * The thrown message goes through getErrorMessage at the call site, so the
 * server's own wording is shown when it is safe and short, and the caller's
 * fallback when it isn't.
 *
 * @param {any} response - the parsed body from a jedApi call
 * @param {string} fallback - what to say when the body gives no usable reason
 * @returns {any} the same response
 */
export function assertApiSuccess(response, fallback = 'The server did not confirm that action.') {
  if (response && typeof response === 'object' && response.success === false) {
    throw new Error(response.message || fallback);
  }
  return response;
}

/** assertApiSuccess + getErrorMessage in one step, for a caller's catch block. */
export const describeApiFailure = (err, fallback) => getErrorMessage(err, fallback);

export default assertApiSuccess;
