// src/components/installations/BatchResultSummary.jsx
// Renders the outcome of an import or an assignment.
//
// Both use PARTIAL SUCCESS: a 201 can still carry rejected rows, and a 200
// means nothing landed at all. The integration guide is explicit that reading
// only the status code hides bad spreadsheet rows and already-assigned meters,
// so this component always shows the counters and lists every rejection with
// the row number or key the backend gave — which is what lets an operator fix
// the exact line in the source file.
import { CheckCircle, AlertTriangle, XCircle, SkipForward } from 'lucide-react';
import { summarizeBatchResult } from '../../utils/installationStatus';

function Counter({ icon: Icon, label, value, tone }) {
  const tones = {
    green: 'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    slate: 'text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700',
    red: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${tones[tone]}`}>
      <Icon className="w-4 h-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight">{value}</p>
        <p className="text-[11px] leading-tight opacity-80">{label}</p>
      </div>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.data - the `data` object from an import/assignment response
 * @param {string} [props.acceptedLabel] - e.g. 'Imported' or 'Assigned'
 */
function BatchResultSummary({ data, acceptedLabel = 'Accepted' }) {
  if (!data) return null;
  const summary = summarizeBatchResult(data);

  return (
    <div className="space-y-3">
      {summary.nothingLanded && (
        <div role="status" className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Nothing was added. Check the rejected rows below — the file may already have been processed.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Counter icon={CheckCircle} label={acceptedLabel} value={summary.accepted} tone="green" />
        {summary.skipped > 0 && (
          <Counter icon={SkipForward} label="Already present" value={summary.skipped} tone="slate" />
        )}
        {summary.rejected > 0 && (
          <Counter icon={XCircle} label="Rejected" value={summary.rejected} tone="red" />
        )}
      </div>

      {summary.rejections.length > 0 && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 overflow-hidden">
          <p className="px-3 py-2 text-xs font-semibold text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-900/20">
            Rejected ({summary.rejections.length}
            {summary.rejected > summary.rejections.length ? ` of ${summary.rejected} shown` : ''})
          </p>
          <ul className="divide-y divide-red-100 dark:divide-red-900/40 max-h-64 overflow-y-auto">
            {summary.rejections.map((r, i) => (
              <li key={`${r.label}-${i}`} className="px-3 py-2 flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
                <span className="font-mono text-xs text-gray-900 dark:text-white shrink-0">{r.label}</span>
                <span className="text-xs text-gray-600 dark:text-gray-400 min-w-0">{r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default BatchResultSummary;
