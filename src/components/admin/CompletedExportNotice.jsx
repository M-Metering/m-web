// src/components/admin/CompletedExportNotice.jsx
// After a pending-installations import: the download of accounts in the sheet
// that are ALREADY completed (data.completedExport) — a Completed Installations
// workbook for just those accounts (2026-10-13). See
// utils/importCompletedExport.js for the link's rules: opened directly as a
// plain link (it needs no login), never fetched with the auth header, and
// sensitive — it holds customer names, phones and addresses.
import { Download } from 'lucide-react';
import { completedExportOf } from '../../utils/importCompletedExport';
import { formatDateTime } from '../../utils/date';

function CompletedExportNotice({ data }) {
  const ce = completedExportOf(data);
  if (!ce) return null;
  const one = ce.rowCount === 1;
  const accounts = `${ce.rowCount.toLocaleString()} account${one ? '' : 's'}`;

  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {accounts} in this sheet {one ? 'is' : 'are'} already installed, so {one ? 'it was' : 'they were'} skipped and
        nothing about {one ? 'it' : 'them'} changed. You can download {one ? 'its' : 'their'} completed installation
        details — the same layout as Export Completed Installations, with picture links instead of embedded pictures.
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
