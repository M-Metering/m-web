// @vitest-environment jsdom
// "Total collected payments" and "Revenue due to us" — one calculation each,
// the same figures on the Admin Dashboard, Payments page, Admin Reports and
// Installations page.
//
// DEFINITIONS (2026-09-28):
//   Total collected payments = the Pending (= Awaiting) Installations valued at
//     the configured meter-type prices: Σ over each qualifying record of its
//     own meter type's current price (totalCollectedPayment, meterPricing.js).
//   Revenue due to us = recognised revenue (GET /finance/revenue/transactions)
//     for completed installations (summarizeRevenueTransactions).
//
// Pinned here: the acceptance tests (mixed meter types, completing and adding
// an installation, a price change, pagination, cross-module equality), filters
// moving count and value together, a failure never reading ₦0, and the older
// guarantees (revenue due from the finance source; trend charts; no polling;
// financial data behind PAYMENTS.VIEW).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataRefreshProvider, useDataRefresh } from '../../contexts/DataRefreshContext';
import { summarizeRevenueTransactions } from '../../../utils/financeSummary';
import { formatCurrencyNGN } from '../../../utils/currency';
import AdminDashboard from '../AdminDashboard';
import PaymentsPage from '../PaymentsPage';
import InstallationRequests from '../InstallationRequests';
import ReportsOverview from '../ReportsOverview';
import jedApi from '../../services/api';

const ADMIN = {
  user: { id: 'u1', role: 'ADMIN' },
  isAdmin: true,
  isAdminRole: true,
  isSuperAdmin: false,
  canViewPayments: true,
  canViewReports: true,
  canViewInstallationRequests: true,
};

vi.mock('../../auth/usePermissions', () => ({ usePermissions: () => ADMIN }));
vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ user: ADMIN.user }),
}));
vi.mock('../../contexts/ThemeContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useTheme: () => ({ isDark: false, theme: 'light', toggleTheme: vi.fn() }),
}));
vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getAllCustomerRequests: vi.fn(),
    getDashboardStats: vi.fn(),
    getPayments: vi.fn(),
    getRevenueTransactions: vi.fn(),
    getDiscos: vi.fn(),
    getInstallations: vi.fn(),
    getInstallationStatistics: vi.fn(),
    getMeterTypes: vi.fn(),
  },
}));

// ---- Prices, configured in Settings → Meter Types (three active types).
let METER_TYPES;
const SINGLE = 100000;
const THREE = 150000;
const CT = 400000;

// ---- Installation records. Pending = JED PAID + imported PENDING/ASSIGNED/
// IN_PROGRESS/FAILED; everything else must contribute nothing.
let IMPORTED;
let JED;
const baseImported = () => [
  { id: 1, accountNumber: '1001', status: 'PENDING', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', createdAt: '2026-09-20T00:00:00Z' },
  { id: 2, accountNumber: '1002', status: 'ASSIGNED', meterType: 'THREE PHASE', discoCode: 'ABA_POWER', createdAt: '2026-09-21T00:00:00Z' },
  { id: 3, accountNumber: '1003', status: 'FAILED', meterType: 'Single Phase', discoCode: 'ABA_POWER', createdAt: '2026-09-22T00:00:00Z' },
  { id: 4, accountNumber: '1004', status: 'IN_PROGRESS', meterType: 'CT Operated', discoCode: 'ABA_POWER', createdAt: '2026-09-22T00:00:00Z' },
  { id: 5, accountNumber: '1005', status: 'INSTALLED', meterType: 'THREE PHASE', discoCode: 'ABA_POWER', createdAt: '2026-09-10T00:00:00Z' },
  { id: 6, accountNumber: '1006', status: 'CANCELLED', meterType: 'THREE PHASE', discoCode: 'ABA_POWER', createdAt: '2026-09-11T00:00:00Z' },
];
const baseJed = () => [
  // Paid 400,000 on record — but valued at its meter type's price, so the
  // payment record is never ALSO added (no double counting).
  { id: 12, accountNumber: '477014', status: 'PAID', meterType: 'Three Phase', amount: 400000, custNames: 'JED PAID', dateRequested: '2026-09-22T00:00:00Z' },
  { id: 13, accountNumber: '477015', status: 'COMPLETED', meterType: 'Single Phase', amount: 113500, custNames: 'JED DONE', dateRequested: '2026-09-02T00:00:00Z' },
  { id: 14, accountNumber: '477016', status: 'INITIATED', meterType: 'Single Phase', amount: 100000, custNames: 'JED UNPAID', dateRequested: '2026-09-25T00:00:00Z' },
];

// Independent expectation — computed here from the raw records and prices.
const PRICE_OF = () => Object.fromEntries(METER_TYPES.filter((t) => t.isActive).map((t) => [t.name.toUpperCase(), t.amount]));
const expectedCollected = () => {
  const price = PRICE_OF();
  const canon = (t) => (/three|3/i.test(t) ? 'THREE PHASE' : /single|1/i.test(t) ? 'SINGLE PHASE' : String(t).toUpperCase());
  const pending = [
    ...IMPORTED.filter((r) => ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'FAILED'].includes(r.status)),
    ...JED.filter((r) => r.status === 'PAID'),
  ];
  return pending.reduce((sum, r) => sum + price[canon(r.meterType)], 0);
};

