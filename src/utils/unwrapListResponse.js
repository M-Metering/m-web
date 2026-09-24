// src/utils/unwrapListResponse.js
// Single source of truth for pulling a list out of an API response whose
// envelope shape varies by endpoint — sometimes a bare array, sometimes
// { data: [...] }, sometimes { data: { results: [...] } }. Previously this
// exact fallback chain was hand-duplicated with a slightly different alias
// set in InstallerDashboard.jsx, AdminInstallations.jsx, PaymentsPage.jsx
// (as unwrapPaymentsPayload), and MeterSchedule.jsx (as an inline ~15-branch
// chain) — see CodeBaseAudit.md's "Repeated / duplicate logic" finding.
//
// This intentionally only unwraps a *list*. MeterSchedule's separate
// pagination-field extraction (page/limit/total/pages, several of which the
// real API returns under inconsistently-cased/typed keys) and stats-object
// unwrapping (unwrapStatsResponse/normalizeStats) are a different concern
// and are left as-is at their call sites.
const DEFAULT_KEYS = ['data', 'items', 'results', 'records'];

/**
 * @param {*} response - the raw API response
 * @param {string[]} extraKeys - endpoint-specific aliases to check before
 *   the default ones (e.g. ['payments', 'transactions'] for a payments list)
 * @returns {Array} the first array found, or [] if none of the known shapes match
 */
export function unwrapListResponse(response, extraKeys = []) {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== 'object') return [];

  const keys = [...extraKeys, ...DEFAULT_KEYS];

  for (const key of keys) {
    if (Array.isArray(response[key])) return response[key];
  }

  // One level deeper — e.g. { data: { results: [...] } } or { data: { data: [...] } }
  const { data } = response;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key];
    }
  }

  return [];
}
