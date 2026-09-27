// @vitest-environment jsdom
// Renders the real Installation Requests page against a mocked jedApi whose
// responses follow the documented shapes (GET /installations,
// GET /external/jed/requests, GET /installations/statistics, GET /discos).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataRefreshProvider } from '../../contexts/DataRefreshContext';
import InstallationRequests from '../InstallationRequests';
import jedApi from '../../services/api';
import { downloadXlsx } from '../../../utils/xlsx';

const ADMIN_PERMISSIONS = {
  canViewInstallationRequests: true, canManageAssignments: true, canManageInstallations: true, canViewPayments: true,
  isAdmin: true, isSuperAdmin: false, enforcesMeterCapacity: true,
};
let permissions = { ...ADMIN_PERMISSIONS };

vi.mock('../../auth/usePermissions', () => ({
  usePermissions: () => permissions,
}));

vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getDiscos: vi.fn(),
    getInstallations: vi.fn(),
    getInstallationStatistics: vi.fn(),
    getAllCustomerRequests: vi.fn(),
    getRevenueTransactions: vi.fn(),
    getMeterTypes: vi.fn(),
    getUsers: vi.fn(),
    getAssignmentBatches: vi.fn(),
    getAssignmentBatch: vi.fn(),
    assignInstallations: vi.fn(),
    unassignInstallations: vi.fn(),
    cancelInstallation: vi.fn(),
    exportInstallations: vi.fn(),
  },
}));

vi.mock('../../../utils/xlsx', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadXlsx: vi.fn(async () => {}),
}));

const page = (data) => ({ success: true, data, pagination: { currentPage: 1, totalPages: 1, totalCount: data.length, hasNext: false } });

const ABA_JOBS = [
  { id: 1, accountNumber: '1001', customerName: 'ADA OBI', discoCode: 'ABA_POWER', status: 'PENDING', meterType: 'SINGLE PHASE', feederName: 'Feeder A', transformerName: 'T1', installationPosition: 'HIGH WALL', createdAt: '2026-09-10T09:00:00Z' },
  { id: 2, accountNumber: '1002', customerName: 'BAYO ALI', discoCode: 'ABA_POWER', status: 'PENDING', meterType: 'THREE PHASE', feederName: 'Feeder A', transformerName: 'T2', installationPosition: 'POLE', createdAt: '2026-09-11T09:00:00Z' },
  { id: 3, accountNumber: '1003', customerName: 'CHIDI EZE', discoCode: 'ABA_POWER', status: 'ASSIGNED', meterType: 'SINGLE PHASE', feederName: 'Feeder B', transformerName: 'T1', installationPosition: 'HIGH WALL', assigneeName: 'Musa Bello', assignedTo: 'uuid-1', createdAt: '2026-09-12T09:00:00Z' },
];

const REMITA = [
  { id: 11, accountNumber: '477014', custNames: 'JED PAID', discoCode: 'JED001', status: 'PAID', amount: 67000, rrr: 'R1', meterRecommended: 'Three Phase', dateRequested: '2026-08-01T00:00:00Z' },
  { id: 12, accountNumber: '477015', custNames: 'JED DONE', discoCode: 'JED001', status: 'COMPLETED', amount: 50000, rrr: 'R2', dateRequested: '2026-08-02T00:00:00Z' },
  { id: 13, accountNumber: '477016', custNames: 'JED UNPAID', discoCode: 'JED001', status: 'INITIATED', amount: 67000, rrr: 'R3', dateRequested: '2026-08-03T00:00:00Z' },
  { id: 14, accountNumber: '555', custNames: 'ABA REMITA', discoCode: 'ABA_POWER', status: 'COMPLETED', amount: 40000, rrr: 'R4', dateRequested: '2026-08-04T00:00:00Z' },
];

// GET /finance/revenue/transactions — the one revenue source (see
// utils/financeSummary.js). Mirrors the records above: JED's PAID and
// COMPLETED Remita requests, the Aba-coded Remita request, and one Aba
// installation recognised on completion.
const REVENUE = [
  { discoCode: 'JED001', source: 'jed_customer_request', reference: '477014', amount: 67000, sourceStatus: 'PAID' },
  { discoCode: 'JED001', source: 'jed_customer_request', reference: '477015', amount: 50000, sourceStatus: 'COMPLETED' },
  { discoCode: 'ABA_POWER', source: 'jed_customer_request', reference: '555', amount: 40000, sourceStatus: 'COMPLETED' },
  { discoCode: 'ABA_POWER', source: 'installation_request', reference: '1009', amount: 100000, sourceStatus: 'INSTALLED' },
];