// ---- Recognised revenue (for "Revenue due to us").
const TX = [
  { discoCode: 'ABA_POWER', source: 'installation_request', sourceId: 685, reference: '3705431479', customerName: 'IHESIABA C', meterType: 'THREE PHASE', amount: 2000000, amountMissing: false, isEstimated: true, sourceStatus: 'INSTALLED', revenueAt: '2026-09-20T10:00:00Z', dateBasis: 'reported_at' },
  { discoCode: 'ABA_POWER', source: 'installation_request', sourceId: 686, reference: '3705431480', customerName: 'OBI A', meterType: 'SINGLE PHASE', amount: 500000, amountMissing: false, isEstimated: false, sourceStatus: 'EXPORTED', revenueAt: '2026-09-21T10:00:00Z', dateBasis: 'reported_at' },
  { discoCode: 'JED001', source: 'jed_customer_request', sourceId: 12, reference: '477014', customerName: 'JED PAID', meterType: 'THREE PHASE', amount: 400000, amountMissing: false, isEstimated: false, sourceStatus: 'PAID', revenueAt: '2026-09-22T10:00:00Z', dateBasis: 'date_paid' },
  { discoCode: 'JED001', source: 'jed_customer_request', sourceId: 13, reference: '477015', customerName: 'JED DONE', meterType: 'SINGLE PHASE', amount: 113500, amountMissing: false, isEstimated: false, sourceStatus: 'COMPLETED', revenueAt: '2026-09-23T10:00:00Z', dateBasis: 'date_completed' },
  { discoCode: 'ABA_POWER', source: 'installation_request', sourceId: 700, reference: '3705431499', customerName: 'NO PRICE', meterType: 'SINGLE PHASE', amount: 0, amountMissing: true, isEstimated: null, sourceStatus: 'INSTALLED', revenueAt: '2026-09-24T10:00:00Z', dateBasis: 'reported_at' },
];
const META = { currency: 'NGN', totals: { amount: 3013500, count: 5, estimatedAmount: 2000000, estimatedCount: 1, missingAmountCount: 1 } };
const txResponse = (rows, meta = META) => ({
  success: true, data: rows, meta,
  pagination: { currentPage: 1, totalPages: 1, totalCount: meta?.totals?.count ?? rows.length, hasNext: false },
});
const REVENUE_DUE = summarizeRevenueTransactions(TX, META.totals).revenueDue; // 2,613,500

const count = (list, s) => list.filter((r) => r.status === s).length;
// Paged like the API: `limit` rows per page with the server's totalCount.
const paged = (rows, { page = 1, limit = 10 } = {}) => ({
  success: true,
  data: rows.slice((page - 1) * limit, page * limit),
  pagination: { currentPage: page, totalPages: Math.max(1, Math.ceil(rows.length / limit)), totalCount: rows.length },
});

