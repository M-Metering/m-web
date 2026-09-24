import { describe, it, expect } from 'vitest';
import { summarizeRemitaPayments, parseAmount } from '../paymentSummary';

describe('parseAmount', () => {
  it.each([
    [67000, 67000],
    ['67,000', 67000],
    [' 1500.50 ', 1500.5],
    [0, null],
    [-10, null],
    ['abc', null],
    [null, null],
    [undefined, null],
    ['', null],
    [Number.NaN, null],
  ])('%p → %p', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
});

describe('summarizeRemitaPayments', () => {
  it('collects PAID and COMPLETED, and counts only COMPLETED as revenue due', () => {
    const s = summarizeRemitaPayments([
      { id: 1, accountNumber: '1', rrr: 'A', status: 'PAID', amount: 67000 },
      { id: 2, accountNumber: '2', rrr: 'B', status: 'COMPLETED', amount: 50000 },
      { id: 3, accountNumber: '3', rrr: 'C', status: 'completed', amount: '25,000' },
      { id: 4, accountNumber: '4', rrr: 'D', status: 'INITIATED', amount: 99999 },
    ]);
    expect(s.collected).toBe(142000);
    expect(s.revenueDue).toBe(75000);
    expect(s.paidCount).toBe(1);
    expect(s.completedCount).toBe(2);
  });

  it('never counts unpaid (INITIATED) or unknown statuses', () => {
    const s = summarizeRemitaPayments([
      { id: 1, status: 'INITIATED', amount: 1000 },
      { id: 2, status: 'CANCELLED', amount: 1000 },
      { id: 3, status: '', amount: 1000 },
    ]);
    expect(s).toMatchObject({ collected: 0, revenueDue: 0, paidCount: 0, completedCount: 0 });
  });

  it('skips duplicate records sharing an RRR, id or account number', () => {
    const s = summarizeRemitaPayments([
      { id: 1, accountNumber: '100', rrr: 'R1', status: 'COMPLETED', amount: 1000 },
      { id: 9, accountNumber: '200', rrr: 'R1', status: 'COMPLETED', amount: 1000 }, // same RRR
      { id: 1, accountNumber: '300', rrr: 'R3', status: 'PAID', amount: 1000 },      // same id
      { id: 5, accountNumber: '100', rrr: 'R5', status: 'PAID', amount: 1000 },      // same account
    ]);
    expect(s.collected).toBe(1000);
    expect(s.revenueDue).toBe(1000);
    expect(s.duplicates).toBe(3);
  });

  it('skips and reports missing or invalid amounts instead of guessing', () => {
    const s = summarizeRemitaPayments([
      { id: 1, status: 'PAID', amount: null },
      { id: 2, status: 'COMPLETED', amount: 'n/a' },
      { id: 3, status: 'COMPLETED', amount: 0 },
      { id: 4, status: 'COMPLETED', amount: 2000 },
    ]);
    expect(s.collected).toBe(2000);
    expect(s.revenueDue).toBe(2000);
    expect(s.invalidAmounts).toBe(3);
    expect(s.completedCount).toBe(1);
  });

  it('avoids floating-point drift in the totals', () => {
    const s = summarizeRemitaPayments([
      { id: 1, status: 'PAID', amount: 0.1 },
      { id: 2, status: 'PAID', amount: 0.2 },
    ]);
    expect(s.collected).toBe(0.3);
  });

  it('handles an empty list', () => {
    expect(summarizeRemitaPayments()).toMatchObject({ collected: 0, revenueDue: 0 });
  });
});
