// src/components/admin/RevenueSummaryPanel.jsx
// "Total collected payments" and "Revenue due to us" — the ONE rendering of
// both figures, fed by hooks/usePaymentRevenueSummary.js. The Admin Dashboard,
// the Payments page, Admin Reports and the Installations page all show this
// panel, so the same records produce the same figures and caveats everywhere.
//
// Definitions (business decision, 2026-09-28):
//   Total collected payments = the Pending (= Awaiting) Installations valued
//                              at the configured meter-type prices
//                              (totalCollectedPayment, utils/meterPricing.js)
//   Revenue due to us        = recognised revenue for COMPLETED installations
//                              (summarizeRevenueTransactions)
//
// Three states that must never look alike:
//   error          → a message and a retry, no figure at all (never ₦0)
//   incomplete     → "Unavailable": not every record could be read, and a
//                    partial sum is an undercount, not an estimate
//   a real zero    → ₦0, with a line saying WHICH kind of zero it is
import { Wallet, BadgeCheck, RefreshCw } from 'lucide-react';
import { formatCurrencyNGN } from '../../utils/currency';
import { paymentFigures } from '../../utils/reportData';

const METRIC_TONES = {
  brand: 'bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400',
  green: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
};

/**
 * A money figure with its own caption. `break-words` and the one-column
 * mobile grid are deliberate: a full NGN amount such as ₦1,250,000.00 must
 * stay readable, never clipped or overlapping, down to the narrowest phone.
 */
export const PaymentMetricCard = ({ icon: Icon, tone = 'brand', label, value, detail, hint, loading = false }) => (
  <div className="card p-4 sm:p-6 flex flex-col transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 dark:hover:shadow-black/30">
    <div className={`p-2 rounded-lg self-start mb-3 ${METRIC_TONES[tone] || METRIC_TONES.brand}`}>
      <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
    </div>
    <h3 className="text-gray-500 dark:text-gray-400 text-xs sm:text-sm font-medium">{label}</h3>
    {loading ? (
      <>
        <div className="h-7 sm:h-8 w-32 mt-1 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" aria-hidden="true" />
        <span className="sr-only">Loading {label}</span>
      </>
    ) : (
      <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mt-1 break-words">{value}</p>
    )}
    {!loading && detail && (
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 break-words">{detail}</p>
    )}
    {hint && (
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 break-words">{hint}</p>
    )}
  </div>
);

// An amount, or "Unavailable" — never ₦0 for a figure that couldn't be read.
const figureOr = ({ loading, amount }) => {
  if (loading) return null;
  return amount === null || amount === undefined ? 'Unavailable' : formatCurrencyNGN(amount);
};

/**
 * @param {object} props
 * @param {string} props.id - heading id (aria-labelledby)
 * @param {string} props.title
 * @param {{ valuation: object|null, loading: boolean, error: string|null, incomplete?: boolean }} props.collected
 *   Total collected payment — totalCollectedPayment() (utils/meterPricing.js):
 *   the pending installations valued at the current meter-type prices.
 * @param {{ summary: object|null, loading: boolean, error: string|null }} props.revenue
 *   Revenue due — summarizeRevenueTransactions() (utils/financeSummary.js).
 * @param {() => void} props.onRetry
 */
function RevenueSummaryPanel({ id, title, collected, revenue, onRetry }) {
  // The figures, their errors and notes come from paymentFigures — the same
  // helper the report exports use, so screen and file can't disagree.
  const { collected: c, due: d, mismatch } = paymentFigures(collected, revenue);

  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 id={id} className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h2>
        {(collected.error || revenue.error) && (
          <button type="button" onClick={onRetry}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline">
            <RefreshCw className="w-3 h-3" /> Try again
          </button>
        )}
      </div>

      {/* One column on mobile so a long amount is never clipped. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <PaymentMetricCard
          icon={Wallet}
          tone="brand"
          label="Total collected payments"
          hint="Pending installations valued at the configured meter-type prices."
          loading={c.loading}
          value={figureOr(c)}
          detail={c.detail}
        />
        <PaymentMetricCard
          icon={BadgeCheck}
          tone="green"
          label="Revenue due to us"
          hint="Recognised revenue for completed installations."
          loading={d.loading}
          value={figureOr(d)}
          detail={d.detail}
        />
      </div>

      {!c.loading && c.byType.length > 0 && (
        <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5" aria-label="Total collected payments by meter type">
          {c.byType.map((t) => (
            <li key={t.label} className="break-words">
              {t.count.toLocaleString()} {t.label}
              {t.unitPrice !== null ? ` × ${formatCurrencyNGN(t.unitPrice)} = ${formatCurrencyNGN(t.value)}` : ' — not valued'}
            </li>
          ))}
        </ul>
      )}
      {!c.loading && c.note && <p className="text-xs text-amber-700 dark:text-amber-400 break-words">{c.note}</p>}
      {!d.loading && d.note && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Revenue due: {d.note}</p>
      )}
      {mismatch && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{mismatch}</p>
      )}
    </section>
  );
}

export default RevenueSummaryPanel;
