// @vitest-environment jsdom
// Meter-number search has to cover the WHOLE inventory, not the page on
// screen. GET /meters has no search parameter (only page/limit/status/
// phaseType), so the client pages through everything and filters locally —
// and the cap on that scan is what used to make a real meter unfindable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DataRefreshProvider } from '../../contexts/DataRefreshContext';
import MeterSchedule from '../MeterSchedule';
import jedApi from '../../services/api';

vi.mock('../../auth/usePermissions', () => ({
  usePermissions: () => ({ canManageAssignments: true, isSuperAdmin: true, isAdmin: true, enforcesMeterCapacity: false }),
}));

vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getMeters: vi.fn(),
    getMeterByNumber: vi.fn(),
    searchMeters: vi.fn(),
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

const PAGE = 100;
// A 5,000-meter inventory: bigger than the old 2,000 cap, so a meter deep in
// the list is exactly the case that used to come back "not found".
const INVENTORY = Array.from({ length: 5000 }, (_, i) => ({
  id: i + 1,
  meterNumber: String(2390000000000 + i),
  simNumber: String(8923401000012345678n + BigInt(i)),
  phaseType: i % 2 ? 'THREE PHASE' : 'SINGLE PHASE',
  status: 'AVAILABLE',
  meterMake: 'MASTER ENERGY',
  model: 'ME-1P',
  manufacturedDate: '2026-03-01',
  uploadedAt: '2026-09-01T09:00:00Z',
  installedAt: null,
}));
// Legitimate identifiers of every supported length, including leading zeros.
const ODD_LENGTHS = [
  { id: 90001, meterNumber: '1234567890' },       // 10
  { id: 90002, meterNumber: '01234567890' },      // 11, leading zero
  { id: 90003, meterNumber: '145345123456' },     // 12
  { id: 90004, meterNumber: '0239110006909' },    // 13, leading zero
].map((m) => ({
  ...m, simNumber: '', phaseType: 'SINGLE PHASE', status: 'AVAILABLE',
  meterMake: '', model: '', manufacturedDate: '', uploadedAt: '2026-09-01T09:00:00Z', installedAt: null,
}));

const ALL = [...INVENTORY, ...ODD_LENGTHS];

