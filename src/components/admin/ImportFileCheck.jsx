// src/components/admin/ImportFileCheck.jsx
// How the server will read a pending-installations sheet under a disco's
// import mapping: which header fills which field, what is kept as an extra,
// missing required columns, blank required cells and repeated account
// numbers. A preview only — the server validates the upload itself, and a
// repeated or already-imported account is skipped there, not duplicated.
// Logic: checkSheetAgainstMapping (utils/discoImportMapping.js).
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export default function ImportFileCheck({ check }) {
  if (!check) return null;
  const problems = check.missingRequired.length > 0 || check.blankRequired.length > 0;
  const matched = check.columns.filter((c) => c.header);

  return (
    <div className={`rounded-lg border p-3 text-xs space-y-2 ${
      problems
        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
        : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    }`}>
      <p className={`flex items-start gap-2 text-sm font-medium ${problems ? 'text-amber-800 dark:text-amber-300' : 'text-green-800 dark:text-green-300'}`}>
        {problems ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
        {check.rowCount.toLocaleString()} row{check.rowCount === 1 ? '' : 's'} ·{' '}
        {problems ? 'some rows or columns need attention' : 'every required column is present'}
      </p>

      {check.missingRequired.length > 0 && (
        <p className="text-amber-800 dark:text-amber-300">
          Missing required column{check.missingRequired.length === 1 ? '' : 's'}: {check.missingRequired.join(', ')}. The server will refuse this file.
        </p>
      )}
      {check.blankRequired.map((b) => (
        <p key={b.label} className="text-amber-800 dark:text-amber-300">
          {b.count.toLocaleString()} row{b.count === 1 ? ' has' : 's have'} no {b.label.toLowerCase()} and will be rejected.
        </p>
      ))}
      {check.duplicateKeys.length > 0 && (
        <p className="text-gray-700 dark:text-gray-300">
          {check.duplicateKeys.length} account number{check.duplicateKeys.length === 1 ? '' : 's'} appear more than once
          ({check.duplicateKeys.slice(0, 3).map((d) => d.key).join(', ')}{check.duplicateKeys.length > 3 ? '…' : ''}) — only one request is created per account.
        </p>
      )}

      {matched.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-gray-700 dark:text-gray-300">
          {matched.map((c) => (
            <div key={c.field} className="flex gap-1.5 min-w-0">
              <dt className="font-mono truncate">{c.header}</dt>
              <dd className="truncate">→ {c.label}{c.required ? ' *' : ''}</dd>
            </div>
          ))}
        </dl>
      )}
      {check.unmappedHeaders.length > 0 && (
        <p className="text-gray-600 dark:text-gray-400">
          {check.captureExtras ? 'Kept on each record as extra details: ' : 'Not imported: '}
          <span className="font-mono">{check.unmappedHeaders.join(', ')}</span>
        </p>
      )}
    </div>
  );
}
