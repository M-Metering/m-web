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
import { formatPhaseLabel } from '../../utils/installationScope';
import { unpricedNote } from '../../utils/meterPricing';

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

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

const figureOr = ({ loading, error, value }) => {
  if (loading) return null;
  if (error) return 'Unavailable';
  return value === null || value === undefined ? 'Unavailable' : formatCurrencyNGN(value);
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
  const v = collected.valuation;
  const summary = revenue.summary;
  const collectedError = collected.error
    ? 'Unable to load payment data.'
    : (!collected.loading && collected.incomplete ? 'Not every pending installation could be read, so the total is not shown short.' : null);
  const dueError = revenue.error
    ? 'Unable to load revenue data.'
    : (summary && !summary.complete ? 'Not every revenue record could be loaded, so this total is not shown short.' : null);
  const note = v ? unpricedNote(v.unpriced) : null;

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
          loading={collected.loading}
          value={figureOr({ loading: collected.loading, error: collectedError, value: v?.total })}
          detail={collectedError || (v ? `${plural(v.count, 'pending installation')}${v.byType.length ? ':' : ''}` : null)}
        />
        <PaymentMetricCard
          icon={BadgeCheck}
          tone="green"
          label="Revenue due to us"
          hint="Recognised revenue for completed installations."
          loading={revenue.loading}
          value={figureOr({ loading: revenue.loading, error: dueError, value: summary?.revenueDue })}
          detail={dueError || (summary ? plural(summary.completedCount, 'completed installation') : null)}
        />
      </div>

      {!collected.loading && v && v.byType.length > 0 && (
        <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5" aria-label="Total collected payments by meter type">
          {v.byType.map((t) => (
            <li key={`${t.disco || ''}|${t.type}`} className="break-words">
              {t.count.toLocaleString()} {t.type === 'UNSPECIFIED' ? 'with no meter type' : (t.name || formatPhaseLabel(t.type))}
              {t.disco ? ` (${t.disco})` : ''}
              {t.unitPrice !== null ? ` × ${formatCurrencyNGN(t.unitPrice)} = ${formatCurrencyNGN(t.value)}` : ' — not valued'}
            </li>
          ))}
        </ul>
      )}
      {!collected.loading && note && <p className="text-xs text-amber-700 dark:text-amber-400 break-words">{note}</p>}
      {!revenue.loading && summary?.complete && summary.note && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Revenue due: {summary.note}</p>
      )}
      {collected.mismatch && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{collected.mismatch}</p>
      )}
    </section>
  );
}

export default RevenueSummaryPanel;
