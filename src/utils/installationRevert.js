// src/utils/installationRevert.js
// "Unassign an installed meter" = POST /installations/{id}/revert (SUPERADMIN
// only, 2026-10-04). The API's own description: an INSTALLED job goes back to
// PENDING and unassigned, its meter returns to stock (AVAILABLE, unassigned)
// and its recognised revenue is cleared. There is no other endpoint that
// separates a meter from a customer after installation.
//
// What it can't do, and so is never offered:
//   - an EXPORTED job (already reported to the disco): the API answers 409
//   - a JED Remita request: that resource has no revert endpoint at all
//
// One rule for every screen that offers it (Installations, Installer Job
// Status, Meter Schedule → Installed), read from a NORMALISED row
// (normalizeMultiRow / normalizeJedRow). The role check is separate —
// permissions.canRevertInstallations — and is the caller's job.
import { ROW_SOURCE } from './installationScope';
import { getAvailableActions, INSTALLATION_STATUS } from './installationStatus';
import { completionDateOf } from './completedInstallationsReport';

/** Why this record can't be reverted, or null when it can. */
export function revertBlockReason(row) {
  if (!row) return 'No installation selected.';
  if (row.source === ROW_SOURCE.JED) {
    return 'JED Remita requests have no undo on the API, so this meter can’t be unassigned here.';
  }
  if (String(row.status).toUpperCase() === INSTALLATION_STATUS.EXPORTED) {
    return 'Already exported to the disco, so the API won’t undo it.';
  }
  if (!getAvailableActions(row.status).revert) return 'Only an installed job can be undone.';
  if (row.raw?.id === undefined || row.raw?.id === null) return 'This record has no installation id.';
  return null;
}

/**
 * Everything the confirmation names, or null when the row can't be reverted.
 * @returns {{ id: number|string, accountNumber: string, customerName: string,
 *   meterNumber: string, installerName: string, installationDate: string|null,
 *   disco: string }|null}
 */
export function revertTargetOf(row) {
  if (revertBlockReason(row)) return null;
  const raw = row.raw || {};
  return {
    id: raw.id,
    accountNumber: row.accountNumber || String(raw.accountNumber ?? ''),
    customerName: row.customerName || raw.customerName || '',
    meterNumber: raw.meterNumber != null ? String(raw.meterNumber) : '',
    installerName: raw.installerName || raw.assigneeName || '',
    installationDate: completionDateOf(row),
    disco: row.discoCode || raw.discoCode || '',
  };
}