beforeEach(() => {
  permissions = { ...ADMIN_PERMISSIONS };
  vi.clearAllMocks();
  jedApi.getDiscos.mockResolvedValue(page([{ code: 'ABA_POWER', name: 'Aba Power' }]));
  jedApi.getInstallations.mockImplementation(async (params) => {
    let rows = ABA_JOBS;
    if (params.discoCode && params.discoCode !== 'ABA_POWER') rows = [];
    if (params.installerId) rows = rows.filter((r) => r.assignedTo === params.installerId);
    if (params.status) rows = rows.filter((r) => r.status === params.status);
    return page(rows);
  });
  jedApi.getInstallationStatistics.mockResolvedValue({
    success: true,
    data: { total: 3, pending: 2, assigned: 1, inProgress: 0, installed: 0, exported: 0, failed: 0, cancelled: 0 },
  });
  jedApi.getAllCustomerRequests.mockImplementation(async (params = {}) =>
    page(params.status ? REMITA.filter((r) => r.status === params.status) : REMITA));
  // Configured meter prices (Settings → Meter Types).
  jedApi.getMeterTypes.mockResolvedValue(page([
    { id: 1, name: 'Single Phase', amount: 100000, isActive: true },
    { id: 2, name: 'Three Phase', amount: 150000, isActive: true },
  ]));
  jedApi.getRevenueTransactions.mockResolvedValue({
    ...page(REVENUE), meta: { totals: { amount: 257000, count: REVENUE.length } },
  });
  jedApi.getUsers.mockResolvedValue(page([{ id: 'uuid-1', firstName: 'Musa', lastName: 'Bello', role: 'INSTALLER' }]));
  jedApi.getAssignmentBatches.mockResolvedValue(page([]));
  jedApi.assignInstallations.mockResolvedValue({ success: true, data: { assignedCount: 1, rejectedCount: 0, rejected: [] } });
});

afterEach(cleanup);

const renderPage = () => render(
  <MemoryRouter>
    <DataRefreshProvider>
      <InstallationRequests />
    </DataRefreshProvider>
  </MemoryRouter>
);

const statTile = (label) => screen.getByRole('button', { name: new RegExp(`^\\d+\\s*${label}$`) });
const tileValue = (label) => Number(statTile(label).querySelector('p').textContent);
const paymentValue = (label) => screen.getByText(label).nextElementSibling.textContent;

