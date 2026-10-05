// @vitest-environment jsdom
// Installer Job Status against a mocked jedApi in the documented shapes
// (GET /users, GET /installations, GET /assignments[/{id}]).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DataRefreshProvider } from '../../contexts/DataRefreshContext';
import InstallerJobStatus from '../InstallerJobStatus';
import jedApi from '../../services/api';

let permissions;
vi.mock('../../auth/usePermissions', () => ({ usePermissions: () => permissions }));

vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getUsers: vi.fn(),
    getInstallations: vi.fn(),
    getAssignmentBatches: vi.fn(),
    getAssignmentBatch: vi.fn(),
    revertInstallation: vi.fn(),
    returnMeters: vi.fn(),
  },
}));

const page = (data) => ({ success: true, data, pagination: { currentPage: 1, totalPages: 1, totalCount: data.length, hasNext: false } });

const JOBS = [
  { id: 1, accountNumber: '1001', customerName: 'ADA OBI', status: 'ASSIGNED', assignedTo: 'u-1', meterType: 'THREE PHASE', discoCode: 'ABA_POWER', assignedAt: '2026-09-01T09:00:00Z' },
  { id: 2, accountNumber: '1002', customerName: 'BAYO ALI', status: 'IN_PROGRESS', assignedTo: 'u-1', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', assignedAt: '2026-09-02T09:00:00Z' },
  { id: 3, accountNumber: '1003', customerName: 'CHIDI EZE', status: 'INSTALLED', assignedTo: 'u-1', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', meterNumber: '0239110006909', installationDate: '2026-09-10', assignedAt: '2026-09-03T09:00:00Z' },
  { id: 4, accountNumber: '1004', customerName: 'DAYO K', status: 'INSTALLED', assignedTo: 'u-2', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', assignedAt: '2026-09-03T09:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  permissions = { canViewInstallerStatus: true, canViewAssignments: true };
  jedApi.getUsers.mockResolvedValue(page([
    { id: 'u-1', firstName: 'John', lastName: 'Doe', role: 'INSTALLER' },
    { id: 'u-2', firstName: 'Musa', lastName: 'Bello', role: 'INSTALLER' },
    { id: 'u-3', firstName: 'New', lastName: 'Hire', role: 'INSTALLER' },
  ]));
  jedApi.getInstallations.mockImplementation(async ({ status }) => page(JOBS.filter((j) => j.status === status)));
  jedApi.getAssignmentBatches.mockImplementation(async ({ status }) => page(status === 'ACTIVE'
    ? [{ id: 40, status: 'ACTIVE', installerId: 'u-1', installerName: 'John Doe' }] : []));
  jedApi.getAssignmentBatch.mockResolvedValue({
    success: true,
    data: {
      id: 40, status: 'ACTIVE', items: [
        { meterNumber: '0239110007001', phaseType: 'THREE PHASE', assignmentStatus: 'ASSIGNED' },
        { meterNumber: '0239110006909', phaseType: 'SINGLE PHASE', assignmentStatus: 'USED' },
      ],
    },
  });
});
afterEach(cleanup);

const renderPage = () => render(<DataRefreshProvider><InstallerJobStatus /></DataRefreshProvider>);
const rowOf = (name) => screen.getAllByText(name).map((el) => el.closest('tr')).find(Boolean);
const cells = (tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim());

describe('InstallerJobStatus — overview', () => {
  it('shows every installer with counts from live jobs and meters from open batches', async () => {
    renderPage();
    await screen.findAllByText('John Doe');
    await waitFor(() => expect(cells(rowOf('John Doe'))[6]).toBe('1'));
    // Installer | Assigned | Awaiting | In progress | Completed | Failed | Meters | Need | Completion
    expect(cells(rowOf('John Doe')).slice(1, 9)).toEqual(['3', '2', '1', '1', '0', '1', '1 needed', '33%']);
    expect(cells(rowOf('Musa Bello')).slice(1, 9)).toEqual(['1', '0', '0', '1', '0', '0', 'Covered', '100%']);
    // A registered installer with no jobs is listed, with no rate rather than 0%.
    expect(cells(rowOf('New Hire'))[8]).toBe('—');
  });

  it('never downloads PENDING or CANCELLED jobs — only statuses that carry an installer', async () => {
    renderPage();
    await screen.findAllByText('John Doe');
    const statuses = jedApi.getInstallations.mock.calls.map(([p]) => p.status).sort();
    expect(statuses).toEqual(['ASSIGNED', 'EXPORTED', 'FAILED', 'INSTALLED', 'IN_PROGRESS']);
    expect(jedApi.getUsers).toHaveBeenCalledWith(expect.objectContaining({ role: 'INSTALLER' }));
  });

  it('shows no money anywhere', async () => {
    renderPage();
    await screen.findAllByText('John Doe');
    expect(document.body.textContent).not.toMatch(/₦|NGN|revenue|amount/i);
  });
});

describe('InstallerJobStatus — detail', () => {
  it('lists one installer\'s jobs and filters them', async () => {
    renderPage();
    await screen.findAllByText('John Doe');
    fireEvent.click(screen.getAllByRole('button', { name: 'View jobs for John Doe' })[0]);

    const list = await screen.findByRole('list', { name: 'Jobs for John Doe' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'COMPLETED' } });
    expect(within(screen.getByRole('list', { name: 'Jobs for John Doe' })).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('CHIDI EZE')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by meter type'), { target: { value: 'THREE PHASE' } });
    expect(screen.getByText('ADA OBI')).toBeTruthy();
    expect(screen.queryByText('BAYO ALI')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /All installers/ }));
    expect((await screen.findAllByText('Musa Bello')).length).toBeGreaterThan(0);
  });
});