beforeEach(() => {
  vi.clearAllMocks();
  ADMIN.canViewPayments = true;
  METER_TYPES = [
    { id: 1, name: 'Single Phase', amount: SINGLE, isActive: true },
    { id: 2, name: 'Three Phase', amount: THREE, isActive: true },
    { id: 3, name: 'CT Operated', amount: CT, isActive: true },
  ];
  IMPORTED = baseImported();
  JED = baseJed();
  jedApi.getMeterTypes.mockImplementation(async (p = {}) => paged(METER_TYPES, { ...p, limit: 100 }));
  jedApi.getInstallations.mockImplementation(async (p = {}) => paged(p.status ? IMPORTED.filter((r) => r.status === p.status) : IMPORTED, p));
  jedApi.getAllCustomerRequests.mockImplementation(async (p = {}) => paged(p.status ? JED.filter((r) => r.status === p.status) : JED, p));
  jedApi.getInstallationStatistics.mockImplementation(async () => ({
    success: true,
    data: {
      total: IMPORTED.length, pending: count(IMPORTED, 'PENDING'), assigned: count(IMPORTED, 'ASSIGNED'),
      inProgress: count(IMPORTED, 'IN_PROGRESS'), failed: count(IMPORTED, 'FAILED'), installed: count(IMPORTED, 'INSTALLED'),
      exported: count(IMPORTED, 'EXPORTED'), cancelled: count(IMPORTED, 'CANCELLED'),
    },
  }));
  jedApi.getPayments.mockResolvedValue(paged([]));
  jedApi.getRevenueTransactions.mockImplementation(async (p = {}) => (p.from ? txResponse([], { totals: { amount: 0, count: 0 } }) : txResponse(TX)));
  jedApi.getDiscos.mockResolvedValue(paged([{ code: 'ABA_POWER', name: 'Aba Power' }]));
  jedApi.getDashboardStats.mockResolvedValue({
    success: true,
    data: { pendingRequests: 0, completedRequests: 0, activeInstallers: 11, totalRevenue: 999999 },
  });
});

afterEach(cleanup);

const Trigger = () => {
  const { notifyDataChanged } = useDataRefresh();
  return <button type="button" onClick={notifyDataChanged}>fire refresh</button>;
};
const wrap = (ui) => <MemoryRouter><DataRefreshProvider><Trigger />{ui}</DataRefreshProvider></MemoryRouter>;
const renderDashboard = () => render(wrap(<AdminDashboard />));

const metricValue = async (label) => {
  const heading = await screen.findByText(label, {}, { timeout: 10000 });
  await waitFor(() => expect(heading.nextElementSibling?.textContent?.trim()).toBeTruthy(), { timeout: 10000 });
  return heading.nextElementSibling?.textContent?.trim();
};
const collected = () => metricValue('Total collected payments');
const refresh = () => fireEvent.click(screen.getByRole('button', { name: 'fire refresh' }));

