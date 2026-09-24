// @vitest-environment jsdom
// The Installer Dashboard shows TWO lists: the installer's own dispatched jobs
// (summary cards) and the shared JED queue (tabs). This suite pins that they
// stay distinguishable, that each counts a record once, and that a completed
// job never also appears as awaiting.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataRefreshProvider } from '../../contexts/DataRefreshContext';
import InstallerDashboard from '../InstallerDashboard';
import jedApi from '../../services/api';

vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ user: { id: 'uuid-1', role: 'INSTALLER', name: 'Musa Bello' } }),
}));

vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getMyInstallations: vi.fn(),
    getMyJobs: vi.fn(),
  },
}));

const page = (data) => ({
  success: true,
  data,
  pagination: { currentPage: 1, totalPages: 1, totalCount: data.length, hasNext: false },
});

// GET /external/jed/requests/installer — the shared queue.
const jed = (accountNumber, status) => ({
  id: Number(accountNumber), accountNumber, status,
  custNames: `CUSTOMER ${accountNumber}`, meterNo: '0239110006909',
  dateRequested: '2026-09-01T00:00:00Z',
});
// GET /installations/me/jobs — this installer's own dispatched jobs.
const own = (id, status) => ({ id, status, accountNumber: `900${id}`, customerName: `OWN ${id}` });

const mockJed = (records) => {
  jedApi.getMyInstallations.mockImplementation(async ({ status }) =>
    page(records.filter((r) => r.status === status)));
};

beforeEach(() => {
  vi.clearAllMocks();
  mockJed([]);
  jedApi.getMyJobs.mockResolvedValue(page([]));
});
afterEach(cleanup);

const renderPage = async () => {
  render(
    <MemoryRouter>
      <DataRefreshProvider><InstallerDashboard /></DataRefreshProvider>
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'JED shared queue' });
};

// Queries are scoped per section on purpose: "Completed" is a card title AND a
// JED tab label, so an unscoped query is ambiguous — which is precisely the
// confusion this screen used to present to the installer.
const assignedSection = () => screen.getByRole('region', { name: 'My assigned jobs' });
const jedSection = () => screen.getByRole('region', { name: 'JED shared queue' });

const jedTab = (name) => within(jedSection()).getByRole('button', { name: new RegExp(`^${name}`) });
const assignedCard = (title) => within(assignedSection()).getByText(title).closest('a');
const cardValue = (title) => assignedCard(title).querySelector('p.text-xl, p.text-2xl')?.textContent;

describe('InstallerDashboard — the two lists are distinguishable', () => {
  it('labels the assigned-jobs cards and the shared queue differently', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'My assigned jobs' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'JED shared queue' })).toBeTruthy();
    // The shared queue says it is not personal, so the two numbers aren't
    // read as the same thing counted twice.
    expect(screen.getByText(/not assigned to you/)).toBeTruthy();
  });

  it('does not add the two lists together', async () => {
    mockJed([jed('1', 'PAID'), jed('2', 'PAID')]);
    jedApi.getMyJobs.mockResolvedValue(page([own(10, 'ASSIGNED')]));
    await renderPage();

    await waitFor(() => expect(cardValue('Awaiting installation')).toBe('1'));
    // The JED tab counts its own two, independently.
    expect(jedTab('Awaiting Installation').textContent).toContain('2');
  });
});

describe('InstallerDashboard — JED queue counts and buckets', () => {
  it('Case 1: one awaiting → awaiting 1, completed 0', async () => {
    mockJed([jed('477014', 'PAID')]);
    await renderPage();
    await waitFor(() => expect(jedTab('Awaiting Installation').textContent).toContain('1'));
    expect(jedTab('Completed').textContent).toContain('0');
  });

  it('Case 2: one completed → awaiting 0, completed 1', async () => {
    mockJed([jed('477014', 'COMPLETED')]);
    await renderPage();
    await waitFor(() => expect(jedTab('Completed').textContent).toContain('1'));
    expect(jedTab('Awaiting Installation').textContent).toContain('0');
  });

  it('Case 3: one of each → awaiting 1, completed 1', async () => {
    mockJed([jed('477014', 'PAID'), jed('477015', 'COMPLETED')]);
    await renderPage();
    await waitFor(() => expect(jedTab('Awaiting Installation').textContent).toContain('1'));
    expect(jedTab('Completed').textContent).toContain('1');
  });

  it('Case 4: the same request returned twice appears once, and says so', async () => {
    // Both status queries return the same account — the merge used to render it twice.
    jedApi.getMyInstallations.mockResolvedValue(page([jed('477014', 'PAID')]));
    await renderPage();

    await waitFor(() => expect(jedTab('Awaiting Installation').textContent).toContain('1'));
    const list = screen.getByRole('table');
    expect(within(list).getAllByText('477014')).toHaveLength(1);
    expect(screen.getByText(/1 repeated record from the server was shown once/)).toBeTruthy();
  });

  it('never leaves a completed request in the awaiting tab', async () => {
    mockJed([jed('477014', 'COMPLETED')]);
    await renderPage();
    await waitFor(() => expect(jedTab('Awaiting Installation').textContent).toContain('0'));
    // The awaiting tab is the default; its empty state is showing.
    expect(screen.getByText(/No installations awaiting installation/)).toBeTruthy();
  });

  it('the tab count equals the number of rows the tab renders', async () => {
    mockJed([jed('1', 'PAID'), jed('2', 'PAID'), jed('3', 'COMPLETED')]);
    await renderPage();
    await waitFor(() => expect(jedTab('Awaiting Installation').textContent).toContain('2'));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2 + 1); // + header
  });
});

describe('InstallerDashboard — assigned-job cards', () => {
  it('counts each dispatched job once, whatever the server repeats', async () => {
    jedApi.getMyJobs.mockResolvedValue(page([
      own(1, 'ASSIGNED'), own(1, 'ASSIGNED'), own(2, 'IN_PROGRESS'), own(3, 'INSTALLED'),
    ]));
    await renderPage();
    await waitFor(() => expect(cardValue('Awaiting installation')).toBe('2'));
    expect(cardValue('Completed')).toBe('1');
    expect(screen.getByText(/1 repeated record from the server was counted once/)).toBeTruthy();
  });

  it('is unaffected by what the JED queue contains', async () => {
    mockJed([jed('1', 'PAID'), jed('2', 'COMPLETED')]);
    jedApi.getMyJobs.mockResolvedValue(page([]));
    await renderPage();
    await waitFor(() => expect(cardValue('Awaiting installation')).toBe('0'));
    expect(cardValue('Completed')).toBe('0');
    expect(screen.getByText('No jobs have been assigned to you yet.')).toBeTruthy();
  });
});
