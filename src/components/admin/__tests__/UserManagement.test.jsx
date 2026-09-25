// @vitest-environment jsdom
// Account protection: a Super Admin cannot delete their own account, and the
// rest of the role model is unchanged. Rendered against a mocked jedApi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import UserManagement from '../UserManagement';
import jedApi from '../../services/api';

const SUPER_ADMIN = {
  id: '3904aad1-2f27-42d1-9c33-fe87502ea594',
  firstName: 'Ada', lastName: 'Boss', email: 'boss@memetering.com', phone: '08149454601',
  role: 'SUPERADMIN', isActive: true,
};
const OTHER_ADMIN = {
  id: 'b0e1c2d3-0000-4000-8000-000000000001',
  firstName: 'Musa', lastName: 'Bello', email: 'musa@memetering.com', phone: '08030000001',
  role: 'ADMIN', isActive: true,
};
const INSTALLER = {
  id: 'b0e1c2d3-0000-4000-8000-000000000002',
  firstName: 'Ngozi', lastName: 'Eke', email: 'ngozi@memetering.com', phone: '08030000002',
  role: 'INSTALLER', isActive: true,
};

let currentUser = SUPER_ADMIN;

vi.mock('../../auth/usePermissions', () => ({
  usePermissions: () => ({
    user: currentUser,
    isAdmin: true,
    isAdminRole: currentUser.role === 'ADMIN',
    isSuperAdmin: currentUser.role === 'SUPERADMIN',
    canManageUsers: true,
    // Admin-tier: sees the page, creates and edits. The Super Admin-only rules
    // (delete, password reset, privileged roles) are still asserted below via
    // isSuperAdmin, exactly as before.
    canViewUsers: true,
    canCreateUsers: true,
    canUpdateUsers: true,
    canDeleteUsers: true,
  }),
}));

vi.mock('../../services/api', () => ({
  default: {
    clearCache: vi.fn(),
    getUsers: vi.fn(),
    deleteUser: vi.fn(),
    getUserById: vi.fn(),
    updateUser: vi.fn(),
    createUser: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = SUPER_ADMIN;
  jedApi.getUsers.mockResolvedValue({
    success: true,
    data: [SUPER_ADMIN, OTHER_ADMIN, INSTALLER],
    pagination: { currentPage: 1, totalPages: 1, totalCount: 3, hasNext: false },
  });
  jedApi.deleteUser.mockResolvedValue({ success: true });
  jedApi.updateUser.mockResolvedValue({ success: true, data: {} });
  jedApi.createUser.mockResolvedValue({ success: true, data: {} });
});
afterEach(cleanup);

const renderPage = async () => {
  render(<UserManagement />);
  await waitFor(() => expect(screen.getAllByText('boss@memetering.com').length).toBeGreaterThan(0));
};

// Every user renders twice — a card (mobile) and a table row (md+). jsdom has
// no viewport, so both are in the DOM; these helpers target the table row, and
// `cardFor` the card, so each layout can be asserted on deliberately.
const nodesFor = (email) => screen.getAllByText(email);
const rowFor = (email) => nodesFor(email).map((n) => n.closest('tr')).find(Boolean);
const cardFor = (email) => nodesFor(email).map((n) => n.closest('li')).find(Boolean);
const deleteButtonIn = (email) =>
  Array.from(rowFor(email).querySelectorAll('button')).find((b) => /Delete user|Super Administrator can do this/.test(b.title || ''));
const ownAccountMarker = (email) =>
  Array.from(rowFor(email).querySelectorAll('span')).find((s) => s.textContent === 'Your account');

describe('UserManagement — Super Admin account protection', () => {
  it('offers no delete action on the signed-in Super Admin\'s own row', async () => {
    await renderPage();
    expect(deleteButtonIn('boss@memetering.com')).toBeUndefined();
    expect(rowFor('boss@memetering.com').textContent).toContain('Your account');
  });

  it('explains why, for a Super Admin', async () => {
    await renderPage();
    expect(ownAccountMarker('boss@memetering.com').getAttribute('title'))
      .toBe('A Super Admin cannot delete their own account.');
  });

  it('still lets a Super Admin delete other accounts', async () => {
    await renderPage();
    fireEvent.click(deleteButtonIn('musa@memetering.com'));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(jedApi.deleteUser).toHaveBeenCalledWith(OTHER_ADMIN.id));
  });

  it('never issues DELETE for the signed-in account, even if the row is reached another way', async () => {
    await renderPage();
    // The Installer row's delete is wired up normally…
    expect(deleteButtonIn('ngozi@memetering.com')).toBeTruthy();
    // …but no delete is ever offered for, or sent for, the current account.
    expect(deleteButtonIn('boss@memetering.com')).toBeUndefined();
    expect(jedApi.deleteUser).not.toHaveBeenCalled();
  });
});

describe('UserManagement — mobile card layout', () => {
  it('renders a card per user alongside the table, so nothing is table-only', async () => {
    await renderPage();
    expect(cardFor('boss@memetering.com')).toBeTruthy();
    expect(cardFor('ngozi@memetering.com')).toBeTruthy();
  });

  it('enforces the same account rules in the card as in the row', async () => {
    await renderPage();
    const ownCard = cardFor('boss@memetering.com');
    // Same rule, same component — no delete on your own account, either layout.
    expect(Array.from(ownCard.querySelectorAll('button')).some((b) => /Delete user/.test(b.title || '')))
      .toBe(false);
    expect(ownCard.textContent).toContain('Your account');
    expect(Array.from(cardFor('ngozi@memetering.com').querySelectorAll('button'))
      .some((b) => /Delete user/.test(b.title || ''))).toBe(true);
  });
});

describe('UserManagement — existing user-management rules are unchanged', () => {
  it('keeps deletion Super Admin-only, and keeps an Admin scoped to Installers', async () => {
    currentUser = OTHER_ADMIN;
    render(<UserManagement />);
    await waitFor(() => expect(screen.getAllByText('ngozi@memetering.com').length).toBeGreaterThan(0));

    // An Admin only ever receives Installer accounts (role param + the
    // client-side backstop), so privileged rows are not on the page at all.
    expect(jedApi.getUsers).toHaveBeenCalledWith(expect.objectContaining({ role: 'INSTALLER' }));
    expect(screen.queryAllByText('boss@memetering.com')).toHaveLength(0);

    const button = deleteButtonIn('ngozi@memetering.com');
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/only a Super Administrator/);
  });
});

