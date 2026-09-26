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
// THE DEFINITIONS ARE UNCHANGED and live in utils/financeSummary.js:
//   collected  = every recognised revenue record (recognition already means
//                the money is real — nothing unpaid can be in this set)
//   revenueDue = the completed-installation subset only
//
// `meta.totals` covers the whole filtered set, so the headline collected
// figure is the server's own aggregate rather than a client re-add — which is
// also why it matches the Revenue tab on the Payments page exactly: same
// endpoint, same totals.
//
// PERMISSION: /finance/* is SUPERADMIN/ADMIN only (Supervisor and Installer
// get a 403), which is precisely `canViewPayments`. Callers pass that as
// `enabled` so an unauthorised role issues no request at all.
import { useState, useEffect, useCallback } from 'react';
import jedApi from '../components/services/api';
import { useDataRefresh } from '../components/contexts/DataRefreshContext';
import { summarizeRevenueTransactions } from '../utils/financeSummary';
import { getErrorMessage } from '../utils/errorMessage';

// The endpoint's documented maximum page size.
const PAGE_LIMIT = 100;
// Ceiling on the paged read. Only the completed/not-completed split needs the
// rows; the collected total comes from meta.totals regardless of how many
// pages are read, so a cap can never distort the headline figure.
const MAX_PAGES = 50;

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
  for (let p = 2; p <= lastPage; p += 1) {
    const next = await jedApi.getRevenueTransactions({ ...params, page: p, limit: PAGE_LIMIT });
    rows.push(...rowsOf(next));
  }

  return { rows, totals, truncated: totalPages > MAX_PAGES };
}

/** One read of the recognised-revenue records, summarised. */
export async function loadRevenueSummary() {
  const { rows, totals, truncated } = await loadRevenueTransactions();
  return { summary: summarizeRevenueTransactions(rows, totals), truncated };
}

/**
 * @param {{ enabled?: boolean }} [options] - `enabled: false` issues NO request.
 */
export function useRevenueSummary({ enabled = true } = {}) {
  const { refreshSignal } = useDataRefresh();
  const [state, setState] = useState({ summary: null, truncated: false });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ summary: null, truncated: false });
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadRevenueSummary();
        // The only writer of `state`, writing the whole object at once: a late
        // response from a superseded run is dropped, never half-applied.
        if (cancelled) return;
        setState({ summary: result.summary, truncated: result.truncated });
      } catch (err) {
        console.error('[useRevenueSummary] Load failed:', err);
        // A failure is an ERROR, never ₦0. `summary` stays null so the caller
        // has no figure to render.
        if (!cancelled) {
          setState({ summary: null, truncated: false });
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

  return {
    summary: state.summary,
    truncated: state.truncated,
    loading,
    error,
    reload,
  };
}

export default useRevenueSummary;
