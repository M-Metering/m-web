import { describe, it, expect } from 'vitest';
import {
  summarizeInstallationTotals, importedStatusCount, jedTotalCount, edgePages, pickRecentRequests,
} from '../installationTotals';
import { summarizeRevenueTransactions } from '../financeSummary';
import { normalizeMultiRow, normalizeJedRow, JED_BUCKET } from '../installationScope';

const stats = (over = {}) => ({
  success: true,
  data: { total: 0, pending: 0, assigned: 0, inProgress: 0, installed: 0, exported: 0, failed: 0, cancelled: 0, ...over },
});
const jed = (PAID, COMPLETED, INITIATED = 0) => ({ PAID, COMPLETED, INITIATED });

describe('summarizeInstallationTotals — the status mapping', () => {
  it('reconciles the worked example: 100 paid, 65 completed → 35 pending, 65 completed', () => {
    const t = summarizeInstallationTotals({ importedStats: stats(), jedCounts: jed(35, 65) });
    expect(t.pending).toBe(35);
    expect(t.completed).toBe(65);
    expect(t.pending + t.completed).toBe(100);
  });

  it('counts paid-but-not-installed as pending and never counts payment alone as completed', () => {
    const t = summarizeInstallationTotals({ importedStats: stats(), jedCounts: jed(4, 0, 9) });
    expect(t).toMatchObject({ pending: 4, completed: 0, awaitingPayment: 9 });
  });

  it('adds imported jobs: pending = PENDING+ASSIGNED+IN_PROGRESS+FAILED, completed = INSTALLED+EXPORTED', () => {
    const t = summarizeInstallationTotals({
      importedStats: stats({ total: 31, pending: 10, assigned: 5, inProgress: 2, failed: 1, installed: 7, exported: 3, cancelled: 3 }),
      jedCounts: jed(2, 4),
    });
    expect(t.pending).toBe(10 + 5 + 2 + 1 + 2);
    expect(t.completed).toBe(7 + 3 + 4);
    expect(t.cancelled).toBe(3);
    expect(t.breakdown.pending).toMatchObject({ jedPaid: 2, imported: 18, unassigned: 10, withInstaller: 7, failed: 1 });
    // Every imported status lands in exactly one bucket.
    expect(t.reconciles).toBe(true);
  });

  it('flags statistics that do not add up to their own total', () => {
    const t = summarizeInstallationTotals({ importedStats: stats({ total: 50, pending: 1 }), jedCounts: jed(0, 0) });
    expect(t.reconciles).toBe(false);
  });

  it('throws — rather than reporting 0 — when a needed count is missing', () => {
    expect(() => summarizeInstallationTotals({ importedStats: { data: { total: 3 } }, jedCounts: jed(1, 1) })).toThrow();
    expect(() => summarizeInstallationTotals({ importedStats: stats(), jedCounts: jed(null, 1) })).toThrow();
  });

  it('reads counts only from the documented aggregate fields', () => {
    expect(importedStatusCount(stats({ inProgress: 4 }), 'IN_PROGRESS')).toBe(4);
    expect(importedStatusCount({ data: {} }, 'PENDING')).toBeNull();
    expect(jedTotalCount({ data: [{}], pagination: { totalCount: 57 } })).toBe(57);
    expect(jedTotalCount({ data: [{}, {}] })).toBeNull();
  });
});

describe('recent installation requests', () => {
  it('reads the first page and the last two, whichever way the server orders', () => {
    expect(edgePages(1)).toEqual([1]);
    expect(edgePages(2)).toEqual([1, 2]);
    expect(edgePages(3)).toEqual([1, 2, 3]);
    expect(edgePages(40)).toEqual([1, 39, 40]);
    expect(edgePages(undefined)).toEqual([1]);
  });

  it('merges both domains newest-first by request date, deduped by resource key', () => {
    const rows = [
      normalizeMultiRow({ id: 1, accountNumber: '1001', createdAt: '2026-09-20T09:00:00Z', status: 'PENDING' }),
      normalizeJedRow({ accountNumber: '477014', dateRequested: '2026-09-26T09:00:00Z', status: 'PAID' }, JED_BUCKET),
      normalizeMultiRow({ id: 2, accountNumber: '1002', createdAt: '2026-09-27T09:00:00Z', status: 'ASSIGNED' }),
      normalizeMultiRow({ id: 2, accountNumber: '1002', createdAt: '2026-09-27T09:00:00Z', status: 'ASSIGNED' }),
      normalizeJedRow({ accountNumber: '477015', dateRequested: '2026-09-01T09:00:00Z', status: 'COMPLETED' }, JED_BUCKET),
    ];
    expect(pickRecentRequests(rows, 3).map((r) => r.accountNumber)).toEqual(['1002', '477014', '1001']);
  });
});

describe('revenue: a payment is counted once', () => {
  it('drops a record the server returns twice, by its own identity', () => {
    const row = { source: 'jed_customer_request', sourceId: 12, reference: '477014', amount: 67000, sourceStatus: 'PAID' };
    const s = summarizeRevenueTransactions([row, { ...row }], { amount: 67000, count: 1 });
    expect(s.collected).toBe(67000);
    expect(s.duplicates).toBe(1);
    expect(s.complete).toBe(true);
  });

  it('is not fooled into "complete" by a repeated page hiding a missing record', () => {
    const a = { source: 'jed_customer_request', sourceId: 1, amount: 100, sourceStatus: 'PAID' };
    const s = summarizeRevenueTransactions([a, { ...a }], { amount: 300, count: 2 });
    expect(s.complete).toBe(false);
    expect(s.collected).toBeNull();
  });
});
