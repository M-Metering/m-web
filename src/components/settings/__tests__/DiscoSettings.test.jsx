// @vitest-environment jsdom
// Settings → Discos: registering a new disco (PHEDC) sends exactly the
// documented POST /discos body with a complete import mapping, and editing an
// existing disco's columns sends the WHOLE mapping back (PUT replaces it), so
// meterInventory and stored per-field options survive.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DataRefreshProvider } from '../../contexts/DataRefreshContext';
import DiscoSettings from '../DiscoSettings';
import jedApi from '../../services/api';

vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getDiscos: vi.fn(),
    getDisco: vi.fn(),
    createDisco: vi.fn(),
    replaceDiscoImportMapping: vi.fn(),
  },
}));

const page = (data) => ({ success: true, data, pagination: { currentPage: 1, totalPages: 1, totalCount: data.length, hasNext: false } });

const ABA_MAPPING = {
  pendingInstallations: {
    sheetIndex: 0, headerRow: 1, keyField: 'accountNumber', captureExtras: true,
    fields: {
      accountNumber: { headers: ['ACCOUNTNUMBER', 'ACCTNO', 'ACCOUNTNO'], required: true, transform: 'text' },
      customerName: { headers: ['CUSTOMERNAME', 'NAME'], required: true, transform: 'trim' },
      meterType: { headers: ['METERTYPE'], required: true, transform: 'phase' },
    },
  },
  meterInventory: {
    keyField: 'meterNumber',
    fields: { meterNumber: { headers: ['METERNO'], required: true, transform: 'text', padStart: 13 } },
  },
};

const renderPage = () => render(<DataRefreshProvider><DiscoSettings /></DataRefreshProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  jedApi.getDiscos.mockResolvedValue(page([{ code: 'ABA_POWER', name: 'Aba Power', integrationMode: 'OFFLINE', isActive: true }]));
  jedApi.getDisco.mockResolvedValue({ success: true, data: { code: 'ABA_POWER', importMapping: ABA_MAPPING } });
  jedApi.createDisco.mockResolvedValue({ success: true, data: { code: 'PHEDC' } });
  jedApi.replaceDiscoImportMapping.mockResolvedValue({ success: true });
});
afterEach(cleanup);

describe('DiscoSettings', () => {
  it('lists every disco, including inactive ones', async () => {
    renderPage();
    expect(await screen.findByText('ABA_POWER')).toBeTruthy();
    expect(jedApi.getDiscos).toHaveBeenCalledWith(expect.not.objectContaining({ isActive: true }));
  });

  it('registers PHEDC with the documented body and a complete mapping', async () => {
    renderPage();
    await screen.findByText('ABA_POWER');
    fireEvent.click(screen.getByRole('button', { name: /Register Disco/ }));
    fireEvent.change(screen.getByLabelText('Code *'), { target: { value: 'phedc' } });
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Port Harcourt Electricity Distribution' } });
    // The Bayelsa sheet's own headers.
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: 'ACCOUNT_NO' } });
    fireEvent.change(screen.getByLabelText('Feeder'), { target: { value: 'FEEDER33NAME' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(jedApi.createDisco).toHaveBeenCalledTimes(1));
    const body = jedApi.createDisco.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['code', 'importMapping', 'integrationMode', 'name']);
    expect(body).toMatchObject({ code: 'PHEDC', name: 'Port Harcourt Electricity Distribution', integrationMode: 'OFFLINE' });
    const pending = body.importMapping.pendingInstallations;
    expect(pending).toMatchObject({ keyField: 'accountNumber', captureExtras: true });
    expect(pending.fields.accountNumber).toEqual({ transform: 'text', headers: ['ACCOUNT_NO'], required: true });
    expect(pending.fields.feederName.headers).toEqual(['FEEDER33NAME']);
    expect(pending.fields.region.headers).toEqual(['REGION']);
    expect(pending.fields.transformerCode.headers).toContain('DTRID');
    // No meter type is ever required of a sheet that may not have one.
    expect(pending.fields.meterType.required).toBe(false);
    // Meter columns copied from the existing disco, minus the padding.
    expect(body.importMapping.meterInventory.fields.meterNumber).toEqual({ headers: ['METERNO'], required: true, transform: 'text' });
    expect(await screen.findByText(/PHEDC is registered/)).toBeTruthy();
  });

  it('refuses a duplicate code without calling the API', async () => {
    renderPage();
    await screen.findByText('ABA_POWER');
    fireEvent.click(screen.getByRole('button', { name: /Register Disco/ }));
    fireEvent.change(screen.getByLabelText('Code *'), { target: { value: 'ABA_POWER' } });
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByText('ABA_POWER is already registered.')).toBeTruthy();
    expect(jedApi.createDisco).not.toHaveBeenCalled();
  });

  it('shows a server refusal instead of a success', async () => {
    jedApi.createDisco.mockResolvedValue({ success: false, message: 'Disco already exists' });
    renderPage();
    await screen.findByText('ABA_POWER');
    fireEvent.click(screen.getByRole('button', { name: /Register Disco/ }));
    fireEvent.change(screen.getByLabelText('Code *'), { target: { value: 'PHEDC' } });
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'PHEDC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(jedApi.createDisco).toHaveBeenCalled());
    expect(screen.queryByText(/is registered/)).toBeNull();
  });

  it('saves edited columns as the whole mapping, keeping meterInventory untouched', async () => {
    renderPage();
    await screen.findByText('ABA_POWER');
    fireEvent.click(screen.getByRole('button', { name: /Import columns/ }));
    const region = await screen.findByLabelText('Region');
    fireEvent.change(region, { target: { value: 'REGION' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save columns' }));
    const confirm = await screen.findAllByRole('button', { name: 'Save columns' });
    fireEvent.click(confirm[confirm.length - 1]);

    await waitFor(() => expect(jedApi.replaceDiscoImportMapping).toHaveBeenCalledTimes(1));
    const [code, mapping] = jedApi.replaceDiscoImportMapping.mock.calls[0];
    expect(code).toBe('ABA_POWER');
    expect(mapping.meterInventory).toEqual(ABA_MAPPING.meterInventory);
    expect(mapping.pendingInstallations.fields.meterType).toEqual(ABA_MAPPING.pendingInstallations.fields.meterType);
    expect(mapping.pendingInstallations.fields.region).toEqual({ transform: 'trim', headers: ['REGION'], required: false });
  });
});
