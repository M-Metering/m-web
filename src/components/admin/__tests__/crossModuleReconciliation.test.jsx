// @vitest-environment jsdom
// ONE Pending Installation figure across the system (2026-09-28), pinned for
// one dataset, rendered on every screen that shows it:
//
//   Dashboard Pending = Dashboard Awaiting = Installations "Pending
//   installations" = Reports "Pending installations"
//
// and Installer Job Status' Awaiting column + the pending installations nobody
// holds = that same figure. Plus the acceptance scenarios: completing jobs,
// new jobs, pagination, and a failed statistics read (an error, never 0).
// The meter-price value stays in Admin Reports only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataRefreshProvider, useDataRefresh } from '../../contexts/DataRefreshContext';
import { formatCurrencyNGN } from '../../../utils/currency';
import AdminDashboard from '../AdminDashboard';
import ReportsOverview from '../ReportsOverview';
import InstallationRequests from '../InstallationRequests';
import InstallerJobStatus from '../../installers/InstallerJobStatus';
import jedApi from '../../services/api';

const PERMS = {
  isAdmin: true, canViewPayments: true, canViewReports: true, canViewInstallationRequests: true,
  canViewInstallerStatus: true, canViewAssignments: true, canManageAssignments: false, canManageInstallations: false,
};
vi.mock('../../auth/usePermissions', () => ({ usePermissions: () => PERMS }));
vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ user: { id: 'u1', role: 'ADMIN' } }),
}));
vi.mock('../../contexts/ThemeContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useTheme: () => ({ isDark: false, theme: 'light', toggleTheme: vi.fn() }),
}));
vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getAllCustomerRequests: vi.fn(),
    getInstallations: vi.fn(),
    getInstallationStatistics: vi.fn(),
    getDashboardStats: vi.fn(),
    getRevenueTransactions: vi.fn(),
    getMeterTypes: vi.fn(),
    getUsers: vi.fn(),
    getAssignmentBatches: vi.fn(),
    getAssignmentBatch: vi.fn(),
    getDiscos: vi.fn(),
    getMeters: vi.fn(),
  },
}));