describe('InstallationRequests — disco scope', () => {
  it('All discos includes both imported jobs and JED requests, with combined counts and payments', async () => {
    renderPage();
    await screen.findByText('ADA OBI');
    await screen.findByText('JED PAID');

    expect(tileValue('All')).toBe(7);
    // The imported PENDING status is labelled for what it is...
    expect(tileValue('Unassigned')).toBe(2);
    // ...and "Pending installations" is the whole not-yet-installed
    // population — the Dashboard's server aggregate: 2 unassigned + 1
    // assigned + 1 paid JED request.
    await waitFor(() => expect(tileValue('Pending installations')).toBe(4));
    expect(tileValue('Assigned')).toBe(1);
    expect(tileValue('Awaiting Installation')).toBe(1);
    expect(tileValue('Awaiting Payment')).toBe(1);
    expect(tileValue('Completed')).toBe(2);

    // Collected = the pending installations at meter prices: 1001 and 1003
    // Single Phase, 1002 and the paid JED request Three Phase → 2×100k +
    // 2×150k. Due = completed revenue (50,000 + 40,000 + 100,000).
    await waitFor(() => expect(paymentValue('Total collected payments')).toMatch(/500,000/));
    expect(paymentValue('Revenue due to us')).toMatch(/190,000/);
    // One request per status query is gone — the scope is loaded once (the
    // shared valuation's status-filtered reads are separate).
    expect(jedApi.getInstallations.mock.calls.filter(([p]) => !p.status)).toHaveLength(1);
  });

  it('JED shows JED requests across all statuses, and only those', async () => {
    renderPage();
    await screen.findByText('JED PAID');
    fireEvent.change(screen.getByLabelText('Disco'), { target: { value: '__JED__' } });

    await waitFor(() => expect(screen.queryByText('ADA OBI')).toBeNull());
    expect(screen.getByText('JED PAID')).toBeTruthy();
    expect(screen.getByText('JED DONE')).toBeTruthy();
    expect(screen.getByText('JED UNPAID')).toBeTruthy();
    expect(screen.queryByText('ABA REMITA')).toBeNull();
    expect(tileValue('All')).toBe(3);
    // Only the paid JED request is pending in JED's scope: one Three Phase.
    await waitFor(() => expect(paymentValue('Total collected payments')).toMatch(/150,000/));
    expect(paymentValue('Revenue due to us')).toMatch(/50,000/);
  });

  it('Aba Power shows only Aba records, and its payments come only from Aba-coded Remita records', async () => {
    renderPage();
    await screen.findByText('ADA OBI');
    fireEvent.change(screen.getByLabelText('Disco'), { target: { value: 'ABA_POWER' } });

    await waitFor(() => expect(screen.queryByText('JED PAID')).toBeNull());
    expect(jedApi.getInstallations).toHaveBeenCalledWith(expect.objectContaining({ discoCode: 'ABA_POWER' }));
    expect(screen.getByText('ABA REMITA')).toBeTruthy();
    expect(tileValue('All')).toBe(4);
    // Due: Aba's Remita request (40,000) and completed installation (100,000).
    // Collected: Aba's pending jobs at meter prices — 1001, 1003 Single and
    // 1002 Three Phase; the Aba Remita request is completed, so not pending.
    await waitFor(() => expect(paymentValue('Revenue due to us')).toMatch(/140,000/));
    await waitFor(() => expect(paymentValue('Total collected payments')).toMatch(/350,000/));
  });

  it('switching status filters locally without refetching', async () => {
    renderPage();
    await screen.findByText('ADA OBI');
    fireEvent.click(statTile('Unassigned'));
    expect(screen.queryByText('CHIDI EZE')).toBeNull();
    expect(screen.getByText('ADA OBI')).toBeTruthy();
    expect(jedApi.getInstallations.mock.calls.filter(([p]) => !p.status)).toHaveLength(1);
  });
});

