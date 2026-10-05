// @vitest-environment jsdom
// Reports after the Payments merge (2026-10-05). Pinned:
//   - four tabs, each piece of the old Payments page in exactly one place;
//   - Payments & deals = Recognised revenue (the shared RevenueTab) or Remita
//     payments; Payment confirmation = confirm one or upload paid customers;
//   - the tab and view live in the URL, so the /payments redirect target
//     (?tab=transactions) and bookmarks open the right place;
//   - no second payment panel: only the Overview renders one.
// The panels themselves are tested elsewhere; here they are stubs.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AdminReports from '../AdminReports';

vi.mock('../ReportsOverview', () => ({ default: () => <div>OVERVIEW PANEL</div> }));
vi.mock('../RevenueTab', () => ({ default: () => <div>RECOGNISED REVENUE</div> }));
vi.mock('../RemitaPaymentsList', () => ({ default: () => <div>REMITA PAYMENTS</div> }));
vi.mock('../ConfirmPaymentTab', () => ({ default: () => <div>CONFIRM ONE</div> }));
vi.mock('../BulkConfirmPaymentsTab', () => ({ default: () => <div>BULK UPLOAD</div> }));
vi.mock('../../services/api', () => ({ default: { getAllCustomerRequests: vi.fn(async () => ({ success: true, data: [] })) } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'ADMIN' } }) }));

afterEach(cleanup);

let lastSearch = '';
function Where() { lastSearch = useLocation().search; return null; }

// The same redirect App.jsx declares for the retired page.
const renderAt = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/payments" element={<Navigate to="/reports?tab=transactions" replace />} />
      <Route path="/reports" element={<><AdminReports /><Where /></>} />
    </Routes>
  </MemoryRouter>
);
const tab = (name) => screen.getByRole('button', { name: new RegExp(`^${name}$`) });

describe('Reports — the merged payment, deal and reporting area', () => {
  it('has four tabs and opens on the Overview', () => {
    renderAt('/reports');
    ['Overview', 'Payments & deals', 'Payment confirmation', 'JED requests'].forEach((t) => expect(tab(t)).toBeTruthy());
    expect(screen.getByText('OVERVIEW PANEL')).toBeTruthy();
    expect(screen.queryByText('Payments')).toBeNull();
  });

  it('the old /payments link lands on Payments & deals, recognised revenue first', () => {
    renderAt('/payments');
    expect(screen.getByText('RECOGNISED REVENUE')).toBeTruthy();
    expect(screen.queryByText('OVERVIEW PANEL')).toBeNull();
  });

  it('Payments & deals switches to the Remita payment records, and the URL follows', () => {
    renderAt('/reports?tab=transactions');
    fireEvent.click(screen.getByRole('button', { name: 'Remita payments' }));
    expect(screen.getByText('REMITA PAYMENTS')).toBeTruthy();
    expect(screen.queryByText('RECOGNISED REVENUE')).toBeNull();
    expect(lastSearch).toBe('?tab=transactions&view=remita');
  });

  it('Payment confirmation holds both actions from the old Payments page', () => {
    renderAt('/reports');
    fireEvent.click(tab('Payment confirmation'));
    expect(screen.getByText('CONFIRM ONE')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Upload paid customers' }));
    expect(screen.getByText('BULK UPLOAD')).toBeTruthy();
    expect(lastSearch).toBe('?tab=confirm&view=bulk');
  });

  it('opens a bookmarked view directly, and ignores an unknown tab', () => {
    renderAt('/reports?tab=confirm&view=bulk');
    expect(screen.getByText('BULK UPLOAD')).toBeTruthy();
    cleanup();
    renderAt('/reports?tab=nonsense');
    expect(screen.getByText('OVERVIEW PANEL')).toBeTruthy();
  });
});
