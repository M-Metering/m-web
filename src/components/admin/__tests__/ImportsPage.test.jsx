// @vitest-environment jsdom
// Per-Disco Access §6 (2026-10-05): a SUPERVISOR keeps import history, row
// errors and blank templates, but may no longer import or undo (the API 403s).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DataRefreshProvider } from '../../contexts/DataRefreshContext';
import ImportsPage from '../ImportsPage';
import jedApi from '../../services/api';

let permissions;
let currentUser;
vi.mock('../../auth/usePermissions', () => ({ usePermissions: () => permissions }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
  useOptionalAuth: () => ({ user: currentUser, refreshUser: vi.fn() }),
}));
vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(), getDiscos: vi.fn(), getDisco: vi.fn(), getImportBatches: vi.fn(), getImportBatch: vi.fn(),
    undoImportBatch: vi.fn(), importPendingInstallations: vi.fn(), importMeterInventory: vi.fn(),
    uploadMeters: vi.fn(), downloadMetersTemplate: vi.fn(),
    downloadPendingInstallationsTemplate: vi.fn(), downloadMeterInventoryTemplate: vi.fn(),
  },
}));

const ABA = { code: 'ABA_POWER', name: 'Aba Power Limited Electric' };
const BATCH = { id: 5, batchRef: 'IMP-5', discoCode: 'ABA_POWER', fileName: 'aba.xlsx', created: 3, createdAt: '2026-10-05T09:00:00Z', importType: 'PENDING_INSTALLATIONS' };

beforeEach(() => {
  vi.clearAllMocks();
  jedApi.getImportBatches.mockResolvedValue({ success: true, data: [BATCH], pagination: { currentPage: 1, totalPages: 1, hasNext: false } });
  jedApi.getImportBatch.mockResolvedValue({ success: true, data: { ...BATCH, errors: [] } });
  jedApi.uploadMeters.mockResolvedValue({
    success: true,
    message: 'Meters uploaded successfully.',
    data: { totalRows: 1, created: 1, failed: 0, errors: [] },
  });
});
afterEach(cleanup);
const renderPage = () => render(<DataRefreshProvider><ImportsPage /></DataRefreshProvider>);

describe('Imports — Supervisor: history and templates only', () => {
  beforeEach(() => {
    permissions = { canViewImports: true, canRunImports: false };
    currentUser = { id: 's', role: 'SUPERVISOR', discos: [ABA] };
  });

  it('opens on History, with no Undo on a batch', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /IMP-5/ }));
    await waitFor(() => expect(jedApi.getImportBatch).toHaveBeenCalledWith(5));
    expect(screen.queryByRole('button', { name: /Undo this import/ })).toBeNull();
  });

  it('offers blank templates, but no file picker and no Import', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Templates/ }));
    expect(await screen.findByRole('button', { name: /Blank template/ })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Import file/ })).toBeNull();
  });
});

describe('Imports — Admin keeps everything', () => {
  it('can import and undo', async () => {
    permissions = { canViewImports: true, canRunImports: true };
    currentUser = { id: 'a', role: 'ADMIN', discos: [ABA] };
    renderPage();
    expect(await screen.findByRole('button', { name: /Import file/ })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    fireEvent.click(await screen.findByRole('button', { name: /IMP-5/ }));
    expect(await screen.findByRole('button', { name: /Undo this import/ })).toBeTruthy();
  });

  it('keeps the direct meter-workbook workflow inside Imports', async () => {
    permissions = { canViewImports: true, canRunImports: true };
    currentUser = { id: 'a', role: 'ADMIN', discos: [ABA] };
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Meter workbook/ }));
    expect(await screen.findByText(/Format the/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Upload$/ })).toBeTruthy();

    const workbook = new File(['meter'], 'meters.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(screen.getByLabelText(/Select Excel file/), { target: { files: [workbook] } });
    fireEvent.click(screen.getByRole('button', { name: /^Upload$/ }));

    await waitFor(() => expect(jedApi.uploadMeters).toHaveBeenCalledOnce());
    const form = jedApi.uploadMeters.mock.calls[0][0];
    expect(form.get('file')).toBeTruthy();
    expect(form.get('discoCode')).toBe('ABA_POWER');
    expect(await screen.findByText('Upload Results')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    fireEvent.click(screen.getByRole('button', { name: /Meter workbook/ }));
    expect(screen.getByText('Upload Results')).toBeTruthy();
  });
});
