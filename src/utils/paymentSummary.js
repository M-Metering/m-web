// src/utils/paymentSummary.js
// Parsing a payment amount off a Remita (JED-flow) customer request.
//
// This file used to also hold summarizeRemitaPayments — "collected" and
// "revenue due" computed from JED's Remita records alone. That was a second
// revenue calculation beside utils/financeSummary.js, it could only ever see
// the JED flow (imported installation work has no Remita records at all), and
// it disagreed with the Dashboard on the same screen scope. It was removed on
// 2026-09-27: every revenue figure now comes from summarizeRevenueTransactions
// over GET /finance/revenue/transactions. What remains here is only the amount
// parser the completed-installations export uses for a JED row's amount.

/** A positive finite amount, or null. Accepts "67,000" strings. */
export function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default parseAmount;
