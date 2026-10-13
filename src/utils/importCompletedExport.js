// src/utils/importCompletedExport.js
// A pending-installations import (POST /imports/:discoCode/pending-installations)
// skips rows whose account already exists. When any of those accounts is
// already completed (INSTALLED/EXPORTED), the response carries
// `data.completedExport`: a link to a Completed Installations workbook for just
// those accounts — the same layout as the portal's "Export Completed
// Installations", except that pictures are links, not embedded (2026-10-13;
// it was the disco response sheet on 2026-10-12, and the old
// `{ rowCount, error }` case no longer happens). No statuses change.
//
//   null                                           nothing to offer
//   { rowCount, fileName, downloadUrl, expiresAt } a download
//
// The link (GET /imports/completed-exports/:token) needs NO login and is the
// only credential, valid for 7 days: open it directly (<a href>), never fetch
// it with the auth header, and treat it as sensitive — the file holds customer
// names, phones and addresses. Read `downloadUrl`, never parse `message`.
// Downloading it adds no entry to GET /installations/exports.

const HTTP_URL_RE = /^https?:\/\/\S+$/i;

/**
 * @param {object|null|undefined} data - the import response's `data`
 * @param {Date} [now]
 * @returns {null | { rowCount: number, url: string, fileName: string|null,
 *   expiresAt: string|null, expired: boolean }}
 */
export function completedExportOf(data, now = new Date()) {
  const ce = data?.completedExport;
  if (!ce || typeof ce !== 'object') return null;
  const rowCount = Number.isFinite(Number(ce.rowCount)) ? Number(ce.rowCount) : 0;

  const url = typeof ce.downloadUrl === 'string' ? ce.downloadUrl.trim() : '';
  if (!HTTP_URL_RE.test(url)) return null;

  const expiresAt = ce.expiresAt || null;
  const expiry = expiresAt ? new Date(expiresAt) : null;
  const expired = !!expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() <= now.getTime();
  return { rowCount, url, fileName: ce.fileName || null, expiresAt, expired };
}

export default completedExportOf;