describe('InstallationRequests — upload-field filters, selection and assignment', () => {
  it('combines feeder + transformer + meter type filters', async () => {
    renderPage();
    await screen.findByText('ADA OBI');
    fireEvent.change(screen.getByLabelText('Feeder'), { target: { value: 'FEEDER A' } });
    fireEvent.change(screen.getByLabelText('Transformer'), { target: { value: 'T1' } });
    fireEvent.change(screen.getByLabelText('Meter type'), { target: { value: 'SINGLE PHASE' } });

    expect(screen.getByText('ADA OBI')).toBeTruthy();
    expect(screen.queryByText('BAYO ALI')).toBeNull();
    expect(screen.queryByText('CHIDI EZE')).toBeNull();
    expect(screen.queryByText('JED PAID')).toBeNull();
    expect(screen.getByText(/^1 of 7 shown$/)).toBeTruthy();
  });

  it('never keeps hidden rows selected after a filter change', async () => {
    renderPage();
    await screen.findByText('ADA OBI');
    fireEvent.change(screen.getByLabelText('Feeder'), { target: { value: 'FEEDER A' } });
    fireEvent.click(screen.getByLabelText(/Select all 2 assignable requests/));
    expect(screen.getByText('2 selected')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Transformer'), { target: { value: 'T2' } });
    await waitFor(() => expect(screen.getByText('1 selected')).toBeTruthy());
  });

  it('assigns exactly the selected, visible jobs and shows the installer meter figures', async () => {
    renderPage();
    await screen.findByText('ADA OBI');
    fireEvent.click(screen.getByLabelText('Select account 1001'));
    fireEvent.click(screen.getByRole('button', { name: /Assign to installer/ }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /Musa Bello/ })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/Installer/), { target: { value: 'uuid-1' } });

    await within(dialog).findByText('Assigned installations');
    expect(within(dialog).getByText(/After assigning 1 job: 2 meters still needed/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(jedApi.assignInstallations).toHaveBeenCalledWith({
      discoCode: 'ABA_POWER', installerId: 'uuid-1', ids: [1],
    }));
  });

  it('pastes many account numbers, reports each kind, and assigns the valid ones in one bulk request', async () => {
    jedApi.assignInstallations.mockResolvedValue({ success: true, data: { assignedCount: 2, rejectedCount: 0, rejected: [] } });
    renderPage();
    await screen.findByText('ADA OBI');
    await screen.findByText('JED PAID');
    // A leftover search must not hide pasted rows.
    fireEvent.change(screen.getByLabelText('Search installation requests'), { target: { value: 'BAYO' } });

    fireEvent.click(screen.getByRole('button', { name: /Paste account numbers/ }));
    fireEvent.change(screen.getByLabelText(/Account numbers — one per line/), {
      target: { value: '1001\n1002, 1003\t477014 9999\n1001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find accounts' }));

    const report = screen.getByText(/account numbers checked/).closest('[role="status"]');
    expect(report.textContent).toMatch(/5 account numbers checked \(1 duplicate removed\)/);
    expect(report.textContent).toMatch(/2 found and ready to assign/);
    expect(report.textContent).toMatch(/1 already assigned: 1003 \(Musa Bello\)/);
    expect(report.textContent).toMatch(/477014 \(JED Remita request \(not assignable\)\)/);
    expect(report.textContent).toMatch(/1 not found: 9999/);

    fireEvent.click(screen.getByRole('button', { name: 'Select 2 assignable' }));
    await waitFor(() => expect(screen.getByText('2 selected')).toBeTruthy());
    expect(screen.getByText('Showing 4 pasted accounts')).toBeTruthy();
    expect(screen.queryByText('JED DONE')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Assign to installer/ }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /Musa Bello/ })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/Installer/), { target: { value: 'uuid-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(jedApi.assignInstallations).toHaveBeenCalledTimes(1));
    expect(jedApi.assignInstallations).toHaveBeenCalledWith({ discoCode: 'ABA_POWER', installerId: 'uuid-1', ids: [1, 2] });
    expect(await within(dialog).findByText(
      '2 installations assigned successfully. 1 was already assigned. 1 account number cannot currently be assigned. 1 account number was not found.'
    )).toBeTruthy();
  });

  it('sends one bulk request per disco, and one failing disco does not undo the others', async () => {
    jedApi.getDiscos.mockResolvedValue(page([{ code: 'ABA_POWER', name: 'Aba Power' }, { code: 'EKO', name: 'Eko' }]));
    jedApi.getInstallations.mockResolvedValue(page([
      ...ABA_JOBS,
      { id: 7, accountNumber: '7001', customerName: 'EKO ONE', discoCode: 'EKO', status: 'PENDING', meterType: 'SINGLE PHASE', createdAt: '2026-09-10T09:00:00Z' },
    ]));
    jedApi.assignInstallations.mockImplementation(async ({ discoCode }) => {
      if (discoCode === 'EKO') throw new Error('SERVER_ERROR:boom');
      return { success: true, data: { assignedCount: 1, rejectedCount: 0, rejected: [] } };
    });
    renderPage();
    await screen.findByText('EKO ONE');
    fireEvent.click(screen.getByLabelText('Select account 1001'));
    fireEvent.click(screen.getByLabelText('Select account 7001'));
    expect(screen.getByText(/Across 2 discos/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Assign to installer/ }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /Musa Bello/ })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/Installer/), { target: { value: 'uuid-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(jedApi.assignInstallations).toHaveBeenCalledTimes(2));
    expect(jedApi.assignInstallations).toHaveBeenCalledWith({ discoCode: 'ABA_POWER', installerId: 'uuid-1', ids: [1] });
    expect(jedApi.assignInstallations).toHaveBeenCalledWith({ discoCode: 'EKO', installerId: 'uuid-1', ids: [7] });
    // The Aba job landed; the Eko one is reported against its own account.
    expect(await within(dialog).findByText('7001')).toBeTruthy();
  });

  it('explains instead of faking an assignment for a JED request', async () => {
    renderPage();
    await screen.findByText('JED PAID');
    fireEvent.click(screen.getByRole('button', { name: /Assign installer/ }));
    expect(screen.getByText("JED requests can't be assigned yet")).toBeTruthy();
    expect(jedApi.assignInstallations).not.toHaveBeenCalled();
  });
});