// Editing sends PUT /users/{id} with the documented UserUpdate body:
// firstName, lastName, role, email, homeAddress, officeAddress — and nothing
// else. It used to also send `name`, `phone` and `nin`, which this API's Joi
// validation rejects outright ('"name" is not allowed'); getErrorMessage drops
// that wording as backend-internal, so every edit failed with a bare
// "Failed to update user". That was the bug.
const UPDATABLE = ['firstName', 'lastName', 'role', 'email', 'homeAddress', 'officeAddress'];

const openEditFor = async (email) => {
  const editBtn = Array.from(rowFor(email).querySelectorAll('button'))
    .find((b) => b.title === 'Edit user');
  fireEvent.click(editBtn);
  await screen.findByRole('button', { name: /Update User/ });
};
const field = (label) => screen.getByText(label).closest('div').querySelector('input');
const save = () => fireEvent.click(screen.getByRole('button', { name: /Update User/ }));

describe('UserManagement — Edit User payload', () => {
  it('populates the form from the selected user', async () => {
    await renderPage();
    await openEditFor('ngozi@memetering.com');
    expect(field('First Name *').value).toBe('Ngozi');
    expect(field('Last Name *').value).toBe('Eke');
    expect(field('Email *').value).toBe('ngozi@memetering.com');
  });

  it('sends only documented UserUpdate fields, and only what changed', async () => {
    await renderPage();
    await openEditFor('ngozi@memetering.com');
    fireEvent.change(field('First Name *'), { target: { value: 'Ngozika' } });
    save();

    await waitFor(() => expect(jedApi.updateUser).toHaveBeenCalled());
    const [id, payload] = jedApi.updateUser.mock.calls[0];
    expect(id).toBe(INSTALLER.id);
    expect(payload).toEqual({ firstName: 'Ngozika' });
    Object.keys(payload).forEach((k) => expect(UPDATABLE).toContain(k));
  });

  it('never sends name, phone, nin or password on an edit', async () => {
    await renderPage();
    await openEditFor('ngozi@memetering.com');
    fireEvent.change(field('Last Name *'), { target: { value: 'Ekene' } });
    save();

    await waitFor(() => expect(jedApi.updateUser).toHaveBeenCalled());
    const [, payload] = jedApi.updateUser.mock.calls[0];
    ['name', 'phone', 'nin', 'password', 'confirmPassword', 'createdAt', 'id']
      .forEach((k) => expect(payload).not.toHaveProperty(k));
  });

  it('does not let phone or NIN be edited — the API cannot update them', async () => {
    await renderPage();
    await openEditFor('ngozi@memetering.com');
    expect(field('Phone *').disabled).toBe(true);
    expect(field('NIN *').disabled).toBe(true);
    expect(screen.getAllByText(/can't be changed here/).length).toBe(2);
  });

  it('sends nothing when nothing changed, and says so', async () => {
    await renderPage();
    await openEditFor('ngozi@memetering.com');
    save();
    await screen.findByText('No changes to save.');
    expect(jedApi.updateUser).not.toHaveBeenCalled();
  });

  it('reports failure and keeps the list unchanged when the server rejects it', async () => {
    jedApi.updateUser.mockRejectedValue(new Error('VALIDATION_ERROR:Validation failed (name: "name" is not allowed)'));
    await renderPage();
    await openEditFor('ngozi@memetering.com');
    fireEvent.change(field('First Name *'), { target: { value: 'Ngozika' } });
    save();
    // An error is surfaced, and the Joi field internals never reach the user —
    // getErrorMessage keeps the server's short summary and drops the
    // parenthesised '"name" is not allowed' detail.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Validation failed/);
    expect(screen.queryByText(/is not allowed/)).toBeNull();
    expect(screen.queryByText('User updated successfully.')).toBeNull();
  });

  it('treats success:false in a 2xx body as a failure, not a silent no-op', async () => {
    jedApi.updateUser.mockResolvedValue({ success: false, message: 'Email already in use' });
    await renderPage();
    await openEditFor('ngozi@memetering.com');
    fireEvent.change(field('First Name *'), { target: { value: 'Ngozika' } });
    save();
    expect(await screen.findByText('Email already in use')).toBeTruthy();
    expect(screen.queryByText('User updated successfully.')).toBeNull();
  });

  it('confirms success and refreshes the list', async () => {
    await renderPage();
    const before = jedApi.getUsers.mock.calls.length;
    await openEditFor('ngozi@memetering.com');
    fireEvent.change(field('First Name *'), { target: { value: 'Ngozika' } });
    save();
    expect(await screen.findByText('User updated successfully.')).toBeTruthy();
    expect(jedApi.getUsers.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('UserManagement — Delete User outcome', () => {
  it('treats success:false in a 2xx body as a failure, and keeps the user listed', async () => {
    jedApi.deleteUser.mockResolvedValue({ success: false, message: 'Cannot delete own account' });
    await renderPage();
    fireEvent.click(deleteButtonIn('musa@memetering.com'));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Cannot delete own account')).toBeTruthy();
    // Still on screen — no fake removal from local state.
    expect(screen.getAllByText('musa@memetering.com').length).toBeGreaterThan(0);
  });

  it('confirms success and re-reads the list from the server', async () => {
    await renderPage();
    const before = jedApi.getUsers.mock.calls.length;
    fireEvent.click(deleteButtonIn('musa@memetering.com'));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    // DELETE /users/{id} is a soft delete, so the notice says deactivated —
    // and offers the reversal, which is the only moment it can be offered.
    expect(await screen.findByText(/Musa Bello was deactivated/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /restore Musa Bello/i })).toBeTruthy();
    expect(jedApi.getUsers.mock.calls.length).toBeGreaterThan(before);
  });

  it('does nothing at all when the confirmation is cancelled', async () => {
    await renderPage();
    fireEvent.click(deleteButtonIn('musa@memetering.com'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(jedApi.deleteUser).not.toHaveBeenCalled();
  });
});
