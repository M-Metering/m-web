// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import AssignedMetersPanel, { parsePastedNumbers } from '../AssignedMetersPanel';
import jedApi from '../../services/api';
import { downloadServerFile } from '../../../utils/xlsx';

vi.mock('../../services/api', () => ({
  default: {
    getAssignedMeters: vi.fn(),
    exportAssignedMeters: vi.fn(),
    searchAssignedMeters: vi.fn(),
    exportAssignedMeterSearch: vi.fn(),
  },
}));
vi.mock('../../../utils/xlsx', () => ({ downloadServerFile: vi.fn() }));
vi.mock('../../../hooks/useDiscoOptions', () => ({ useDiscoOptions: () => ({ discos: [{ code: 'PHEDC', name: 'Port Harcourt' }], loading: false }) }));
vi.mock('../../contexts/DataRefreshContext', () => ({ useDataRefresh: () => ({ refreshSignal: 0 }) }));
vi.mock('../../installations/InstallerSelect', () => ({ default: () => null }));

const row = { meterNumber: '0239110211103', phaseType: 'SINGLE PHASE', installerName: 'Ada', discoCode: 'PHEDC', batchId: 7, batchRef: 'MB-7', assignmentStatus: 'ASSIGNED', assignedAt: '2026-11-01T10:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  jedApi.getAssignedMeters.mockResolvedValue({ data: [row], pagination: { currentPage: 1, totalPages: 1, totalCount: 1, hasNext: false, hasPrev: false } });
  jedApi.exportAssignedMeters.mockResolvedValue({ blob: new Blob(['x']), filename: 'assigned-meters.xlsx' });
  jedApi.exportAssignedMeterSearch.mockResolvedValue({ blob: new Blob(['x']), filename: 'assigned-meters-search.csv' });
});
afterEach(cleanup);

describe('parsePastedNumbers', () => {
  it('splits on lines, commas and spaces, and keeps leading zeros', () => {
    expect(parsePastedNumbers('0239 , 0111\n\n0222;0333')).toEqual(['0239', '0111', '0222', '0333']);
  });
});

describe('assigned meters list', () => {
  it('asks the server for held meters by default and shows them', async () => {
    render(<AssignedMetersPanel />);
    await screen.findByText('0239110211103');
    expect(jedApi.getAssignedMeters.mock.calls[0][0]).toMatchObject({ status: 'ASSIGNED', page: 1, limit: 25 });
  });

  it('sends a changed filter to the server, back on page one', async () => {
    render(<AssignedMetersPanel />);
    await screen.findByText('0239110211103');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'USED' } });
    await waitFor(() => expect(jedApi.getAssignedMeters).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'USED', page: 1 })));
  });

  it('exports with the filters on screen', async () => {
    render(<AssignedMetersPanel />);
    await screen.findByText('0239110211103');
    fireEvent.change(screen.getByLabelText('Disco'), { target: { value: 'PHEDC' } });
    await waitFor(() => expect(jedApi.getAssignedMeters).toHaveBeenLastCalledWith(expect.objectContaining({ discoCode: 'PHEDC' })));
    await screen.findByText('0239110211103');
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    await waitFor(() => expect(downloadServerFile).toHaveBeenCalled());
    expect(jedApi.exportAssignedMeters).toHaveBeenCalledWith(expect.objectContaining({ discoCode: 'PHEDC', status: 'ASSIGNED', format: 'xlsx' }));
  });
});

describe('bulk search', () => {
  it('searches pasted numbers, shows every result and exports exactly those', async () => {
    jedApi.searchAssignedMeters.mockResolvedValue({
      data: [{ ...row, result: 'ASSIGNED' }, { meterNumber: '0000000000', result: 'NOT_FOUND' }],
      summary: { requested: 2, assigned: 1, notAssigned: 0, notFound: 1, duplicatesRemoved: 1 },
    });
    render(<AssignedMetersPanel />);
    fireEvent.change(screen.getByPlaceholderText(/0239110211103/), { target: { value: '0239110211103\n0000000000\n0000000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Not found');
    expect(jedApi.searchAssignedMeters).toHaveBeenCalledWith({ meterNumbers: ['0239110211103', '0000000000', '0000000000'] });
    expect(screen.getByText(/2 searched: 1 assigned, 0 not assigned, 1 not found \(1 duplicate removed\)/)).toBeTruthy();

    const exportCsv = screen.getAllByRole('button', { name: 'Export CSV' }).at(-1);
    fireEvent.click(exportCsv);
    await waitFor(() => expect(jedApi.exportAssignedMeterSearch).toHaveBeenCalledWith({
      meterNumbers: ['0239110211103', '0000000000', '0000000000'], format: 'csv',
    }));
  });

  it('refuses more than 5,000 pasted numbers before calling the API', () => {
    render(<AssignedMetersPanel />);
    const many = Array.from({ length: 5001 }, (_, i) => String(i)).join('\n');
    fireEvent.change(screen.getByPlaceholderText(/0239110211103/), { target: { value: many } });
    expect(screen.getByRole('button', { name: 'Search' }).disabled).toBe(true);
  });
});