describe('InstallationRequests — Export Completed Installations', () => {
  const exportedSheets = () => downloadXlsx.mock.calls.at(-1)[1];
  const exportedAccounts = () => exportedSheets()[0].rows.map((r) => r.accountNumber).sort();
  const exportButton = () => screen.getByRole('button', { name: /Export Completed Installations/ });

  it('exports every completed installation in "All discos" (JED and Aba), completed statuses only', async () => {
    renderPage();
    await screen.findByText('JED DONE');
    await waitFor(() => expect(screen.getByText('2 completed installations in scope')).toBeTruthy());
    fireEvent.click(exportButton());

    await waitFor(() => expect(downloadXlsx).toHaveBeenCalled());
    expect(downloadXlsx.mock.calls[0][0]).toMatch(/^completed-installations-all-discos-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(exportedAccounts()).toEqual(['477015', '555']);
    expect(exportedSheets().map((s) => s.name)).toEqual(['Completed Installations', 'Summary']);
    expect(await screen.findByText('Exported 2 completed installations.')).toBeTruthy();
  });

  it('JED scope exports no Aba records; Aba scope exports no JED records', async () => {
    renderPage();
    await screen.findByText('JED DONE');

    fireEvent.change(screen.getByLabelText('Disco'), { target: { value: '__JED__' } });
    await waitFor(() => expect(screen.getByText('1 completed installation in scope')).toBeTruthy());
    fireEvent.click(exportButton());
    await waitFor(() => expect(downloadXlsx).toHaveBeenCalledTimes(1));
    expect(exportedAccounts()).toEqual(['477015']);

    fireEvent.change(screen.getByLabelText('Disco'), { target: { value: 'ABA_POWER' } });
    await waitFor(() => expect(screen.queryByText('JED PAID')).toBeNull());
    await waitFor(() => expect(screen.getByText('1 completed installation in scope')).toBeTruthy());
    fireEvent.click(exportButton());
    await waitFor(() => expect(downloadXlsx).toHaveBeenCalledTimes(2));
    expect(exportedAccounts()).toEqual(['555']);
    const summary = Object.fromEntries(exportedSheets()[1].rows.map((r) => [r.item.trim(), r.value]));
    expect(summary['DisCo scope']).toBe('Aba Power (ABA_POWER)');
  });

  it('applies the installation date range', async () => {
    renderPage();
    await screen.findByText('JED DONE');
    // Neither completed fixture has a dateCompleted, so a range excludes both.
    fireEvent.change(screen.getByLabelText('Installed from'), { target: { value: '2026-01-01' } });
    await waitFor(() => expect(screen.getByText('0 completed installations in scope')).toBeTruthy());
    expect(exportButton().disabled).toBe(true);
  });

  it('is unavailable while the list is incomplete', async () => {
    jedApi.getAllCustomerRequests.mockImplementation(async ({ page: p }) => ({
      success: true, data: REMITA, pagination: { currentPage: p, totalPages: 500, hasNext: true },
    }));
    renderPage();
    await screen.findByText('Not every record loaded, so the export is unavailable.');
    expect(exportButton().disabled).toBe(true);
  });
});

describe('InstallationRequests — import date', () => {
  // The fixtures give each imported job a different createdAt: 10, 11 and 12
  // September. JED's Remita requests are not imported and have none.
  const importedFrom = () => screen.getByLabelText('Imported from');
  const importedTo = () => screen.getByLabelText('Imported to');

  it('shows the import date on an imported row, separate from assignment and installation', async () => {
    renderPage();
    const row = (await screen.findByText('CHIDI EZE')).closest('.p-4');
    expect(within(row).getByText(/^Imported /)).toBeTruthy();
    expect(within(row).getByText(/^Assigned to Musa Bello/)).toBeTruthy();
    // Two distinct dates, never the same field doing both jobs.
    expect(within(row).getByText(/^Imported /).textContent)
      .not.toBe(within(row).getByText(/^Assigned to Musa Bello/).textContent);
  });

  it('shows no import date for a JED request, which is never imported', async () => {
    renderPage();
    const row = (await screen.findByText('JED PAID')).closest('.p-4');
    expect(within(row).queryByText(/^Imported /)).toBeNull();
  });

  it('filters on the import date alone', async () => {
    renderPage();
    await screen.findByText('ADA OBI');

    fireEvent.change(importedFrom(), { target: { value: '2026-09-11' } });
    await waitFor(() => expect(screen.queryByText('ADA OBI')).toBeNull());
    expect(screen.getByText('BAYO ALI')).toBeTruthy();
    expect(screen.getByText('CHIDI EZE')).toBeTruthy();
    // JED's requests have no import date, so they drop out while it is set.
    expect(screen.queryByText('JED PAID')).toBeNull();
    expect(tileValue('All')).toBe(2);

    fireEvent.change(importedTo(), { target: { value: '2026-09-11' } });
    await waitFor(() => expect(screen.queryByText('CHIDI EZE')).toBeNull());
    expect(tileValue('All')).toBe(1);
  });

  it('combines the import date with the meter-type filter', async () => {
    renderPage();
    await screen.findByText('ADA OBI');
    fireEvent.change(importedFrom(), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText('Meter type'), { target: { value: 'THREE PHASE' } });

    await waitFor(() => expect(screen.queryByText('ADA OBI')).toBeNull());
    expect(screen.getByText('BAYO ALI')).toBeTruthy();
    expect(tileValue('All')).toBe(1);
  });

  it('restores everything when the dates are cleared', async () => {
    renderPage();
    await screen.findByText('ADA OBI');
    fireEvent.change(importedFrom(), { target: { value: '2026-09-12' } });
    await waitFor(() => expect(tileValue('All')).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: /Clear dates/ }));
    await waitFor(() => expect(tileValue('All')).toBe(7));
  });
});

