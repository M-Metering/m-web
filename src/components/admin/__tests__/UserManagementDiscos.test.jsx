// @vitest-environment jsdom
// Per-Disco Access (2026-10-05, §4): who may grant which discos.
//   - SUPERADMIN: multi-select of every disco on create; edit changes a user's
//     discos through PUT /users/:id/discos (the whole set), never PUT /users.
//   - ADMIN with one disco: no field, discoCodes omitted (the server applies
//     the ADMIN's own disco).
//   - ADMIN with several: their own discos, all pre-ticked; at least one.
//   - A SUPERADMIN account is never profiled: no field for it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import UserManagement from '../UserManagement';
import jedApi from '../../services/api';

const ABA = { code: 'ABA_POWER', name: 'Aba Power Limited Electric' };
const PHEDC = { code: 'PHEDC', name: 'Port Harcourt Electricity Distribution Company' };

const SUPER_ADMIN = { id: 'sa-1', firstName: 'Ada', lastName: 'Boss', email: 'boss@x.com', phone: '08000000001', role: 'SUPERADMIN', discos: [] };
const INSTALLER = { id: 'in-1', firstName: 'Ngozi', lastName: 'Eke', email: 'ngozi@x.com', phone: '08000000002', role: 'INSTALLER', discos: [ABA] };

let currentUser = SUPER_ADMIN;

vi.mock('../../contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ user: currentUser, refreshUser: vi.fn() }),
  useAuth: () => ({ user: currentUser, refreshUser: vi.fn() }),
}));
vi.mock('../../auth/usePermissions', () => ({
  usePermissions: () => {
    const adminTier = currentUser.role === 'ADMIN' || currentUser.role === 'SUPERADMIN';
    return {
      user: currentUser,
      isAdmin: adminTier,
      isSuperAdmin: currentUser.role === 'SUPERADMIN',
      canViewUsers: true,
      canCreateUsers: adminTier,
      canUpdateUsers: adminTier,
      canDeleteUsers: adminTier,
    };
  },
}));
vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getUsers: vi.fn(),
    getDiscos: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    updateUserDiscos: vi.fn(),
  },
}));

const page = (data) => ({ success: true, data, pagination: { currentPage: 1, totalPages: 1, totalCount: data.length, hasNext: false } });

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = SUPER_ADMIN;
  jedApi.getUsers.mockResolvedValue(page([SUPER_ADMIN, INSTALLER]));
  jedApi.getDiscos.mockResolvedValue(page([ABA, PHEDC]));
  jedApi.createUser.mockResolvedValue({ success: true, data: {} });
  jedApi.updateUser.mockResolvedValue({ success: true, data: {} });
  jedApi.updateUserDiscos.mockResolvedValue({ success: true, data: {} });
});
afterEach(cleanup);

const renderPage = async () => {
  render(<UserManagement />);
  await waitFor(() => expect(screen.getAllByText('ngozi@x.com').length).toBeGreaterThan(0));
};
const field = (label) => screen.getByText(label).closest('div').querySelector('input');
const discoBox = (name) => screen.queryByRole('checkbox', { name: new RegExp(name) });

const fillNewUser = () => {
  fireEvent.change(field('First Name *'), { target: { value: 'Ada' } });
  fireEvent.change(field('Last Name *'), { target: { value: 'Obi' } });
  fireEvent.change(field('Phone *'), { target: { value: '08012345678' } });
  fireEvent.change(field('Email *'), { target: { value: 'ada@example.com' } });
  fireEvent.change(field('NIN *'), { target: { value: '12345678901' } });
  fireEvent.change(field('Password *'), { target: { value: 'secret1' } });
  fireEvent.change(field('Confirm Password *'), { target: { value: 'secret1' } });
};
const openCreate = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Add User/ }));
  await screen.findByRole('button', { name: /Create User/ });
};