const serveInventory = (rows) => {
  jedApi.getMeters.mockImplementation(async ({ page = 1, limit = 25, status, phaseType }) => {
    let data = rows;
    if (status) data = data.filter((m) => m.status === status);
    if (phaseType) data = data.filter((m) => m.phaseType === phaseType);
    const start = (page - 1) * limit;
    const slice = data.slice(start, start + limit);
    return {
      success: true,
      data: slice,
      // GET /meters reports currentPage as a STRING and omits hasNext.
      pagination: { currentPage: String(page), limit, total: data.length, pages: Math.ceil(data.length / limit) },
    };
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  serveInventory(ALL);
  // The authoritative lookup: GET /meters/meter-number/{n}.
  jedApi.getMeterByNumber.mockImplementation(async (n) => {
    const found = ALL.find((m) => m.meterNumber === n);
    if (!found) throw new Error('NOT_FOUND:Meter not found');
    return { success: true, data: found };
  });
  jedApi.getMeterStatistics.mockResolvedValue({
    success: true, data: { totalMeters: ALL.length, available: ALL.length, installed: 0, faulty: 0 },
  });
  jedApi.getDiscos.mockResolvedValue({ success: true, data: [], pagination: { hasNext: false } });
  jedApi.getUsers.mockResolvedValue({ success: true, data: [], pagination: { hasNext: false } });
});
afterEach(cleanup);

const renderPage = async () => {
  render(<DataRefreshProvider><MeterSchedule /></DataRefreshProvider>);
  await screen.findByPlaceholderText(/Search by Meter Number/);
};

const search = (term) => {
  const input = screen.getByPlaceholderText(/Search by Meter Number/);
  fireEvent.change(input, { target: { value: term } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return input;
};

const exactCalls = () => jedApi.getMeterByNumber.mock.calls.map(([n]) => n);
const listCalls = () => jedApi.getMeters.mock.calls.filter(([p]) => p.limit === PAGE);
const searchCalls = () => jedApi.searchMeters.mock.calls.map(([p]) => p);

// GET /meters/search: server-side, over meter_number and sim_number, paginated.
const serveSearch = (rows) => {
  jedApi.searchMeters.mockImplementation(async ({ q, limit = 20, status, phaseType }) => {
    let data = rows.filter(
      (m) => String(m.meterNumber).includes(q) || String(m.simNumber).includes(q)
    );
    if (status) data = data.filter((m) => m.status === status);
    if (phaseType) data = data.filter((m) => m.phaseType === phaseType);
    const page = data.slice(0, limit);
    return {
      success: true,
      data: page,
      pagination: { currentPage: 1, totalPages: Math.ceil(data.length / limit), totalCount: data.length, hasNext: data.length > limit },
    };
  });
};

describe('Meter Schedule — a complete meter number is one server-side lookup', () => {
  it('asks the API for that exact meter, and does not page the inventory', async () => {
    await renderPage();
    const before = listCalls().length;
    const deep = INVENTORY[4499].meterNumber; // row 4,500 — nowhere near page 1

    search(deep);
    expect(await screen.findByText(deep, {}, { timeout: 5000 })).toBeTruthy();

    // GET /meters/meter-number/{n} — the whole inventory, one request.
    expect(exactCalls()).toEqual([deep]);
    // No full-inventory scan was started.
    expect(listCalls().length).toBe(before);
  }, 20000);

  it('sends the meter number as the exact string typed', async () => {
    await renderPage();
    search('0239110006909');
    await waitFor(() => expect(exactCalls()).toEqual(['0239110006909']), { timeout: 5000 });
    // Not coerced, not padded, not trimmed to a length.
    expect(typeof exactCalls()[0]).toBe('string');
  }, 20000);

  it.each(ODD_LENGTHS.map((m) => [m.meterNumber.length, m.meterNumber]))(
    'finds a %i-digit meter number exactly as stored',
    async (_len, meterNumber) => {
      await renderPage();
      search(meterNumber);
      const found = await screen.findByText(meterNumber, {}, { timeout: 5000 });
      expect(found.textContent).toBe(meterNumber);
      expect(exactCalls()).toEqual([meterNumber]);
    },
    20000
  );

  it('shows an empty result — not an error — when the meter does not exist', async () => {
    await renderPage();
    search('9999999999999');
    expect(await screen.findByText(/You searched for:/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  }, 20000);

  it('respects the active status filter on an exact hit', async () => {
    await renderPage();
    // The meter exists but is AVAILABLE; filtering to INSTALLED must not show it.
    fireEvent.change(screen.getAllByLabelText('Status')[0], { target: { value: 'INSTALLED' } });
    search(INVENTORY[4499].meterNumber);
    await waitFor(() => expect(exactCalls().length).toBe(1), { timeout: 5000 });
    expect(screen.queryByText(INVENTORY[4499].meterNumber)).toBeNull();
  }, 20000);

  it('falls back to scanning when the lookup endpoint itself fails', async () => {
    jedApi.getMeterByNumber.mockRejectedValue(new Error('SERVER_ERROR:boom'));
    await renderPage();
    const deep = INVENTORY[4499].meterNumber;
    search(deep);
    // Still found, via the paged scan — a broken lookup doesn't break search.
    expect(await screen.findByText(deep, {}, { timeout: 8000 })).toBeTruthy();
    expect(listCalls().length).toBeGreaterThan(0);
  }, 25000);

  it('restores the normal inventory when the search is cleared', async () => {
    await renderPage();
    const deep = INVENTORY[4499].meterNumber;
    search(deep);
    await screen.findByText(deep, {}, { timeout: 5000 });

    search('');
    await waitFor(() => expect(screen.getByText(INVENTORY[0].meterNumber)).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText(deep)).toBeNull();
  }, 20000);
});

// GET /meters/search (2026-09-24) replaced the paged scan for a digits
// partial. The scan survives only for a term no endpoint covers.
describe('Meter Schedule — a partial serial is a server-side search', () => {
  it('searches the whole inventory in one request instead of paging it', async () => {
    serveSearch(INVENTORY);
    await renderPage();
    const before = listCalls().length;
    search('006909'); // too short to be a meter number

    await waitFor(() => expect(searchCalls().length).toBe(1), { timeout: 8000 });
    expect(searchCalls()[0]).toMatchObject({ q: '006909' });
    // Neither the exact-lookup route nor the scan is used for this.
    expect(exactCalls()).toEqual([]);
    expect(listCalls().length).toBe(before);
  }, 25000);

  it('passes the active status/phase filters to the search rather than refiltering locally', async () => {
    serveSearch(INVENTORY);
    await renderPage();
    fireEvent.change(screen.getByLabelText(/Status/i), { target: { value: 'AVAILABLE' } });
    search('00690');

    await waitFor(() => expect(searchCalls().length).toBeGreaterThan(0), { timeout: 8000 });
    expect(searchCalls().at(-1)).toMatchObject({ q: '00690', status: 'AVAILABLE' });
  }, 25000);

  it('says the list is partial when there are more matches than one page', async () => {
    // 5,000 meters all sharing this prefix — far more than the search page.
    serveSearch(Array.from({ length: 5000 }, (_, i) => ({
      ...INVENTORY[0], id: i + 1, meterNumber: String(3390000000000 + i), simNumber: String(8923401000012345678n + BigInt(i)),
    })));
    await renderPage();
    search('33900000');
    expect(await screen.findByText(/some meters may be missing/, {}, { timeout: 10000 })).toBeTruthy();
  }, 30000);

  it('still scans for a make/model term, which no endpoint covers', async () => {
    serveSearch(INVENTORY);
    await renderPage();
    search('Hexing'); // not digits — no server-side search for this

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(1), { timeout: 8000 });
    expect(searchCalls()).toEqual([]);
    expect(exactCalls()).toEqual([]);
    jedApi.getMeters.mock.calls.forEach(([params]) => {
      expect(params).not.toHaveProperty('search');
      expect(params).not.toHaveProperty('q');
      expect(Object.keys(params).every((k) => ['page', 'limit', 'status', 'phaseType'].includes(k))).toBe(true);
    });
  }, 25000);
});
