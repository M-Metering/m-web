// src/utils/reportData.js
// What the reports SAY, built once and shared by the screen and its exports
// (2026-10-05). The Overview figures and the payment panel render from these
// same helpers, and each export builds its report (utils/reportExport.js)
// from them too — so a figure on screen, in the .xlsx, in the .csv and on the
// printed page is one value, never four calculations. Nothing here computes a
// financial figure: totals come from useInstallationTotals, Total collected
// payments from totalCollectedPayment (utils/meterPricing.js) and Revenue due
// from summarizeRevenueTransactions (utils/financeSummary.js), as before.
import { COLUMN_TYPES } from './xlsx';
import { unpricedNote } from './meterPricing';
import { formatPhaseLabel } from './installationScope';
import { formatCurrencyNGN } from './currency';
import { formatPlainDate } from './date';

const { TEXT, NUMBER, CURRENCY, DATETIME } = COLUMN_TYPES;
const plural = (n, word) => `${Number(n).toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const n = (v) => Number(v).toLocaleString();

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------

/** The installation figures Reports → Overview shows, in its order. */
export function overviewInstallationFigures(t) {
  if (!t) return [];
  return [
    { label: 'Total requests', value: t.pending + t.completed + t.awaitingPayment + t.cancelled, hint: 'Every JED and imported request' },
    { label: 'Pending installations', value: t.pending, hint: '= Dashboard Pending / Awaiting Installations' },
    { label: 'Completed installations', value: t.completed, hint: null },
    { label: 'Pending, with an installer', value: t.breakdown.pending.withInstaller, hint: 'Part of pending: assigned or in progress' },
    { label: 'Pending, not yet assigned', value: t.breakdown.pending.unassigned, hint: 'Part of pending: imported, no installer yet' },
    { label: 'Pending after a failed attempt', value: t.breakdown.pending.failed, hint: 'Part of pending' },
    {
      label: 'Paid JED requests', value: t.breakdown.pending.jedPaid + t.breakdown.completed.jed,
      hint: `${n(t.breakdown.pending.jedPaid)} awaiting installation · ${n(t.breakdown.completed.jed)} completed`,
    },
    { label: 'Awaiting payment', value: t.awaitingPayment, hint: 'JED, RRR not yet paid — not pending' },
    { label: 'Cancelled', value: t.cancelled, hint: 'Counted nowhere' },
  ];
}

/**
 * Total collected payments and Revenue due exactly as RevenueSummaryPanel
 * shows them: an amount, or null with the reason it isn't shown.
 * @returns {{ collected: { amount: number|null, loading: boolean, error: string|null, detail: string|null,
 *   byType: { label: string, count: number, unitPrice: number|null, value: number|null }[], note: string|null },
 *   due: { amount: number|null, loading: boolean, error: string|null, detail: string|null, note: string|null },
 *   mismatch: string|null }}
 */
export function paymentFigures(collected, revenue) {
  const v = collected?.valuation || null;
  const summary = revenue?.summary || null;
  const collectedError = collected?.error
    ? 'Unable to load payment data.'
    : (!collected?.loading && collected?.incomplete ? 'Not every pending installation could be read, so the total is not shown short.' : null);
  const dueError = revenue?.error
    ? 'Unable to load revenue data.'
    : (summary && !summary.complete ? 'Not every revenue record could be loaded, so this total is not shown short.' : null);
  const amountOr = (error, value) => (error || value === null || value === undefined ? null : value);
  return {
    collected: {
      amount: collected?.loading ? null : amountOr(collectedError, v?.total),
      loading: !!collected?.loading,
      error: collectedError,
      detail: collectedError || (v ? `${plural(v.count, 'pending installation')}${v.byType.length ? ':' : ''}` : null),
      byType: (v?.byType || []).map((t) => ({
        label: `${t.type === 'UNSPECIFIED' ? 'with no meter type' : (t.name || formatPhaseLabel(t.type))}${t.disco ? ` (${t.disco})` : ''}`,
        count: t.count,
        unitPrice: t.unitPrice,
        value: t.value,
      })),
      note: v ? unpricedNote(v.unpriced) : null,
    },
    due: {
      amount: revenue?.loading ? null : amountOr(dueError, summary?.revenueDue),
      loading: !!revenue?.loading,
      error: dueError,
      detail: dueError || (summary ? plural(summary.completedCount, 'completed installation') : null),
      note: summary?.complete && summary.note ? summary.note : null,
    },
    mismatch: collected?.mismatch || null,
  };
}

const OVERVIEW_COLUMNS = [
  { key: 'section', header: 'Section', type: TEXT },
  { key: 'metric', header: 'Metric', type: TEXT },
  { key: 'count', header: 'Count', type: NUMBER },
  { key: 'amount', header: 'Amount (₦)', type: CURRENCY },
  { key: 'detail', header: 'Detail', type: TEXT },
];

/**
 * Reports → Overview as a report. Money rows only when `showMoney` (the
 * viewer holds PAYMENTS.VIEW) — the same rule as the screen.
 * @param {{ totals: object|null, payment?: ReturnType<typeof paymentFigures>|null,
 *   recordedTotal?: { amount: number|null, error: boolean }|null, prices?: object[],
 *   showMoney: boolean, generatedAt?: Date }} args
 */
export function buildOverviewReport({ totals, payment = null, recordedTotal = null, prices = [], showMoney, generatedAt = new Date() }) {
  if (!totals) throw new Error('Installation totals are not loaded.');
  const rows = overviewInstallationFigures(totals).map((f) => ({
    section: 'Installations (all discos)', metric: f.label, count: f.value, amount: null, detail: f.hint,
  }));
  const notes = [];
  if (showMoney && payment) {
    const c = payment.collected;
    const d = payment.due;
    if (c.loading || d.loading) throw new Error('Payment figures are still loading.');
    rows.push({
      section: 'Payments', metric: 'Total collected payments', count: null, amount: c.amount,
      // c.detail ends with ':' on screen (it introduces the per-type list); not here.
      detail: [c.amount === null ? 'Unavailable' : null, c.detail?.replace(/:$/, ''), 'Pending installations valued at the configured meter-type prices'].filter(Boolean).join(' — '),
    });
    c.byType.forEach((t) => rows.push({
      section: 'Payments', metric: `  ${t.label}`, count: t.count, amount: t.value,
      detail: t.unitPrice !== null ? `× ${formatCurrencyNGN(t.unitPrice)}` : 'not valued',
    }));
    rows.push({
      section: 'Payments', metric: 'Revenue due to us', count: null, amount: d.amount,
      detail: [d.amount === null ? 'Unavailable' : null, d.detail, 'Recognised revenue for completed installations'].filter(Boolean).join(' — '),
    });
    if (recordedTotal) {
      rows.push({
        section: 'Payments', metric: 'Total amount paid (all recorded payments)', count: null,
        amount: recordedTotal.error ? null : recordedTotal.amount,
        detail: `${recordedTotal.error || recordedTotal.amount === null ? 'Unavailable — ' : ''}The sum of the recorded payment records; a different figure from Total collected payments`,
      });
    }
    prices.forEach((p) => rows.push({
      section: 'Current meter prices', metric: `${p.name}${p.disco ? ` (${p.disco})` : ''}`, count: null, amount: p.price, detail: null,
    }));
    [c.note, d.note && `Revenue due: ${d.note}`, payment.mismatch].filter(Boolean).forEach((x) => notes.push(x));
  }
  if (totals.reconciles === false) notes.push("The server's per-status counts don't add up to its own total.");
  return {
    title: 'Overview Report', slug: 'Overview', generatedAt, orientation: 'portrait',
    filters: [{ label: 'Scope', value: 'All discos' }], notes,
    tables: [{ name: 'Overview', title: 'Overview', columns: OVERVIEW_COLUMNS, rows }],
  };
}

// --------------------------------------------------------------------------
// Payments & deals
// --------------------------------------------------------------------------

const SOURCE_LABELS = { jed_customer_request: 'JED Remita request', installation_request: 'Imported installation' };
const DATE_BASIS_LABELS = { date_paid: 'Paid', date_completed: 'Completed', date_requested: 'Requested', reported_at: 'Installed' };

const DEAL_COLUMNS = [
  { key: 'reference', header: 'Account Number', type: TEXT },
  { key: 'customerName', header: 'Customer', type: TEXT },
  { key: 'discoCode', header: 'Disco', type: TEXT },
  { key: 'meterType', header: 'Meter Type', type: TEXT },
  { key: 'status', header: 'Status', type: TEXT },
  { key: 'amount', header: 'Amount (₦)', type: CURRENCY },
  { key: 'amountNote', header: 'Amount Note', type: TEXT },
  { key: 'revenueAt', header: 'Recognised At', type: DATETIME },
  { key: 'dateBasis', header: 'Recognised On', type: TEXT },
  { key: 'source', header: 'Record Type', type: TEXT },
  { key: 'sourceId', header: 'Record ID', type: TEXT },
];

/**
 * Payments & deals → Recognised revenue as a report: every transaction that
 * matches the screen's filters (all pages), plus the summary the screen shows
 * for the same filters.
 * @param {{ rows: object[] (normalizeRevenueTransaction), statusLabel: (row) => string,
 *   summary: object|null (summarizeRevenue), filters: {label,value}[], generatedAt?: Date }} args
 */
export function buildPaymentsDealsReport({ rows, statusLabel, summary, filters, searching = false, generatedAt = new Date() }) {
  const data = rows.map((r) => ({
    reference: r.reference || null,
    customerName: r.customerName || null,
    discoCode: r.discoCode || null,
    meterType: r.meterType ? formatPhaseLabel(r.meterType) : null,
    status: r.sourceStatus ? statusLabel(r) : null,
    amount: r.amountMissing ? null : r.amount,
    amountNote: r.amountMissing ? 'Not priced' : (r.isEstimated ? 'Estimated' : null),
    revenueAt: r.revenueAt || null,
    dateBasis: DATE_BASIS_LABELS[r.dateBasis] || r.dateBasis || null,
    source: SOURCE_LABELS[r.source] || r.source || null,
    sourceId: r.sourceId ?? null,
  }));
  const notes = [];
  const summaryRows = [];
  if (summary) {
    summaryRows.push({ item: 'Recognised revenue', count: summary.count, amount: summary.amount, detail: summary.note || null });
    summary.byDisco.forEach((d) => summaryRows.push({
      item: `  ${d.discoCode}`, count: d.count, amount: d.amount, detail: [d.recognitionText, d.note].filter(Boolean).join(' — ') || null,
    }));
    // summary.note rides on the Recognised revenue row itself — not repeated as a note.
    if (searching) notes.push('The search narrows the records only; the summary covers the date, meter type and disco filters.');
  }
  return {
    title: 'Payment & Deals Report', slug: 'Payment-Deals', generatedAt, orientation: 'landscape', filters, notes,
    tables: [
      { name: 'Payments & Deals', title: 'Recognised revenue records', columns: DEAL_COLUMNS, rows: data },
      ...(summaryRows.length ? [{
        name: 'Summary', title: 'Summary',
        columns: [
          { key: 'item', header: 'Item', type: TEXT },
          { key: 'count', header: 'Records', type: NUMBER },
          { key: 'amount', header: 'Amount (₦)', type: CURRENCY },
          { key: 'detail', header: 'Detail', type: TEXT },
        ],
        rows: summaryRows,
      }] : []),
    ],
  };
}

const REMITA_COLUMNS = [
  { key: 'customerName', header: 'Customer', type: TEXT },
  { key: 'accountNumber', header: 'Account Number', type: TEXT },
  { key: 'meterType', header: 'Meter Type', type: TEXT },
  { key: 'status', header: 'Status', type: TEXT },
  { key: 'amount', header: 'Amount (₦)', type: CURRENCY },
  { key: 'date', header: 'Date Paid', type: DATETIME },
];

/** Payments & deals → Remita payments as a report (the loaded window, all pages). */
export function buildRemitaPaymentsReport({ payments, rangeLabel, generatedAt = new Date() }) {
  return {
    title: 'Remita Payments Report', slug: 'Remita-Payments', generatedAt, orientation: 'landscape',
    filters: [{ label: 'Date paid', value: rangeLabel }], notes: [],
    tables: [{
      name: 'Remita Payments', title: 'Remita payment records', columns: REMITA_COLUMNS,
      rows: payments.map((p) => ({
        customerName: p?.custNames || p?.customerName || null,
        accountNumber: p?.accountNumber != null ? String(p.accountNumber) : null,
        meterType: p?.meterType || null,
        status: p?.status || null,
        amount: p?.amount ?? p?.amountPaid ?? null,
        date: p?.datePaid || p?.dateCompleted || null,
      })),
    }],
  };
}

/** "01 Sep 2026 – 30 Sep 2026", or one side, for a filter summary. */
export const dateRangeText = (from, to) => (from || to
  ? `${from ? formatPlainDate(from) : '…'} – ${to ? formatPlainDate(to) : '…'}`
  : null);