describe('UserManagement — discos', () => {
  it("shows each user's discos, and 'All discos' for a Super Admin", async () => {
    await renderPage();
    const row = screen.getAllByText('ngozi@x.com').map((n) => n.closest('tr')).find(Boolean);
    expect(within(row).getByText('ABA_POWER')).toBeTruthy();
    const bossRow = screen.getAllByText('boss@x.com').map((n) => n.closest('tr')).find(Boolean);
    expect(within(bossRow).getByText('All discos')).toBeTruthy();
  });

  it('Super Admin: chooses from every disco and always sends discoCodes on create', async () => {
    await renderPage();
    await openCreate();
    fillNewUser();
    fireEvent.click(discoBox('PHEDC'));
    fireEvent.click(screen.getByRole('button', { name: /Create User/ }));
    await waitFor(() => expect(jedApi.createUser).toHaveBeenCalled());
    expect(jedApi.createUser.mock.calls[0][0]).toMatchObject({ role: 'INSTALLER', discoCodes: ['PHEDC'] });
  });

  it('Super Admin: no disco field, and no discoCodes, for a Super Admin account', async () => {
    await renderPage();
    await openCreate();
    fillNewUser();
    fireEvent.change(screen.getByText('Role *').closest('div').querySelector('select'), { target: { value: 'SUPERADMIN' } });
    expect(discoBox('PHEDC')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Create User/ }));
    await waitFor(() => expect(jedApi.createUser).toHaveBeenCalled());
    expect(jedApi.createUser.mock.calls[0][0]).not.toHaveProperty('discoCodes');
  });

  it("Super Admin: changing only a user's discos uses PUT /users/:id/discos with the whole set", async () => {
    await renderPage();
    const row = screen.getAllByText('ngozi@x.com').map((n) => n.closest('tr')).find(Boolean);
    fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.title === 'Edit user'));
    await screen.findByRole('button', { name: /Update User/ });
    expect(discoBox('ABA_POWER').checked).toBe(true);
    fireEvent.click(discoBox('PHEDC'));
    fireEvent.click(screen.getByRole('button', { name: /Update User/ }));
    await waitFor(() => expect(jedApi.updateUserDiscos).toHaveBeenCalledWith('in-1', ['ABA_POWER', 'PHEDC']));
    expect(jedApi.updateUser).not.toHaveBeenCalled();
  });

  it('Admin with one disco: no field; discoCodes omitted so the server applies theirs', async () => {
    currentUser = { id: 'ad-1', firstName: 'Musa', lastName: 'B', email: 'musa@x.com', phone: '08000000003', role: 'ADMIN', discos: [ABA] };
    jedApi.getUsers.mockResolvedValue(page([INSTALLER]));
    await renderPage();
    await openCreate();
    expect(discoBox('ABA_POWER')).toBeNull();
    fillNewUser();
    fireEvent.click(screen.getByRole('button', { name: /Create User/ }));
    await waitFor(() => expect(jedApi.createUser).toHaveBeenCalled());
    expect(jedApi.createUser.mock.calls[0][0]).not.toHaveProperty('discoCodes');
    // A scoped Admin's picker never asks GET /discos.
    expect(jedApi.getDiscos).not.toHaveBeenCalled();
  });

  it('Admin with several discos: only their own, all pre-ticked, at least one required', async () => {
    currentUser = { id: 'ad-2', firstName: 'Musa', lastName: 'B', email: 'musa@x.com', phone: '08000000003', role: 'ADMIN', discos: [ABA, PHEDC] };
    jedApi.getUsers.mockResolvedValue(page([INSTALLER]));
    await renderPage();
    await openCreate();
    expect(discoBox('ABA_POWER').checked).toBe(true);
    expect(discoBox('PHEDC').checked).toBe(true);
    fillNewUser();
    fireEvent.click(discoBox('ABA_POWER'));
    fireEvent.click(discoBox('PHEDC'));
    fireEvent.click(screen.getByRole('button', { name: /Create User/ }));
    expect(await screen.findByText('Choose at least one disco.')).toBeTruthy();
    expect(jedApi.createUser).not.toHaveBeenCalled();
    fireEvent.click(discoBox('PHEDC'));
    fireEvent.click(screen.getByRole('button', { name: /Create User/ }));
    await waitFor(() => expect(jedApi.createUser).toHaveBeenCalled());
    expect(jedApi.createUser.mock.calls[0][0].discoCodes).toEqual(['PHEDC']);
  });

  it("Admin editing: discos are shown, not editable, and never sent", async () => {
    currentUser = { id: 'ad-1', firstName: 'Musa', lastName: 'B', email: 'musa@x.com', phone: '08000000003', role: 'ADMIN', discos: [ABA, PHEDC] };
    jedApi.getUsers.mockResolvedValue(page([INSTALLER]));
    await renderPage();
    const row = screen.getAllByText('ngozi@x.com').map((n) => n.closest('tr')).find(Boolean);
    fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.title === 'Edit user'));
    await screen.findByRole('button', { name: /Update User/ });
    expect(discoBox('PHEDC')).toBeNull();
    expect(screen.getByText(/Only a Super Administrator can change which discos/)).toBeTruthy();
    fireEvent.change(field('First Name *'), { target: { value: 'Ngozika' } });
    fireEvent.click(screen.getByRole('button', { name: /Update User/ }));
    await waitFor(() => expect(jedApi.updateUser).toHaveBeenCalledWith('in-1', { firstName: 'Ngozika' }));
    expect(jedApi.updateUserDiscos).not.toHaveBeenCalled();
  });
});
