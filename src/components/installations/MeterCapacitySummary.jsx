// src/components/installations/MeterCapacitySummary.jsx
// Required / assigned / still-needed meter figures for one installer, shown
// wherever an admin dispatches meters or jobs. Figures come from
// useInstallerMeterCapacity (live API reads) via computeMeterCapacity.
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { formatPhaseLabel } from '../../utils/installationScope';

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
 */
function MeterCapacitySummary({ capacity, loading, error, onRetry, addJobs = 0, addMeters = 0 }) {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400" role="status">
        <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
        Checking this installer's jobs and meters…
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

  const phases = Object.entries(capacity.byPhase).filter(([, b]) => b.required > 0 || b.assigned > 0);
  const afterJobs = capacity.required + addJobs;
  const neededAfterJobs = Math.max(afterJobs - capacity.assigned, 0);
  const neededAfterMeters = capacity.remaining - addMeters;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3 space-y-2" aria-live="polite">
      <div className="grid grid-cols-3 gap-2">
        <Figure label="Meters required" value={capacity.required} />
        <Figure label="Meters assigned" value={capacity.assigned} />
        <Figure label="Still needed" value={capacity.remaining} />
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        One meter per open job (assigned or in progress) for this disco.
        {capacity.surplus > 0 && ` Holding ${capacity.surplus} more meter${capacity.surplus === 1 ? '' : 's'} than open jobs.`}
      </p>
      {phases.length > 0 && (
        <ul className="text-[11px] text-gray-600 dark:text-gray-300 flex flex-wrap gap-x-3 gap-y-0.5">
          {phases.map(([key, b]) => (
            <li key={key}>{phaseLabel(key)}: {b.required} required · {b.assigned} assigned · {b.remaining} needed</li>
          ))}
        </ul>
      )}
      {addJobs > 0 && (
        <p className="text-xs text-gray-700 dark:text-gray-200">
          After assigning {addJobs} job{addJobs === 1 ? '' : 's'}: {neededAfterJobs} meter{neededAfterJobs === 1 ? '' : 's'} still needed.
        </p>
      )}
      {addMeters > 0 && (
        <p className={`text-xs ${neededAfterMeters < 0 ? 'text-red-700 dark:text-red-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}>
          {neededAfterMeters < 0
            ? `This dispatch is ${-neededAfterMeters} meter${neededAfterMeters === -1 ? '' : 's'} over what is needed.`
            : `After this dispatch: ${neededAfterMeters} meter${neededAfterMeters === 1 ? '' : 's'} still needed.`}
        </p>
      )}
    </div>
  );
}

export default MeterCapacitySummary;
