// @vitest-environment jsdom
// The Admin Dashboard's installation KPIs and Recent Installations, against a
// mocked jedApi in the documented shapes. The rules pinned here:
//   - Pending/Completed come from server aggregates, never from the recent rows;
//   - Pending and Awaiting are ONE population and one figure (JED PAID +
//     imported PENDING/ASSIGNED/IN_PROGRESS/FAILED); payment alone is never
//     completed;
//   - "recent" is newest by request date whatever order the server pages in;
//   - a failure is "Unavailable", never 0; a real zero is 0 with an empty state;
//   - the Pending card carries no money (value analysis is Admin Reports').
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataRefreshProvider, useDataRefresh } from '../../contexts/DataRefreshContext';
import { formatCurrencyNGN } from '../../../utils/currency';
import AdminDashboard from '../AdminDashboard';
import jedApi from '../../services/api';
import { downloadXlsx, downloadServerXlsx } from '../../../utils/xlsx';

let permissions;
vi.mock('../../auth/usePermissions', () => ({ usePermissions: () => permissions }));
vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ user: { id: 'u1', role: 'ADMIN' } }),
}));
vi.mock('../../contexts/ThemeContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useTheme: () => ({ isDark: false, theme: 'light', toggleTheme: vi.fn() }),
}));
vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getAllCustomerRequests: vi.fn(),
    getInstallations: vi.fn(),
    getInstallationStatistics: vi.fn(),
    getDashboardStats: vi.fn(),
    getUsers: vi.fn(),
    getRevenueTransactions: vi.fn(),
    getMeterTypes: vi.fn(),
    exportMeters: vi.fn(),
    exportCustomerRequests: vi.fn(),
    exportJedRequests: vi.fn(),
  },
}));
vi.mock('../../../utils/xlsx', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadXlsx: vi.fn(async () => {}),
  downloadServerXlsx: vi.fn(async () => {}),
}));

const ADMIN = { isAdmin: true, canViewPayments: true, canViewReports: true };
const SUPERVISOR = {
  isAdmin: false, isSupervisor: true, canViewPayments: false, canViewReports: false,
  canViewAllInstallations: true, canViewAssignments: true, canViewInstallerStatus: true,
};

const STATS = { total: 31, pending: 10, assigned: 5, inProgress: 2, failed: 1, installed: 7, exported: 3, cancelled: 3 };
const JED_COUNTS = { PAID: 2, COMPLETED: 4, INITIATED: 9 };

// 25 JED requests the server pages OLDEST first (ascending), 10 per page —
// so page 1 holds the oldest and a naive "first 5" would be wrong.
const JED_ROWS = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  accountNumber: `4770${String(i + 1).padStart(2, '0')}`,
  custNames: `JED CUSTOMER ${i + 1}`,
  status: i % 2 ? 'PAID' : 'COMPLETED',
  amount: 67000,
  dateRequested: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
}));
const IMPORTED = [
  { id: 900, accountNumber: '3705431499', customerName: 'NEWEST IMPORT', discoCode: 'ABA_POWER', status: 'ASSIGNED', meterType: 'THREE PHASE', assigneeName: 'Musa Bello', createdAt: '2026-09-27T08:00:00Z' },
];

const pageOf = (rows, page, limit) => ({
  success: true,
  data: rows.slice((page - 1) * limit, page * limit),
  pagination: { currentPage: page, totalPages: Math.max(1, Math.ceil(rows.length / limit)), totalCount: rows.length },
});

