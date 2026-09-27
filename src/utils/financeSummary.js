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
import { isInstalledStatus } from './installationStatus';
import { isCompletedStatus } from './statusBadge';

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const toCount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Money is summed in floats; trim the drift so ₦75,000.00 never renders as
// ₦74,999.999999. Same rounding paymentSummary.js applies for the same reason.
const round2 = (n) => Math.round(n * 100) / 100;

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

/**
 * Whether a revenue row's underlying record is a COMPLETED INSTALLATION.
 *
 * Both installation domains land in this one list, so both vocabularies are
 * accepted — and neither is re-implemented here:
 *   multi-disco `InstallationRequest` → INSTALLED / EXPORTED (isInstalledStatus)
 *   JED `JedCustomerRequest`          → COMPLETED            (isCompletedStatus)
 * A JED request that is only PAID is money collected but NOT yet due to us,
 * which is exactly the distinction the two figures below turn on.
 */
export const isCompletedInstallationRow = (row) =>
  isInstalledStatus(row?.sourceStatus) || isCompletedStatus(row?.sourceStatus);

/**
 * "Total collected payments" and "revenue due to us" over the recognised-
 * revenue records (GET /finance/revenue/transactions). THE ONE revenue
 * calculation in the app: the Admin Dashboard, the Payments page and the
 * Installations page all render its output, so for the same records they
 * cannot disagree.
 *
 * WHY THESE FIGURES COME FROM HERE. The same two figures used to be read from
 * JED's Remita records alone (utils/paymentSummary.js), which silently reports
 * ₦0 wherever the revenue is multi-disco installation work — there are no
 * Remita payment records for it at all. The finance endpoints cover BOTH
 * domains, so this is the only source that can answer for the whole business.
 *
 * THE DEFINITIONS (business decision, 2026-09-27):
 *   collected   = the value of PENDING installations: money recognised for
 *                 work that is not yet a completed installation (e.g. a JED
 *                 request that is PAID and awaiting its installer).
 *   revenueDue  = the value of COMPLETED installations (INSTALLED/EXPORTED,
 *                 or JED COMPLETED — isCompletedInstallationRow).
 * The two are disjoint and together make up everything recognised, which is
 * reported separately as `recognisedTotal` (the server's own meta.totals).
 * Until 2026-09-27 "collected" meant every recognised record, i.e. it also
 * included the completed work; that overlap is gone.
 *
 * COMPLETE OR NOTHING. Neither figure can be taken from the server's total —
 * the split needs every row. So both are computed from the rows, and when not
 * every row arrived (`complete: false`, a paging cap or a short read) they
 * are null: a partial sum is exactly the undercount this must never show.
 * `reconciled` says whether the rows add up to the server's own total; a
 * mismatch means the records changed mid-read and a refresh is needed.
 *
 * @param {object[]} rows - raw transaction rows (ALL of them, or a subset
 *   picked by `select`)
 * @param {{amount?: number, count?: number, estimatedAmount?: number,
 *   estimatedCount?: number, missingAmountCount?: number}} [totals] - meta.totals
 *   for the whole, unfiltered read
 * @param {{ select?: (row: object) => boolean }} [options]
 *   select: narrow to a scope (a disco) AFTER completeness is
 *   judged on the full read.
 */
export function summarizeRevenueTransactions(rows = [], totals = null, { select } = {}) {
  const raw = (Array.isArray(rows) ? rows : []).map(normalizeRevenueTransaction);
  // One payment is one record. A row the server sends twice (a repeated page,
  // a retried read) is counted once, by the record's own identity: its source
  // table and id, else disco + account. A record with neither is kept rather
  // than guessed at.
  const seen = new Set();
  let duplicates = 0;
  const all = raw.filter((row) => {
    const key = row.source && row.sourceId != null
      ? `${row.source}:${row.sourceId}`
      : row.reference ? `${row.discoCode || ''}:${row.reference}` : null;
    if (!key) return true;
    if (seen.has(key)) { duplicates += 1; return false; }
    seen.add(key);
    return true;
  });
  // Unique records, so a page the server repeats can't hide one it skipped.
  const loaded = all.length;
  const serverCount = toCount(totals?.count);
  const complete = serverCount === 0 || loaded >= serverCount;

  const records = select ? all.filter(select) : all;
  let pending = 0;
  let completed = 0;
  let pendingCount = 0;
  let completedCount = 0;
  let unpricedCount = 0;
  records.forEach((row) => {
    if (row.amountMissing) unpricedCount += 1;
    if (isCompletedInstallationRow(row)) {
      completed += row.amount;
      completedCount += 1;
    } else {
      pending += row.amount;
      pendingCount += 1;
    }
  });

  const hasServerTotal = totals && Number.isFinite(Number(totals.amount));
  const allSum = all.reduce((sum, row) => sum + row.amount, 0);
  return {
    collected: complete ? round2(pending) : null,
    revenueDue: complete ? round2(completed) : null,
    pendingCount,
    completedCount,
    // Records in scope. `count` for an unscoped read is the server's own.
    count: select ? records.length : (serverCount || records.length),
    loadedCount: loaded,
    complete,
    recognisedTotal: hasServerTotal ? toNumber(totals.amount) : null,
    reconciled: !complete || !hasServerTotal || Math.abs(round2(allSum) - toNumber(totals.amount)) < 0.01,
    unpricedCount,
    duplicates,
    note: select ? null : dataQualityNote(totals),
  };
}

/**
 * Which recognised-revenue rows belong to an Installations-page scope — the
 * same attribution that page applies to its own rows (utils/installationScope.js):
 *   All discos           every row
 *   a registered disco   rows whose discoCode is that disco's; for a JED-coded
 *                        disco, also every JED Remita row (they're JED's)
 *   JED (Remita)         JED Remita rows only
 * @param {{ includeMulti: boolean, multiDiscoCode: string, remitaBucket: string|null }} scopeInfo
 * @param {(discoCode: string) => string} bucketOf - attributeRemitaRecord bound to the registered discos
 * @returns {((row: object) => boolean) | undefined} undefined for "everything"
 */
export function revenueScopeFilter(scopeInfo, bucketOf) {
  if (!scopeInfo || scopeInfo.remitaBucket === null) return undefined;
  const code = String(scopeInfo.multiDiscoCode || '').toUpperCase();
  return (row) => {
    const isRemita = row.source === 'jed_customer_request';
    if (isRemita && bucketOf(row.discoCode) === scopeInfo.remitaBucket) return true;
    return scopeInfo.includeMulti && !isRemita && String(row.discoCode || '').toUpperCase() === code;
  };
}

export default {
  summarizeRevenue,
  dataQualityNote,
  recognitionLabel,
  normalizeRevenueTransaction,
  transactionAmountLabel,
};
