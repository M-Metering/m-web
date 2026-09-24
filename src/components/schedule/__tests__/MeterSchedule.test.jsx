// @vitest-environment jsdom
// Meter Schedule: make/model display, who may assign, and Super Admin-only
// deletion of imported meter records. Rendered against a mocked jedApi using
// the documented GET /meters item shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { DataRefreshProvider } from '../../contexts/DataRefreshContext';
import MeterSchedule from '../MeterSchedule';
import jedApi from '../../services/api';

let permissions = { canManageAssignments: true, isSuperAdmin: true, isAdmin: true };

vi.mock('../../auth/usePermissions', () => ({
  usePermissions: () => permissions,
}));

vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getMeters: vi.fn(),
    getMeterStatistics: vi.fn(),
    deleteMeter: vi.fn(),
    exportMeters: vi.fn(),
    getDiscos: vi.fn(),
    getUsers: vi.fn(),
    getInstallations: vi.fn(),
    getAssignmentBatches: vi.fn(),
    getAssignmentBatch: vi.fn(),
    assignMeters: vi.fn(),
  },
}));

const page = (data) => ({
  success: true,
  data,
  pagination: { currentPage: 1, totalPages: 1, total: data.length, limit: 12, hasNext: false },
});

// Exactly the documented GET /meters item shape.
const METERS = [
  {
    id: 1, meterNumber: '0239110006909', simNumber: '8923401000012345678',
    manufacturedDate: '2026-03-01', meterMake: 'MASTER ENERGY', model: 'ME-1P',
    phaseType: 'SINGLE PHASE', sgcNumber: '0600123', status: 'AVAILABLE',
    uploadedAt: '2026-09-01T09:00:00Z', installedAt: null,
  },
  // Imported without make/model/manufacturedDate — the blank-field case.
  {
    id: 2, meterNumber: '0239110006917', simNumber: '8923401000012345679',
    manufacturedDate: '', meterMake: '', model: '',
    phaseType: 'THREE PHASE', sgcNumber: '', status: 'AVAILABLE',
    uploadedAt: '2026-09-02T09:00:00Z', installedAt: null,
  },
  // In service — must never be deletable.
  {
    id: 3, meterNumber: '0239110006925', simNumber: '8923401000012345680',
    manufacturedDate: '2026-02-01', meterMake: 'MASTER ENERGY', model: 'ME-3P',
    phaseType: 'THREE PHASE', sgcNumber: '0600124', status: 'INSTALLED',
    uploadedAt: '2026-08-01T09:00:00Z', installedAt: '2026-09-07T10:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  permissions = { canManageAssignments: true, isSuperAdmin: true, isAdmin: true };
  jedApi.getMeters.mockResolvedValue(page(METERS));
  jedApi.getMeterStatistics.mockResolvedValue({
    success: true,
    data: { totalMeters: 3, available: 2, installed: 1, faulty: 0 },
  });
  jedApi.deleteMeter.mockResolvedValue({ success: true });
  jedApi.getDiscos.mockResolvedValue(page([{ code: 'ABA_POWER', name: 'Aba Power' }]));
  jedApi.getUsers.mockResolvedValue(page([{ id: 'uuid-1', firstName: 'Musa', lastName: 'Bello', role: 'INSTALLER' }]));
  jedApi.getInstallations.mockResolvedValue(page([]));
  jedApi.getAssignmentBatches.mockResolvedValue(page([]));
});
afterEach(cleanup);

const renderPage = async () => {
  render(<DataRefreshProvider><MeterSchedule /></DataRefreshProvider>);
  await screen.findByText('0239110006909');
};

const cardFor = (serial) => screen.getByText(serial).closest('.card');
const buttonIn = (serial, titlePrefix) =>
  Array.from(cardFor(serial).querySelectorAll('button')).find((b) => b.title?.startsWith(titlePrefix));

describe('MeterSchedule — manufacturer & make', () => {
  it('shows the record\'s real make and model', async () => {
    await renderPage();
    const card = cardFor('0239110006909');
    expect(within(card).getByText('Make: MASTER ENERGY')).toBeTruthy();
    expect(within(card).getByText('Model: ME-1P')).toBeTruthy();
  });

  it('labels the build date as a date, not a manufacturer', async () => {
    await renderPage();
    expect(within(cardFor('0239110006909')).getByText('Manufactured date: 2026-03-01')).toBeTruthy();
  });

  it('says "Not recorded" instead of leaving a dangling label', async () => {
    await renderPage();
    const card = cardFor('0239110006917');
    expect(within(card).getByText('Make: Not recorded')).toBeTruthy();
    expect(within(card).getByText('Model: Not recorded')).toBeTruthy();
    expect(within(card).getByText('Manufactured date: Not recorded')).toBeTruthy();
  });

  it('never fills a missing make in from another field', async () => {
    await renderPage();
    const card = cardFor('0239110006917');
    // THREE PHASE and the SIM are on the card; neither leaks into Make.
    expect(within(card).queryByText(/Make: (THREE PHASE|89234)/)).toBeNull();
  });
});