let revenueRows;
beforeEach(() => {
  vi.clearAllMocks();
  permissions = { ...ADMIN };
  revenueRows = [
    { source: 'jed_customer_request', sourceId: 2, reference: '477002', amount: 67000, sourceStatus: 'PAID' },
    { source: 'jed_customer_request', sourceId: 2, reference: '477002', amount: 67000, sourceStatus: 'PAID' }, // repeated
    { source: 'jed_customer_request', sourceId: 1, reference: '477001', amount: 67000, sourceStatus: 'COMPLETED' },
  ];
  jedApi.getInstallationStatistics.mockResolvedValue({ success: true, data: STATS });
  jedApi.getAllCustomerRequests.mockImplementation(async ({ status, page = 1, limit = 10 }) => {
    if (status) return { success: true, data: JED_ROWS.slice(0, 1), pagination: { currentPage: 1, totalPages: JED_COUNTS[status], totalCount: JED_COUNTS[status] } };
    return pageOf(JED_ROWS, page, limit);
  });
  jedApi.getInstallations.mockImplementation(async ({ page = 1, limit = 10 }) => pageOf(IMPORTED, page, limit));
  jedApi.getDashboardStats.mockResolvedValue({ success: true, data: { pendingRequests: 0, completedRequests: 0, activeInstallers: 11, totalRevenue: 0 } });
  jedApi.getRevenueTransactions.mockImplementation(async ({ from }) => (from
    ? { success: true, data: [], meta: { totals: { amount: 0, count: 0 } }, pagination: { totalPages: 1 } }
    : { success: true, data: revenueRows, meta: { totals: { amount: 134000, count: 2 } }, pagination: { totalPages: 1, totalCount: 2 } }));
});
afterEach(cleanup);

const renderDashboard = (extra = null) => render(
  <MemoryRouter><DataRefreshProvider>{extra}<AdminDashboard /></DataRefreshProvider></MemoryRouter>
);
const card = (title) => screen.getByText(title).closest('.card');
const kpi = async (title) => {
  await waitFor(() => expect(within(card(title)).queryByText(/Loading/)).toBeNull(), { timeout: 5000 });
  return within(card(title)).getByText(title).nextElementSibling.textContent.trim();
};

