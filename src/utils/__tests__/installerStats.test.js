import { describe, it, expect } from 'vitest';
import {
  summarizeInstallerStats, totalInstallerStats, filterInstallerJobs, formatCompletionRate, jobInstallerId, installerMeterList,
} from '../installerStats';

const INSTALLERS = [
  { id: 'u-1', firstName: 'John', lastName: 'Doe' },
  { id: 'u-2', firstName: 'Ada', lastName: 'Obi' },
];
const job = (id, status, extra = {}) => ({
  id, status, assignedTo: 'u-1', accountNumber: `10${id}`, meterType: 'SINGLE PHASE', ...extra,
});

describe('summarizeInstallerStats', () => {
  it('matches the worked example: 20 assigned, 8 awaiting, 12 completed → 60%', () => {
    const jobs = [
      ...Array.from({ length: 5 }, (_, i) => job(i + 1, 'ASSIGNED')),
      ...Array.from({ length: 3 }, (_, i) => job(i + 10, 'IN_PROGRESS')),
      ...Array.from({ length: 10 }, (_, i) => job(i + 20, 'INSTALLED')),
      ...Array.from({ length: 2 }, (_, i) => job(i + 40, 'EXPORTED')),
    ];
    const holders = new Map(Array.from({ length: 20 }, (_, i) => [`0239110000${String(i).padStart(3, '0')}`, { installerId: 'u-1', phaseType: 'SINGLE PHASE' }]));
    const { rows } = summarizeInstallerStats({ installers: INSTALLERS, jobs, holders });
    const john = rows.find((r) => r.installerId === 'u-1');
    expect(john).toMatchObject({
      name: 'John Doe', assigned: 5, inProgress: 3, awaiting: 8, completed: 12, total: 20, meters: 20, inRoster: true,
    });
    expect(formatCompletionRate(john.completionRate)).toBe('60%');
    // 8 open jobs, 20 meters held → nothing more needed, 12 surplus.
    expect(john.capacity).toMatchObject({ required: 8, assigned: 20, remaining: 0, surplus: 12 });
  });

  it('lists every registered installer, including one with no jobs, whose rate is — not 0%', () => {
    const { rows } = summarizeInstallerStats({ installers: INSTALLERS, jobs: [job(1, 'ASSIGNED')], holders: new Map() });
    const ada = rows.find((r) => r.installerId === 'u-2');
    expect(ada.total).toBe(0);
    expect(formatCompletionRate(ada.completionRate)).toBe('—');
    expect(ada.meters).toBe(0);
  });

  it('counts a repeated record once, and counts a failed attempt the installer still holds as awaiting', () => {
    const { rows, duplicates } = summarizeInstallerStats({
      installers: INSTALLERS, jobs: [job(1, 'ASSIGNED'), job(1, 'ASSIGNED'), job(2, 'FAILED')],
    });
    const john = rows.find((r) => r.installerId === 'u-1');
    expect(duplicates).toBe(1);
    expect(john).toMatchObject({ assigned: 1, failed: 1, awaiting: 2, total: 2 });
  });

  it('keeps a job whose installer is no longer on the roster, flagged', () => {
    const { rows } = summarizeInstallerStats({
      installers: INSTALLERS, jobs: [job(1, 'INSTALLED', { assignedTo: 'u-9', assigneeName: 'Former Staff' })],
    });
    expect(rows.find((r) => r.installerId === 'u-9')).toMatchObject({ name: 'Former Staff', inRoster: false, completed: 1 });
  });

  it('reports meters as unknown (null), not 0, when the dispatch index could not be read', () => {
    const { rows } = summarizeInstallerStats({ installers: INSTALLERS, jobs: [], holders: null });
    expect(rows[0].meters).toBeNull();
    expect(totalInstallerStats(rows).meters).toBeNull();
  });

  it('counts held meters per meter type with canonical phases', () => {
    const holders = new Map([
      ['A', { installerId: 'u-2', phaseType: '3 Phase' }],
      ['B', { installerId: 'u-2', phaseType: 'THREE PHASE' }],
      ['C', { installerId: 'u-2', phaseType: 'Single Phase' }],
    ]);
    const { rows } = summarizeInstallerStats({ installers: INSTALLERS, jobs: [], holders });
    expect(rows.find((r) => r.installerId === 'u-2').metersByPhase).toEqual({ 'THREE PHASE': 2, 'SINGLE PHASE': 1 });
  });

  it('never coerces the installer id', () => {
    expect(jobInstallerId({ assignedTo: '0012' })).toBe('0012');
    expect(jobInstallerId({ installerId: 'u-1' })).toBe('u-1');
    expect(jobInstallerId({})).toBeNull();
  });
});

