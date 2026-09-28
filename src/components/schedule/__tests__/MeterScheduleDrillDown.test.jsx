// @vitest-environment jsdom
// Meter Schedule status cards as drill-downs (2026-09-27). Pinned:
//   - a card opens exactly the server-filtered list it counts, and the list's
//     own total is shown beside the card's count (a disagreement is flagged);
//   - Installed meters show the installation they went into, joined by meter
//     number from real completed-installation records — nothing invented;
//   - Assigned lists exactly the open-dispatch index its count comes from;
//   - no card shows a field /meters/statistics doesn't return.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DataRefreshProvider } from '../../contexts/DataRefreshContext';
import MeterSchedule from '../MeterSchedule';
import jedApi from '../../services/api';

let permissions;
vi.mock('../../auth/usePermissions', () => ({ usePermissions: () => permissions }));
vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getMeters: vi.fn(),
    getMeterStatistics: vi.fn(),
    getMeterByNumber: vi.fn(),
    searchMeters: vi.fn(),
    getInstallations: vi.fn(),
    getAllCustomerRequests: vi.fn(),
    getAssignmentBatches: vi.fn(),
    getAssignmentBatch: vi.fn(),
  },
}));

const page = (data, total = data.length) => ({
  success: true, data, pagination: { currentPage: 1, totalPages: 1, total, limit: 25, hasNext: false },
});

const METERS = [
  { id: 1, meterNumber: '0239110006909', phaseType: 'SINGLE PHASE', status: 'AVAILABLE' },
  { id: 2, meterNumber: '0239110006917', phaseType: 'THREE PHASE', status: 'AVAILABLE' },
  { id: 3, meterNumber: '0239110006925', phaseType: 'THREE PHASE', status: 'INSTALLED', installedAt: '2026-09-07T10:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  permissions = { canManageSchedule: true, canViewAssignments: true, canManageAssignments: false, isSuperAdmin: false, isAdmin: true };
  jedApi.getMeterStatistics.mockResolvedValue({ success: true, data: { totalMeters: 3, available: 2, installed: 1, faulty: 0, singlePhase: 1, threePhase: 2 } });
  jedApi.getMeters.mockImplementation(async ({ status, phaseType }) => page(METERS.filter((m) =>
    (!status || m.status === status) && (!phaseType || m.phaseType === phaseType))));
  jedApi.getInstallations.mockImplementation(async ({ status }) => page(status === 'INSTALLED' ? [{
    id: 70, accountNumber: '3705431479', customerName: 'IHESIABA C', customerAddress: '12 Aba Rd', customerPhone: '08030000000',
    discoCode: 'ABA_POWER', status: 'INSTALLED', meterType: 'THREE PHASE', meterNumber: '0239110006925', sealNumber: 'SL-77',
    installationDate: '2026-09-07', assigneeName: 'Musa Bello', assignedTo: 'u-1', assignedAt: '2026-09-01T09:00:00Z',
    latitude: 5.1, longitude: 7.3, installationPhotoUrl: 'https://api.example/files/abc',
  }] : []));
  jedApi.getAllCustomerRequests.mockResolvedValue(page([]));
  jedApi.getAssignmentBatches.mockImplementation(async ({ status }) => page(status === 'ACTIVE'
    ? [{ id: 40, status: 'ACTIVE', installerId: 'u-1', installerName: 'Musa Bello', batchRef: 'MB-40' }] : []));
  jedApi.getAssignmentBatch.mockResolvedValue({
    success: true, data: { id: 40, status: 'ACTIVE', items: [{ meterNumber: '0239110006917', phaseType: 'THREE PHASE', assignmentStatus: 'ASSIGNED' }] },
  });
});
afterEach(cleanup);

const renderPage = async () => {
  render(<DataRefreshProvider><MeterSchedule /></DataRefreshProvider>);
  await screen.findByText('0239110006909');
};
const cardButton = (title) => screen.getAllByRole('button').find((b) => b.querySelector('p')?.textContent === title);

describe('Meter Schedule — status cards', () => {
  it('shows only cards the API supports, and "—" (not 0) for a figure it did not return', async () => {
    await renderPage();
    expect(cardButton('Pending')).toBeUndefined();
    expect(cardButton('Paid')).toBeUndefined();
    await waitFor(() => expect(cardButton('Retired').textContent).toMatch(/—/));
    expect(cardButton('Installed').textContent).toMatch(/1/);
  });

  it('Installed opens the INSTALLED list, with the same count, and the installation behind each meter', async () => {
    await renderPage();
    fireEvent.click(cardButton('Installed'));
    await waitFor(() => expect(jedApi.getMeters).toHaveBeenCalledWith(expect.objectContaining({ status: 'INSTALLED' })));
    expect(cardButton('Installed').getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByText(/Showing/)).toBeTruthy();
    const summary = screen.getByText(/Showing/).closest('.card');
    expect(summary.textContent).toMatch(/Installed — 1 matching record/);
    expect(summary.textContent).not.toMatch(/The card reports/);

    const card = (await screen.findByText('IHESIABA C')).closest('.card');
    expect(within(card).getByText('3705431479')).toBeTruthy();
    expect(within(card).getByText('12 Aba Rd')).toBeTruthy();
    expect(within(card).getByText('08030000000')).toBeTruthy();
    expect(within(card).getByText('SL-77')).toBeTruthy();
    expect(within(card).getByText('Musa Bello')).toBeTruthy();
    expect(within(card).getByText(/5\.100000, 7\.300000/)).toBeTruthy();
    expect(within(card).getByText('View installation photo').closest('a').getAttribute('href')).toBe('https://api.example/files/abc');
    // Only completed statuses are read for the join.
    const statuses = jedApi.getInstallations.mock.calls.map(([p]) => p.status).sort();
    expect(statuses).toEqual(['EXPORTED', 'INSTALLED']);
  });

  it('flags a card whose count disagrees with the list it opens', async () => {
    jedApi.getMeterStatistics.mockResolvedValue({ success: true, data: { totalMeters: 3, available: 2, installed: 5 } });
    await renderPage();
    fireEvent.click(cardButton('Installed'));
    expect(await screen.findByText(/The card reports 5 but the list has 1/)).toBeTruthy();
  });

  it('keeps customer phone numbers from a non-admin viewer', async () => {
    permissions = { ...permissions, isAdmin: false };
    await renderPage();
    fireEvent.click(cardButton('Installed'));
    await screen.findByText('IHESIABA C');
    expect(screen.queryByText('08030000000')).toBeNull();
  });

  it('Assigned lists exactly the meters out with installers, matching its count', async () => {
    await renderPage();
    await waitFor(() => expect(cardButton('Assigned').textContent).toMatch(/1/));
    fireEvent.click(cardButton('Assigned'));
    const list = await screen.findByRole('list', { name: 'Assigned meters' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list.textContent).toMatch(/0239110006917/);
    expect(list.textContent).toMatch(/With Musa Bello/);
  });

  it('a phase card filters by phase, and "Show all meters" clears it', async () => {
    await renderPage();
    fireEvent.click(cardButton('Three Phase'));
    await waitFor(() => expect(jedApi.getMeters).toHaveBeenCalledWith(expect.objectContaining({ phaseType: 'THREE PHASE' })));
    fireEvent.click(await screen.findByRole('button', { name: /Show all meters/ }));
    await waitFor(() => expect(screen.queryByText(/Showing/)).toBeNull());
  });
});
