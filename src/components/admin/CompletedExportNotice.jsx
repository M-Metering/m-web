// src/components/admin/CompletedExportNotice.jsx
// After a pending-installations import: the download of accounts in the sheet
// that are ALREADY completed (data.completedExport, 2026-10-12). See
// utils/importCompletedExport.js for the shapes and the link's rules — opened
// directly as a plain link (it needs no login), never fetched with the auth
// header, and sensitive: it holds customer names, phones and addresses.
import { Download, AlertTriangle } from 'lucide-react';
import { completedExportOf } from '../../utils/importCompletedExport';
import { formatDateTime } from '../../utils/date';

function CompletedExportNotice({ data }) {
  const ce = completedExportOf(data);
  if (!ce) return null;
  const accounts = `${ce.rowCount.toLocaleString()} account${ce.rowCount === 1 ? '' : 's'}`;

  if (ce.kind === 'error') {
    return (
      <div role="alert" className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 dark:text-amber-300">
          {accounts} in this sheet {ce.rowCount === 1 ? 'is' : 'are'} already completed, but their response sheet
          could not be prepared: {ce.error}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {accounts} in this sheet {ce.rowCount === 1 ? 'is' : 'are'} already completed. Nothing about {ce.rowCount === 1 ? 'it' : 'them'} was
        changed; download the disco response sheet for just {ce.rowCount === 1 ? 'that account' : 'those accounts'}.
      </p>
      {ce.expired ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">This download link has expired. Re-import the sheet to get a new one.</p>
      ) : (
        <>
          <a
            href={ce.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700"
          >
            <Download className="w-4 h-4" /> Download completed installations ({ce.rowCount.toLocaleString()})
          </a>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Anyone with this link can download these customers’ details without signing in
            {ce.expiresAt ? `, until ${formatDateTime(ce.expiresAt)}` : ''}. Don’t share it.
          </p>
        </>
      )}
    </div>
  );
}

export default CompletedExportNotice;