const METER_TYPES = [
  { id: 1, name: 'Single Phase', amount: 100000, isActive: true },
  { id: 2, name: 'Three Phase', amount: 150000, isActive: true },
];
const BASE_IMPORTED = [
  { id: 1, accountNumber: '1001', status: 'PENDING', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', createdAt: '2026-09-20T00:00:00Z' },
  { id: 2, accountNumber: '1002', status: 'ASSIGNED', meterType: 'Single Phase', discoCode: 'ABA_POWER', assignedTo: 'u-1', createdAt: '2026-09-21T00:00:00Z' },
  { id: 3, accountNumber: '1003', status: 'IN_PROGRESS', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', assignedTo: 'u-1', createdAt: '2026-09-22T00:00:00Z' },
  { id: 4, accountNumber: '1004', status: 'FAILED', meterType: '3 Phase', discoCode: 'ABA_POWER', assignedTo: 'u-1', createdAt: '2026-09-23T00:00:00Z' },
  { id: 5, accountNumber: '1005', status: 'INSTALLED', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', assignedTo: 'u-1', createdAt: '2026-09-10T00:00:00Z' },
  { id: 6, accountNumber: '1006', status: 'CANCELLED', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', createdAt: '2026-09-11T00:00:00Z' },
  { id: 7, accountNumber: '1007', status: 'ASSIGNED', meterType: 'THREE PHASE', discoCode: 'ABA_POWER', assignedTo: 'u-2', createdAt: '2026-09-24T00:00:00Z' },
];
const BASE_JED = [
  { id: 11, accountNumber: '477011', status: 'PAID', meterType: 'Three Phase', amount: 150000, dateRequested: '2026-09-24T00:00:00Z' },
  { id: 12, accountNumber: '477012', status: 'COMPLETED', meterType: 'Single Phase', amount: 100000, dateRequested: '2026-09-01T00:00:00Z' },
  { id: 13, accountNumber: '477013', status: 'INITIATED', meterType: 'Single Phase', amount: 100000, dateRequested: '2026-09-25T00:00:00Z' },
];

// The live dataset; tests mutate it and fire the app's refresh signal.
let IMPORTED;
let JED;

const count = (list, s) => list.filter((r) => r.status === s).length;
// Paged like the real API: `limit` rows per page, the server's totalCount.
const paged = (rows, { page = 1, limit = 10 } = {}) => ({
  success: true,
  data: rows.slice((page - 1) * limit, page * limit),
  pagination: { currentPage: page, totalPages: Math.max(1, Math.ceil(rows.length / limit)), totalCount: rows.length },
});

function installMocks() {
  jedApi.getMeterTypes.mockImplementation(async () => paged(METER_TYPES, { limit: 100 }));
  jedApi.getInstallationStatistics.mockImplementation(async () => ({
    success: true,
    data: {
      total: IMPORTED.length, pending: count(IMPORTED, 'PENDING'), assigned: count(IMPORTED, 'ASSIGNED'),
      inProgress: count(IMPORTED, 'IN_PROGRESS'), failed: count(IMPORTED, 'FAILED'), installed: count(IMPORTED, 'INSTALLED'),
      exported: count(IMPORTED, 'EXPORTED'), cancelled: count(IMPORTED, 'CANCELLED'),
    },
  }));
  jedApi.getInstallations.mockImplementation(async (p = {}) =>
    paged(IMPORTED.filter((r) => (!p.status || r.status === p.status) && (!p.installerId || r.assignedTo === p.installerId)), p));
  jedApi.getAllCustomerRequests.mockImplementation(async (p = {}) => paged(p.status ? JED.filter((r) => r.status === p.status) : JED, p));
  jedApi.getDashboardStats.mockResolvedValue({ success: true, data: { activeInstallers: 2 } });
  jedApi.getRevenueTransactions.mockResolvedValue({
    success: true,
    data: [
      { source: 'jed_customer_request', sourceId: 11, reference: '477011', amount: 150000, sourceStatus: 'PAID' },
      { source: 'jed_customer_request', sourceId: 12, reference: '477012', amount: 100000, sourceStatus: 'COMPLETED' },
    ],
    meta: { totals: { amount: 250000, count: 2 } },
    pagination: { totalPages: 1, totalCount: 2 },
  });
  jedApi.getUsers.mockResolvedValue(paged([
    { id: 'u-1', firstName: 'John', lastName: 'Doe', role: 'INSTALLER' },
    { id: 'u-2', firstName: 'Ada', lastName: 'Obi', role: 'INSTALLER' },
  ], { limit: 100 }));
  jedApi.getAssignmentBatches.mockResolvedValue(paged([]));
  jedApi.getDiscos.mockResolvedValue(paged([{ code: 'ABA_POWER', name: 'Aba Power' }]));
  jedApi.getMeters.mockResolvedValue(paged([]));
}

beforeEach(() => {
  vi.clearAllMocks();
  IMPORTED = BASE_IMPORTED.map((r) => ({ ...r }));
  JED = BASE_JED.map((r) => ({ ...r }));
  installMocks();
});
afterEach(cleanup);

const Trigger = () => {
  const { notifyDataChanged } = useDataRefresh();
  return <button type="button" onClick={notifyDataChanged}>fire refresh</button>;
};
const wrap = (ui) => render(<MemoryRouter><DataRefreshProvider><Trigger />{ui}</DataRefreshProvider></MemoryRouter>);

// Independent expectation, computed from the raw data, not by the app.
const expectedPending = () =>
  IMPORTED.filter((r) => ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'FAILED'].includes(r.status)).length
  + JED.filter((r) => r.status === 'PAID').length;

// ---- readers, one per screen
const dashboardFigures = async () => {
  const c = (await screen.findByText('Pending Installations')).closest('.card');
  await waitFor(() => expect(within(c).getByText('Pending Installations').nextElementSibling.textContent).toMatch(/^\d/), { timeout: 5000 });
  return {
    pending: Number(within(c).getByText('Pending Installations').nextElementSibling.textContent.replace(/,/g, '')),
    awaiting: Number(within(c).getByText(/Awaiting installation:/).textContent.replace(/\D/g, '')),
  };
};
const installationsPending = async () => {
  const tile = await screen.findByRole('button', { name: /Pending installations$/ });
  await waitFor(() => expect(tile.querySelector('p').textContent).toMatch(/^\d/), { timeout: 5000 });
  return Number(tile.querySelector('p').textContent.replace(/,/g, ''));
};
const reportsPending = async () => {
  const label = await screen.findByText('Pending installations', { selector: 'p' });
  return Number(label.previousElementSibling.textContent.replace(/,/g, ''));
};

async function allFigures() {
  let v = wrap(<AdminDashboard />);
  const dash = await dashboardFigures();
  v.unmount();
  v = wrap(<InstallationRequests />);
  const inst = await installationsPending();
  v.unmount();
  v = wrap(<ReportsOverview />);
  const reports = await reportsPending();
  v.unmount();
  return { dashPending: dash.pending, dashAwaiting: dash.awaiting, installations: inst, reports };
}

const all = (n) => ({ dashPending: n, dashAwaiting: n, installations: n, reports: n });

describe('One Pending Installation figure everywhere', () => {
  it('Dashboard Pending = Dashboard Awaiting = Installations = Reports', async () => {
    expect(expectedPending()).toBe(6);
    expect(await allFigures()).toEqual(all(6));
  }, 30000);

  it('Installer Job Status: the Awaiting column plus the pending nobody holds = the same figure', async () => {
    wrap(<InstallerJobStatus />);
    await screen.findAllByText('John Doe');
    const column = ['John Doe', 'Ada Obi'].map((name) => {
      const tr = screen.getAllByText(name).map((el) => el.closest('tr')).find(Boolean);
      return Number(tr.querySelectorAll('td')[2].textContent);
    });
    // John: assigned + in progress + failed-while-his; Ada: assigned.
    expect(column).toEqual([3, 1]);
    expect(await screen.findByText(/System-wide pending installations: 6 \(same as the Dashboard\) — 4 with installers above, 2 not yet held/)).toBeTruthy();
    // Operational only.
    expect(document.body.textContent).not.toMatch(/₦|NGN|meter prices|Amount paid/);
  }, 30000);

  it('Scenario 2 — completing jobs lowers every figure on the next refresh', async () => {
    // Make it 40 pending, then complete 5.
    for (let i = 0; i < 34; i += 1) IMPORTED.push({ id: 100 + i, accountNumber: `2${i}`, status: 'PENDING', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', createdAt: '2026-09-26T00:00:00Z' });
    expect(await allFigures()).toEqual(all(40));

    const view = wrap(<AdminDashboard />);
    expect((await dashboardFigures()).pending).toBe(40);
    IMPORTED.filter((r) => r.status === 'PENDING').slice(0, 5).forEach((r) => { r.status = 'INSTALLED'; });
    fireEvent.click(screen.getByRole('button', { name: 'fire refresh' }));
    await waitFor(async () => expect((await dashboardFigures()).pending).toBe(35));
    view.unmount();
    expect(await allFigures()).toEqual(all(35));

    // Scenario 3 — 10 new pending installations.
    for (let i = 0; i < 10; i += 1) IMPORTED.push({ id: 300 + i, accountNumber: `3${i}`, status: 'PENDING', meterType: 'THREE PHASE', discoCode: 'ABA_POWER', createdAt: '2026-09-27T00:00:00Z' });
    expect(await allFigures()).toEqual(all(45));
  }, 60000);

  it('Scenario 4 — 100 pending across 10-row pages is 100, not 10', async () => {
    IMPORTED = Array.from({ length: 100 }, (_, i) => ({ id: 500 + i, accountNumber: `5${i}`, status: 'PENDING', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', createdAt: '2026-09-26T00:00:00Z' }));
    JED = [];
    expect(await allFigures()).toEqual(all(100));
  }, 30000);

  it('Scenario 5 — a failed statistics read is an error, never 0, and is logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    jedApi.getInstallationStatistics.mockRejectedValue(new Error('SERVER_ERROR:db down'));
    let v = wrap(<AdminDashboard />);
    const c = (await screen.findByText('Pending Installations')).closest('.card');
    await waitFor(() => expect(within(c).getByText(/Unavailable/)).toBeTruthy());
    expect(within(c).queryByText('0')).toBeNull();
    v.unmount();

    v = wrap(<InstallationRequests />);
    expect(await screen.findByText(/Unable to load the pending installation total/)).toBeTruthy();
    const tile = screen.getByRole('button', { name: /Pending installations$/ });
    expect(tile.querySelector('p').textContent).toBe('—');
    v.unmount();

    wrap(<ReportsOverview />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Pending installations')).toBeNull();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  }, 30000);

  it('Total collected payments = the pending installations at meter prices, on Dashboard and Reports', async () => {
    // 1001, 1002, 1003 Single; 1004, 1007, the paid JED request Three Phase.
    const expected = formatCurrencyNGN(3 * 100000 + 3 * 150000);
    const read = async () => {
      const label = await screen.findByText('Total collected payments');
      await waitFor(() => expect(label.nextElementSibling.textContent).toMatch(/\d/), { timeout: 5000 });
      return label.nextElementSibling.textContent.trim();
    };
    let v = wrap(<AdminDashboard />);
    expect(await read()).toBe(expected);
    v.unmount();
    v = wrap(<ReportsOverview />);
    expect(await read()).toBe(expected);
    v.unmount();
    // Installer Job Status stays operational: no price read, no money.
    jedApi.getMeterTypes.mockClear();
    wrap(<InstallerJobStatus />);
    await screen.findAllByText('John Doe');
    expect(document.body.textContent).not.toMatch(/₦|NGN/);
    expect(jedApi.getMeterTypes).not.toHaveBeenCalled();
  }, 30000);

  it('Installer Job Status figures carry both theme colours', async () => {
    wrap(<InstallerJobStatus />);
    const row = (await screen.findAllByText('John Doe')).map((el) => el.closest('tr')).find(Boolean);
    expect(row.closest('tbody').className).toMatch(/text-gray-900.*dark:text-white/);
  }, 20000);
});
