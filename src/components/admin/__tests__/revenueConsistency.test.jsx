// @vitest-environment jsdom
// The Admin Dashboard's money figures: that they come from the source that
// actually holds the revenue, that they equal the Payments page's Revenue tab,
// and that a failure never renders as ₦0.
//
// THE BUG THIS FILE EXISTS FOR (2026-09-26). The dashboard showed ₦0 next to a
// Revenue tab reading ₦3,013,500 across 29 records. Two sources were tried and
// both were wrong in a way that produced a confident zero rather than an error:
//
//   GET /external/jed/requests   every request, including INITIATED ones never
//                                paid — the wrong question.
//   GET /external/jed/payments   the right question for the JED/Remita flow,
//                                but that flow is EMPTY here: zero records.
//   GET /finance/revenue/*       recognised revenue across BOTH installation
//                                domains. The money is here.
//
// So the regression these tests defend is specifically: *the dashboard must
// not read a JED-only endpoint*, and it must equal the Revenue tab's totals.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataRefreshProvider, useDataRefresh } from '../../contexts/DataRefreshContext';
import { summarizeRevenueTransactions } from '../../../utils/financeSummary';
import { formatCurrencyNGN } from '../../../utils/currency';
import AdminDashboard from '../AdminDashboard';
import jedApi from '../../services/api';

const ADMIN = {
  user: { id: 'u1', role: 'ADMIN' },
  isAdmin: true,
  isAdminRole: true,
  isSuperAdmin: false,
  canViewPayments: true,
  canViewReports: true,
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
  },
}));

const page = (data) => ({
  success: true,
  data,
  pagination: { currentPage: 1, totalPages: 1, totalCount: data.length, hasNext: false },
});

// GET /finance/revenue/transactions, in the documented shape. Mixed on purpose:
// an Aba row recognised on installation completion, a JED row only PAID (money
// collected, NOT yet due), a JED row COMPLETED, and an unpriced record.
const TX = [
  { discoCode: 'ABA_POWER', source: 'installation_request', sourceId: 685, reference: '3705431479', customerName: 'IHESIABA C', meterType: 'THREE PHASE', amount: 2000000, amountMissing: false, isEstimated: true, sourceStatus: 'INSTALLED', revenueAt: '2026-09-20T10:00:00Z', dateBasis: 'reported_at' },
  { discoCode: 'ABA_POWER', source: 'installation_request', sourceId: 686, reference: '3705431480', customerName: 'OBI A', meterType: 'SINGLE PHASE', amount: 500000, amountMissing: false, isEstimated: false, sourceStatus: 'EXPORTED', revenueAt: '2026-09-21T10:00:00Z', dateBasis: 'reported_at' },
  { discoCode: 'JED001', source: 'jed_customer_request', sourceId: 12, reference: '477014', customerName: 'JED PAID', meterType: 'THREE PHASE', amount: 400000, amountMissing: false, isEstimated: false, sourceStatus: 'PAID', revenueAt: '2026-09-22T10:00:00Z', dateBasis: 'date_paid' },
  { discoCode: 'JED001', source: 'jed_customer_request', sourceId: 13, reference: '477015', customerName: 'JED DONE', meterType: 'SINGLE PHASE', amount: 113500, amountMissing: false, isEstimated: false, sourceStatus: 'COMPLETED', revenueAt: '2026-09-23T10:00:00Z', dateBasis: 'date_completed' },
  { discoCode: 'ABA_POWER', source: 'installation_request', sourceId: 700, reference: '3705431499', customerName: 'NO PRICE', meterType: 'SINGLE PHASE', amount: 0, amountMissing: true, isEstimated: null, sourceStatus: 'INSTALLED', revenueAt: '2026-09-24T10:00:00Z', dateBasis: 'reported_at' },
];

// meta.totals covers the whole filtered set — the server's own aggregate.
const META = {
  currency: 'NGN',
  totals: { amount: 3013500, count: 29, estimatedAmount: 2000000, estimatedCount: 1, missingAmountCount: 1 },
};

const txResponse = (rows, meta = META) => ({
  success: true,
  data: rows,
  meta,
  pagination: { currentPage: 1, totalPages: 1, totalCount: meta?.totals?.count ?? rows.length, hasNext: false },
});

// The authoritative answer, from the shared calculation — never hand-written.
const ORACLE = summarizeRevenueTransactions(TX, META.totals);

beforeEach(() => {
  vi.clearAllMocks();
  jedApi.getAllCustomerRequests.mockResolvedValue(page([]));
  jedApi.getPayments.mockResolvedValue(page([]));
  jedApi.getRevenueTransactions.mockResolvedValue(txResponse(TX));
  jedApi.getDashboardStats.mockResolvedValue({
    success: true,
    data: { pendingRequests: 0, completedRequests: 0, activeInstallers: 11, totalRevenue: 999999 },
  });
});

