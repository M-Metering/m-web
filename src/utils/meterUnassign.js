// src/utils/meterUnassign.js
// "Unassign meter" — ONE rule for every screen that shows a meter
// (Installations, Assignments, Meter Schedule cards and drill-downs, Meter
// Inventory search results, Installer Job Status). The API has exactly two
// operations, and which one applies depends on where the meter is:
//
//   RETURN  the meter is with an installer, not yet installed (an open
//           dispatch batch item still ASSIGNED — see indexMeterHolders).
//           POST /assignments/meters/return { meterNumbers }: the batch item
//           is released and the meter is dispatchable again. Nothing else
//           changes — the meter record (status stays AVAILABLE, type
//           unchanged), the installer's installation jobs and every customer
//           record are untouched. ASSIGNMENTS.MANAGE: Admin, Super Admin,
//           Supervisor (permissions.canManageAssignments).
//   REVERT  the meter is installed on an imported job (INSTALLED, never
//           EXPORTED). POST /installations/{id}/revert — SUPERADMIN only
//           (permissions.canRevertInstallations); see utils/installationRevert.js.
//
// Neither deletes a meter. Anything else (available, faulty, retired, lost,
// installed on an exported job or a JED request) gets no action, because the
// backend would refuse it.
import jedApi from '../components/services/api';
import { meterSerial, meterAvailability, METER_AVAILABILITY } from './meterInventory';
import { normalizePhase } from './installationScope';
import { revertTargetOf, revertBlockReason } from './installationRevert';
import { assertApiSuccess } from './apiResult';
import { summarizeBatchResult } from './installationStatus';

export const UNASSIGN_KIND = Object.freeze({ RETURN: 'RETURN', REVERT: 'REVERT' });

/**
 * Which unassignment, if any, this viewer may perform on this meter.
 * @param {{ meter: object, holder?: object|null, installationRow?: object|null,
 *   canReturn?: boolean, canRevert?: boolean }} args
 *   installationRow: the NORMALISED completed installation that reports this
 *   meter (installationDetailsOf(...).row), when known.
 * @returns {{ kind: 'RETURN', target: object } | { kind: 'REVERT', target: object } | null}
 */
export function unassignActionFor({ meter, holder = null, installationRow = null, canReturn = false, canRevert = false }) {
  const serial = meterSerial(meter);
  if (!serial) return null;
  const { key } = meterAvailability(meter, holder);
  if (key === METER_AVAILABILITY.ASSIGNED && holder && canReturn === true) {
    return {
      kind: UNASSIGN_KIND.RETURN,
      target: {
        meterNumber: serial,
        phaseType: normalizePhase(meter?.phaseType) || normalizePhase(holder.phaseType) || null,
        installerName: holder.installerName || null,
        assignedAt: holder.assignedAt || null,
        batchRef: holder.batchRef || null,
      },
    };
  }
  if (key === METER_AVAILABILITY.INSTALLED && canRevert === true && installationRow) {
    const target = revertTargetOf(installationRow);
    return target ? { kind: UNASSIGN_KIND.REVERT, target } : null;
  }
  return null;
}

/** Why an installed meter can't be unassigned (for a Super Admin), or null. */
export const installedUnassignBlockReason = (installationRow) =>
  (installationRow ? revertBlockReason(installationRow) : 'Its installation record could not be found.');

/**
 * Read a POST /assignments/meters/return response for the serials sent.
 * Partial success is possible, so a 200 is not proof every meter came back.
 * @returns {{ returned: string[], rejected: { meterNumber: string, reason: string }[] }}
 */
export function parseReturnResult(response, requested = []) {
  const data = response?.data ?? response ?? {};
  const { rejections } = summarizeBatchResult(data);
  const rejected = rejections.map((r) => ({ meterNumber: r.label, reason: r.reason }));
  const refused = new Set(rejected.map((r) => r.meterNumber));
  return { returned: requested.filter((n) => !refused.has(n)), rejected };
}

/**
 * THE call that releases meters from an installer, for every screen.
 * Throws on a transport error or a { success: false } body; otherwise
 * returns the per-meter outcome. The caller bumps notifyDataChanged.
 * @param {string[]} meterNumbers - exact strings, never coerced
 */
export async function returnMetersToStock(meterNumbers) {
  const serials = meterNumbers.map((n) => String(n));
  const response = assertApiSuccess(await jedApi.returnMeters(serials), 'The server did not confirm the return.');
  return parseReturnResult(response, serials);
}
