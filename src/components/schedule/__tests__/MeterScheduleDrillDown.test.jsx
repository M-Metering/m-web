// @vitest-environment jsdom
// Meter Schedule summary cards (restored 2026-10-05). Pinned:
//   - the cards are plain tiles again — only Installed is clickable, and it
//     opens a modal instead of changing the page or the inventory;
//   - the modal lists the meters the Installed count is made of
//     (GET /meters?status=INSTALLED) joined to their real installation
//     records — nothing invented, missing fields left out;
//   - no meter card embeds installation details;
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
    revertInstallation: vi.fn(),
    returnMeters: vi.fn(),
    deleteMeter: vi.fn(),
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
// A summary card by its title: the tile element (a <div>, or a <button> when clickable).
const cardOfTitle = (title) => Array.from(document.querySelectorAll('.card'))
  .find((el) => el.querySelector(':scope > div > div > p')?.textContent === title);

describe('Meter Schedule — summary cards', () => {
  it('shows only cards the API supports, and "—" (not 0) for a figure it did not return', async () => {
    await renderPage();
    expect(cardOfTitle('Pending')).toBeUndefined();
    expect(cardOfTitle('Paid')).toBeUndefined();
    await waitFor(() => expect(cardOfTitle('Retired').textContent).toMatch(/—/));
    expect(cardOfTitle('Installed').textContent).toMatch(/1/);
  });

  it('are plain tiles: only Installed is a button; no hints, no selected state, no drill-down list on the page', async () => {
    await renderPage();
    await waitFor(() => expect(cardOfTitle('Assigned').textContent).toMatch(/1/));
    ['Total Meters', 'Available', 'Assigned', 'Faulty', 'Retired', 'Single Phase', 'Three Phase'].forEach((title) => {
      expect(cardOfTitle(title).tagName).toBe('DIV');
    });
    expect(cardOfTitle('Installed').tagName).toBe('BUTTON');
    expect(screen.queryByText(/with installers/)).toBeNull();
    expect(screen.queryByText(/Out with installers/)).toBeNull();
    expect(document.querySelector('[aria-pressed]')).toBeNull();
    fireEvent.click(cardOfTitle('Available'));
    expect(screen.queryByText(/^Showing/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Assigned meters' })).toBeNull();
  });

  it('a meter card never embeds installation or customer details', async () => {
    permissions = { ...permissions, isSuperAdmin: true, canRevertInstallations: true };
    await renderPage();
    const card = (await screen.findByRole('heading', { name: '0239110006925' })).closest('.card');
    // The Super Admin read of installation records happens (for Unassign)...
    await waitFor(() => expect(jedApi.getInstallations).toHaveBeenCalled());
    await waitFor(() => expect(within(card).getByRole('button', { name: /Unassign meter/ })).toBeTruthy());
    // ...but none of it is drawn onto the card.
    expect(within(card).queryByText('IHESIABA C')).toBeNull();
    expect(within(card).queryByText('SL-77')).toBeNull();
  });
});

describe('Meter Schedule — the Installed card opens the installed details modal', () => {
  const SECOND = {
    id: 71, accountNumber: '3705431480', customerName: 'OKORO N', customerAddress: '3 Port Rd', discoCode: 'ABA_POWER',
    status: 'EXPORTED', meterType: 'SINGLE PHASE', meterNumber: '0239110006933', sealNumber: 'SL-78',
    installationDate: '2026-09-08', assigneeName: 'Ada Eze', assignedTo: 'u-2', discoSupervisor: 'Engr. Obi',
  };
  const INSTALLED_METERS = [
    METERS[2],
    { id: 4, meterNumber: '0239110006933', phaseType: 'SINGLE PHASE', status: 'INSTALLED', meterMake: 'Hexing' },
    { id: 5, meterNumber: '0239110006941', phaseType: 'SINGLE PHASE', status: 'INSTALLED' },
  ];
  beforeEach(() => {
    const first = jedApi.getInstallations.getMockImplementation();
    jedApi.getInstallations.mockImplementation(async (p) => (p.status === 'EXPORTED' ? page([SECOND]) : first(p)));
    jedApi.getMeters.mockImplementation(async ({ status, phaseType }) => page(
      status === 'INSTALLED' ? INSTALLED_METERS
        : METERS.filter((m) => (!status || m.status === status) && (!phaseType || m.phaseType === phaseType))
    ));
    jedApi.getMeterStatistics.mockResolvedValue({ success: true, data: { totalMeters: 5, available: 2, installed: 3, faulty: 0, singlePhase: 3, threePhase: 2 } });
  });
  const openModal = async () => {
    await renderPage();
    fireEvent.click(cardOfTitle('Installed'));
    return screen.findByRole('dialog', { name: 'Installed Installations' });
  };

  it('opens a modal and leaves the inventory exactly as it was', async () => {
    const modal = await openModal();
    expect(await within(modal).findByRole('list', { name: 'Installed meters' })).toBeTruthy();
    // The inventory behind is unfiltered: the available meter is still listed.
    expect(screen.getByRole('heading', { name: '0239110006909' })).toBeTruthy();
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Installed Installations' })).toBeNull());
  });

  it('lists every meter behind the count, each with its real installation, grouped and searchable', async () => {
    const modal = await openModal();
    const list = await within(modal).findByRole('list', { name: 'Installed meters' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(modal.textContent).not.toMatch(/the card reports/);

    fireEvent.click(within(modal).getByRole('button', { name: /0239110006925/ }));
    const text = modal.textContent;
    ['Customer', 'Installer', 'Installation', 'Meter', 'Seal', 'Location', 'Installation picture',
      'IHESIABA C', '3705431479', '12 Aba Rd', 'Musa Bello', 'SL-77', 'Three Phase', '5.100000, 7.300000', 'View picture']
      .forEach((v) => expect(text).toContain(v));
    expect(within(modal).getByRole('img', { name: /Installation of meter 0239110006925/ }).getAttribute('src')).toBe('https://api.example/files/abc');

    // A field the record doesn't carry is left out, never filled in.
    fireEvent.click(within(modal).getByRole('button', { name: /0239110006933/ }));
    expect(modal.textContent).toContain('Engr. Obi');
    expect(modal.textContent).toContain('Hexing');

    // A meter no installation reports is still listed, and says so.
    expect(within(list).getAllByRole('listitem')[2].textContent).toMatch(/0239110006941.*No installation record reports this meter/);

    const search = within(modal).getByLabelText('Search installed meters');
    for (const term of ['3705431480', 'okoro', 'Ada Eze', '0239110006933']) {
      fireEvent.change(search, { target: { value: term } });
      expect(within(modal).getAllByRole('listitem')).toHaveLength(1);
    }
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.change(within(modal).getByLabelText('Filter by installer'), { target: { value: 'Musa Bello' } });
    expect(within(modal).getAllByRole('listitem')).toHaveLength(1);
  });

  it('keeps customer phone numbers from a non-admin viewer', async () => {
    permissions = { ...permissions, isAdmin: false };
    const modal = await openModal();
    fireEvent.click(await within(modal).findByRole('button', { name: /0239110006925/ }));
    expect(within(modal).getByText('SL-77')).toBeTruthy();
    expect(within(modal).queryByText('08030000000')).toBeNull();
  });

  it('says plainly when there is nothing, or when the read fails', async () => {
    jedApi.getMeters.mockImplementation(async ({ status }) => page(status === 'INSTALLED' ? [] : METERS));
    let modal = await openModal();
    expect(await within(modal).findByText('No installed installations found.')).toBeTruthy();
    cleanup();
    jedApi.getMeters.mockImplementation(async ({ status }) => {
      if (status === 'INSTALLED') throw new Error('SERVER_ERROR:boom at /srv/x.js');
      return page(METERS);
    });
    modal = await openModal();
    expect(await within(modal).findByText(/Unable to load installed installation details\. Please try again\./)).toBeTruthy();
    expect(modal.textContent).not.toMatch(/boom|srv/);
  });

  it('offers Unassign to a Super Admin on an INSTALLED record only, and re-reads after it', async () => {
    permissions = { ...permissions, isSuperAdmin: true, canRevertInstallations: true };
    jedApi.revertInstallation.mockResolvedValue({ success: true, data: { id: 70, status: 'PENDING' } });
    const modal = await openModal();
    fireEvent.click(await within(modal).findByRole('button', { name: /0239110006933/ }));
    // EXPORTED: already reported to the disco — the API refuses, so it isn't offered.
    expect(within(modal).queryByRole('button', { name: /Unassign installed meter/ })).toBeNull();
    expect(within(modal).getByText(/Can’t unassign: Already exported/)).toBeTruthy();

    fireEvent.click(within(modal).getByRole('button', { name: /0239110006925/ }));
    fireEvent.click(within(modal).getByRole('button', { name: /Unassign installed meter/ }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByLabelText('Installation to be changed').textContent).toMatch(/IHESIABA C.*3705431479.*0239110006925.*Musa Bello/);
    const reads = jedApi.getInstallations.mock.calls.length;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm unassign' }));
    await waitFor(() => expect(jedApi.revertInstallation).toHaveBeenCalledWith(70, undefined));
    await waitFor(() => expect(jedApi.getInstallations.mock.calls.length).toBeGreaterThan(reads));
  });

  it('never offers Unassign to an Admin', async () => {
    const modal = await openModal();
    fireEvent.click(await within(modal).findByRole('button', { name: /0239110006925/ }));
    expect(within(modal).queryByRole('button', { name: /Unassign/ })).toBeNull();
  });

  it('works for a role to whom JED requests are forbidden', async () => {
    permissions = { ...permissions, isAdmin: false, isSupervisor: true };
    jedApi.getAllCustomerRequests.mockRejectedValue(new Error('PERMISSION_ERROR:Insufficient permissions'));
    const modal = await openModal();
    expect(await within(modal).findByText(/IHESIABA C/)).toBeTruthy();
    expect(within(modal).getByText(/JED Remita requests aren’t available to your role/)).toBeTruthy();
    expect(within(modal).queryByRole('alert')).toBeNull();
  });
});

describe('Meter Schedule — Unassign meter (same rule and calls as Installations/Assignments)', () => {
  const HELD = '0239110006917';
  const search = async (term) => {
    const box = screen.getAllByPlaceholderText('Search by Meter Number, SIM, SGC...')[0];
    fireEvent.change(box, { target: { value: term } });
    fireEvent.keyDown(box, { key: 'Enter' });
  };
  const cardOf = async (serial) => (await screen.findByRole('heading', { name: serial })).closest('.card');

  beforeEach(() => {
    jedApi.getMeterByNumber.mockImplementation(async (n) => {
      const m = METERS.find((x) => x.meterNumber === n);
      if (!m) throw new Error('NOT_FOUND:Meter not found');
      return { success: true, data: m };
    });
    jedApi.returnMeters.mockResolvedValue({ success: true, data: { returned: 1 } });
  });

  it('search finds an assigned meter (status AVAILABLE on the record), shows Assigned and its installer, and unassigns it', async () => {
    permissions = { ...permissions, canManageAssignments: true };
    await renderPage();
    await search(HELD);
    await waitFor(() => expect(jedApi.getMeterByNumber).toHaveBeenCalledWith(HELD));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '0239110006909' })).toBeNull());
    const card = await cardOf(HELD);
    await waitFor(() => expect(within(card).getByText('Assigned')).toBeTruthy());
    expect(within(card).getByText('With Musa Bello')).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: `Unassign meter ${HELD}` }));
    const dialog = await screen.findByRole('alertdialog');
    const named = within(dialog).getByLabelText('Meter to be unassigned').textContent;
    expect(named).toMatch(new RegExp(HELD));
    expect(named).toMatch(/Three Phase/);
    expect(named).toMatch(/Musa Bello/);
    expect(jedApi.returnMeters).not.toHaveBeenCalled();

    const batchReads = jedApi.getAssignmentBatches.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unassign meter' }));
    await waitFor(() => expect(jedApi.returnMeters).toHaveBeenCalledWith([HELD]));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // Re-read from the server (who holds what), never a local edit; never a delete.
    await waitFor(() => expect(jedApi.getAssignmentBatches.mock.calls.length).toBeGreaterThan(batchReads));
    expect(jedApi.deleteMeter).not.toHaveBeenCalled();
  });

  it('keeps the meter and the dialog when the server refuses, with a plain message', async () => {
    permissions = { ...permissions, canManageAssignments: true };
    jedApi.returnMeters.mockRejectedValue(new Error('SERVER_ERROR:Internal error at /srv/app.js:12'));
    await renderPage();
    const card = await cardOf(HELD);
    await waitFor(() => expect(within(card).getByText('Assigned')).toBeTruthy());
    fireEvent.click(within(card).getByRole('button', { name: `Unassign meter ${HELD}` }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unassign meter' }));
    expect(await within(dialog).findByText('Unable to unassign this meter. Please try again.')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(within(card).getByText('Assigned')).toBeTruthy();
  });

  it('is not offered without ASSIGNMENTS.MANAGE, nor on an available meter', async () => {
    permissions = { ...permissions, canManageAssignments: false };
    await renderPage();
    await waitFor(() => expect(within(screen.getByRole('heading', { name: HELD }).closest('.card')).getByText('Assigned')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Unassign meter/ })).toBeNull();
    cleanup();
    permissions = { ...permissions, canManageAssignments: true };
    await renderPage();
    const available = await cardOf('0239110006909');
    expect(within(available).queryByRole('button', { name: /Unassign meter/ })).toBeNull();
  });

  it('an installed meter found by search: Super Admin gets the installation revert, an Admin gets nothing', async () => {
    jedApi.revertInstallation.mockResolvedValue({ success: true, data: { id: 70, status: 'PENDING' } });
    permissions = { ...permissions, canManageAssignments: true, canRevertInstallations: false };
    await renderPage();
    await search('0239110006925');
    let card = await cardOf('0239110006925');
    expect(within(card).getByText('Installed')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /Unassign meter/ })).toBeNull();
    cleanup();

    permissions = { ...permissions, isSuperAdmin: true, canRevertInstallations: true };
    await renderPage();
    card = await cardOf('0239110006925');
    fireEvent.click(await within(card).findByRole('button', { name: 'Unassign meter 0239110006925' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/Unassign installed meter?/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm unassign' }));
    await waitFor(() => expect(jedApi.revertInstallation).toHaveBeenCalledWith(70, undefined));
    expect(jedApi.returnMeters).not.toHaveBeenCalled();
  });
});
