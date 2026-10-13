// @vitest-environment jsdom
// The custom export builder against a mocked jedApi: built from the catalogue,
// sends exactly the documented request, saves the server's file, and puts the
// server's per-input errors next to the inputs they name.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import CustomExportModal from '../CustomExportModal';
import jedApi from '../../services/api';
import { downloadServerXlsx } from '../../../utils/xlsx';
import { downloadBlob } from '../../../utils/downloadBlob';

vi.mock('../../services/api', () => ({
  default: { getCustomExportFields: vi.fn(), runCustomExport: vi.fn() },
}));
vi.mock('../../../utils/xlsx', () => ({ downloadServerXlsx: vi.fn(async () => {}) }));
vi.mock('../../../utils/downloadBlob', () => ({ downloadBlob: vi.fn() }));
let discos = [{ code: 'ABA_POWER', name: 'Aba Power' }, { code: 'PHEDC', name: 'PHEDC' }];
vi.mock('../../../hooks/useDiscoOptions', () => ({ useDiscoOptions: () => ({ discos }) }));

const FIELDS = [
  { key: 'status', label: 'Status', section: 'Record', type: 'enum', ops: ['in', 'notIn'], groupable: true, default: true, values: ['PENDING', 'INSTALLED'] },
  { key: 'accountNumber', label: 'Account number', section: 'Customer', type: 'text', ops: ['eq', 'in'], default: true },
  { key: 'customerPhone', label: 'Customer phone', section: 'Customer', type: 'text', ops: ['eq'] },
  { key: 'installerName', label: 'Installer of record', section: 'Completion', type: 'text', ops: ['eq'], groupable: true },
  { key: 'reportedAt', label: 'Completed / Reported At', section: 'Completion', type: 'datetime', ops: ['between', 'preset'], groupable: true, default: true },
];
const catalogue = (fields = FIELDS) => ({
  success: true,
  data: {
    fields,
    datePresets: ['today', 'last7days'],
    dateBuckets: ['day', 'week', 'month', 'year'],
    metrics: [{ key: 'count', label: 'Installations' }, { key: 'withGps', label: 'With GPS' }],
    formats: ['xlsx', 'csv'],
    limits: { xlsx: 100000, csv: 500000, filters: 50, groupBy: 4, sort: 3 },
  },
});
const blob = new Blob(['x']);

beforeEach(() => {
  vi.clearAllMocks();
  discos = [{ code: 'ABA_POWER', name: 'Aba Power' }, { code: 'PHEDC', name: 'PHEDC' }];
  jedApi.getCustomExportFields.mockResolvedValue(catalogue());
  jedApi.runCustomExport.mockResolvedValue({ blob, filename: 'installations-export-2026-10-13.xlsx' });
});
afterEach(cleanup);

const open = async (props = {}) => {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(<CustomExportModal isOpen onClose={onClose} onDone={onDone} {...props} />);
  await screen.findByText('2. Columns');
  return { onDone, onClose };
};
const download = (label = /Download Excel/) => fireEvent.click(screen.getByRole('button', { name: label }));