describe('MeterSchedule — assign', () => {
  it('offers Assign on dispatchable meters only', async () => {
    await renderPage();
    expect(within(cardFor('0239110006909')).getByRole('button', { name: 'Assign' })).toBeTruthy();
    // Installed meters are not dispatchable.
    expect(within(cardFor('0239110006925')).queryByRole('button', { name: 'Assign' })).toBeNull();
  });

  it('hides Assign from a role that cannot manage assignments', async () => {
    permissions = { canManageAssignments: false, isSuperAdmin: true, isAdmin: true };
    await renderPage();
    expect(within(cardFor('0239110006909')).queryByRole('button', { name: 'Assign' })).toBeNull();
  });

  it('loads nothing for the assignment dialog until it is opened', async () => {
    await renderPage();
    // The dialog's disco list and installer list are its own concern — a
    // visit to Meter Schedule must not pay for a dialog nobody opened.
    expect(jedApi.getDiscos).not.toHaveBeenCalled();
    expect(jedApi.getUsers).not.toHaveBeenCalled();

    fireEvent.click(within(cardFor('0239110006909')).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(jedApi.getDiscos).toHaveBeenCalled());
  });

  it('opens the shared assignment modal, not a page-local one', async () => {
    await renderPage();
    fireEvent.click(within(cardFor('0239110006909')).getByRole('button', { name: 'Assign' }));
    await screen.findByRole('dialog', { name: /Assign meter/ });
    // The same installer picker and capacity read the Assignments page uses.
    expect(await screen.findByRole('option', { name: /Musa Bello/ })).toBeTruthy();
    expect(screen.getByLabelText(/^Disco/)).toBeTruthy();
  });

  it('never assigns without a disco and installer', async () => {
    await renderPage();
    fireEvent.click(within(cardFor('0239110006909')).getByRole('button', { name: 'Assign' }));
    const dialog = await screen.findByRole('dialog', { name: /Assign meter/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(jedApi.assignMeters).not.toHaveBeenCalled();
  });
});

describe('MeterSchedule — Super Admin deletion of imported meters', () => {
  it('offers deletion to a Super Admin', async () => {
    await renderPage();
    expect(buttonIn('0239110006909', 'Delete meter')).toBeTruthy();
  });

  it('offers no deletion at all to an Admin who is not a Super Admin', async () => {
    permissions = { canManageAssignments: true, isSuperAdmin: false, isAdmin: true };
    await renderPage();
    expect(buttonIn('0239110006909', 'Delete meter')).toBeUndefined();
    expect(screen.queryByLabelText(/Select meter/)).toBeNull();
  });

  it('blocks deleting a meter that is installed at a customer, and says why', async () => {
    await renderPage();
    const blocked = buttonIn('0239110006925', 'Cannot be deleted');
    expect(blocked.disabled).toBe(true);
    expect(blocked.title).toMatch(/installed at a customer premises/);
    // …and it cannot be selected for a batch delete either.
    expect(within(cardFor('0239110006925')).queryByLabelText(/Select meter/)).toBeNull();
  });

  it('requires confirmation, and Cancel deletes nothing', async () => {
    await renderPage();
    fireEvent.click(buttonIn('0239110006909', 'Delete meter'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/permanently remove 1 imported meter record/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(jedApi.deleteMeter).not.toHaveBeenCalled();
  });

  it('deletes only the confirmed record and re-reads the list from the server', async () => {
    await renderPage();
    fireEvent.click(buttonIn('0239110006909', 'Delete meter'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 1 meter' }));

    await waitFor(() => expect(jedApi.deleteMeter).toHaveBeenCalledWith('0239110006909'));
    expect(jedApi.deleteMeter).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('1 meter deleted.')).toBeTruthy();
    // Not just dropped from local state — the list is re-read.
    await waitFor(() => expect(jedApi.getMeters.mock.calls.length).toBeGreaterThan(1));
  });

  it('deletes a whole selection, naming the count on the button', async () => {
    await renderPage();
    fireEvent.click(screen.getByLabelText('Select meter 0239110006909'));
    fireEvent.click(screen.getByLabelText('Select meter 0239110006917'));
    fireEvent.click(screen.getByRole('button', { name: /Delete 2$/ }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/permanently remove 2 imported meter records/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 meters' }));

    await waitFor(() => expect(jedApi.deleteMeter).toHaveBeenCalledTimes(2));
    expect(jedApi.deleteMeter).toHaveBeenCalledWith('0239110006909');
    expect(jedApi.deleteMeter).toHaveBeenCalledWith('0239110006917');
  });

  it('reports a per-meter failure without claiming success for it', async () => {
    jedApi.deleteMeter.mockImplementation(async (serial) => {
      if (serial === '0239110006917') throw new Error('VALIDATION_ERROR:Meter is linked to an installation');
      return { success: true };
    });
    await renderPage();
    fireEvent.click(screen.getByLabelText('Select meter 0239110006909'));
    fireEvent.click(screen.getByLabelText('Select meter 0239110006917'));
    fireEvent.click(screen.getByRole('button', { name: /Delete 2$/ }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete 2 meters' }));

    expect(await screen.findByText('1 meter deleted.')).toBeTruthy();
    expect(screen.getByText('1 could not be deleted:')).toBeTruthy();
    expect(screen.getByText(/Meter is linked to an installation/)).toBeTruthy();
  });
});
