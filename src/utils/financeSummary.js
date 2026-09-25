// src/utils/financeSummary.js
// Reading GET /finance/revenue/* (added 2026-09-24).
//
// THE RULE THIS FILE EXISTS FOR: a revenue total from this API is never exact,
// and must never be rendered as though it were. Two things make it inexact,
// and the response reports both so they can be shown:
//
//   estimatedAmount / estimatedCount — revenue valued at today's price rather
//     than the price in force when the work completed. Older Aba Power rows
//     backfilled before per-row pricing was captured land here (`isEstimated`
//     on the transaction row).
//   missingAmountCount — completed work with NO price recorded at all. Those
//     rows come through as `amount: 0, amountMissing: true`, so they drag the
//     total DOWN silently.
//
// Recognition timing is the backend's and differs per disco — JED recognises on
// Remita confirmation, Aba Power on installation completion. Never re-derive it
// here; read `recognition` off the row.
import { formatCurrencyNGN } from './currency';

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const toCount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const RECOGNITION_LABELS = Object.freeze({
  ON_PAYMENT_CONFIRMED: 'counted when Remita confirms payment',
  ON_INSTALLATION_COMPLETED: 'counted when the installation is completed',
});

/** A recognition basis in words, falling back to the raw value rather than guessing. */
export const recognitionLabel = (value) => {
  const key = String(value || '').toUpperCase().trim();
  return RECOGNITION_LABELS[key] || (key ? key.toLowerCase().replace(/_/g, ' ') : null);
};

/**
 * The one-line caveat that must accompany any total from these endpoints.
 * Returns null only when the figure genuinely carries no caveat — i.e. nothing
 * is estimated and nothing is unpriced.
 *
 * @param {{estimatedAmount?: number, estimatedCount?: number, missingAmountCount?: number}} quality
 * @returns {string|null}
 */
export function dataQualityNote(quality) {
  const estimatedAmount = toNumber(quality?.estimatedAmount);
  const estimatedCount = toCount(quality?.estimatedCount);
  const missing = toCount(quality?.missingAmountCount);
  if (estimatedCount === 0 && missing === 0) return null;

  const parts = [];
  if (estimatedCount > 0) {
    parts.push(`${formatCurrencyNGN(estimatedAmount)} estimated at today's price (${estimatedCount} record${estimatedCount === 1 ? '' : 's'})`);
  }
  if (missing > 0) {
    parts.push(`${missing} record${missing === 1 ? '' : 's'} completed with no price recorded`);
  }
  return `Includes ${parts.join(', and ')}.`;
}

/**
 * Normalise GET /finance/revenue/summary into what a panel renders. Nothing is
 * computed from the rows — the API's own totals are used as given; this only
 * reshapes them and attaches the caveat.
 */
export function summarizeRevenue(response) {
  const data = response?.data ?? response ?? {};
  const total = data.total || {};
  const byDisco = Array.isArray(data.byDisco) ? data.byDisco : [];

  return {
    currency: data.currency || 'NGN',
    range: data.range || { from: null, to: null, preset: null },
    amount: toNumber(total.amount),
    count: toCount(total.count),
    byDisco: byDisco.map((row) => ({
      discoCode: row.discoCode,
      recognition: row.recognition,
      recognitionText: recognitionLabel(row.recognition),
      amount: toNumber(row.amount),
      count: toCount(row.count),
      note: dataQualityNote(row),
    })),
    // The whole-figure caveat. `dataQuality` is the documented home for it;
    // fall back to the total row so a response shaped either way still warns.
    note: dataQualityNote(data.dataQuality || total),
  };
}

/**
 * One transaction row, flattened. `reference` is the ACCOUNT NUMBER, not a
 * database id — it is a string identifier and is never coerced. `sourceId` is
 * the underlying installation_request.id / jed_customer_request.id and is for
 * support lookups only, so it is deliberately not shown as the reference.
 */
export function normalizeRevenueTransaction(row) {
  return {
    discoCode: row?.discoCode || null,
    source: row?.source || null,
    sourceId: row?.sourceId ?? null,
    reference: row?.reference != null ? String(row.reference) : '',
    customerName: row?.customerName || '',
    meterType: row?.meterType || null,
    amount: toNumber(row?.amount),
    amountMissing: row?.amountMissing === true,
    isEstimated: row?.isEstimated === true,
    sourceStatus: row?.sourceStatus || null,
    revenueAt: row?.revenueAt || null,
    dateBasis: row?.dateBasis || null,
  };
}

/** How a single row's amount should read: the figure, or why there isn't one. */
export function transactionAmountLabel(row) {
  if (row?.amountMissing) return 'Not priced';
  return formatCurrencyNGN(toNumber(row?.amount));
}

export default {
  summarizeRevenue,
  dataQualityNote,
  recognitionLabel,
  normalizeRevenueTransaction,
  transactionAmountLabel,
};
