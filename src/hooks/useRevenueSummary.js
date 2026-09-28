// src/hooks/useRevenueSummary.js
// "Total collected payments" and "revenue due to us" for the Admin Dashboard.
//
// THE SOURCE IS `GET /finance/revenue/transactions` — FIXED 2026-09-26, after
// two wrong answers. The history matters, because each wrong source looked
// right and produced a confident ₦0:
//
//   1. GET /external/jed/requests  — every customer request, including
//      INITIATED ones never paid. Wrong shape of question.
//   2. GET /external/jed/payments  — "payments (paid or completed)". The right
//      question for the JED/Remita flow, but that flow is EMPTY in this
//      deployment: the endpoint returns zero records, so the figures were ₦0
//      while the Revenue tab showed ₦3,013,500 across 29 records.
//   3. GET /finance/revenue/*      — recognised revenue across BOTH domains.
//      JED's Remita payments and multi-disco installation work both land here.
//      This is the only source that can answer the question for the whole
//      business, which is why it is the one that has the money in it.
//
// The lesson encoded here: a money figure reading ₦0 next to a screen showing
// real money is a SOURCE problem, not a formatting one.
//
// THE DEFINITIONS live in utils/financeSummary.js (summarizeRevenueTransactions)
// and nowhere else:
//   collected  = value of PENDING installations (recognised, not yet complete)
//   revenueDue = value of COMPLETED installations
// Both need every row (the split can't come from the server's total), so the
// read pages through ALL records and the figures are withheld — never
// estimated — if it couldn't. The Dashboard, the Payments page and the
// Installations page all use this hook, so they show the same numbers.
//
// PERMISSION: /finance/* is SUPERADMIN/ADMIN only (Supervisor and Installer
// get a 403), which is precisely `canViewPayments`. Callers pass that as
// `enabled` so an unauthorised role issues no request at all.
import { useState, useEffect, useCallback, useMemo } from 'react';
import jedApi from '../components/services/api';
import { useDataRefresh } from '../components/contexts/DataRefreshContext';
import { summarizeRevenueTransactions } from '../utils/financeSummary';
import { getErrorMessage } from '../utils/errorMessage';
import { mapWithConcurrency } from '../utils/concurrency';

// The endpoint's documented maximum page size.
const PAGE_LIMIT = 100;
// Ceiling on the paged read (10,000 records). Past it the figures are
// reported as unavailable, not as a partial sum.
const MAX_PAGES = 100;
const CONCURRENCY = 4;

const rowsOf = (response) => (Array.isArray(response?.data) ? response.data : []);

/**
 * Every recognised-revenue record matching `params`, paged.
 *
 * Shared by the dashboard's totals (no params — all time) and its trend charts
 * (a `from`/`to` window), so both read one endpoint and can never tell
 * different stories about the same money.
 *
 * @param {{from?: string, to?: string, discoCode?: string, meterType?: string}} [params]
 * @returns {Promise<{rows: object[], totals: object|null, truncated: boolean}>}
 */
export async function loadRevenueTransactions(params = {}) {
  const first = await jedApi.getRevenueTransactions({ ...params, page: 1, limit: PAGE_LIMIT });
  const rows = [...rowsOf(first)];
  const totals = first?.meta?.totals || null;

  const totalPages = Number(first?.pagination?.totalPages) || 1;
  const lastPage = Math.min(totalPages, MAX_PAGES);
  const pages = [];
  for (let p = 2; p <= lastPage; p += 1) pages.push(p);
  // Pages in parallel (bounded), appended in page order.
  const rest = await mapWithConcurrency(pages, CONCURRENCY, async (p) =>
    rowsOf(await jedApi.getRevenueTransactions({ ...params, page: p, limit: PAGE_LIMIT })));
  rest.forEach((pageRows) => rows.push(...pageRows));

  return { rows, totals, truncated: totalPages > MAX_PAGES };
}

/**
 * @param {{ enabled?: boolean, select?: (row: object) => boolean }} [options]
 *   `enabled: false` issues NO request. `select` narrows the summary to a
 *   scope (see revenueScopeFilter) without a second read — keep it stable
 *   (useMemo) so the summary isn't recomputed every render.
 */
// `enabled` must be passed explicitly and be exactly true: an undefined
// permission flag must never switch a financial read ON by default.
export function useRevenueSummary({ enabled: enabledFlag = false, select } = {}) {
  const enabled = enabledFlag === true;
  const { refreshSignal } = useDataRefresh();
  const [state, setState] = useState({ rows: null, totals: null, truncated: false });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ rows: null, totals: null, truncated: false });
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadRevenueTransactions();
        // The only writer of `state`, writing the whole object at once: a late
        // response from a superseded run is dropped, never half-applied.
        if (cancelled) return;
        setState({ rows: result.rows, totals: result.totals, truncated: result.truncated });
      } catch (err) {
        console.error('[useRevenueSummary] Load failed:', err);
        // A failure is an ERROR, never ₦0. `summary` stays null so the caller
        // has no figure to render.
        if (!cancelled) {
          setState({ rows: null, totals: null, truncated: false });
          setError(getErrorMessage(err, "Couldn't load revenue totals."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // refreshSignal is the app's existing "a mutation happened" event. No
    // timer, no interval, no polling.
  }, [enabled, reloadKey, refreshSignal]);

  const summary = useMemo(
    () => (state.rows
      ? summarizeRevenueTransactions(state.rows, state.totals, { select })
      : null),
    [state.rows, state.totals, select]
  );

  return {
    summary,
    truncated: state.truncated,
    loading,
    error,
    reload,
  };
}

export default useRevenueSummary;
