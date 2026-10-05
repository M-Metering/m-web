// src/components/admin/RemitaPaymentsList.jsx
// Reports → Payments & deals → "Remita payments": the JED/Remita payment
// records (GET /external/jed/payments) for a date-paid window. Moved here
// unchanged from the retired Payments page (2026-10-05). A different question
// from the recognised-revenue records beside it (RevenueTab): these are Remita
// payment events for JED requests, by the date they were paid.
import { useState, useCallback, useEffect } from 'react';
import jedApi from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { formatCurrencyNGN } from '../../utils/currency';
import StatusBadge from '../common/StatusBadge';
import { RefreshCw, AlertCircle, Loader2, Calendar } from 'lucide-react';
import { formatDateTime, parseTimestamp, getRecentDaysRange } from '../../utils/date';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';
import ReportExportBar, { NO_DATA_TEXT } from '../reports/ReportExportBar';
import { buildRemitaPaymentsReport } from '../../utils/reportData';

const DATE_PRESETS = [
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
];

// Field helpers matching the real, documented GET /external/jed/payments
// item schema exactly: custNames, accountNumber, amount, meterType,
// datePaid, dateCompleted, status (confirmed against the live OpenAPI
// spec — no rrr/reference field exists on this endpoint's response, so
// none is displayed here; a small amount of defensive fallback is kept
// only for genuinely plausible casing variants, not invented fields).
const getCustomerName = (p) => p?.custNames || p?.customerName || null;
const getAmount = (p) => p?.amount ?? p?.amountPaid ?? 0;
const getAccount = (p) => p?.accountNumber || p?.account_number || 'N/A';
const getMeterType = (p) => p?.meterType || null;
const getPaymentStatus = (p) => p?.status || 'UNKNOWN';
const getPaymentDate = (p) => p?.datePaid || p?.dateCompleted || null;

function RemitaPaymentsList() {
  const { refreshSignal } = useDataRefresh();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preset, setPreset] = useState('30');
  const [hasFetched, setHasFetched] = useState(false);

  const fetchPayments = useCallback(async (days = preset) => {
    setLoading(true);
    setError(null);
    try {
      // GET /external/jed/payments documents startDate/endDate (ISO), not a
      // `days` param — the previous `{ days }` call was silently ignored, so
      // every range button returned the same first 20 payments. Pages
      // through the whole window (limit 100/page) so the list is complete.
      const list = await fetchAllPages(
        (params) => jedApi.getPayments(params),
        getRecentDaysRange(Number(days))
      );
      setPayments(list);
      setHasFetched(true);
    } catch (err) {
      console.error('[Payments] Failed to fetch:', err);
      setError(getErrorMessage(err, 'Failed to load payments'));
    } finally {
      setLoading(false);
    }
  }, [preset]);

  // Export the loaded window — already every page (fetchAllPages above).
  const buildReport = useCallback(async () => buildRemitaPaymentsReport({
    payments, rangeLabel: DATE_PRESETS.find((p) => p.id === preset)?.label || `Last ${preset} days`,
  }), [payments, preset]);

  const handlePresetChange = (id) => {
    setPreset(id);
    fetchPayments(id);
  };

  // Re-fetch after an app-wide data mutation elsewhere (e.g. a bulk payment
  // import) — but only if the admin has already loaded this tab once, so we
  // don't force a fetch before they've picked a date range.
  useEffect(() => {
    if (hasFetched) fetchPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => handlePresetChange(p.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                preset === p.id ? 'bg-brand-500 text-gray-900' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => fetchPayments()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 disabled:bg-brand-400 text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {hasFetched ? 'Refresh' : 'Load Payments'}
        </button>
      </div>

      {hasFetched && !loading && (
        <div className="card p-3 sm:p-4">
          <ReportExportBar build={buildReport} label="Export Remita payments"
            disabled={payments.length === 0} disabledReason={payments.length === 0 ? NO_DATA_TEXT : null} />
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex gap-2 text-sm text-red-800 dark:text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {!hasFetched && !loading && (
        <div className="card p-10 text-center text-gray-500 dark:text-gray-400 text-sm">
          Choose a date range above to load payments
        </div>
      )}

      {loading && (
        <div className="card p-10 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      )}

      {!loading && hasFetched && (
        <div className="card overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-gray-200 dark:divide-gray-700">
            {payments.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No payments in this range</div>
            ) : (
              payments.map((p, i) => {
                const paymentDate = getPaymentDate(p);
                return (
                  <div key={`${getAccount(p)}-${i}`} className="p-4">
                    <div className="flex justify-between items-start mb-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {getCustomerName(p) || `Account ${getAccount(p)}`}
                      </p>
                      <StatusBadge status={getPaymentStatus(p)} />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Acct: {getAccount(p)}{getMeterType(p) ? ` · ${getMeterType(p)}` : ''}
                    </p>
                    <div className="flex justify-between items-center mt-2 gap-2">
                      <span
                        className="text-xs text-gray-500 dark:text-gray-400"
                        title={parseTimestamp(paymentDate)?.toISOString() ?? ''}
                      >
                        {formatDateTime(paymentDate)}
                      </span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrencyNGN(getAmount(p))}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Meter Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {payments.length === 0 ? (
                  <tr><td colSpan="6" className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No payments in this range</td></tr>
                ) : (
                  payments.map((p, i) => {
                    const paymentDate = getPaymentDate(p);
                    return (
                      <tr key={`${getAccount(p)}-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{getCustomerName(p) || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{getAccount(p)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{getMeterType(p) || '-'}</td>
                        <td className="px-4 py-3"><StatusBadge status={getPaymentStatus(p)} /></td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-white">{formatCurrencyNGN(getAmount(p))}</td>
                        <td
                          className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400"
                          title={parseTimestamp(paymentDate)?.toISOString() ?? ''}
                        >
                          {formatDateTime(paymentDate)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default RemitaPaymentsList;