describe('Total collected payments = pending installations at meter-type prices', () => {
  it('Test 4 — mixed meter types: Σ each record’s own price, not count × one price', async () => {
    renderDashboard();
    // 1001 single, 1002 three, 1003 single (failed), 1004 CT, JED PAID three.
    const expected = 2 * SINGLE + 2 * THREE + 1 * CT;
    expect(expectedCollected()).toBe(expected);
    expect(await collected()).toBe(formatCurrencyNGN(expected));
    expect(expected).not.toBe(5 * SINGLE);
    // A third supported type is priced from its own configured price.
    expect(await screen.findByText(/1 CT Operated × .*400,000/)).toBeTruthy();
    // The count beside it is the same population.
    expect(screen.getByText('5 pending installations:')).toBeTruthy();
  }, 30000);

  it('values a paid JED request at its meter price, never adding its payment record too', async () => {
    JED = JED.filter((r) => r.status === 'PAID'); // recorded 400,000
    IMPORTED = [];
    renderDashboard();
    expect(await collected()).toBe(formatCurrencyNGN(THREE));
  }, 30000);

  it('Test 2 / Test 3 — completing one lowers it by that meter’s price; adding one raises it', async () => {
    renderDashboard();
    const start = expectedCollected();
    expect(await collected()).toBe(formatCurrencyNGN(start));

    IMPORTED.find((r) => r.accountNumber === '1002').status = 'INSTALLED'; // a Three Phase job completes
    refresh();
    await waitFor(async () => expect(await collected()).toBe(formatCurrencyNGN(start - THREE)), { timeout: 10000 });

    IMPORTED.push({ id: 9, accountNumber: '1009', status: 'PENDING', meterType: 'SINGLE PHASE', discoCode: 'ABA_POWER', createdAt: '2026-09-27T00:00:00Z' });
    refresh();
    await waitFor(async () => expect(await collected()).toBe(formatCurrencyNGN(start - THREE + SINGLE)), { timeout: 10000 });
  }, 40000);

  it('follows a meter price change with no code change', async () => {
    renderDashboard();
    await collected();
    METER_TYPES = METER_TYPES.map((t) => (t.name === 'Single Phase' ? { ...t, amount: 120000 } : t));
    refresh();
    await waitFor(async () => expect(await collected()).toBe(formatCurrencyNGN(expectedCollected())), { timeout: 10000 });
    expect(expectedCollected()).toBe(2 * 120000 + 2 * THREE + CT);
  }, 30000);

  it('Test 5 — pagination: every pending record counts, not one page', async () => {
    IMPORTED = Array.from({ length: 19 }, (_, i) => ({
      id: 100 + i, accountNumber: `19${i}`, status: 'ASSIGNED', meterType: i < 14 ? 'SINGLE PHASE' : 'THREE PHASE',
      discoCode: 'ABA_POWER', createdAt: '2026-09-26T00:00:00Z',
    }));
    JED = [];
    // Every read of the installations list is served 10 rows per page.
    jedApi.getInstallations.mockImplementation(async (p = {}) =>
      paged(p.status ? IMPORTED.filter((r) => r.status === p.status) : IMPORTED, { ...p, limit: Math.min(p.limit || 10, 10) }));
    renderDashboard();
    expect(await collected()).toBe(formatCurrencyNGN(14 * SINGLE + 5 * THREE));
    expect(screen.getByText('19 pending installations:')).toBeTruthy();
  }, 30000);

  it('a genuine zero is ₦0; a failure is "Unavailable" with a message — never ₦0', async () => {
    IMPORTED = [];
    JED = [];
    const view = render(wrap(<AdminDashboard />));
    expect(await collected()).toBe(formatCurrencyNGN(0));
    view.unmount();

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    jedApi.getMeterTypes.mockRejectedValue(new Error('SERVER_ERROR:db down'));
    renderDashboard();
    expect(await collected()).toBe('Unavailable');
    expect(screen.getByText('Unable to load payment data.')).toBeTruthy();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  }, 30000);
});

describe('Test 6 — the same figures on every screen', () => {
  const figures = async (ui) => {
    const view = render(wrap(ui));
    const out = { collected: await collected(), due: await metricValue('Revenue due to us') };
    view.unmount();
    return out;
  };

  it('Dashboard = Payments = Reports = Installations (All discos)', async () => {
    const expected = { collected: formatCurrencyNGN(expectedCollected()), due: formatCurrencyNGN(REVENUE_DUE) };
    expect(await figures(<AdminDashboard />)).toEqual(expected);
    expect(await figures(<PaymentsPage />)).toEqual(expected);
    expect(await figures(<ReportsOverview />)).toEqual(expected);
    expect(await figures(<InstallationRequests />)).toEqual(expected);
  }, 60000);

  it('on the Installations page, a filter moves the count and the value together', async () => {
    render(wrap(<InstallationRequests />));
    expect(await collected()).toBe(formatCurrencyNGN(expectedCollected()));
    // Meter type = Three Phase: the ASSIGNED job + the paid JED request.
    const meterType = await screen.findByLabelText(/^Meter type/);
    fireEvent.change(meterType, { target: { value: 'THREE PHASE' } });
    await waitFor(async () => expect(await collected()).toBe(formatCurrencyNGN(2 * THREE)), { timeout: 10000 });
    const tile = screen.getByRole('button', { name: /Pending installations$/ });
    expect(tile.querySelector('p').textContent).toBe('2');
  }, 30000);
});