// Supervisor holds INSTALLATIONS.MANAGE and ASSIGNMENTS.MANAGE on the real
// API, so it gets the full page. This block covers the other direction: a
// viewer WITHOUT those permissions must get the records and none of the
// actions — which is what every gate on this page is actually keyed to.
describe('InstallationRequests — a viewer without the manage permissions', () => {
  const asSupervisor = () => {
    permissions = {
      canViewInstallationRequests: true, canManageAssignments: false, canManageInstallations: false,
      isAdmin: false, isSuperAdmin: false, enforcesMeterCapacity: true,
    };
  };

  it('shows the records and none of the actions that would change them', async () => {
    asSupervisor();
    renderPage();
    await screen.findByText('ADA OBI');

    // Every row is still readable...
    expect(screen.getByText('JED PAID')).toBeTruthy();
    // ...and nothing on the page can dispatch, unassign, cancel or export-and-mark.
    expect(screen.queryByLabelText('Select account 1001')).toBeNull();
    expect(screen.queryByRole('button', { name: /Assign to installer/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Assign installer/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Export & mark sent|Export preview/ })).toBeNull();
    expect(screen.queryByText('Mark rows as sent (moves them to Exported)')).toBeNull();
  });

  it('shows a viewer without PAYMENTS.VIEW no money at all, and asks for none', async () => {
    asSupervisor();
    renderPage();
    await screen.findByText('JED PAID');
    expect(screen.queryByText('Total collected payments')).toBeNull();
    expect(screen.queryByText(/67,000/)).toBeNull();
    expect(jedApi.getRevenueTransactions).not.toHaveBeenCalled();
  });

  it('calls no mutating endpoint while the page is open', async () => {
    asSupervisor();
    renderPage();
    await screen.findByText('ADA OBI');
    expect(jedApi.assignInstallations).not.toHaveBeenCalled();
    expect(jedApi.unassignInstallations).not.toHaveBeenCalled();
    expect(jedApi.cancelInstallation).not.toHaveBeenCalled();
    expect(jedApi.exportInstallations).not.toHaveBeenCalled();
  });

  it('gives a Supervisor the full page, because the API gives it those routes', async () => {
    permissions = {
      canViewInstallationRequests: true, canManageAssignments: true, canManageInstallations: true,
      isAdmin: false, isSuperAdmin: false, isSupervisor: true, enforcesMeterCapacity: true,
    };
    renderPage();
    await screen.findByText('ADA OBI');
    expect(screen.getByLabelText('Select account 1001')).toBeTruthy();
    expect(screen.getByText('Mark rows as sent (moves them to Exported)')).toBeTruthy();
  });
});