afterEach(cleanup);

const wrap = (ui) => <MemoryRouter><DataRefreshProvider>{ui}</DataRefreshProvider></MemoryRouter>;
const renderDashboard = () => render(wrap(<AdminDashboard />));

const metricValue = async (label) => {
  const heading = await screen.findByText(label, {}, { timeout: 10000 });
  return heading.nextElementSibling?.textContent?.trim();
};

describe('Revenue comes from the source that holds the money', () => {
  it('reads GET /finance/revenue/transactions, the Revenue tab’s own source', async () => {
    renderDashboard();
    await metricValue('Total collected payments');

    expect(jedApi.getRevenueTransactions).toHaveBeenCalled();
    // No full read of the request list for totals — only the 5-row
    // "Recent Installations" list may touch that endpoint.
    const requestReads = jedApi.getAllCustomerRequests.mock.calls.map(([p]) => p);
    requestReads.forEach((p) => expect(p.limit).toBe(5));
  }, 30000);

  it('shows real money even though the JED payment endpoints are empty', async () => {
    // This IS the reported bug, pinned: every JED-flow source returns nothing
    // in this deployment, and the figures must still be right. If someone
    // repoints them at a JED-only endpoint, this fails immediately.
    jedApi.getPayments.mockResolvedValue(page([]));
    jedApi.getAllCustomerRequests.mockResolvedValue(page([]));
    renderDashboard();

    expect(await metricValue('Total collected payments')).toBe(formatCurrencyNGN(3013500));
    expect(await metricValue('Revenue due to us')).toBe(formatCurrencyNGN(2613500));
  }, 30000);

  it('shows real money, not ₦0, when revenue records exist', async () => {
    renderDashboard();
    expect(await metricValue('Total collected payments')).not.toBe('NGN 0');
    expect(await metricValue('Total collected payments')).toBe(formatCurrencyNGN(ORACLE.collected));
  }, 30000);

  it('takes collected from the server’s whole-set total, matching the Revenue tab', async () => {
    renderDashboard();
    // meta.totals.amount — the same figure the Revenue tab renders, not a
    // client re-add of the rows on this page.
    expect(await metricValue('Total collected payments')).toBe(formatCurrencyNGN(3013500));
    expect(await screen.findByText(/29 records counted/)).toBeTruthy();
  }, 30000);

  it('counts only completed installations toward revenue due', async () => {
    renderDashboard();
    // INSTALLED 2,000,000 + EXPORTED 500,000 + JED COMPLETED 113,500.
    // The JED PAID row is collected but NOT due — the business rule, unchanged.
    expect(ORACLE.revenueDue).toBe(2613500);
    expect(await metricValue('Revenue due to us')).toBe(formatCurrencyNGN(2613500));
  }, 30000);

  it('excludes a paid-but-not-installed record from revenue due', async () => {
    jedApi.getRevenueTransactions.mockResolvedValue(txResponse(
      [TX[2]], // the JED PAID row only
      { totals: { amount: 400000, count: 1 } }
    ));
    renderDashboard();

    expect(await metricValue('Total collected payments')).toBe(formatCurrencyNGN(400000));
    expect(await metricValue('Revenue due to us')).toBe(formatCurrencyNGN(0));
  }, 30000);

  it('never reports revenue due above collected', async () => {
    renderDashboard();
    const toNumber = (t) => Number(String(t).replace(/[^0-9.]/g, ''));
    expect(toNumber(await metricValue('Revenue due to us')))
      .toBeLessThanOrEqual(toNumber(await metricValue('Total collected payments')));
  }, 30000);

  it('carries the estimated/unpriced caveat, so the total is never shown as exact', async () => {
    renderDashboard();
    await metricValue('Total collected payments');
    expect(screen.getByText(/1 record completed with no price recorded/)).toBeTruthy();
  }, 30000);
});