describe('filterInstallerJobs', () => {
  const JOBS = [
    job(1, 'ASSIGNED', { assignedAt: '2026-09-01T09:00:00Z', meterType: 'THREE PHASE' }),
    job(2, 'IN_PROGRESS', { assignedAt: '2026-09-05T09:00:00Z' }),
    job(3, 'INSTALLED', { assignedAt: '2026-09-02T09:00:00Z', installationDate: '2026-09-10', meterNumber: '0239110006909' }),
    job(4, 'EXPORTED', { assignedAt: '2026-09-03T09:00:00Z', installationDate: '2026-09-20', meterNumber: '0239110007001' }),
    job(5, 'FAILED', { assignedAt: '2026-09-04T09:00:00Z' }),
  ];
  const ids = (list) => list.map((j) => j.id);

  it('filters by status, including the two grouped statuses', () => {
    expect(ids(filterInstallerJobs(JOBS, { status: 'AWAITING' }))).toEqual([1, 2, 5]);
    expect(ids(filterInstallerJobs(JOBS, { status: 'COMPLETED' }))).toEqual([3, 4]);
    expect(ids(filterInstallerJobs(JOBS, { status: 'FAILED' }))).toEqual([5]);
  });

  it('filters by meter type with any spelling', () => {
    expect(ids(filterInstallerJobs(JOBS, { meterType: 'Three Phase' }))).toEqual([1]);
  });

  it('filters by installation date as a plain calendar date', () => {
    expect(ids(filterInstallerJobs(JOBS, { dateBasis: 'installed', from: '2026-09-10', to: '2026-09-10' }))).toEqual([3]);
  });

  it('filters by assignment date', () => {
    expect(ids(filterInstallerJobs(JOBS, { from: '2026-09-02', to: '2026-09-03' }))).toEqual([3, 4]);
  });

  it('matches account and meter number as exact-string substrings', () => {
    expect(ids(filterInstallerJobs(JOBS, { account: '104' }))).toEqual([4]);
    expect(ids(filterInstallerJobs(JOBS, { meterNumber: '7001' }))).toEqual([4]);
    expect(ids(filterInstallerJobs(JOBS, { meterNumber: '0239110006909' }))).toEqual([3]);
  });
});

describe('installerMeterList', () => {
  it('merges meters in hand with meters installed on the installer\'s jobs, one entry per serial', () => {
    const row = {
      heldMeters: [
        { meterNumber: '0239110007001', phaseType: 'THREE PHASE', assignedAt: '2026-09-05T08:00:00Z', batchRef: 'B-40' },
        { meterNumber: '0239110006909', phaseType: 'SINGLE PHASE' }, // also on a report below
      ],
      jobs: [
        { id: 3, status: 'INSTALLED', meterNumber: '0239110006909', meterType: 'Single Phase', installationDate: '2026-09-10', accountNumber: '1003' },
        { id: 5, status: 'EXPORTED', meterNumber: '0239110000001', meterType: 'SINGLE PHASE', accountNumber: '1005' },
        { id: 1, status: 'ASSIGNED', meterNumber: null, accountNumber: '1001' }, // not installed: no meter yet
      ],
    };
    const list = installerMeterList(row);
    expect(list.map((m) => [m.meterNumber, m.state])).toEqual([
      ['0239110007001', 'HELD'],
      ['0239110000001', 'INSTALLED'],
      ['0239110006909', 'INSTALLED'], // the report wins over a stale "in hand"
    ]);
    expect(list[0]).toMatchObject({ phaseType: 'THREE PHASE', batchRef: 'B-40', job: null });
    expect(list[2]).toMatchObject({ phaseType: 'SINGLE PHASE', installedOn: '2026-09-10', job: { accountNumber: '1003' } });
  });

  it('is empty for an installer with nothing assigned', () => {
    expect(installerMeterList({ heldMeters: [], jobs: [] })).toEqual([]);
    expect(installerMeterList(null)).toEqual([]);
  });
});
