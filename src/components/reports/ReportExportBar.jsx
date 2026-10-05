// src/components/reports/ReportExportBar.jsx
// [Export Excel] [Export CSV] [Print / PDF] for any report (2026-10-05).
//
// The caller passes `build`: an async function returning the report
// (utils/reportExport.js) for exactly what is on screen — its filters, every
// page. All three actions call the same `build`, so the .xlsx, the .csv and
// the printed page are the same records and figures.
//
// One action at a time: a ref refuses a second click before React re-renders,
// every button is disabled while one runs, and `finally` always restores them.
// Failures show one plain sentence; the technical error goes to the console.
//
// Print renders <PrintableReport> into a portal on <body> and marks the body
// `printing-report`, so the print stylesheet (index.css) hides the whole app
// and prints only the report: header, filters, tables, notes, page numbers.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { FileSpreadsheet, FileText, Printer, Loader2 } from 'lucide-react';
import {
  SYSTEM_NAME, cellText, reportHasRows, downloadReportXlsx, downloadReportCsv,
} from '../../utils/reportExport';
import { formatDateTime } from '../../utils/date';

const BUSY_TEXT = {
  xlsx: 'Preparing Excel…',
  csv: 'Preparing CSV…',
  print: 'Preparing report for printing…',
};
const FAIL_TEXT = {
  xlsx: 'Unable to export this report. Please try again.',
  csv: 'Unable to export this report. Please try again.',
  print: 'Unable to prepare the report for printing. Please try again.',
};
export const NO_DATA_TEXT = 'No data available for the selected filters.';

/** The printed report. Light-theme only: paper doesn't have a dark mode. */
export function PrintableReport({ report }) {
  if (!report) return null;
  return (
    <div className={`report-print-root ${report.orientation === 'portrait' ? 'portrait' : 'landscape'} text-gray-900 bg-white`}>
      <header className="border-b border-gray-400 pb-2 mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">{SYSTEM_NAME}</p>
        <h1 className="text-lg font-bold">{report.title}</h1>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-[10px]">
          {(report.filters?.length ? report.filters : [{ label: 'Filters', value: 'None' }]).map((f) => (
            <div key={f.label} className="contents"><dt className="font-semibold">{f.label}</dt><dd>{f.value}</dd></div>
          ))}
          <dt className="font-semibold">Generated</dt><dd>{formatDateTime(report.generatedAt)}</dd>
        </dl>
      </header>
      {report.tables.map((t) => (
        <section key={t.name} className="mb-4">
          {report.tables.length > 1 && <h2 className="text-sm font-semibold mb-1">{t.title || t.name}</h2>}
          {t.rows.length === 0 ? (
            <p className="text-[10px] text-gray-600">{NO_DATA_TEXT}</p>
          ) : (
            <table className="w-full border-collapse text-[9px]">
              <thead>
                <tr>
                  {t.columns.map((c) => (
                    <th key={c.key} className="border border-gray-400 bg-gray-100 px-1 py-0.5 text-left font-semibold">{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, i) => (
                  <tr key={i}>
                    {t.columns.map((c) => (
                      <td key={c.key} className="border border-gray-300 px-1 py-0.5 align-top break-words">{cellText(row[c.key], c.type, 'print')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-0.5 text-[9px] text-gray-600">{t.rows.length.toLocaleString()} row{t.rows.length === 1 ? '' : 's'}</p>
        </section>
      ))}
      {report.notes?.length > 0 && (
        <ul className="text-[9px] text-gray-700 list-disc pl-4">
          {report.notes.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      <p className="mt-3 text-[9px] text-gray-500">{SYSTEM_NAME} · {report.title} · generated {formatDateTime(report.generatedAt)}</p>
    </div>
  );
}

/**
 * @param {{ build: () => Promise<object>, disabled?: boolean, disabledReason?: string|null,
 *   label?: string, formats?: ('xlsx'|'csv'|'print')[] }} props
 *   disabled: e.g. still loading or nothing to export; disabledReason is shown.
 */
export default function ReportExportBar({
  build, disabled = false, disabledReason = null, label = 'Export this report', formats = ['xlsx', 'csv', 'print'],
}) {
  const [busy, setBusy] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [printReport, setPrintReport] = useState(null);
  const running = useRef(false);

  // Always leave print mode, whichever way the dialog closed.
  useEffect(() => {
    const done = () => { document.body.classList.remove('printing-report'); setPrintReport(null); };
    window.addEventListener('afterprint', done);
    return () => { window.removeEventListener('afterprint', done); document.body.classList.remove('printing-report'); };
  }, []);

  const run = useCallback(async (kind) => {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(kind);
    setError(null);
    try {
      const report = await build();
      if (!reportHasRows(report)) { setError(NO_DATA_TEXT); return; }
      if (kind !== 'print') setDownloading(true);
      if (kind === 'xlsx') await downloadReportXlsx(report);
      else if (kind === 'csv') downloadReportCsv(report);
      else {
        // The report must be in the DOM before the synchronous print() call.
        flushSync(() => setPrintReport(report));
        document.body.classList.add('printing-report');
        window.print();
      }
    } catch (err) {
      console.error(`[ReportExport] ${kind} failed:`, err);
      setError(err?.userMessage || FAIL_TEXT[kind]);
    } finally {
      running.current = false;
      setBusy(null);
      setDownloading(false);
    }
  }, [build, disabled]);

  const button = (kind, Icon, text) => (
    <button key={kind} type="button" onClick={() => run(kind)} disabled={disabled || busy !== null}
      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
      {busy === kind ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
      {text}
    </button>
  );

  return (
    <div className="print:hidden">
      <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
        {formats.includes('xlsx') && button('xlsx', FileSpreadsheet, 'Export Excel')}
        {formats.includes('csv') && button('csv', FileText, 'Export CSV')}
        {formats.includes('print') && button('print', Printer, 'Print / PDF')}
        <span className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
          {busy ? (downloading ? 'Downloading…' : BUSY_TEXT[busy]) : disabled && disabledReason ? disabledReason : ''}
        </span>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>}
      {printReport && createPortal(<PrintableReport report={printReport} />, document.body)}
    </div>
  );
}
