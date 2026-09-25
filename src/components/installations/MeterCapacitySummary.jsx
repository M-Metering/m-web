// src/components/installations/MeterCapacitySummary.jsx
// What an installer is carrying, per meter type, wherever an admin dispatches
// meters or jobs:
//
//   Assigned Installations   open jobs (ASSIGNED or IN_PROGRESS) in this disco
//   Assigned Meters          meters of that type currently in their hands
//   Available Meter Capacity installations - meters, never below zero
//
// Broken out per meter type because the two capacities are independent: an
// installer with 5 Single Phase jobs and 2 Three Phase jobs who already holds
// 5 Single Phase meters can still be given 2 Three Phase ones.
//
// Every figure comes from useInstallerMeterCapacity (live API reads) via
// computeMeterCapacity — nothing here is derived from component state or from
// a count the API didn't return. Rows for both real meter types are always
// shown, including zeros, so "Three Phase: 0 available" explains itself rather
// than the row simply being absent.
import { Loader2, AlertCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { formatPhaseLabel } from '../../utils/installationScope';
// The two real phase types, from the one place that already lists them.
import { METER_PHASE_TYPES } from '../../utils/installationStatus';
import { phaseCapacity } from '../../utils/meterCapacity';

const phaseLabel = (key) => (key === 'UNSPECIFIED' ? 'Phase not recorded' : formatPhaseLabel(key));

function Figure({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-lg font-bold leading-tight text-gray-900 dark:text-white">{value}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{label}</p>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object|null} props.capacity - computeMeterCapacity() result
 * @param {boolean} props.loading
 * @param {string|null} props.error
 * @param {() => void} props.onRetry
 * @param {number} [props.addJobs] - jobs about to be assigned (projection)
 * @param {number} [props.addMeters] - new meters about to be dispatched (projection)
 * @param {boolean} [props.enforced] - false when the viewer's role isn't capped
 *   by these figures (Super Admin); they are then information, not a limit.
 */
function MeterCapacitySummary({ capacity, loading, error, onRetry, addJobs = 0, addMeters = 0, enforced = true }) {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400" role="status">
        <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
        Checking this installer&apos;s jobs and meters…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          <button type="button" onClick={onRetry}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300 hover:underline">
            <RefreshCw className="w-3 h-3" /> Try again
          </button>
        </div>
      </div>
    );
  }

  if (!capacity) return null;

  // Both real meter types always, plus any other bucket the data produced
  // (today only 'UNSPECIFIED', when a record carries no phase at all).
  const extraKeys = Object.keys(capacity.byPhase)
    .filter((key) => !METER_PHASE_TYPES.includes(key))
    .filter((key) => capacity.byPhase[key].required > 0 || capacity.byPhase[key].assigned > 0);
  const rows = [...METER_PHASE_TYPES, ...extraKeys].map((key) => ({ key, ...phaseCapacity(capacity, key) }));

  const afterJobs = capacity.required + addJobs;
  const neededAfterJobs = Math.max(afterJobs - capacity.assigned, 0);
  const neededAfterMeters = capacity.remaining - addMeters;
  const overBy = -neededAfterMeters;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3 space-y-2.5" aria-live="polite">
      <div className="grid grid-cols-3 gap-2">
        <Figure label="Assigned installations" value={capacity.required} />
        <Figure label="Assigned meters" value={capacity.assigned} />
        <Figure label="Available capacity" value={capacity.remaining} />
      </div>

      <table className="w-full text-[11px]">
        <caption className="sr-only">
          Assigned installations, assigned meters and available meter capacity, per meter type
        </caption>
        <thead>
          <tr className="text-gray-500 dark:text-gray-400">
            <th scope="col" className="text-left font-medium py-1">Meter type</th>
            <th scope="col" className="text-right font-medium py-1">Installations</th>
            <th scope="col" className="text-right font-medium py-1">Meters</th>
            <th scope="col" className="text-right font-medium py-1">Available</th>
          </tr>
        </thead>
        <tbody className="text-gray-700 dark:text-gray-200">
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-gray-200 dark:border-gray-700">
              <th scope="row" className="text-left font-medium py-1">{phaseLabel(row.key)}</th>
              <td className="text-right tabular-nums py-1">{row.required}</td>
              <td className="text-right tabular-nums py-1">{row.assigned}</td>
              <td
                className={`text-right tabular-nums py-1 font-semibold ${
                  enforced && row.remaining === 0
                    ? 'text-gray-400 dark:text-gray-500'
                    : 'text-gray-900 dark:text-white'
                }`}
              >
                {row.remaining}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        One meter per open job (assigned or in progress) for this disco.
        {capacity.surplus > 0 && ` Holding ${capacity.surplus} more meter${capacity.surplus === 1 ? '' : 's'} than open jobs.`}
      </p>

      {!enforced && (
        <p className="text-[11px] text-gray-600 dark:text-gray-300 flex items-start gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px text-brand-600 dark:text-brand-400" />
          Shown for reference. As a Super Administrator you can dispatch meters
          independently of these installation assignments.
        </p>
      )}

      {addJobs > 0 && (
        <p className="text-xs text-gray-700 dark:text-gray-200">
          After assigning {addJobs} job{addJobs === 1 ? '' : 's'}: {neededAfterJobs} meter{neededAfterJobs === 1 ? '' : 's'} still needed.
        </p>
      )}
      {addMeters > 0 && (
        <p className={`text-xs ${enforced && neededAfterMeters < 0 ? 'text-red-700 dark:text-red-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}>
          {neededAfterMeters < 0
            ? (enforced
              ? `This dispatch is ${overBy} meter${overBy === 1 ? '' : 's'} over what is needed.`
              : `This dispatch is ${overBy} meter${overBy === 1 ? '' : 's'} more than this installer's open jobs need.`)
            : `After this dispatch: ${neededAfterMeters} meter${neededAfterMeters === 1 ? '' : 's'} still needed.`}
        </p>
      )}
    </div>
  );
}

export default MeterCapacitySummary;
