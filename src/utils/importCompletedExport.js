// src/utils/importCompletedExport.js
// A pending-installations import (POST /imports/:discoCode/pending-installations)
// skips rows whose account already exists. Since 2026-10-12, when any of those
// accounts is already completed (INSTALLED/EXPORTED), the response carries
// `data.completedExport`: a link to the disco's normal installation response
// sheet for just those accounts. No statuses change.
//
//   null                                         nothing to offer
//   { rowCount, fileName, downloadUrl, expiresAt } a download
//   { rowCount, error }                          found, but the disco has no
//                                                export template — show error
//
// The link (GET /imports/completed-exports/:token) needs NO login and is the
// only credential, valid for 7 days: open it directly (<a href>), never fetch
// it with the auth header, and treat it as sensitive — the file holds customer
// names, phones and addresses. Read `downloadUrl`, never parse `message`.

const HTTP_URL_RE = /^https?:\/\/\S+$/i;

/**
 * @param {object|null|undefined} data - the import response's `data`
 * @param {Date} [now]
 * @returns {null | { kind: 'download', rowCount: number, url: string, fileName: string|null,
 *   expiresAt: string|null, expired: boolean } | { kind: 'error', rowCount: number, error: string }}
 */
export function completedExportOf(data, now = new Date()) {
  const ce = data?.completedExport;
  if (!ce || typeof ce !== 'object') return null;
  const rowCount = Number.isFinite(Number(ce.rowCount)) ? Number(ce.rowCount) : 0;

  if (ce.error) return { kind: 'error', rowCount, error: String(ce.error) };

  const url = typeof ce.downloadUrl === 'string' ? ce.downloadUrl.trim() : '';
  if (!HTTP_URL_RE.test(url)) return null;

  const expiresAt = ce.expiresAt || null;
  const expiry = expiresAt ? new Date(expiresAt) : null;
  const expired = !!expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() <= now.getTime();
  return { kind: 'download', rowCount, url, fileName: ce.fileName || null, expiresAt, expired };
}

export default completedExportOf;
