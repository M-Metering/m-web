// src/components/installations/ExportChoiceModal.jsx
// Installations → "Export installations" asks which export is wanted first
// (2026-10-13):
//   Standard — the existing Completed Installations workbook, built in the
//              browser from exactly the rows on screen (pictures embedded).
//   Custom   — CustomExportModal: the server-built export where the user picks
//              columns, filters and totals, across every status.
import { useEffect, useRef } from 'react';
import { X, FileSpreadsheet, SlidersHorizontal, ChevronRight } from 'lucide-react';

function Option({ icon: Icon, title, children, note, disabled, onClick }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="w-full text-left p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-900/20 disabled:opacity-60 disabled:hover:bg-white dark:disabled:hover:bg-gray-800 disabled:hover:border-gray-200 dark:disabled:hover:border-gray-700 flex items-start gap-3">
      <span className="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
        <span className="block text-xs text-gray-600 dark:text-gray-400 mt-1">{children}</span>
        {note && <span className="block text-xs text-amber-700 dark:text-amber-400 mt-1">{note}</span>}
      </span>
      <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 mt-3" aria-hidden="true" />
    </button>
  );
}

/**
 * @param {{ isOpen: boolean, onClose: () => void, completedCount: number,
 *   standardBlockedReason?: string|null, onStandard: () => void, onCustom: () => void }} props
 */
function ExportChoiceModal({ isOpen, onClose, completedCount, standardBlockedReason, onStandard, onCustom }) {
  const titleRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    titleRef.current?.focus();
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const noneToExport = completedCount === 0;
  const standardNote = standardBlockedReason
    || (noneToExport ? 'No completed installations match your current filters, so there is nothing to put in this report.' : null);
  const n = completedCount.toLocaleString();

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="export-choice-title"
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg">
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="export-choice-title" ref={titleRef} tabIndex={-1} className="text-lg font-semibold text-gray-900 dark:text-white outline-none">
              What would you like to export?
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Pick the ready-made report, or build your own.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-6 space-y-3">
          <Option icon={FileSpreadsheet} title="Standard export — completed installations"
            disabled={!!standardNote} note={standardNote} onClick={onStandard}>
            The usual Excel report of the {n} completed installation{completedCount === 1 ? '' : 's'} shown on this page,
            using your current filters and installation dates. Includes pictures, picture links and a Summary sheet.
          </Option>
          <Option icon={SlidersHorizontal} title="Custom export — choose what to include" onClick={onCustom}>
            Pick the columns, filters and totals yourself — for example, installations per installer per week.
            Covers requests in every status, not only completed ones. Excel or CSV.
          </Option>
        </div>
      </div>
    </div>
  );
}

export default ExportChoiceModal;
