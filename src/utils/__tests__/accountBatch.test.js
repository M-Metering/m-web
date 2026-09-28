import { describe, it, expect } from 'vitest';
import { classifyPastedAccounts, accountBatchMessage, mergeAssignmentResults } from '../accountBatch';
import { ROW_SOURCE } from '../installationScope';

const multi = (id, accountNumber, status, extra = {}) => ({
  key: `M-${id}`, source: ROW_SOURCE.MULTI, id, accountNumber, status, discoCode: 'ABA_POWER', ...extra,
});
const jed = (accountNumber, status) => ({ key: `J-${accountNumber}`, source: ROW_SOURCE.JED, accountNumber, status });

const ROWS = [
  multi(1, '1234567890', 'PENDING'),
  multi(2, '1234567891', 'FAILED'),
  multi(3, '1234567892', 'ASSIGNED', { installer: 'Musa Bello' }),
  multi(4, '1234567893', 'INSTALLED'),
  multi(5, '0012345678', 'PENDING'),
  jed('477014', 'PAID'),
];

describe('classifyPastedAccounts', () => {
  it('splits a pasted list into assignable, already assigned, not assignable and not found', () => {
    const r = classifyPastedAccounts('1234567890\n1234567891, 1234567892,1234567893\t477014 9999999999', ROWS);
    expect(r.assignable.map((a) => a.account)).toEqual(['1234567890', '1234567891']);
    expect(r.assignableRows.map((row) => row.id)).toEqual([1, 2]);
    expect(r.alreadyAssigned).toEqual([{ account: '1234567892', installer: 'Musa Bello' }]);
    expect(r.cannotAssign).toEqual([
      { account: '1234567893', reason: 'Installed' },
      { account: '477014', reason: 'JED Remita request (not assignable)' },
    ]);
    expect(r.notFound).toEqual(['9999999999']);
    expect(Array.from(r.matchedKeys)).toEqual(['M-1', 'M-2', 'M-3', 'M-4', 'J-477014']);
  });

  it('removes duplicates and blanks, and reports the duplicates', () => {
    const r = classifyPastedAccounts('1234567890\n\n1234567890\n 1234567890 ', ROWS);
    expect(r.accounts).toEqual(['1234567890']);
    expect(r.duplicates).toEqual(['1234567890']);
    expect(r.assignableRows).toHaveLength(1);
  });

  it('compares account numbers as exact strings, keeping leading zeros significant', () => {
    expect(classifyPastedAccounts('0012345678', ROWS).assignable).toHaveLength(1);
    expect(classifyPastedAccounts('12345678', ROWS).notFound).toEqual(['12345678']);
  });

  it('offers every assignable job for an account that exists in two discos', () => {
    const rows = [multi(1, '555', 'PENDING'), multi(9, '555', 'PENDING', { discoCode: 'JED001' })];
    expect(classifyPastedAccounts('555', rows).assignableRows.map((r) => r.discoCode)).toEqual(['ABA_POWER', 'JED001']);
  });
});

describe('accountBatchMessage', () => {
  it('reads like the operator summary', () => {
    expect(accountBatchMessage({ assigned: 15, alreadyAssigned: 3, notFound: 2 }))
      .toBe('15 installations assigned successfully. 3 were already assigned. 2 account numbers were not found.');
    expect(accountBatchMessage({ assigned: 1, alreadyAssigned: 1, notFound: 1, cannotAssign: 1, rejected: 1 }))
      .toBe('1 installation assigned successfully. 1 was already assigned. 1 account number cannot currently be assigned. 1 account number was not found. 1 was refused by the server — see the list below.');
  });
});

describe('mergeAssignmentResults', () => {
  it('adds per-disco responses together', () => {
    expect(mergeAssignmentResults([
      { assignedCount: 2, rejectedCount: 1, rejected: [{ key: '1', reason: 'not pending' }] },
      { assignedCount: 3, rejectedCount: 0, rejected: [] },
    ])).toEqual({ assignedCount: 5, rejectedCount: 1, rejected: [{ key: '1', reason: 'not pending' }] });
  });
});