describe('CustomExportModal', () => {
  it('lists the catalogue by section with the usual columns ticked', async () => {
    await open();
    expect(screen.getByRole('checkbox', { name: 'Status' }).checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Account number' }).checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Customer phone' }).checked).toBe(false);
    expect(screen.getByText('Record')).toBeTruthy();
  });

  it('offers only what the role’s catalogue holds (a Supervisor gets no phone)', async () => {
    jedApi.getCustomExportFields.mockResolvedValue(catalogue(FIELDS.filter((f) => f.key !== 'customerPhone')));
    await open();
    expect(screen.queryByRole('checkbox', { name: 'Customer phone' })).toBeNull();
  });

  it('sends the default request and saves the Excel file as the server built it', async () => {
    const { onDone, onClose } = await open();
    download();
    await waitFor(() => expect(jedApi.runCustomExport).toHaveBeenCalledWith({
      format: 'xlsx', columns: ['status', 'accountNumber', 'reportedAt'],
    }));
    expect(downloadServerXlsx).toHaveBeenCalledWith(blob, 'installations-export-2026-10-13.xlsx');
    expect(onDone).toHaveBeenCalledWith(expect.stringMatching(/installations-export-2026-10-13\.xlsx/));
    expect(onClose).toHaveBeenCalled();
  });

  it('builds a filtered, grouped CSV for the page’s disco', async () => {
    jedApi.runCustomExport.mockResolvedValue({ blob, filename: 'installations-export.csv' });
    await open({ initialDiscoCodes: ['ABA_POWER'] });
    expect(screen.getByRole('checkbox', { name: 'Aba Power' }).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /CSV/ }));

    fireEvent.click(screen.getByRole('button', { name: /Add filter/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Installed' }));

    fireEvent.click(screen.getByRole('button', { name: /Add a grouping/ }));
    fireEvent.change(screen.getByLabelText('Group 1 field'), { target: { value: 'reportedAt' } });
    fireEvent.change(screen.getByLabelText('Group 1 period'), { target: { value: 'week' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'With GPS' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Totals only/ }));

    download(/Download CSV/);
    await waitFor(() => expect(jedApi.runCustomExport).toHaveBeenCalledWith({
      format: 'csv',
      discoCodes: ['ABA_POWER'],
      columns: [],
      filters: [{ field: 'status', op: 'in', value: ['INSTALLED'] }],
      groupBy: ['reportedAt:week'],
      metrics: ['withGps'],
    }));
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'installations-export.csv');
  });

  it('refuses an incomplete filter before sending', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Add filter/ }));
    download();
    expect(await screen.findByText('Choose at least one value.')).toBeTruthy();
    expect(jedApi.runCustomExport).not.toHaveBeenCalled();
  });

  it('puts the server’s errors on the inputs they name and keeps the builder open', async () => {
    jedApi.runCustomExport.mockRejectedValue(Object.assign(
      new Error('NOT_FOUND:Invalid export request: 1 problem'),
      { status: 400, errors: ['filters[0]: status does not accept "FOO"'] },
    ));
    const { onClose } = await open();
    fireEvent.click(screen.getByRole('button', { name: /Add filter/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pending' }));
    download();
    expect(await screen.findByText('filters[0]: status does not accept "FOO"')).toBeTruthy();
    expect(screen.getByText('Invalid export request: 1 problem')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the row-limit message as written', async () => {
    jedApi.runCustomExport.mockRejectedValue(new Error(
      'NOT_FOUND:This export has 120,000 rows; XLSX allows at most 100,000. Narrow the filters or choose CSV.'));
    await open();
    download();
    expect(await screen.findByText(/Narrow the filters or choose CSV/)).toBeTruthy();
  });

  it('sends one request however many times the button is pressed', async () => {
    let finish;
    jedApi.runCustomExport.mockReturnValue(new Promise((r) => { finish = r; }));
    await open();
    download();
    fireEvent.click(screen.getByRole('button', { name: /Preparing/ }));
    expect(jedApi.runCustomExport).toHaveBeenCalledTimes(1);
    finish({ blob, filename: 'f.xlsx' });
    await waitFor(() => expect(downloadServerXlsx).toHaveBeenCalled());
  });

  it('hides the disco picker for a one-disco user and says so when the options fail to load', async () => {
    discos = [{ code: 'PHEDC', name: 'PHEDC' }];
    jedApi.getCustomExportFields.mockRejectedValueOnce(new Error('NETWORK_ERROR:down'));
    render(<CustomExportModal isOpen onClose={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Unable to reach the server/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: /Try again/ }));
    await screen.findByText('2. Columns');
    expect(screen.queryByText('Discos')).toBeNull();
  });
});
