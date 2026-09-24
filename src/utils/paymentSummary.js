// src/utils/paymentSummary.js
// Collected payments and "revenue due to us" for a set of Remita (JED-flow)
// customer requests — the only records in this API that carry a payment
// amount (`JedCustomerRequest.amount`, with status INITIATED/PAID/COMPLETED).
// Multi-disco `InstallationRequest` records have no amount or payment field at
// all, so imported jobs can never contribute here; see API_GAP_REPORT.md.
//
// Rules:
//   - Collected  = sum of valid amounts on PAID or COMPLETED requests
//                  (INITIATED = RRR generated, not paid — never counted).
//   - Revenue due to us = the COMPLETED subset only (installation done).
//   - A request is counted once: repeats of the same RRR, id or account
//     number are skipped (and reported), so a duplicated record can't
//     inflate either figure.
//   - A missing, non-numeric, zero or negative amount is skipped and
//     reported rather than guessed.
import { normalizeStatus } from './statusBadge';

const PAID_STATUSES = new Set(['PAID', 'COMPLETED']);

/** A positive finite amount, or null. Accepts "67,000" strings. */
export function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object[]} records - raw JedCustomerRequest objects
 * @returns {{ collected: number, revenueDue: number, paidCount: number,
 *   completedCount: number, duplicates: number, invalidAmounts: number }}
 *   paidCount/completedCount count only records whose amount was counted.
 */
export function summarizeRemitaPayments(records = []) {
  const seen = { rrr: new Set(), id: new Set(), account: new Set() };
  let collected = 0;
  let revenueDue = 0;
  let paidCount = 0;
  let completedCount = 0;
  let duplicates = 0;
  let invalidAmounts = 0;

  records.forEach((r) => {
    const status = normalizeStatus(r?.status);
    if (!PAID_STATUSES.has(status)) return;

    const rrr = r.rrr ? String(r.rrr).trim() : '';
    const id = r.id != null ? String(r.id) : '';
    const account = r.accountNumber != null ? String(r.accountNumber).trim() : '';
    if ((rrr && seen.rrr.has(rrr)) || (id && seen.id.has(id)) || (account && seen.account.has(account))) {
      duplicates += 1;
      return;
    }
    if (rrr) seen.rrr.add(rrr);
    if (id) seen.id.add(id);
    if (account) seen.account.add(account);

    const amount = parseAmount(r.amount);
    if (amount === null) {
      invalidAmounts += 1;
      return;
    }

    collected += amount;
    if (status === 'COMPLETED') {
      revenueDue += amount;
      completedCount += 1;
    } else {
      paidCount += 1;
    }
  });

  return {
    collected: round2(collected),
    revenueDue: round2(revenueDue),
    paidCount,
    completedCount,
    duplicates,
    invalidAmounts,
  };
}

export default summarizeRemitaPayments;
