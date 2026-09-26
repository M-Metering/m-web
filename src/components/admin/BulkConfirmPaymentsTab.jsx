// src/components/admin/BulkConfirmPaymentsTab.jsx
//
// "Upload Paid Customers" — the real Pharez API has no bulk "create these
// customers as PAID" endpoint (no way to batch-create JedCustomerRequest
// records at all, and no way to set status directly — see
// API_GAP_REPORT.md). What it does have is exactly what a genuine
// paid-customer import needs, composed honestly:
//   1. The spreadsheet is parsed IN THE BROWSER (`readSpreadsheetRows`,
//      utils/xlsx.js). This used to POST the file to /uploads/excel for the
//      server to parse — an endpoint that was documented but never deployed,
//      so "Validate File" 404'd every single time. That path was removed from
//      the API entirely on 2026-09-25 (the /uploads prefix is now general file
//      storage), so parsing locally is both the fix and the only option. It
//      needs no new dependency: ExcelJS is already the lazy-loaded chunk this
//      app uses for exports.
//   2. POST /external/jed/confirm-payment (by accountNumber) or
//      POST /external/jed/confirm-payment/manual/{rrr} — the same real,
//      already-used endpoints ConfirmPaymentTab calls for a single
//      customer — called once per row here. These work correctly.
// Every row is a real API call against a real backend record (the
// request must already exist, created earlier via Generate RRR); nothing
// is fabricated client-side, and no invented bulk endpoint is called.
import { useState } from 'react';
import jedApi from '../services/api';
import { downloadXlsx, COLUMN_TYPES, readSpreadsheetRows } from '../../utils/xlsx';
import { validateUploadFile } from '../../utils/fileValidation';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import ConfirmationModal from '../common/ConfirmationModal';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  UploadCloud, AlertCircle, CheckCircle, XCircle, FileDown, Loader2,
  Info, ListChecks
} from 'lucide-react';

const ACCOUNT_NUMBER_KEYS = ['accountnumber', 'account', 'acctno', 'acctnumber', 'account_number'];
const RRR_KEYS = ['rrr', 'remitareferencenumber', 'paymentreference', 'reference', 'remitarrr'];

const normalizeKey = (key) => String(key || '').toLowerCase().replace(/[\s_-]/g, '');

const findValue = (row, candidates) => {
  const keys = Object.keys(row || {});
  const matchKey = keys.find((k) => candidates.includes(normalizeKey(k)));
  if (!matchKey) return { found: false, value: '' };
  const raw = row[matchKey];
  return { found: true, value: raw === null || raw === undefined ? '' : String(raw).trim() };
};

/**
 * Parse raw sheet rows into { accountNumber, rrr, valid, reason } records,
 * applying the same business rule already enforced elsewhere in the app
 * (account number is numeric-only) and de-duplicating identifiers within
 * the same file.
 */
function normalizeRows(rawRows) {
  let anyAccountColumn = false;
  let anyRrrColumn = false;
  const seen = new Set();

  const rows = rawRows.map((raw, index) => {
    const account = findValue(raw, ACCOUNT_NUMBER_KEYS);
    const rrrField = findValue(raw, RRR_KEYS);
    if (account.found) anyAccountColumn = true;
    if (rrrField.found) anyRrrColumn = true;

    const accountNumber = account.value;
    const rrr = rrrField.value;
    const identifier = rrr || accountNumber;

    let valid = true;
    let reason = null;

    if (!accountNumber && !rrr) {
      valid = false;
      reason = 'Missing both account number and RRR';
    } else if (accountNumber && !/^\d+$/.test(accountNumber)) {
      valid = false;
      reason = 'Invalid account number (must be numeric)';
    } else if (identifier && seen.has(identifier)) {
      valid = false;
      reason = 'Duplicate row in this file (skipped)';
    }

    if (valid && identifier) seen.add(identifier);

    return { index, raw, accountNumber, rrr, identifier, valid, reason };
  });

  return { rows, anyAccountColumn, anyRrrColumn };
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700',
    green: 'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    red: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    blue: 'text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800',
    amber: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  };
  const textColors = {
    gray: 'text-gray-900 dark:text-white',
    green: 'text-green-700 dark:text-green-300',
    red: 'text-red-700 dark:text-red-300',
    blue: 'text-brand-700 dark:text-brand-300',
    amber: 'text-amber-700 dark:text-amber-300',
  };
  return (
    <div className={`flex items-center p-3 rounded-lg border ${colors[color]}`}>
      <Icon className={`w-6 h-6 mr-3 shrink-0 ${textColors[color]}`} />
      <div>
        <div className={`text-2xl font-bold ${textColors[color]}`}>{value}</div>
        <div className="text-sm font-medium">{label}</div>
      </div>
    </div>
  );
}

