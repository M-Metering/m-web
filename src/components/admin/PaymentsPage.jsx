// src/components/admin/PaymentsPage.jsx
// A simple operational Payments experience: real payment records
// (GET /external/jed/payments), the routine confirm-payment action, and
// bulk-confirming a batch of already-paid customers from a file. The
// diagnostic "RRR / Order Lookup" tab (raw Remita status/order lookups,
// webhook-endpoint verification, manual-confirm-by-RRR) and "Webhook
// Replay" tab (manually resubmitting a Remita webhook payload) were
// removed — they exposed backend integration mechanics an Admin doesn't
// need for the normal day-to-day workflow, not a required business action.
// checkRemitaStatusByRRR and confirmPaymentManually are still real,
// still-used API methods (ConfirmPaymentTab.jsx's RRR lookup, and
// BulkConfirmPaymentsTab.jsx's per-row confirm, respectively) — only the
// standalone diagnostic tabs and the API surface exclusive to them
// (checkRemitaStatusByOrderId, verifyPaymentByRRR, submitRemitaWebhook,
// and the /webhooks/* endpoint config) were removed. See API_GAP_REPORT.md.
import { useState, useCallback, useEffect } from 'react';
import jedApi from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { formatCurrencyNGN } from '../../utils/currency';
import ConfirmPaymentTab from './ConfirmPaymentTab';
import BulkConfirmPaymentsTab from './BulkConfirmPaymentsTab';
import StatusBadge from '../common/StatusBadge';
import {
  CreditCard, RefreshCw, AlertCircle, Loader2, Calendar
} from 'lucide-react';
import { formatDateTime, parseTimestamp, getRecentDaysRange } from '../../utils/date';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';

const TABS = [
  { id: 'payments', label: 'Payments' },
  { id: 'confirm', label: 'Confirm Payment' },
  { id: 'bulkImport', label: 'Upload Paid Customers' },
];

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

// ---- Tab: Payments ----
function PaymentsTab() {
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

function PaymentsPage() {
  const [activeTab, setActiveTab] = useState('payments');

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg flex-shrink-0">
          <CreditCard className="w-6 h-6 text-brand-600 dark:text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Payments</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">
            Who paid, how much, and what's next — payment records, confirmation, and bulk import
          </p>
        </div>
      </div>

      <div className="card p-3 sm:p-4">
        <div className="flex space-x-1 sm:space-x-2 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap text-xs sm:text-sm ${
                activeTab === tab.id
                  ? 'bg-brand-500 text-gray-900'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'payments' && <PaymentsTab />}
      {activeTab === 'confirm' && <ConfirmPaymentTab />}
      {activeTab === 'bulkImport' && <BulkConfirmPaymentsTab />}
    </div>
  );
}

export default PaymentsPage;