describe('Installation KPIs', () => {
  it('Pending = Awaiting, one figure from the server aggregates across both domains', async () => {
    renderDashboard();
    // JED PAID 2 + imported PENDING 10 + ASSIGNED 5 + IN_PROGRESS 2 + FAILED 1.
    expect(await kpi('Pending Installations')).toBe('20');
    const c = card('Pending Installations');
    expect(within(c).getByText(/Awaiting installation:/).textContent).toBe('Awaiting installation: 20');
    expect(c.textContent).toMatch(/7 with installers · 10 not yet\s*assigned · 1 after a failed attempt · 2 paid JED/);
    // Completed = JED COMPLETED 4 + imported INSTALLED 7 + EXPORTED 3.
    expect(await kpi('Completed Installations')).toBe('14');
    expect(within(card('Completed Installations')).getByText(/9 awaiting payment, 3 cancelled/)).toBeTruthy();
    expect(jedApi.getInstallationStatistics).toHaveBeenCalled();
    // The JED counts are the server's totalCount for each status — one row each.
    ['PAID', 'COMPLETED', 'INITIATED'].forEach((status) => {
      expect(jedApi.getAllCustomerRequests).toHaveBeenCalledWith({ status, page: 1, limit: 1 });
    });
  });

  it('never derives a total from the recent rows', async () => {
    renderDashboard();
    await kpi('Pending Installations');
    // No read is large enough to be a scan of the requests.
    // Counts are limit-1 totalCount reads and the recent card reads edge
    // pages. The only large reads are Total collected payments' valuation,
    // and it reads ONLY pending statuses — never completed or cancelled.
    const PENDING = ['PAID', 'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'FAILED'];
    [...jedApi.getAllCustomerRequests.mock.calls, ...jedApi.getInstallations.mock.calls]
      .map(([p]) => p)
      .filter((p) => p.limit > 10)
      .forEach((p) => expect(PENDING).toContain(p.status));
    // /dashboard-stats' undefined 0/0 no longer drives the KPIs.
    expect(await kpi('Pending Installations')).not.toBe('0');
  });

  it('keeps the Pending card a count — its money is Total collected payments, in the payment panel', async () => {
    renderDashboard();
    await kpi('Pending Installations');
    expect(within(card('Pending Installations')).queryByText(/₦|NGN|Amount paid|value/i)).toBeNull();
  });

  it('a failed read is "Unavailable", never 0', async () => {
    jedApi.getInstallationStatistics.mockRejectedValue(new Error('SERVER_ERROR:boom'));
    renderDashboard();
    expect(await kpi('Pending Installations')).toMatch(/Unavailable/);
    expect(await kpi('Completed Installations')).toMatch(/Unavailable/);
    // The rest of the dashboard still renders.
    expect(await screen.findByText('Recent Installations')).toBeTruthy();
  });

  it('a genuinely empty system shows 0 and an empty recent list', async () => {
    jedApi.getInstallationStatistics.mockResolvedValue({ success: true, data: { total: 0, pending: 0, assigned: 0, inProgress: 0, failed: 0, installed: 0, exported: 0, cancelled: 0 } });
    jedApi.getAllCustomerRequests.mockImplementation(async () => ({ success: true, data: [], pagination: { totalPages: 0, totalCount: 0 } }));
    jedApi.getInstallations.mockResolvedValue({ success: true, data: [], pagination: { totalPages: 0, totalCount: 0 } });
    renderDashboard();
    expect(await kpi('Pending Installations')).toBe('0');
    expect(await kpi('Completed Installations')).toBe('0');
    expect(await screen.findByText('No installation requests yet.')).toBeTruthy();
  });

  it('shows a Supervisor the counts but no amount, and requests no revenue', async () => {
    permissions = { ...SUPERVISOR };
    renderDashboard();
    expect(await kpi('Pending Installations')).toBe('20');
    expect(screen.queryByText('Amount paid')).toBeNull();
    expect(jedApi.getRevenueTransactions).not.toHaveBeenCalled();
    expect(screen.queryByText(formatCurrencyNGN(67000))).toBeNull();
  });
});

describe('Supervisor dashboard', () => {
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const COMPLETED_IMPORTED = [
    { id: 1, status: 'INSTALLED', installationDate: today },
    { id: 2, status: 'INSTALLED', installationDate: today },
    { id: 3, status: 'INSTALLED', installationDate: '2020-01-01' }, // outside every range
  ];
  const EXPORTED_IMPORTED = [{ id: 4, status: 'EXPORTED', installationDate: today }];

  beforeEach(() => {
    permissions = { ...SUPERVISOR };
    jedApi.getUsers.mockResolvedValue({ success: true, data: [{ id: 'i1', role: 'INSTALLER' }], pagination: { currentPage: 1, totalPages: 6, totalCount: 6 } });
    jedApi.getInstallations.mockImplementation(async ({ status, page = 1, limit = 10 }) => {
      if (status === 'INSTALLED') return pageOf(COMPLETED_IMPORTED, page, limit);
      if (status === 'EXPORTED') return pageOf(EXPORTED_IMPORTED, page, limit);
      return pageOf(IMPORTED, page, limit);
    });
    jedApi.getAllCustomerRequests.mockImplementation(async ({ status, page = 1, limit = 10 }) => {
      if (status === 'COMPLETED' && limit > 1) {
        return pageOf([{ id: 77, accountNumber: '477077', status: 'COMPLETED', dateCompleted: now.toISOString() }], page, limit);
      }
      if (status) return { success: true, data: JED_ROWS.slice(0, 1), pagination: { currentPage: 1, totalPages: JED_COUNTS[status], totalCount: JED_COUNTS[status] } };
      return pageOf(JED_ROWS, page, limit);
    });
  });

  it('loads every operational figure from reads the Supervisor holds — no finance, no /dashboard-stats', async () => {
    renderDashboard();
    expect(await kpi('Pending Installations')).toBe('20');
    expect(await kpi('Completed Installations')).toBe('14');
    // The installer roster's own totalCount.
    expect(await kpi('Installers')).toBe('6');
    expect(jedApi.getUsers).toHaveBeenCalledWith({ role: 'INSTALLER', page: 1, limit: 1 });
    expect(jedApi.getDashboardStats).not.toHaveBeenCalled();
    expect(jedApi.getRevenueTransactions).not.toHaveBeenCalled();
    expect(jedApi.getMeterTypes).not.toHaveBeenCalled();
  });

  it('charts completed installations from the installation records instead of waiting forever', async () => {
    renderDashboard();
    // 2 INSTALLED + 1 EXPORTED + 1 JED COMPLETED today; the 2020 one is out of range.
    const chart = await screen.findByRole('img', { name: /Installations Completed chart/ });
    expect(chart).toBeTruthy();
    expect(within(chart.closest('.card')).getByText('latest: 4')).toBeTruthy();
    expect(screen.queryByText('Collected payments')).toBeNull();
    expect(jedApi.getInstallations).toHaveBeenCalledWith(expect.objectContaining({ status: 'INSTALLED' }));
    expect(jedApi.getInstallations).toHaveBeenCalledWith(expect.objectContaining({ status: 'EXPORTED' }));
  });

  it('still shows Pending and Completed when JED requests are forbidden to the role (403)', async () => {
    jedApi.getAllCustomerRequests.mockRejectedValue(Object.assign(new Error('PERMISSION_ERROR:Insufficient permissions'), {}));
    renderDashboard();
    // Imported only: PENDING 10 + ASSIGNED 5 + IN_PROGRESS 2 + FAILED 1 — never "Unavailable".
    expect(await kpi('Pending Installations')).toBe('18');
    expect(await kpi('Completed Installations')).toBe('10');
    expect(within(card('Pending Installations')).getByText(/JED Remita requests aren.t available to your role/)).toBeTruthy();
    // The trend still renders from the imported records.
    expect(await screen.findByRole('img', { name: /Installations Completed chart/ })).toBeTruthy();
    expect(screen.queryByText(/Couldn.t load/)).toBeNull();
  });

  it("offers the Supervisor's own pages as shortcuts, and no admin tools", async () => {
    renderDashboard();
    await kpi('Pending Installations');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dashboard');
    expect(screen.getByRole('button', { name: /Installations/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Assignments/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Installer Job Status/ })).toBeTruthy();
    expect(screen.queryByText('Manage Users')).toBeNull();
    expect(screen.queryByText('System Settings')).toBeNull();
    expect(screen.queryByText('Generate Report')).toBeNull();
  });
});

describe('Recent Installations', () => {
  const recentList = () => screen.findByRole('list', { name: 'Recent installations' });

  it('shows the newest requests first even though the server pages oldest-first', async () => {
    renderDashboard();
    const list = await recentList();
    const names = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(names).toHaveLength(5);
    // The import on 27 Sep, then JED requests 25, 24, 23, 22 (by dateRequested).
    expect(names[0]).toMatch(/NEWEST IMPORT/);
    expect(names[1]).toMatch(/JED CUSTOMER 25/);
    expect(names[4]).toMatch(/JED CUSTOMER 22/);
    // Only the edge pages were read: 1 and the last two.
    const pages = jedApi.getAllCustomerRequests.mock.calls.map(([p]) => p).filter((p) => !p.status).map((p) => p.page).sort();
    expect(pages).toEqual([1, 2, 3]);
  });

  it('shows account, meter type, installer, status and amount from the real records', async () => {
    renderDashboard();
    const list = await recentList();
    const first = within(list).getAllByRole('listitem')[0];
    expect(first.textContent).toMatch(/3705431499/);
    expect(first.textContent).toMatch(/Three Phase/);
    expect(first.textContent).toMatch(/Musa Bello/);
    expect(within(list).getAllByText(formatCurrencyNGN(67000)).length).toBeGreaterThan(0);
  });

  it('says so when one source fails, and shows the other', async () => {
    jedApi.getInstallations.mockRejectedValue(new Error('SERVER_ERROR:x'));
    renderDashboard();
    await recentList();
    expect(screen.getByText(/Couldn.t load imported installation requests/)).toBeTruthy();
  });

  it('is an error state, not an empty list, when every source fails', async () => {
    jedApi.getInstallations.mockRejectedValue(new Error('SERVER_ERROR:x'));
    jedApi.getAllCustomerRequests.mockRejectedValue(new Error('SERVER_ERROR:x'));
    renderDashboard();
    expect(await screen.findByText("Couldn't load recent installations.")).toBeTruthy();
    expect(screen.queryByText('No installation requests yet.')).toBeNull();
  });
});

describe('Refresh', () => {
  it('re-reads the installation figures on the app-wide refresh signal', async () => {
    const Trigger = () => {
      const { notifyDataChanged } = useDataRefresh();
      return <button type="button" onClick={notifyDataChanged}>fire refresh</button>;
    };
    renderDashboard(<Trigger />);
    await kpi('Pending Installations');
    const before = jedApi.getInstallationStatistics.mock.calls.length;
    jedApi.getInstallationStatistics.mockResolvedValue({ success: true, data: { ...STATS, pending: 11, total: 32 } });
    fireEvent.click(screen.getByRole('button', { name: 'fire refresh' }));
    await waitFor(() => expect(jedApi.getInstallationStatistics.mock.calls.length).toBeGreaterThan(before));
    await waitFor(async () => expect(await kpi('Pending Installations')).toBe('21'));
  });
});

describe('Generate Report (fixed 2026-10-05)', () => {
  const open = async () => {
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: /Generate Report/ }));
    return screen.findByRole('dialog', { name: 'Generate Report' });
  };
  const metric = async (label) => {
    const heading = await screen.findByText(label, { selector: 'h3' });
    await waitFor(() => expect(heading.nextElementSibling?.tagName).toBe('P'), { timeout: 5000 });
    return heading.nextElementSibling.textContent.trim();
  };

  it('downloads the summary report with the figures the dashboard shows — and never calls the JED-only exports', async () => {
    const dialog = await open();
    const excel = within(dialog).getByRole('button', { name: 'Export Excel' });
    await waitFor(() => expect(excel.disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(excel);
    await waitFor(() => expect(downloadXlsx).toHaveBeenCalledTimes(1));
    const [filename, sheets] = downloadXlsx.mock.calls[0];
    expect(filename).toMatch(/^ME-Metering-Overview-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const rows = sheets[0].rows;
    const row = (m) => rows.find((r) => r.metric === m);
    expect(String(row('Pending installations').count)).toBe(await kpi('Pending Installations'));
    const due = row('Revenue due to us');
    expect(due.amount === null ? 'Unavailable' : formatCurrencyNGN(due.amount)).toBe(await metric('Revenue due to us'));
    const col = row('Total collected payments');
    expect(col.amount === null ? 'Unavailable' : formatCurrencyNGN(col.amount)).toBe(await metric('Total collected payments'));
    expect(jedApi.exportCustomerRequests).not.toHaveBeenCalled();
    expect(jedApi.exportJedRequests).not.toHaveBeenCalled();
  }, 30000);

  it('the meter inventory export says so plainly when the server has nothing', async () => {
    jedApi.exportMeters.mockRejectedValue(new Error('{"success":false,"message":"No meters found to export"} 404'));
    const dialog = await open();
    const meters = within(dialog).getByRole('button', { name: 'Export meter inventory' });
    fireEvent.click(meters);
    expect(await within(dialog).findByText('There are no meters to export.')).toBeTruthy();
    expect(downloadServerXlsx).not.toHaveBeenCalled();
    // The button is usable again.
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Export meter inventory' }).disabled).toBe(false));
  }, 30000);
});
