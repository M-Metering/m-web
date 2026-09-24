import { describe, it, expect } from 'vitest';
import {
  assignedJobKey, jedRequestKey, dedupeByKey,
  splitAssignedJobs, splitJedQueue, summarizeInstallerJobs, matchesInstallerSearch,
} from '../installerQueue';

const job = (id, status, over = {}) => ({ id, status, accountNumber: `45710862${id}`, ...over });
const jed = (accountNumber, status, over = {}) => ({ accountNumber, status, custNames: 'ADA OBI', ...over });

describe('record identity', () => {
  it('keys an assigned job by its integer id', () => {
    expect(assignedJobKey({ id: 7 })).toBe('M-7');
    expect(assignedJobKey({ id: 7 })).toBe(assignedJobKey({ id: '7' }));
  });

  it('falls back to disco + account when a job has no id', () => {
    expect(assignedJobKey({ discoCode: 'ABA_POWER', accountNumber: '4571086214' }))
      .toBe('M-ABA_POWER-4571086214');
  });

  it('keys a JED request by account number, the resource key', () => {
    expect(jedRequestKey({ accountNumber: '477014' })).toBe('J-477014');
    // A different id for the same account is still the same request.
    expect(jedRequestKey({ accountNumber: '477014', id: 1 }))
      .toBe(jedRequestKey({ accountNumber: '477014', id: 2 }));
  });

  it('never collapses two records on name or meter number alone', () => {
    // Same customer name and meter, genuinely different accounts.
    const a = jed('477014', 'PAID', { meterNo: '0239110006909' });
    const b = jed('477015', 'PAID', { meterNo: '0239110006909' });
    expect(jedRequestKey(a)).not.toBe(jedRequestKey(b));
  });

  it('keeps a record it cannot key, rather than dropping it', () => {
    const { items, duplicates } = dedupeByKey([{}, {}], assignedJobKey);
    expect(items).toHaveLength(2);
    expect(duplicates).toBe(0);
  });
});

describe('splitAssignedJobs', () => {
  it('buckets by the real status and puts a job in at most one queue', () => {
    const jobs = [
      job(1, 'ASSIGNED'), job(2, 'IN_PROGRESS'),
      job(3, 'INSTALLED'), job(4, 'EXPORTED'),
      job(5, 'FAILED'), job(6, 'CANCELLED'), job(7, 'PENDING'),
    ];
    const { awaiting, completed, other } = splitAssignedJobs(jobs);
    expect(awaiting.map((j) => j.id)).toEqual([1, 2]);
    expect(completed.map((j) => j.id)).toEqual([3, 4]);
    expect(other.map((j) => j.id)).toEqual([5, 6, 7]);
    // No job is in two buckets.
    expect(awaiting.filter((j) => completed.includes(j))).toHaveLength(0);
  });

  it('counts a repeated record once and reports the duplicate', () => {
    const { awaiting, all, duplicates } = splitAssignedJobs([
      job(1, 'ASSIGNED'), job(1, 'ASSIGNED'), job(2, 'ASSIGNED'),
    ]);
    expect(awaiting).toHaveLength(2);
    expect(all).toHaveLength(2);
    expect(duplicates).toBe(1);
  });

  it('keeps the first copy when the same job arrives twice with different statuses', () => {
    // Should not happen, but if it does the job must not be in both queues.
    const { awaiting, completed } = splitAssignedJobs([job(1, 'ASSIGNED'), job(1, 'INSTALLED')]);
    expect(awaiting.length + completed.length).toBe(1);
  });
});

describe('splitJedQueue', () => {
  it('treats PAID as awaiting and COMPLETED as completed, INITIATED as neither', () => {
    const { awaiting, completed, other } = splitJedQueue([
      jed('1', 'PAID'), jed('2', 'COMPLETED'), jed('3', 'INITIATED'),
    ]);
    expect(awaiting.map((r) => r.accountNumber)).toEqual(['1']);
    expect(completed.map((r) => r.accountNumber)).toEqual(['2']);
    expect(other.map((r) => r.accountNumber)).toEqual(['3']);
  });

  it('is case-insensitive about the status the API returns', () => {
    const { awaiting, completed } = splitJedQueue([jed('1', 'paid'), jed('2', 'completed')]);
    expect(awaiting).toHaveLength(1);
    expect(completed).toHaveLength(1);
  });

  it('counts the same account once when it arrives from two status queries', () => {
    // The dashboard asks for PAID and COMPLETED separately and merges them;
    // a record present in both responses must still appear once.
    const { awaiting, completed, all, duplicates } = splitJedQueue([
      jed('477014', 'PAID'), jed('477015', 'COMPLETED'), jed('477014', 'PAID'),
    ]);
    expect(all).toHaveLength(2);
    expect(duplicates).toBe(1);
    expect(awaiting).toHaveLength(1);
    expect(completed).toHaveLength(1);
  });

  it('never leaves a completed request in the awaiting queue', () => {
    const { awaiting, completed } = splitJedQueue([jed('477014', 'COMPLETED')]);
    expect(awaiting).toHaveLength(0);
    expect(completed).toHaveLength(1);
  });
});

describe('summarizeInstallerJobs — counts match the lists', () => {
  it.each([
    ['one awaiting', [job(1, 'ASSIGNED')], { awaiting: 1, completed: 0 }],
    ['one completed', [job(1, 'INSTALLED')], { awaiting: 0, completed: 1 }],
    ['one of each', [job(1, 'ASSIGNED'), job(2, 'INSTALLED')], { awaiting: 1, completed: 1 }],
    ['none', [], { awaiting: 0, completed: 0 }],
  ])('%s', (_name, jobs, expected) => {
    const summary = summarizeInstallerJobs(jobs);
    const split = splitAssignedJobs(jobs);
    expect(summary).toMatchObject(expected);
    // The invariant that matters: the card number IS the list length.
    expect(summary.awaiting).toBe(split.awaiting.length);
    expect(summary.completed).toBe(split.completed.length);
  });

  it('counts a duplicated record once', () => {
    expect(summarizeInstallerJobs([job(1, 'ASSIGNED'), job(1, 'ASSIGNED')]))
      .toMatchObject({ awaiting: 1, total: 1, duplicates: 1 });
  });

  it('moves a job from awaiting to completed without leaving a copy behind', () => {
    const before = summarizeInstallerJobs([job(1, 'ASSIGNED'), job(2, 'ASSIGNED')]);
    const after = summarizeInstallerJobs([job(1, 'INSTALLED'), job(2, 'ASSIGNED')]);
    expect(before).toMatchObject({ awaiting: 2, completed: 0 });
    expect(after).toMatchObject({ awaiting: 1, completed: 1 });
    expect(after.total).toBe(before.total);
  });
});

describe('matchesInstallerSearch', () => {
  it('matches the fields of either resource', () => {
    expect(matchesInstallerSearch(jed('477014', 'PAID', { meterNo: '0239110006909' }), '477014')).toBe(true);
    expect(matchesInstallerSearch(jed('477014', 'PAID', { meterNo: '0239110006909' }), '0239110')).toBe(true);
    expect(matchesInstallerSearch({ customerName: 'NGOZI EKE', meterNumber: '123' }, 'ngozi')).toBe(true);
  });

  it('matches everything on an empty term, and nothing irrelevant', () => {
    expect(matchesInstallerSearch(jed('477014', 'PAID'), '')).toBe(true);
    expect(matchesInstallerSearch(jed('477014', 'PAID'), '   ')).toBe(true);
    expect(matchesInstallerSearch(jed('477014', 'PAID'), 'zzzz')).toBe(false);
  });
});
