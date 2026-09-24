// @vitest-environment jsdom
// The dashboard cards and the My Jobs filters must report the same numbers
// from the same data (GET /installations/me/jobs).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataRefreshProvider, useDataRefresh } from '../../contexts/DataRefreshContext';
import InstallerJobSummary from '../InstallerJobSummary';
import MyJobs from '../../installations/MyJobs';
import jedApi from '../../services/api';

vi.mock('../../auth/usePermissions', () => ({
  usePermissions: () => ({ isInstaller: true, canViewMyJobs: true }),
}));

vi.mock('../../services/api', () => ({
  default: { clearCache: vi.fn(), getMyJobs: vi.fn(), getMyMeters: vi.fn() },
}));

const JOBS = ['ASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'INSTALLED', 'EXPORTED', 'FAILED']
  .map((status, i) => ({ id: i + 1, accountNumber: String(100 + i), customerName: `C${i}`, status }));

// First page full, second page carries the rest — totals must span pages.
const pagedJobs = async ({ page }) => (page === 1
  ? { success: true, data: JOBS.slice(0, 4), pagination: { hasNext: true, totalPages: 2 } }
  : { success: true, data: JOBS.slice(4), pagination: { hasNext: false, totalPages: 2 } });

let bump;
function Bumper() {
  bump = useDataRefresh().notifyDataChanged;
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  jedApi.getMyJobs.mockImplementation(pagedJobs);
  jedApi.getMyMeters.mockResolvedValue({ success: true, data: [], pagination: { hasNext: false } });
});
afterEach(cleanup);

const card = (title) => Number(screen.getByText(title).nextElementSibling.textContent);

describe('InstallerJobSummary', () => {
  it('counts awaiting and completed jobs across every page', async () => {
    render(<MemoryRouter><DataRefreshProvider><InstallerJobSummary /></DataRefreshProvider></MemoryRouter>);
    await waitFor(() => expect(card('Awaiting installation')).toBe(3));
    expect(card('Completed')).toBe(2);
    expect(jedApi.getMyJobs).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    expect(jedApi.getMyJobs.mock.calls.every(([p]) => !('installerId' in p))).toBe(true);
  });

  it('matches the My Jobs filter counts', async () => {
    render(<MemoryRouter><DataRefreshProvider><InstallerJobSummary /><MyJobs /></DataRefreshProvider></MemoryRouter>);
    await waitFor(() => expect(card('Awaiting installation')).toBe(3));
    expect(screen.getByRole('button', { name: 'Awaiting installation (3)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Completed (2)' })).toBeTruthy();
  });

  it('refreshes when a job changes elsewhere', async () => {
    render(<MemoryRouter><DataRefreshProvider><Bumper /><InstallerJobSummary /></DataRefreshProvider></MemoryRouter>);
    await waitFor(() => expect(card('Completed')).toBe(2));
    jedApi.getMyJobs.mockResolvedValue({
      success: true, data: JOBS.map((j) => (j.id === 1 ? { ...j, status: 'INSTALLED' } : j)), pagination: { hasNext: false },
    });
    act(() => bump());
    await waitFor(() => expect(card('Completed')).toBe(3));
    expect(card('Awaiting installation')).toBe(2);
  });

  it('shows an empty state and a concise error', async () => {
    jedApi.getMyJobs.mockResolvedValueOnce({ success: true, data: [], pagination: { hasNext: false } });
    const { unmount } = render(<MemoryRouter><DataRefreshProvider><InstallerJobSummary /></DataRefreshProvider></MemoryRouter>);
    expect(await screen.findByText('No jobs have been assigned to you yet.')).toBeTruthy();
    unmount();

    jedApi.getMyJobs.mockRejectedValueOnce(new Error('SERVER_ERROR:boom'));
    render(<MemoryRouter><DataRefreshProvider><InstallerJobSummary /></DataRefreshProvider></MemoryRouter>);
    expect(await screen.findByText("Couldn't load your job summary.")).toBeTruthy();
  });
});
