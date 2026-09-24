// @vitest-environment jsdom
// The consolidated Installations area: one route, two views, and the old
// /installation-requests bookmark still lands somewhere useful.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import InstallationsPage from '../InstallationsPage';

// Both views are heavy pages of their own; this suite is about the switch,
// so each is stubbed. Their own behaviour is covered by their own suites.
vi.mock('../../admin/InstallationRequests', () => ({
  default: () => <div data-testid="view-requests">All requests view</div>,
}));
vi.mock('../../admin/AdminInstallations', () => ({
  default: () => <div data-testid="view-jed">JED queue view</div>,
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const renderAt = (initialEntry = '/installations') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <Routes>
      <Route path="/installations" element={<InstallationsPage />} />
      <Route path="/installation-requests" element={<Navigate to="/installations" replace />} />
    </Routes>
  </MemoryRouter>
);

const tab = (name) => screen.getByRole('button', { name: new RegExp(name) });

describe('InstallationsPage — one area, two views', () => {
  it('shows a single Installations heading, not one per view', async () => {
    renderAt();
    await screen.findByTestId('view-requests');
    expect(screen.getAllByRole('heading', { name: 'Installations' })).toHaveLength(1);
  });

  it('defaults to the combined request list', async () => {
    renderAt();
    expect(await screen.findByTestId('view-requests')).toBeTruthy();
    expect(screen.queryByTestId('view-jed')).toBeNull();
  });

  it('switches to the JED queue and back', async () => {
    renderAt();
    await screen.findByTestId('view-requests');

    fireEvent.click(tab('JED Queue'));
    expect(await screen.findByTestId('view-jed')).toBeTruthy();
    expect(screen.queryByTestId('view-requests')).toBeNull();

    fireEvent.click(tab('All Requests'));
    expect(await screen.findByTestId('view-requests')).toBeTruthy();
    expect(screen.queryByTestId('view-jed')).toBeNull();
  });

  it('opens the view named in the URL, so a view can be linked to', async () => {
    renderAt('/installations?view=jed');
    expect(await screen.findByTestId('view-jed')).toBeTruthy();
  });

  it('falls back to the default view for an unknown ?view=', async () => {
    renderAt('/installations?view=nonsense');
    expect(await screen.findByTestId('view-requests')).toBeTruthy();
  });

  it('describes the active view, so the two are never confused', async () => {
    renderAt();
    await screen.findByTestId('view-requests');
    expect(screen.getByText(/imported jobs and JED's Remita requests/)).toBeTruthy();

    fireEvent.click(tab('JED Queue'));
    await screen.findByTestId('view-jed');
    expect(screen.getByText(/JED paid requests awaiting installation/)).toBeTruthy();
  });

  it('keeps the old /installation-requests bookmark working', async () => {
    renderAt('/installation-requests');
    expect(await screen.findByTestId('view-requests')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Installations' })).toBeTruthy());
  });
});