describe('Revenue due comes from the recognised-revenue records', () => {
  it('reads GET /finance/revenue/transactions and counts completed installations only', async () => {
    renderDashboard();
    expect(await metricValue('Revenue due to us')).toBe(formatCurrencyNGN(REVENUE_DUE));
    expect(REVENUE_DUE).toBe(2613500);
    expect(jedApi.getPayments).not.toHaveBeenCalled();
  }, 30000);

  it('reads every revenue page', async () => {
    jedApi.getRevenueTransactions.mockImplementation(async ({ page: n, from }) => {
      if (from) return txResponse([], { totals: { amount: 0, count: 0 } });
      const rows = n === 1 ? TX.slice(0, 3) : TX.slice(3);
      return { success: true, data: rows, meta: META, pagination: { currentPage: n, totalPages: 2, totalCount: 5 } };
    });
    renderDashboard();
    expect(await metricValue('Revenue due to us')).toBe(formatCurrencyNGN(REVENUE_DUE));
  }, 30000);

  it('withholds revenue due, rather than undercounting, when not every record loaded', async () => {
    jedApi.getRevenueTransactions.mockImplementation(async (p = {}) => (p.from
      ? txResponse([], { totals: { amount: 0, count: 0 } })
      : txResponse(TX, { totals: { ...META.totals, count: 29 } })));
    renderDashboard();
    expect(await metricValue('Revenue due to us')).toBe('Unavailable');
  }, 30000);

  it('a revenue failure is an error state, never ₦0', async () => {
    jedApi.getRevenueTransactions.mockRejectedValue(new Error('SERVER_ERROR: relation "finance_revenue" does not exist'));
    renderDashboard();
    expect(await metricValue('Revenue due to us')).toBe('Unavailable');
    expect(screen.getByText('Unable to load revenue data.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/relation|does not exist/);
  }, 30000);
});

describe('Trend charts read the recognised-revenue records', () => {
  it('builds both series from the revenue records, not from JED payments', async () => {
    renderDashboard();
    await waitFor(() => expect(jedApi.getRevenueTransactions.mock.calls.some(([p]) => p.from && p.to)).toBe(true));
    expect(jedApi.getPayments).not.toHaveBeenCalled();
  }, 30000);

  it('asks for a window whose end is exclusive, so today is included', async () => {
    renderDashboard();
    await waitFor(() => expect(jedApi.getRevenueTransactions.mock.calls.some(([p]) => p.from && p.to)).toBe(true));
    const [{ from, to }] = jedApi.getRevenueTransactions.mock.calls.map(([p]) => p).filter((p) => p.from && p.to);
    expect(new Date(to).getTime()).toBeGreaterThan(Date.now());
    expect(Math.round((new Date(to) - new Date(from)) / 86400000)).toBe(30);
  }, 30000);
});

describe('Dashboard labels and refresh', () => {
  it('renders no generic "Revenue" label and never shows /dashboard-stats.totalRevenue', async () => {
    renderDashboard();
    await collected();
    expect(screen.queryByText('Revenue')).toBeNull();
    expect(screen.queryByText(formatCurrencyNGN(999999))).toBeNull();
    expect(await screen.findByText('Payment & Revenue Summary')).toBeTruthy();
  }, 30000);

  it('re-reads on the app-wide refresh, and never on a timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderDashboard();
      await waitFor(() => expect(jedApi.getMeterTypes).toHaveBeenCalled(), { timeout: 10000 });
      const initial = jedApi.getMeterTypes.mock.calls.length;
      await vi.advanceTimersByTimeAsync(120000);
      expect(jedApi.getMeterTypes.mock.calls.length).toBe(initial);
      refresh();
      await waitFor(() => expect(jedApi.getMeterTypes.mock.calls.length).toBeGreaterThan(initial), { timeout: 10000 });
    } finally {
      vi.useRealTimers();
    }
  }, 30000);
});

describe('Financial data stays behind PAYMENTS.VIEW', () => {
  it('renders nothing and requests no money for a role without access', async () => {
    ADMIN.canViewPayments = false;
    renderDashboard();
    await screen.findByText('Pending Installations', {}, { timeout: 10000 });
    expect(screen.queryByText('Total collected payments')).toBeNull();
    expect(jedApi.getRevenueTransactions).not.toHaveBeenCalled();
    expect(jedApi.getMeterTypes).not.toHaveBeenCalled();
    const card = screen.getByText('Pending Installations').closest('.card');
    expect(within(card).queryByText(/₦/)).toBeNull();
  }, 30000);
});