describe('InstallerJobStatus — access', () => {
  it('denies a role without the permission and requests nothing', async () => {
    permissions = { canViewInstallerStatus: false, canViewAssignments: false };
    renderPage();
    expect(screen.getByText('Access Denied')).toBeTruthy();
    expect(jedApi.getInstallations).not.toHaveBeenCalled();
    expect(jedApi.getUsers).not.toHaveBeenCalled();
    expect(jedApi.getAssignmentBatches).not.toHaveBeenCalled();
  });

  it('says meter figures are unavailable rather than showing 0 when batches cannot be read', async () => {
    jedApi.getAssignmentBatches.mockRejectedValue(new Error('SERVER_ERROR:boom'));
    renderPage();
    await screen.findAllByText('John Doe');
    await screen.findByText(/Meter figures are unavailable/);
    expect(cells(rowOf('John Doe'))[6]).toBe('—');
  });
});

describe('InstallerJobStatus — the installer\'s meters, and the record behind each', () => {
  const openJohn = async () => {
    renderPage();
    await screen.findAllByText('John Doe');
    fireEvent.click(screen.getAllByRole('button', { name: 'View jobs for John Doe' })[0]);
  };

  it('lists every meter assigned to the installer: in hand, and installed for a customer', async () => {
    await openJohn();
    fireEvent.click(await screen.findByRole('tab', { name: /Meters \(2\)/ }));
    const list = screen.getByRole('list', { name: 'Meters for John Doe' });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    // In hand first (open batch, still ASSIGNED), then installed (reported on job 3).
    expect(items[0]).toMatch(/0239110007001.*Assigned.*Three Phase/);
    expect(items[1]).toMatch(/0239110006909.*Installed.*CHIDI EZE.*1003/);
    expect(screen.getByText(/1 assigned, not yet installed · 1 installed/)).toBeTruthy();
  });

  it('opens the installation and customer record for an installed meter', async () => {
    await openJohn();
    fireEvent.click(await screen.findByRole('tab', { name: /Meters/ }));
    fireEvent.click(screen.getByRole('button', { name: /Meter 0239110006909: view the installation and customer/ }));
    const record = await screen.findByRole('dialog');
    expect(record.textContent).toMatch(/CHIDI EZE/);
    expect(record.textContent).toMatch(/1003/);
  });

  it('opens the open jobs of its type for a meter still in hand — never a customer it is not installed for', async () => {
    await openJohn();
    fireEvent.click(await screen.findByRole('tab', { name: /Meters/ }));
    fireEvent.click(screen.getByRole('button', { name: /Meter 0239110007001: view the jobs it is assigned for/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Assigned \(with the installer, not yet installed\)/);
    expect(dialog.textContent).toMatch(/dispatched separately/);
    const jobs = within(dialog).getByRole('list', { name: /Open jobs for meter 0239110007001/ });
    // THREE PHASE meter: ADA OBI's open three-phase job, not BAYO ALI's single-phase one
    // nor CHIDI EZE's completed one.
    expect(jobs.textContent).toMatch(/ADA OBI/);
    expect(jobs.textContent).not.toMatch(/BAYO ALI|CHIDI EZE/);
    fireEvent.click(within(jobs).getByRole('button', { name: /ADA OBI/ }));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toMatch(/Acct 1001/));
  });

  it('opens any assigned job\'s details from the Jobs list', async () => {
    await openJohn();
    fireEvent.click(await screen.findByRole('button', { name: /Account 1001: view job details/ }));
    const record = await screen.findByRole('dialog');
    expect(record.textContent).toMatch(/ADA OBI/);
  });

  it("shows the customer's phone to the admin tier only", async () => {
    const withPhone = JOBS.map((j) => (j.id === 3 ? { ...j, customerPhone: '08031234567' } : j));
    jedApi.getInstallations.mockImplementation(async ({ status }) => page(withPhone.filter((j) => j.status === status)));
    const open = async () => {
      await openJohn();
      fireEvent.click(await screen.findByRole('tab', { name: /Meters/ }));
      fireEvent.click(screen.getByRole('button', { name: /Meter 0239110006909/ }));
      return screen.findByRole('dialog');
    };
    permissions = { canViewInstallerStatus: true, canViewAssignments: true, isAdmin: false };
    expect((await open()).textContent).not.toMatch(/08031234567/);
    cleanup();
    permissions = { canViewInstallerStatus: true, canViewAssignments: true, isAdmin: true };
    expect((await open()).textContent).toMatch(/08031234567/);
  });
});

describe('InstallerJobStatus — unassign an installed meter (Super Admin only)', () => {
  const openInstalledMeter = async () => {
    renderPage();
    await screen.findAllByText('John Doe');
    fireEvent.click(screen.getAllByRole('button', { name: 'View jobs for John Doe' })[0]);
    fireEvent.click(await screen.findByRole('tab', { name: /Meters/ }));
    fireEvent.click(screen.getByRole('button', { name: /Meter 0239110006909: view the installation and customer/ }));
    return screen.findByRole('dialog');
  };

  it('is not offered to an Admin', async () => {
    permissions = { canViewInstallerStatus: true, canViewAssignments: true, isAdmin: true, canRevertInstallations: false };
    const dialog = await openInstalledMeter();
    expect(within(dialog).queryByRole('button', { name: /Unassign installed meter/ })).toBeNull();
  });

  it('asks first, naming the customer, account, meter and installer, then reverts and re-reads', async () => {
    permissions = { canViewInstallerStatus: true, canViewAssignments: true, isAdmin: true, isSuperAdmin: true, canRevertInstallations: true };
    jedApi.revertInstallation.mockResolvedValue({ success: true, data: { id: 3, status: 'PENDING' } });
    const dialog = await openInstalledMeter();
    fireEvent.click(within(dialog).getByRole('button', { name: /Unassign installed meter/ }));
    const confirm = await screen.findByRole('alertdialog');
    const named = within(confirm).getByLabelText('Installation to be changed').textContent;
    expect(named).toMatch(/CHIDI EZE/);
    expect(named).toMatch(/1003/);
    expect(named).toMatch(/0239110006909/);
    expect(jedApi.revertInstallation).not.toHaveBeenCalled();
    const readsBefore = jedApi.getInstallations.mock.calls.length;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm unassign' }));
    await waitFor(() => expect(jedApi.revertInstallation).toHaveBeenCalledWith(3, undefined));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // The refresh signal re-reads the page from the server.
    await waitFor(() => expect(jedApi.getInstallations.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('keeps the dialog open with a plain message when the server refuses', async () => {
    permissions = { canViewInstallerStatus: true, canViewAssignments: true, isAdmin: true, isSuperAdmin: true, canRevertInstallations: true };
    jedApi.revertInstallation.mockResolvedValue({ success: false, message: 'Installation already exported to the disco' });
    const dialog = await openInstalledMeter();
    fireEvent.click(within(dialog).getByRole('button', { name: /Unassign installed meter/ }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm unassign' }));
    expect(await within(confirm).findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});

describe('InstallerJobStatus — unassign a meter still with the installer', () => {
  const openMeters = async () => {
    renderPage();
    await screen.findAllByText('John Doe');
    fireEvent.click(screen.getAllByRole('button', { name: 'View jobs for John Doe' })[0]);
    fireEvent.click(await screen.findByRole('tab', { name: /Meters/ }));
  };

  it('returns it to stock (same call as Assignments), names the installer, and re-reads the held count', async () => {
    permissions = { canViewInstallerStatus: true, canViewAssignments: true, canManageAssignments: true, isAdmin: true };
    jedApi.returnMeters.mockResolvedValue({ success: true, data: { returned: 1 } });
    await openMeters();
    fireEvent.click(screen.getByRole('button', { name: 'Unassign meter 0239110007001' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByLabelText('Meter to be unassigned').textContent).toMatch(/0239110007001.*Three Phase.*John Doe/);
    // The installed meter on job 1003 is a Super Admin revert, not offered to an Admin.
    expect(screen.queryByRole('button', { name: 'Unassign meter 0239110006909' })).toBeNull();
    const reads = jedApi.getAssignmentBatches.mock.calls.length;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Unassign meter' }));
    await waitFor(() => expect(jedApi.returnMeters).toHaveBeenCalledWith(['0239110007001']));
    await waitFor(() => expect(jedApi.getAssignmentBatches.mock.calls.length).toBeGreaterThan(reads));
  });

  it('is not offered without ASSIGNMENTS.MANAGE', async () => {
    permissions = { canViewInstallerStatus: true, canViewAssignments: true, canManageAssignments: false };
    await openMeters();
    expect(screen.queryByRole('button', { name: /Unassign meter/ })).toBeNull();
  });
});
