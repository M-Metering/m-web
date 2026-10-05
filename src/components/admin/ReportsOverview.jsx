// src/components/admin/ReportsOverview.jsx
// Admin Reports → Overview: the operational summary of the whole installation
// system. It computes NOTHING itself — every figure comes from the hooks the
// Admin Dashboard and Installer Job Status use, so a metric with the same name
// is the same number on all three screens:
//
//   counts       useInstallationTotals        → utils/installationTotals.js
//   value        usePendingInstallationValue  → utils/meterPricing.js
//   money        useRevenueSummary            → utils/financeSummary.js
//
// Every count is a server-side aggregate (GET /installations/statistics and
// JED totalCounts); nothing is summed from a page of rows.
import { AlertCircle, RefreshCw } from 'lucide-react';
import { usePermissions } from '../auth/usePermissions';
import { useInstallationTotals } from '../../hooks/useDashboardInstallations';
import { usePaymentRevenueSummary } from '../../hooks/usePaymentRevenueSummary';
import { formatCurrencyNGN } from '../../utils/currency';
import RevenueSummaryPanel from './RevenueSummaryPanel';

function Figure({ label, value, hint }) {
  return (
    <div className="card p-3 sm:p-4 min-w-0">
      <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white leading-tight break-words">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

const n = (v) => Number(v).toLocaleString();

function ReportsOverview() {
  const { canViewPayments } = usePermissions();
  const showMoney = canViewPayments === true;
  const totalsState = useInstallationTotals({ enabled: true });
  const t = totalsState.totals;
  const paymentSummary = usePaymentRevenueSummary({ enabled: showMoney, totals: t });
  const revenue = paymentSummary.revenue;
  const pendingValue = paymentSummary.pendingValue;

  return (
    <div className="space-y-4 sm:space-y-6">
      <section aria-labelledby="reports-installations" className="space-y-2">
        <h2 id="reports-installations" className="text-sm font-semibold text-gray-700 dark:text-gray-300">Installations · all discos</h2>
        {totalsState.loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3" role="status" aria-label="Loading installation figures">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="card h-20 animate-pulse" />)}
          </div>
        ) : totalsState.error || !t ? (
          <div role="alert" className="card p-4 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-800 dark:text-red-300">{totalsState.error || "Couldn't load installation totals."}</p>
              <button type="button" onClick={totalsState.reload}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline">
                <RefreshCw className="w-3 h-3" /> Try again
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
              <Figure label="Total requests" value={n(t.pending + t.completed + t.awaitingPayment + t.cancelled)}
                hint="Every JED and imported request" />
              <Figure label="Pending installations" value={n(t.pending)} hint="= Dashboard Pending / Awaiting Installations" />
              <Figure label="Completed installations" value={n(t.completed)} />
              <Figure label="Pending, with an installer" value={n(t.breakdown.pending.withInstaller)} hint="Part of pending: assigned or in progress" />
              <Figure label="Pending, not yet assigned" value={n(t.breakdown.pending.unassigned)} hint="Part of pending: imported, no installer yet" />
              <Figure label="Pending after a failed attempt" value={n(t.breakdown.pending.failed)} hint="Part of pending" />
              <Figure label="Paid JED requests" value={n(t.breakdown.pending.jedPaid + t.breakdown.completed.jed)}
                hint={`${n(t.breakdown.pending.jedPaid)} awaiting installation · ${n(t.breakdown.completed.jed)} completed`} />
              <Figure label="Awaiting payment" value={n(t.awaitingPayment)} hint="JED, RRR not yet paid — not pending" />
              <Figure label="Cancelled" value={n(t.cancelled)} hint="Counted nowhere" />
            </div>
            {t.reconciles === false && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                The server&apos;s per-status counts don&apos;t add up to its own total; refresh, and report it if it persists.
              </p>
            )}
          </>
        )}
      </section>

      {showMoney && (
        <>
          <RevenueSummaryPanel
            id="reports-revenue"
            title="Payment & Revenue Summary"
            collected={paymentSummary.collected}
            revenue={paymentSummary.revenue}
            onRetry={paymentSummary.reload}
          />

          <section aria-labelledby="reports-value" className="space-y-2">
            <h2 id="reports-value" className="text-sm font-semibold text-gray-700 dark:text-gray-300">Recorded payments and current meter prices</h2>
            <div className="card p-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Total amount paid (all recorded payments)</p>
                <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white break-words">
                  {revenue.loading ? '…'
                    : revenue.error || !revenue.summary || revenue.summary.recognisedTotal === null ? 'Unavailable'
                      : formatCurrencyNGN(revenue.summary.recognisedTotal)}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  The sum of the recorded payment records. It is a different figure from Total collected payments
                  above, which values the pending installations at the configured meter prices.
                </p>
                {pendingValue.pendingValue?.prices?.length > 0 && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                    Current prices: {pendingValue.pendingValue.prices.map((p) => `${p.name}${p.disco ? ` (${p.disco})` : ""} ${formatCurrencyNGN(p.price)}`).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default ReportsOverview;
