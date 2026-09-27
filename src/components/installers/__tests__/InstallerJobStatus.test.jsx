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