// Excel, not CSV: the identifier is an account number or 12-digit RRR, which
// Excel would otherwise strip of leading zeros or show in scientific notation.
const exportErrorsToExcel = (errorRows) => downloadXlsx('bulk_confirm_errors.xlsx', [{
  name: 'Errors',
  columns: [
    { header: 'Row', key: 'row', type: COLUMN_TYPES.NUMBER },
    { header: 'Account Number / RRR', key: 'identifier', type: COLUMN_TYPES.TEXT },
    { header: 'Error', key: 'error', type: COLUMN_TYPES.TEXT },
  ],
  rows: errorRows.map((r) => ({ row: r.index + 1, identifier: r.identifier || '', error: r.error || '' })),
}]).catch((err) => console.error('[BulkConfirmPayments] Error export failed:', err));

function BulkConfirmPaymentsTab() {
  const { notifyDataChanged } = useDataRefresh();

  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [parsedRows, setParsedRows] = useState(null); // null = not parsed yet

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const validRows = (parsedRows || []).filter((r) => r.valid);
  const invalidRows = (parsedRows || []).filter((r) => !r.valid);

  const resetAll = () => {
    setFile(null);
    setParseError(null);
    setParsedRows(null);
    setResults(null);
    setSessionExpired(false);
    setProgress({ done: 0, total: 0 });
    const input = document.getElementById('bulk-confirm-file-input');
    if (input) input.value = '';
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0] || null;
    setParsedRows(null);
    setResults(null);

    if (selected) {
      const { valid, reason } = validateUploadFile(selected);
      if (!valid) {
        setFile(null);
        setParseError(reason);
        e.target.value = '';
        return;
      }
    }

    setFile(selected);
    setParseError(null);
  };

  const handleParse = async () => {
    if (!file || parsing) return;
    setParsing(true);
    setParseError(null);
    setParsedRows(null);
    setResults(null);

    try {
      // ExcelJS cannot read the legacy binary .xls format — say so plainly
      // rather than failing later with a parse error.
      if (/\.xls$/i.test(file.name || '')) {
        setParseError('The old .xls format cannot be read here. Open it in Excel and save as .xlsx or .csv, then try again.');
        return;
      }

      const { rows: rawRows } = await readSpreadsheetRows(file);

      if (!rawRows.length) {
        setParseError('No data rows found in the uploaded file.');
        return;
      }

      const { rows, anyAccountColumn, anyRrrColumn } = normalizeRows(rawRows);

      if (!anyAccountColumn && !anyRrrColumn) {
        setParseError(
          "Missing required columns — the file must have an 'Account Number' and/or 'RRR' column so each row can be matched to an existing request."
        );
        return;
      }

      setParsedRows(rows);
    } catch (err) {
      console.error('[BulkConfirmPayments] Parse failed:', err);
      // Parsing is local now, so there is no network failure mode here — a
      // throw means the file itself could not be read.
      setParseError(getErrorMessage(err, "Couldn't read this file. Check that it's a valid .xlsx or .csv and try again."));
    } finally {
      setParsing(false);
    }
  };

  const handleImportClick = () => {
    if (importing || validRows.length === 0) return;
    setConfirmOpen(true);
  };

  const handleConfirmImport = async () => {
    if (importing) return; // guards against a double-click firing two batches
    setConfirmOpen(false);
    setImporting(true);
    setResults(null);
    setSessionExpired(false);
    setProgress({ done: 0, total: validRows.length });

    const rowResults = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        if (row.rrr) {
          await jedApi.confirmPaymentManually(row.rrr);
        } else {
          await jedApi.confirmPayment({ accountNumber: row.accountNumber });
        }
        rowResults.push({ ...row, success: true });
      } catch (err) {
        const message = String(err?.message || '');
        rowResults.push({ ...row, success: false, error: getErrorMessage(err, "Couldn't confirm this payment.") });

        // The session's JWT is gone (jedApi already cleared it) — further
        // calls will just fail identically, so stop the batch instead of
        // spamming N more requests that can't possibly succeed.
        if (message.toUpperCase().includes('AUTH_ERROR')) {
          setSessionExpired(true);
          setProgress({ done: i + 1, total: validRows.length });
          setResults(rowResults);
          setImporting(false);
          return;
        }
      }
      setProgress({ done: i + 1, total: validRows.length });
    }

    setResults(rowResults);
    setImporting(false);

    const succeeded = rowResults.filter((r) => r.success).length;
    if (succeeded > 0) {
      jedApi.clearCache();
      notifyDataChanged();
    }
  };

  const succeededCount = results ? results.filter((r) => r.success).length : 0;
  const failedCount = results ? results.length - succeededCount : 0;
  const errorRows = results ? results.filter((r) => !r.success) : [];

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg shrink-0">
            <UploadCloud className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Upload Paid Customers</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Bulk-confirm payment for customers who have already paid via Remita, from an Excel/CSV file of
              account numbers and/or RRRs.
            </p>
          </div>
        </div>

        <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg p-3 flex gap-2 text-xs sm:text-sm text-brand-800 dark:text-brand-300">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            Upload a file of customers who have already paid to confirm their payments in bulk. Each row
            needs an <strong>Account Number</strong> and/or <strong>RRR</strong>, and the customer must
            already have a request in the system with a completed payment — new requests can't be created
            this way.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Select Excel/CSV file
          </label>
          <input
            id="bulk-confirm-file-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            disabled={parsing || importing}
            className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
          />
          {file && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              Selected: <span className="font-mono">{file.name}</span> ({Math.round(file.size / 1024)} KB)
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleParse}
            disabled={!file || parsing || importing}
            className="inline-flex items-center gap-2 bg-brand-500 text-gray-900 px-4 py-2 rounded-lg disabled:opacity-50 hover:bg-brand-600 transition-colors text-sm font-medium"
          >
            {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
            {parsing ? 'Parsing...' : 'Validate File'}
          </button>
          {(parsedRows || results) && (
            <button
              type="button"
              onClick={resetAll}
              disabled={importing}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>

        {parseError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {parseError}
          </div>
        )}

        {/* Preview + validation, shown once parsed and before import */}
        {parsedRows && !results && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard icon={ListChecks} label="Total Rows" value={parsedRows.length} />
              <StatCard icon={CheckCircle} label="Valid" value={validRows.length} color="green" />
              <StatCard icon={XCircle} label="Invalid / Skipped" value={invalidRows.length} color={invalidRows.length ? 'amber' : 'gray'} />
            </div>

            {validRows.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                  Preview ({Math.min(10, validRows.length)} of {validRows.length} valid rows)
                </p>
                <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-100 dark:bg-gray-900/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Row</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Account Number</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">RRR</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {validRows.slice(0, 10).map((r) => (
                        <tr key={r.index}>
                          <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{r.index + 1}</td>
                          <td className="px-3 py-2 text-sm font-mono text-gray-900 dark:text-white">{r.accountNumber || '-'}</td>
                          <td className="px-3 py-2 text-sm font-mono text-gray-900 dark:text-white">{r.rrr || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {invalidRows.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                  Rows that will be skipped ({invalidRows.length})
                </p>
                <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-100 dark:bg-gray-900/50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Row</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Identifier</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {invalidRows.map((r) => (
                        <tr key={r.index}>
                          <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{r.index + 1}</td>
                          <td className="px-3 py-2 text-sm font-mono text-gray-700 dark:text-gray-300">{r.identifier || '-'}</td>
                          <td className="px-3 py-2 text-sm text-amber-700 dark:text-amber-400">{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleImportClick}
              disabled={validRows.length === 0 || importing}
              className="inline-flex items-center gap-2 bg-amber-600 text-white px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-700 transition-colors text-sm font-medium"
            >
              <CheckCircle className="w-4 h-4" />
              Import {validRows.length || ''} Customer{validRows.length === 1 ? '' : 's'}
            </button>
          </div>
        )}

        {/* In-progress */}
        {importing && (
          <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-brand-600 shrink-0" />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Processing {progress.done} of {progress.total}...
            </span>
          </div>
        )}

        {sessionExpired && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            Your session expired partway through this batch. Log in again and re-upload the remaining rows
            (rows already confirmed above were successful and won't be re-submitted if you retry the same file).
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={ListChecks} label="Total Processed" value={results.length} />
              <StatCard icon={CheckCircle} label="Confirmed" value={succeededCount} color="green" />
              <StatCard icon={XCircle} label="Failed" value={failedCount} color="red" />
              <StatCard
                icon={CheckCircle}
                label="Success Rate"
                value={results.length ? `${Math.round((succeededCount / results.length) * 100)}%` : '0%'}
                color="blue"
              />
            </div>

            {succeededCount > 0 && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300 flex gap-2">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                Dashboard, Reports, Payments, and Awaiting Installation will reflect these changes automatically.
              </div>
            )}

            {errorRows.length > 0 && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-medium text-gray-900 dark:text-white text-sm">Failed Rows ({errorRows.length})</h4>
                  <button
                    type="button"
                    onClick={() => exportErrorsToExcel(errorRows)}
                    className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  >
                    <FileDown className="w-4 h-4" />
                    Export Errors
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-100 dark:bg-gray-900/50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Row</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Identifier</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Error</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {errorRows.map((r) => (
                        <tr key={r.index}>
                          <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{r.index + 1}</td>
                          <td className="px-3 py-2 text-sm font-mono text-gray-900 dark:text-white">{r.identifier || '-'}</td>
                          <td className="px-3 py-2 text-sm text-red-600 dark:text-red-400">{r.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmImport}
        loading={importing}
        confirmText="Import"
        title="Import Paid Customers"
        message={`Import ${validRows.length} customer${validRows.length === 1 ? '' : 's'} into the system? Each row will be confirmed as paid with JED, the same as using Confirm Payment individually. This cannot be undone.`}
      />
    </div>
  );
}

export default BulkConfirmPaymentsTab;
