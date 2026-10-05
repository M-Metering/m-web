// @vitest-environment jsdom
// Report exports (2026-10-05). Pinned:
//   - one action at a time; the buttons always come back, after success or failure;
//   - nothing is written for an empty report — the user is told instead;
//   - Print renders ONLY the report (body.printing-report) and calls print();
//   - Payments & deals exports the WHOLE filtered set — every page, the
//     screen's own filters and search — not the 20 rows on screen.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import ReportExportBar from '../ReportExportBar';
import RevenueTab from '../../admin/RevenueTab';
import { DataRefreshProvider } from '../../contexts/DataRefreshContext';
import { downloadXlsx } from '../../../utils/xlsx';
import { downloadBlob } from '../../../utils/downloadBlob';
import jedApi from '../../services/api';

vi.mock('../../../utils/xlsx', async (importOriginal) => ({ ...(await importOriginal()), downloadXlsx: vi.fn(async () => {}) }));
vi.mock('../../../utils/downloadBlob', () => ({ downloadBlob: vi.fn(), default: vi.fn() }));
vi.mock('../../../hooks/useDiscoOptions', () => ({ useDiscoOptions: () => ({ discos: [{ code: 'ABA_POWER', name: 'Aba Power' }] }) }));
vi.mock('../../services/api', () => ({ default: { getRevenueSummary: vi.fn(), getRevenueTransactions: vi.fn() } }));

const REPORT = {
  title: 'Test Report', slug: 'Test', generatedAt: new Date(2026, 9, 5), orientation: 'landscape', filters: [], notes: [],
  tables: [{ name: 'T', columns: [{ key: 'a', header: 'Account' }], rows: [{ a: '0001' }] }],
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); document.body.classList.remove('printing-report'); });

describe('ReportExportBar', () => {
  it('runs one export at a time and restores the buttons afterwards', async () => {
    let release;
    const build = vi.fn(() => new Promise((r) => { release = () => r(REPORT); }));
    render(<ReportExportBar build={build} />);
    const excel = screen.getByRole('button', { name: 'Export Excel' });
    fireEvent.click(excel);
    fireEvent.click(excel);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(build).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Preparing Excel…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print / PDF' }).disabled).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(downloadXlsx).toHaveBeenCalledTimes(1));
    expect(downloadXlsx.mock.calls[0][0]).toBe('ME-Metering-Test-2026-10-05.xlsx');
    await waitFor(() => expect(excel.disabled).toBe(false));
  });

  it('writes the CSV through the same report', async () => {
    render(<ReportExportBar build={async () => REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(downloadBlob.mock.calls[0][1]).toBe('ME-Metering-Test-2026-10-05.csv');
  });

  it('writes nothing for an empty report, and says why', async () => {
    render(<ReportExportBar build={async () => ({ ...REPORT, tables: [{ ...REPORT.tables[0], rows: [] }] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    expect(await screen.findByText('No data available for the selected filters.')).toBeTruthy();
    expect(downloadXlsx).not.toHaveBeenCalled();
  });

  it('a failure is one plain sentence, and the buttons come back', async () => {
    render(<ReportExportBar build={async () => { throw new Error('SERVER_ERROR: relation "x" does not exist'); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Print / PDF' }));
    expect(await screen.findByText('Unable to prepare the report for printing. Please try again.')).toBeTruthy();
    expect(screen.queryByText(/relation/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Print / PDF' }).disabled).toBe(false);
  });

  it('prints only the report: header, filters and rows in a body portal, app hidden by the print stylesheet', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      // At the moment print() runs, the report is in the DOM and the body is marked.
      expect(document.body.classList.contains('printing-report')).toBe(true);
      const root = document.body.querySelector(':scope > .report-print-root');
      expect(root.textContent).toMatch(/ME Metering System.*Test Report/);
      expect(root.textContent).toContain('0001');
    });
    render(<ReportExportBar build={async () => ({ ...REPORT, filters: [{ label: 'Meter type', value: 'Three Phase' }] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Print / PDF' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(document.body.querySelector('.report-print-root').textContent).toMatch(/Meter type\s*Three Phase/);
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(document.body.classList.contains('printing-report')).toBe(false);
    print.mockRestore();
  });
});

describe('Payments & deals export — every matching record, the screen’s filters', () => {
  // 45 records; the screen shows 20 per page, the export loader reads 100 per
  // page — so the server is asked with each caller's own limit.
  const ALL = Array.from({ length: 45 }, (_, i) => ({
    source: 'installation_request', sourceId: i + 1, reference: `00${1000 + i}`, customerName: `C${i}`,
    discoCode: 'ABA_POWER', meterType: 'THREE PHASE', amount: 150000, sourceStatus: 'INSTALLED', revenueAt: '2026-09-10T10:00:00Z', dateBasis: 'reported_at',
  }));
  beforeEach(() => {
    jedApi.getRevenueSummary.mockResolvedValue({ success: true, data: { totals: { amount: 6750000, count: 45 }, byDisco: [] } });
    jedApi.getRevenueTransactions.mockImplementation(async ({ page = 1, limit = 20 }) => ({
      success: true, data: ALL.slice((page - 1) * limit, page * limit),
      meta: { totals: { amount: 6750000, count: 45 } },
      pagination: { currentPage: page, totalPages: Math.ceil(ALL.length / limit), totalCount: ALL.length },
    }));
  });

  it('exports all 45 records — not the 20 on screen — with the active meter type, disco and search', async () => {
    render(<DataRefreshProvider><RevenueTab defaultRange="all" /></DataRefreshProvider>);
    await screen.findByText('Page 1 of 3 · 45 records');
    fireEvent.change(screen.getByLabelText('Filter revenue by meter type'), { target: { value: 'THREE PHASE' } });
    fireEvent.change(screen.getByLabelText('Filter revenue by disco'), { target: { value: 'ABA_POWER' } });
    fireEvent.change(screen.getByLabelText('Search revenue records'), { target: { value: 'C1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const excel = screen.getByRole('button', { name: 'Export Excel' });
    await waitFor(() => expect(excel.disabled).toBe(false));
    fireEvent.click(excel);
    await waitFor(() => expect(downloadXlsx).toHaveBeenCalledTimes(1));

    const exportCalls = jedApi.getRevenueTransactions.mock.calls.map(([p]) => p).filter((p) => p.limit !== 20);
    expect(exportCalls.length).toBeGreaterThan(0);
    exportCalls.forEach((p) => expect(p).toMatchObject({ meterType: 'THREE PHASE', discoCode: 'ABA_POWER', search: 'C1' }));
    const [filename, sheets] = downloadXlsx.mock.calls[0];
    expect(filename).toMatch(/^ME-Metering-Payment-Deals-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(sheets[0].rows).toHaveLength(45);
    expect(sheets[0].rows[0].reference).toBe('001000');
    const info = Object.fromEntries(sheets.at(-1).rows.map((r) => [r.item, r.value]));
    expect(info['Meter type']).toBe('Three Phase');
    expect(info.Disco).toBe('Aba Power (ABA_POWER)');
    expect(info.Search).toBe('"C1"');
  });
});
