// src/hooks/usePaymentRevenueSummary.js
// Everything RevenueSummaryPanel needs, from the two shared calculations — the
// one hook the Dashboard, Payments page, Admin Reports and Installations page
// use, so "Total collected payments" and "Revenue due to us" are the same
// figures on every screen:
//
//   collected  usePendingInstallationValue → totalCollectedPayment
//              (utils/meterPricing.js): the Pending (= Awaiting)
//              Installations valued at the configured meter-type prices
//   revenue    useRevenueSummary → summarizeRevenueTransactions: recognised
//              revenue, of which "revenue due" is the completed installations
//
// Financial: callers pass `enabled: canViewPayments`; explicit opt-in only.
import { useCallback } from 'react';
import { usePendingInstallationValue } from './usePendingInstallationValue';
import { useRevenueSummary } from './useRevenueSummary';

/**
 * The panel's `collected` prop from the shared valuation. `totals` (from
 * useInstallationTotals), when given, is checked against the number of records
 * valued — they are the same population read two ways, so a difference means
 * the data changed between reads.
 */
export function collectedFrom({ pendingValue, loading, error }, totals = null) {
  const incomplete = !!pendingValue && !pendingValue.valuation;
  const mismatch = pendingValue?.valuation && totals && pendingValue.count !== totals.pending
    ? `${pendingValue.count.toLocaleString()} pending installations were valued but ${totals.pending.toLocaleString()} are counted as pending — the records changed between reads; refresh to reconcile.`
    : null;
  return { valuation: pendingValue?.valuation || null, loading, error, incomplete, mismatch };
}

/**
 * @param {{ enabled?: boolean, select?: (row: object) => boolean, totals?: object|null }} [options]
 *   select narrows the revenue records to a scope (revenueScopeFilter).
 */
export function usePaymentRevenueSummary({ enabled = false, select, totals = null } = {}) {
  const on = enabled === true;
  const value = usePendingInstallationValue({ enabled: on });
  const revenue = useRevenueSummary({ enabled: on, select });
  const { reload: reloadValue } = value;
  const { reload: reloadRevenue } = revenue;
  const reload = useCallback(() => { reloadValue(); reloadRevenue(); }, [reloadValue, reloadRevenue]);
  return {
    collected: collectedFrom(value, totals),
    revenue: { summary: revenue.summary, loading: revenue.loading, error: revenue.error },
    // For a caller valuing a filtered subset with the same prices.
    priceIndex: value.pendingValue?.priceIndex || null,
    pendingValue: value,
    reload,
  };
}

export default usePaymentRevenueSummary;