// The charts had the same root cause as the figures: a JED-only source that
// returns nothing here, so both panels rendered blank.
describe('Trend charts read the same source as the figures', () => {
  it('builds both series from the revenue records, not from JED payments', async () => {
    renderDashboard();
    await metricValue('Total collected payments');
    await waitFor(() => expect(jedApi.getRevenueTransactions.mock.calls.length).toBeGreaterThan(1));

    expect(jedApi.getPayments).not.toHaveBeenCalled();
    // The windowed read is the trend's: a from/to range, unlike the totals'
    // unfiltered read.
    const windowed = jedApi.getRevenueTransactions.mock.calls
      .map(([p]) => p)
      .filter((p) => p.from && p.to);
    expect(windowed.length).toBeGreaterThan(0);
  }, 30000);

  it('asks for a window whose end is exclusive, so today is included', async () => {
    renderDashboard();
    await waitFor(() => expect(
      jedApi.getRevenueTransactions.mock.calls.some(([p]) => p.from && p.to)
    ).toBe(true));

    const [{ from, to }] = jedApi.getRevenueTransactions.mock.calls
      .map(([p]) => p)
      .filter((p) => p.from && p.to);
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // `to` is exclusive on the finance endpoints, so it must be after today.
    expect(new Date(to).getTime()).toBeGreaterThan(Date.now());
    // 30 days is the dashboard's default range.
    const spanDays = Math.round((new Date(to) - new Date(from)) / 86400000);
    expect(spanDays).toBe(30);
  }, 30000);

  it('renders the charts rather than leaving them blank when revenue exists', async () => {
    renderDashboard();
    expect(await screen.findByText('Collected payments')).toBeTruthy();
    expect(await screen.findByText('Installations Completed')).toBeTruthy();
    // The empty-state copy must NOT be showing — that was the reported symptom.
    await waitFor(() => {
      expect(screen.queryByText('No payments recorded in this range.')).toBeNull();
    });
  }, 30000);
});

describe('Zero and failure are different things', () => {
  it('a successful read with no records shows ₦0 and says so', async () => {
    jedApi.getRevenueTransactions.mockResolvedValue(txResponse([], { totals: { amount: 0, count: 0 } }));
    renderDashboard();

    expect(await metricValue('Total collected payments')).toBe(formatCurrencyNGN(0));
    expect(await metricValue('Revenue due to us')).toBe(formatCurrencyNGN(0));
    expect(await screen.findByText(/No revenue recorded yet/)).toBeTruthy();
  }, 30000);

  it('an API failure is an error state, never ₦0', async () => {
    jedApi.getRevenueTransactions.mockRejectedValue(
      new Error('SERVER_ERROR: relation "finance_revenue" does not exist')
    );
    renderDashboard();

    const alert = await screen.findByRole('alert', {}, { timeout: 10000 });
    expect(within(alert).getByText("Couldn't load revenue totals.")).toBeTruthy();
    // No figure is rendered at all on failure.
    expect(screen.queryByText('Total collected payments')).toBeNull();
    expect(alert.textContent).not.toMatch(/relation|SERVER_ERROR|does not exist/);
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
  }, 30000);
});

describe('The ambiguous Revenue KPI is gone', () => {
  it('renders no generic "Revenue" label anywhere on the dashboard', async () => {
    renderDashboard();
    await metricValue('Total collected payments');

    expect(screen.queryByText('Revenue')).toBeNull();
    // ...and /dashboard-stats.totalRevenue is not displayed under any label.
    expect(screen.queryByText(formatCurrencyNGN(999999))).toBeNull();
  }, 30000);

  it('still reads GET /dashboard-stats for the operational KPIs', async () => {
    renderDashboard();
    expect(await screen.findByText('Installers')).toBeTruthy();
    expect(jedApi.getDashboardStats).toHaveBeenCalled();
  }, 30000);

  it('labels the section so it cannot be mistaken for the old KPI', async () => {
    renderDashboard();
    expect(await screen.findByText('Payment & Revenue Summary')).toBeTruthy();
  }, 30000);
});

describe('refreshSignal, and no polling', () => {
  const Trigger = () => {
    const { notifyDataChanged } = useDataRefresh();
    return <button type="button" onClick={notifyDataChanged}>fire refresh</button>;
  };

  it('re-reads on the app-wide refresh, and never on a timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(wrap(<><Trigger /><AdminDashboard /></>));
      await waitFor(() => expect(jedApi.getRevenueTransactions).toHaveBeenCalled(), { timeout: 10000 });
      const initial = jedApi.getRevenueTransactions.mock.calls.length;

      await vi.advanceTimersByTimeAsync(120000);
      expect(jedApi.getRevenueTransactions.mock.calls.length).toBe(initial);

      fireEvent.click(screen.getByRole('button', { name: 'fire refresh' }));
      await waitFor(
        () => expect(jedApi.getRevenueTransactions.mock.calls.length).toBeGreaterThan(initial),
        { timeout: 10000 }
      );
    } finally {
      vi.useRealTimers();
    }
  }, 30000);
});

describe('Financial data stays behind the existing permission', () => {
  it('renders nothing and requests no revenue for a role without access', async () => {
    ADMIN.canViewPayments = false;
    try {
      renderDashboard();
      await screen.findByText('Pending', {}, { timeout: 10000 });

      expect(screen.queryByText('Total collected payments')).toBeNull();
      expect(screen.queryByText('Payment & Revenue Summary')).toBeNull();
      // /finance/* is 403 for Supervisor and Installer — so it isn't asked.
      expect(jedApi.getRevenueTransactions).not.toHaveBeenCalled();
      expect(jedApi.getPayments).not.toHaveBeenCalled();
    } finally {
      ADMIN.canViewPayments = true;
    }
  }, 30000);
});
