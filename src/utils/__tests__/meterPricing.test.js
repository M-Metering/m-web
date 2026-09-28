import { describe, it, expect } from 'vitest';
import { buildPriceIndex, valueInstallations, unpricedNote } from '../meterPricing';

const TYPES = [
  { id: 1, name: 'Single Phase', amount: 100000, isActive: true },
  { id: 2, name: 'Three Phase', amount: '150,000', isActive: true },
];
const jobs = (type, n, prefix = 'A') => Array.from({ length: n }, (_, i) => ({ accountNumber: `${prefix}${i}`, meterType: type }));

describe('valueInstallations', () => {
  it('matches the worked example: 5 × ₦100,000 + 2 × ₦150,000 = ₦800,000', () => {
    const v = valueInstallations([...jobs('SINGLE PHASE', 5), ...jobs('THREE PHASE', 2)], buildPriceIndex(TYPES));
    expect(v.total).toBe(800000);
    expect(v.byType).toEqual([
      { type: 'SINGLE PHASE', name: 'Single Phase', count: 5, unitPrice: 100000, value: 500000, reason: null },
      { type: 'THREE PHASE', name: 'Three Phase', count: 2, unitPrice: 150000, value: 300000, reason: null },
    ]);
    expect(v.unpriced.count).toBe(0);
  });

  it('reads each installation\'s own meter type, whatever its spelling', () => {
    const v = valueInstallations([
      { meterType: 'Single Phase' }, { meterType: '3 Phase' }, { meterType: 'THREE_PHASE' }, { meterType: '1PH' },
    ], buildPriceIndex(TYPES));
    expect(v.total).toBe(2 * 100000 + 2 * 150000);
  });

  it('follows a price change immediately — nothing is cached or hardcoded', () => {
    const rows = jobs('SINGLE PHASE', 10);
    expect(valueInstallations(rows, buildPriceIndex(TYPES)).total).toBe(1000000);
    const raised = TYPES.map((t) => (t.id === 1 ? { ...t, amount: 120000 } : t));
    expect(valueInstallations(rows, buildPriceIndex(raised)).total).toBe(1200000);
  });

  it('never prices a missing, unpriced or ambiguous meter type — it counts and names them', () => {
    const index = buildPriceIndex([
      ...TYPES,
      { id: 3, name: 'three phase', amount: 175000, isActive: true }, // conflicts with Three Phase
      { id: 4, name: 'CT Operated', amount: 0, isActive: true }, // no valid price
    ]);
    const v = valueInstallations([
      ...jobs('SINGLE PHASE', 1),
      { accountNumber: 'X1', meterType: '' },
      { accountNumber: 'X2', meterType: 'CT Operated' },
      { accountNumber: 'X3', meterType: 'Three Phase' },
    ], index);
    expect(v.total).toBe(100000);
    expect(v.unpriced).toMatchObject({ count: 3, unknownType: 1, noPrice: 1, ambiguous: 1, examples: ['X1', 'X2', 'X3'] });
    expect(unpricedNote(v.unpriced)).toMatch(/1 with no meter type, 1 whose meter type has no active price, 1 whose meter type has conflicting prices/);
  });

  it('ignores inactive meter types', () => {
    const index = buildPriceIndex([{ id: 1, name: 'Single Phase', amount: 90000, isActive: false }]);
    expect(valueInstallations(jobs('SINGLE PHASE', 2), index).unpriced.noPrice).toBe(2);
  });

  it('treats a duplicate meter type at the SAME price as one price', () => {
    const index = buildPriceIndex([...TYPES, { id: 9, name: 'SINGLE PHASE', amount: 100000, isActive: true }]);
    expect(valueInstallations(jobs('SINGLE PHASE', 3), index).total).toBe(300000);
  });
});
