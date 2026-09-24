// @vitest-environment jsdom
// Installer job filters: Area / Meter Type / Feeder / Transformer, and how
// they combine with the existing search and status filters. Rendered against
// a mocked jedApi (documented GET /installations/me/jobs shape).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DataRefreshProvider } from '../../contexts/DataRefreshContext';
import MyJobs from '../MyJobs';
import jedApi from '../../services/api';

vi.mock('../../auth/usePermissions', () => ({
  usePermissions: () => ({ canViewMyJobs: true, isInstaller: true }),
}));

vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getMyJobs: vi.fn(),
    getMyMeters: vi.fn(),
    startInstallation: vi.fn(),
    failInstallation: vi.fn(),
    reportInstallation: vi.fn(),
  },
}));

const page = (data) => ({
  success: true,
  data,
  pagination: { currentPage: 1, totalPages: 1, totalCount: data.length, hasNext: false },
});

const JOBS = [
  {
    id: 1, accountNumber: '4571086211', customerName: 'ISAAC ISAAC', status: 'ASSIGNED',
    area: 'Aba', meterType: 'THREE PHASE', feederName: 'ABA GRA 11KV', transformerName: 'JOHNSON',
  },
  {
    id: 2, accountNumber: '4571086212', customerName: 'NGOZI EKE', status: 'ASSIGNED',
    area: 'Aba', meterType: 'SINGLE PHASE', feederName: 'ABA GRA 11KV', transformerName: 'OKON',
  },
  {
    id: 3, accountNumber: '4571086213', customerName: 'MUSA BELLO', status: 'IN_PROGRESS',
    area: 'Umuahia', meterType: 'THREE PHASE', feederName: 'UMUAHIA 33KV', transformerName: 'OKON',
  },
  {
    id: 4, accountNumber: '4571086214', customerName: 'ADA OBI', status: 'INSTALLED',
    area: 'Aba', meterType: 'THREE PHASE', feederName: 'ABA GRA 11KV', transformerName: 'JOHNSON',
    meterNumber: '0239110006909', sealNumber: 'APLE0099123',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  jedApi.getMyJobs.mockResolvedValue(page(JOBS));
  jedApi.getMyMeters.mockResolvedValue(page([]));
});
afterEach(cleanup);

const renderPage = async () => {
  render(<DataRefreshProvider><MyJobs /></DataRefreshProvider>);
  await screen.findByLabelText('Area');
};

// Job cards are the only place a customer name renders at this size.
const shownCustomers = () =>
  Array.from(document.querySelectorAll('p.font-medium.text-sm.truncate')).map((p) => p.textContent);
const setFilter = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const statusTab = (name) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

describe('MyJobs — job filters', () => {
  it('offers Area, Meter Type, Feeder and Transformer, built from the jobs themselves', async () => {
    await renderPage();
    ['Area', 'Meter Type', 'Feeder', 'Transformer'].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeTruthy();
    });
    const areas = Array.from(screen.getByLabelText('Area').options).map((o) => o.textContent);
    expect(areas).toEqual(['Any area', 'Aba (3)', 'Umuahia (1)']);
  });

  it('filters by meter type alone', async () => {
    await renderPage();
    setFilter('Meter Type', 'THREE PHASE');
    expect(shownCustomers()).toEqual(['ISAAC ISAAC', 'MUSA BELLO']);
  });

  it('filters by area alone', async () => {
    await renderPage();
    setFilter('Area', 'UMUAHIA');
    expect(shownCustomers()).toEqual(['MUSA BELLO']);
  });

  it('combines area and meter type', async () => {
    await renderPage();
    setFilter('Area', 'ABA');
    setFilter('Meter Type', 'THREE PHASE');
    expect(shownCustomers()).toEqual(['ISAAC ISAAC']);
  });

  it('combines feeder and transformer', async () => {
    await renderPage();
    setFilter('Feeder', 'UMUAHIA 33KV');
    setFilter('Transformer', 'OKON');
    expect(shownCustomers()).toEqual(['MUSA BELLO']);
  });

  it('shows an empty state, not stale rows, when nothing matches', async () => {
    await renderPage();
    setFilter('Area', 'UMUAHIA');
    fireEvent.change(screen.getByLabelText('Search jobs'), { target: { value: '4571086211' } });
    await waitFor(() => expect(screen.getByText('No jobs match these filters')).toBeTruthy());
    expect(shownCustomers()).toEqual([]);
  });

  it('cannot select a combination that matches nothing — the dropdowns are faceted', async () => {
    await renderPage();
    setFilter('Feeder', 'ABA GRA 11KV');
    // Umuahia has no Aba GRA feeder, so it is no longer offered as an area.
    expect(Array.from(screen.getByLabelText('Area').options).map((o) => o.value)).toEqual(['', 'ABA']);
  });

  it('restores the full list when filters are cleared', async () => {
    await renderPage();
    setFilter('Area', 'UMUAHIA');
    expect(shownCustomers()).toEqual(['MUSA BELLO']);
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    expect(shownCustomers()).toEqual(['ISAAC ISAAC', 'NGOZI EKE', 'MUSA BELLO']);
  });

  it('narrows search results further, rather than replacing them', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText('Search jobs'), { target: { value: '4571086211' } });
    setFilter('Meter Type', 'THREE PHASE');
    await waitFor(() => expect(shownCustomers()).toEqual(['ISAAC ISAAC']));
    setFilter('Meter Type', 'SINGLE PHASE');
    await waitFor(() => expect(screen.getByText('No jobs match these filters')).toBeTruthy());
  });

  it('keeps the status counts in step with the active filters', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: 'Completed (1)' })).toBeTruthy();
    setFilter('Area', 'UMUAHIA');
    expect(screen.getByRole('button', { name: 'Completed (0)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Awaiting installation (1)' })).toBeTruthy();
  });

  it('applies the status filter on top of the field filters', async () => {
    await renderPage();
    setFilter('Area', 'ABA');
    statusTab('Completed');
    expect(shownCustomers()).toEqual(['ADA OBI']);
  });

  it('is faceted — a feeder that no longer applies drops out of the dropdown', async () => {
    await renderPage();
    setFilter('Area', 'UMUAHIA');
    const feeders = Array.from(screen.getByLabelText('Feeder').options).map((o) => o.value);
    expect(feeders).toEqual(['', 'UMUAHIA 33KV']);
  });
});

describe('MyJobs — seal numbers already recorded', () => {
  it('passes the seals on the installer\'s own jobs to the report form', async () => {
    await renderPage();
    statusTab('In Progress');
    fireEvent.click(screen.getByRole('button', { name: /Report installation/ }));

    const seal = await screen.findByLabelText(/Seal number/);
    fireEvent.change(seal, { target: { value: 'aple0099123' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit installation/ }));

    expect(await screen.findByText(
      'This seal number has already been used. Please enter a unique seal number.'
    )).toBeTruthy();
    expect(jedApi.reportInstallation).not.toHaveBeenCalled();
  });
});
