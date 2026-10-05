// src/utils/meterPricing.js
// Installation VALUE from the configured meter-type prices — the one place
// that turns "these pending installations" into a naira figure.
//
// SOURCE OF PRICES: GET /settings/meter-type →
// { id, discoId, discoCode, name, amount, isActive }. Admins edit them in
// Settings → Meter Types; every edit clears the API cache and fires the app's
// refresh signal, so the value re-reads at the current price with no
// deployment. Nothing here hardcodes a price.
//
// PRICES ARE PER DISCO (API, 2026-10-04): every price belongs to exactly one
// disco and each disco has its own list, so the key is (disco, meter type).
// An imported installation is priced from its OWN disco's list. A JED Remita
// request is priced from its own discoCode's list when there is one, otherwise
// from JED's list ("JED payments are charged from JED's list"). A price row
// with no discoCode (the pre-2026-10-04 shape) applies to any disco that has
// no price of its own for that type.
//
// MATCHING. A meter type's `name` and an installation's meter type are both
// put through normalizePhase, so "Single Phase", "SINGLE PHASE" and "1-Phase"
// are one type. Only ACTIVE types with a positive amount price anything.
//
// WHAT IS NEVER GUESSED (each is counted and reported, never priced):
//   unknownType  — the installation has no meter type at all
//   noPrice      — its disco has no active price for its meter type
//   ambiguous    — two active prices for the same disco normalise to the same
//                  type at DIFFERENT amounts, so there is no single right price
//                  (the API allows one active price per type per disco, so
//                  this means differently spelled names)
//
// THIS IS A VALUE, NOT A PAYMENT. It is "what these installations are worth at
// today's prices". Money actually recorded as paid comes from the revenue
// records (utils/financeSummary.js) and is shown separately, labelled as such.
import { normalizePhase, ROW_SOURCE } from './installationScope';
import { isPendingInstallationRow } from './installationTotals';

const positive = (value) => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The price list a JED Remita request falls back to. */
export const JED_PRICE_DISCO = 'JED';
// A price row with no disco: the pre-per-disco shape, used as a fallback.
const ANY_DISCO = '*';
const discoOf = (code) => String(code ?? '').trim().toUpperCase();
const priceKey = (disco, type) => `${disco}|${type}`;

/**
 * @param {object[]} meterTypes - GET /settings/meter-type rows
 * @returns {{ prices: Map<string, { price: number, name: string, id: any, disco: string|null }>,
 *   ambiguous: Set<string>, discos: Set<string> }}
 *   keys are `${disco}|${normalisedType}`; `discos` = the discos that have a price list
 */
export function buildPriceIndex(meterTypes = []) {
  const prices = new Map();
  const ambiguous = new Set();
  const discos = new Set();
  meterTypes.forEach((t) => {
    if (!t || t.isActive === false) return;
    const type = normalizePhase(t.name);
    const price = positive(t.amount);
    if (!type || price === null) return;
    const disco = discoOf(t.discoCode) || ANY_DISCO;
    if (disco !== ANY_DISCO) discos.add(disco);
    const key = priceKey(disco, type);
    const existing = prices.get(key);
    if (existing && existing.price !== price) ambiguous.add(key);
    else if (!existing) prices.set(key, { price, name: t.name, id: t.id, disco: disco === ANY_DISCO ? null : disco });
  });
  ambiguous.forEach((key) => prices.delete(key));
  return { prices, ambiguous, discos };
}

/** Which disco's price list values this row (see the header). */
export function priceDiscoFor(row, index) {
  const own = discoOf(row?.discoCode);
  if (own && index?.discos?.has(own)) return own;
  return row?.source === ROW_SOURCE.JED ? JED_PRICE_DISCO : own;
}

/** The price entry for a row's meter type, or why there is none. */
function lookupPrice(row, type, index) {
  const disco = priceDiscoFor(row, index);
  for (const key of [priceKey(disco, type), priceKey(ANY_DISCO, type)]) {
    if (index.ambiguous.has(key)) return { reason: 'ambiguous', disco };
    if (index.prices.has(key)) return { entry: index.prices.get(key), disco };
  }
  return { reason: 'noPrice', disco };
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
export function valueInstallations(rows = [], index = { prices: new Map(), ambiguous: new Set(), discos: new Set() }) {
  const groups = new Map();
  const unpriced = { count: 0, unknownType: 0, noPrice: 0, ambiguous: 0, examples: [] };
  let total = 0;
  let pricedCount = 0;

  rows.forEach((row) => {
    const type = normalizePhase(row?.meterType);
    const found = type ? lookupPrice(row, type, index) : { reason: 'unknownType' };
    const reason = found.reason || null;
    // The disco whose list priced it, when that list is a disco's own.
    const disco = found.entry?.disco || null;

    // One group per (disco, type): two discos may charge differently.
    const groupKey = `${disco || ''}|${type || 'UNSPECIFIED'}`;
    if (!groups.has(groupKey)) {
      const unitPrice = reason ? null : found.entry.price;
      // `name` is the meter type as configured in Settings (e.g. 'CT Operated'),
      // so the breakdown reads the way the admin named it.
      const name = reason ? null : found.entry.name;
      groups.set(groupKey, {
        type: type || 'UNSPECIFIED', ...(disco ? { disco } : {}), name, count: 0, unitPrice, value: reason ? null : 0, reason,
      });
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
    byType: Array.from(groups.values()).sort((a, b) => a.type.localeCompare(b.type) || String(a.disco || '').localeCompare(String(b.disco || ''))),
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
  if (unpriced.noPrice) parts.push(`${unpriced.noPrice} whose meter type has no active price for their disco`);
  if (unpriced.ambiguous) parts.push(`${unpriced.ambiguous} whose meter type has conflicting prices`);
  return `Not valued: ${parts.join(', ')}${unpriced.examples.length ? ` (e.g. account ${unpriced.examples.join(', ')})` : ''}.`;
}

export default valueInstallations;
