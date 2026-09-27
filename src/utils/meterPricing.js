// src/utils/meterPricing.js
// Installation VALUE from the configured meter-type prices — the one place
// that turns "these pending installations" into a naira figure.
//
// SOURCE OF PRICES: GET /settings/meter-type → { id, name, amount, isActive }.
// Admins edit them in Settings → Meter Types; every edit clears the API cache
// and fires the app's refresh signal, so the value re-reads at the current
// price with no deployment. Nothing here hardcodes a price.
//
// MATCHING. A meter type's `name` and an installation's meter type are both
// put through normalizePhase, so "Single Phase", "SINGLE PHASE" and "1-Phase"
// are one type. Only ACTIVE types with a positive amount price anything.
//
// WHAT IS NEVER GUESSED (each is counted and reported, never priced):
//   unknownType  — the installation has no meter type at all
//   noPrice      — its type has no active meter-type price configured
//   ambiguous    — two active meter types normalise to the same type at
//                  DIFFERENT prices, so there is no single right price
//
// THIS IS A VALUE, NOT A PAYMENT. It is "what these installations are worth at
// today's prices". Money actually recorded as paid comes from the revenue
// records (utils/financeSummary.js) and is shown separately, labelled as such.
import { normalizePhase } from './installationScope';
import { isPendingInstallationRow } from './installationTotals';

const positive = (value) => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {object[]} meterTypes - GET /settings/meter-type rows
 * @returns {{ prices: Map<string, { price: number, name: string, id: any }>, ambiguous: Set<string> }}
 */
export function buildPriceIndex(meterTypes = []) {
  const prices = new Map();
  const ambiguous = new Set();
  meterTypes.forEach((t) => {
    if (!t || t.isActive === false) return;
    const key = normalizePhase(t.name);
    const price = positive(t.amount);
    if (!key || price === null) return;
    const existing = prices.get(key);
    if (existing && existing.price !== price) ambiguous.add(key);
    else if (!existing) prices.set(key, { price, name: t.name, id: t.id });
  });
  ambiguous.forEach((key) => prices.delete(key));
  return { prices, ambiguous };
}

/**
 * Value a set of installations at the configured meter-type prices.
 *
 * @param {{ key?: string, accountNumber?: string, meterType?: string }[]} rows
 * @param {ReturnType<typeof buildPriceIndex>} index
 * @returns {{ total: number, pricedCount: number, count: number,
 *   byType: { type: string, count: number, unitPrice: number|null, value: number|null, reason: string|null }[],
 *   unpriced: { count: number, unknownType: number, noPrice: number, ambiguous: number, examples: string[] } }}
 */
export function valueInstallations(rows = [], index = { prices: new Map(), ambiguous: new Set() }) {
  const groups = new Map();
  const unpriced = { count: 0, unknownType: 0, noPrice: 0, ambiguous: 0, examples: [] };
  let total = 0;
  let pricedCount = 0;

  rows.forEach((row) => {
    const type = normalizePhase(row?.meterType);
    let reason = null;
    if (!type) reason = 'unknownType';
    else if (index.ambiguous.has(type)) reason = 'ambiguous';
    else if (!index.prices.has(type)) reason = 'noPrice';

    const groupKey = type || 'UNSPECIFIED';
    if (!groups.has(groupKey)) {
      const unitPrice = reason ? null : index.prices.get(type).price;
      // `name` is the meter type as configured in Settings (e.g. 'CT Operated'),
      // so the breakdown reads the way the admin named it.
      const name = reason ? null : index.prices.get(type).name;
      groups.set(groupKey, { type: groupKey, name, count: 0, unitPrice, value: reason ? null : 0, reason });
    }
    const g = groups.get(groupKey);
    g.count += 1;
    if (reason) {
      unpriced.count += 1;
      unpriced[reason] += 1;
      if (unpriced.examples.length < 5 && row?.accountNumber) unpriced.examples.push(String(row.accountNumber));
    } else {
      g.value += g.unitPrice;
      total += g.unitPrice;
      pricedCount += 1;
    }
  });

  return {
    total: Math.round(total * 100) / 100,
    pricedCount,
    count: rows.length,
    byType: Array.from(groups.values()).sort((a, b) => a.type.localeCompare(b.type)),
    unpriced,
  };
}

/**
 * TOTAL COLLECTED PAYMENT (business definition, 2026-09-28): the value of the
 * Pending (= Awaiting) Installations at the configured meter-type prices —
 * Σ over each qualifying record of its own meter type's current price.
 *
 * The ONE formula for that figure. The shared loader applies it to every
 * pending record (Dashboard, Payments, Reports, and the Installations page
 * when nothing is filtered); the Installations page applies it to exactly the
 * rows its filters show, so the count beside it and this value always describe
 * the same records. Records that aren't pending are ignored here, whatever the
 * caller passes, so a list of mixed statuses can be handed in safely.
 *
 * It is a value, not a sum of payment records: a paid JED request contributes
 * its meter type's current price, not its recorded amount, so nothing is
 * counted twice.
 *
 * @param {object[]} rows - normalised rows (normalizeMultiRow / normalizeJedRow)
 * @param {ReturnType<typeof buildPriceIndex>} index
 */
export function totalCollectedPayment(rows = [], index) {
  return valueInstallations(rows.filter(isPendingInstallationRow), index);
}

/** A one-line, operator-facing explanation of what could not be priced, or null. */
export function unpricedNote(unpriced) {
  if (!unpriced?.count) return null;
  const parts = [];
  if (unpriced.unknownType) parts.push(`${unpriced.unknownType} with no meter type`);
  if (unpriced.noPrice) parts.push(`${unpriced.noPrice} whose meter type has no active price`);
  if (unpriced.ambiguous) parts.push(`${unpriced.ambiguous} whose meter type has conflicting prices`);
  return `Not valued: ${parts.join(', ')}${unpriced.examples.length ? ` (e.g. account ${unpriced.examples.join(', ')})` : ''}.`;
}

export default valueInstallations;
