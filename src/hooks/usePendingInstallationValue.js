// src/hooks/usePendingInstallationValue.js
// The value of every PENDING installation at the current meter-type prices —
// shared by the Admin Dashboard, Reports and Installer Job Status so the figure
// is computed once, one way (utils/meterPricing.js).
//
// Which installations: exactly the Dashboard's "Pending Installations"
// (isPendingInstallation, utils/installationTotals.js) — JED PAID plus imported
// PENDING / ASSIGNED / IN_PROGRESS / FAILED. `count` is returned so a caller can
// check it against the aggregate total (collectedFrom, usePaymentRevenueSummary.js).
//
// Why rows are read at all: pricing needs each installation's meter type, and
// the API has no count-by-meter-type for installations (API_GAP_REPORT.md,
// gap AJ). Only the pending statuses are read (never completed or cancelled),
// by server-side status filter, pages in parallel; jedApi's 30-second cache
// means Installer Job Status' own reads of ASSIGNED/IN_PROGRESS/FAILED are the
// same requests, not repeats. If any read stops at its cap, the value is
// withheld — a partial sum would understate it.
//
// Financial: callers pass `enabled: canViewPayments`. Explicit opt-in only.
import { useState, useEffect, useCallback } from 'react';
import jedApi from '../components/services/api';
import { useDataRefresh } from '../components/contexts/DataRefreshContext';
import { fetchAllPages, fetchAllPagesDetailed } from '../utils/fetchAllPages';
import { getErrorMessage } from '../utils/errorMessage';
import { normalizeMultiRow, normalizeJedRow, JED_BUCKET } from '../utils/installationScope';
import { PENDING_INSTALLATION_STATUSES, isPendingInstallation } from '../utils/installationTotals';
import { buildPriceIndex, totalCollectedPayment } from '../utils/meterPricing';

const MAX_PAGES = 100;

/** One read: pending rows + current prices → the valuation. */
export async function loadPendingInstallationValue() {
  const [meterTypes, jedPaid, ...imported] = await Promise.all([
    fetchAllPages((p) => jedApi.getMeterTypes(p), {}),
    ...PENDING_INSTALLATION_STATUSES.jed.map((status) =>
      fetchAllPagesDetailed((p) => jedApi.getAllCustomerRequests(p), { status }, { maxPages: MAX_PAGES })),
    ...PENDING_INSTALLATION_STATUSES.imported.map((status) =>
      fetchAllPagesDetailed((p) => jedApi.getInstallations(p), { status }, { maxPages: MAX_PAGES })),
  ]);

  const byKey = new Map();
  jedPaid.items.forEach((r) => {
    if (!isPendingInstallation('jed', r?.status)) return;
    const row = normalizeJedRow(r, JED_BUCKET);
    if (row.key && !byKey.has(row.key)) byKey.set(row.key, row);
  });
  imported.forEach(({ items }) => items.forEach((r) => {
    if (!isPendingInstallation('imported', r?.status)) return;
    const row = normalizeMultiRow(r);
    if (row.key && !byKey.has(row.key)) byKey.set(row.key, row);
  }));
  const rows = Array.from(byKey.values());
  const complete = ![jedPaid, ...imported].some((r) => r.truncated);
  const index = buildPriceIndex(meterTypes);
  const valuation = totalCollectedPayment(rows, index);
  if (valuation.unpriced.count > 0) {
    // A data inconsistency an admin should fix in Settings or in the import.
    console.warn('[PendingInstallationValue] Installations not valued:', valuation.unpriced);
  }
  return {
    count: rows.length,
    complete,
    valuation: complete ? valuation : null,
    // The live prices, so a caller valuing a filtered subset (the
    // Installations page) uses exactly the prices this total used.
    priceIndex: index,
    prices: Array.from(index.prices.entries()).map(([key, p]) => ({ type: key.split('|')[1], disco: p.disco, price: p.price, name: p.name })),
  };
}

/** @param {{ enabled?: boolean }} [options] - explicit opt-in (PAYMENTS.VIEW) */
export function usePendingInstallationValue({ enabled = false } = {}) {
  const on = enabled === true;
  const { refreshSignal } = useDataRefresh();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(on);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => { jedApi.clearCache(); setReloadKey((k) => k + 1); }, []);

  useEffect(() => {
    if (!on) { setData(null); setLoading(false); setError(null); return undefined; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadPendingInstallationValue();
        if (!cancelled) setData(result);
      } catch (err) {
        console.error('[PendingInstallationValue] Load failed:', err);
        if (!cancelled) { setData(null); setError(getErrorMessage(err, "Couldn't value pending installations.")); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [on, reloadKey, refreshSignal]);

  return { pendingValue: data, loading, error, reload };
}


export default usePendingInstallationValue;
