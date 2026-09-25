// src/utils/importUndo.js
// Reading the result of POST /imports/{id}/undo (added 2026-09-24).
//
// The undo is PARTIAL BY DESIGN and idempotent. It removes only rows nothing
// real depends on yet:
//   pending-installations batch — deletes PENDING / ASSIGNED / FAILED /
//     CANCELLED rows; keeps INSTALLED / EXPORTED / IN_PROGRESS, because those
//     are real field work or a report already sent to the disco;
//   meter-inventory batch      — deletes meters still UNASSIGNED and not
//     referenced by any installation; keeps anything dispatched or installed.
//
// So a non-zero `skippedCount` is the safety behaviour working, NOT a failure.
// Everything here exists to make a screen say that correctly: never render an
// undo with skipped rows as an error.
import { installationStatusLabel } from './installationStatus';

const toCount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Normalise an undo response into what a summary panel needs.
 *
 * @param {object} data - the `data` object of the undo response
 * @returns {{ deleted: number, skipped: number, reasons: {status: string, label: string, count: number}[],
 *   headline: string, detail: string|null, partial: boolean, noop: boolean }}
 */
export function summarizeUndoResult(data) {
  const payload = data?.data || data || {};
  const deleted = toCount(payload.deletedCount);
  const skipped = toCount(payload.skippedCount);

  const byReason = payload.skippedByReason && typeof payload.skippedByReason === 'object'
    ? payload.skippedByReason
    : {};
  const reasons = Object.entries(byReason)
    // A meter batch's reasons are meter statuses, not installation statuses;
    // installationStatusLabel falls back to the raw value for those, which
    // reads correctly ("USED", "ASSIGNED") and invents nothing.
    .map(([status, count]) => ({ status, label: installationStatusLabel(status), count: toCount(count) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  // Calling undo twice is legal and the second call simply removes nothing.
  const noop = deleted === 0 && skipped === 0;

  const headline = noop
    ? 'Nothing left to remove from this import.'
    : `Removed ${plural(deleted, 'row')} created by this import.`;

  const detail = skipped > 0
    ? `${plural(skipped, 'row')} kept because ${skipped === 1 ? 'it is' : 'they are'} already in use${
      reasons.length > 0 ? ` (${reasons.map((r) => `${r.count} ${r.label.toLowerCase()}`).join(', ')})` : ''
    }.`
    : null;

  return { deleted, skipped, reasons, headline, detail, partial: skipped > 0, noop };
}

/**
 * What the confirmation dialog says before an undo runs. It names the batch and
 * states the limit plainly, so nobody expects installed work to disappear.
 */
export function undoConfirmationMessage(batch) {
  const ref = batch?.batchRef || batch?.fileName || `batch ${batch?.id ?? ''}`.trim();
  const rows = toCount(batch?.totalRows);
  const scope = rows > 0 ? ` (${plural(rows, 'row')} in the original file)` : '';
  return `Remove the rows this import created${scope}? Only rows nothing depends on yet are removed — anything already installed, exported, in progress or dispatched to an installer is kept. This cannot be undone, and it does not delete the batch record itself.\n\nImport: ${ref}`;
}

export default { summarizeUndoResult, undoConfirmationMessage };
