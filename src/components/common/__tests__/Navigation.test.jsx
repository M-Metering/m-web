// @vitest-environment jsdom
// The role matrix, pinned. Navigation is the first place a role boundary shows
// up to a user, and a stray `accessible: () => true` here has put an Installer
// in front of an admin page before (Security.md, finding 8). This asserts the
// exact item set each role gets — so adding a page forces a deliberate choice.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Navigation from '../Navigation';
import { ROLES } from '../../auth/permissions';

afterEach(cleanup);

const navFor = (userRole) => {
  render(
    <MemoryRouter>
      <Navigation userRole={userRole} isOpen={false} onClose={() => {}} collapsed={false} onToggleCollapse={() => {}} />
    </MemoryRouter>
  );
  // The drawer and the desktop rail render the same item set; take the first.
  const [nav] = screen.getAllByRole('navigation');
  return within(nav).getAllByRole('link').map((a) => a.getAttribute('href'));
};

const ADMIN_TIER = [
  '/dashboard', '/installations', '/imports', '/assignments', '/schedule',
  '/users', '/reports', '/payments', '/uploads', '/settings',
];

describe('Navigation — role matrix', () => {
  it('gives Super Admin the full administrative set', () => {
    expect(navFor(ROLES.SUPERADMIN).sort()).toEqual([...ADMIN_TIER].sort());
  });

  it('gives Admin the same set — the two differ inside pages, not in navigation', () => {
    // Super Admin-only powers (delete a user, delete a meter) are enforced
    // inside the pages and by the backend, not by hiding whole sections.
    expect(navFor(ROLES.ADMIN).sort()).toEqual([...ADMIN_TIER].sort());
  });

  it('gives Installer only operational items', () => {
    expect(navFor(ROLES.INSTALLER).sort()).toEqual(['/complaints', '/dashboard', '/my-jobs']);
  });

  // Per the backend's own scope for the role: installations and assignments in
  // full, meters and the installer roster read-only, nothing else.
  it('gives Supervisor its five items and no more', () => {
    expect(navFor(ROLES.SUPERVISOR).sort()).toEqual(
      ['/assignments', '/dashboard', '/installations', '/schedule', '/users']
    );
  });

  it('never shows a Supervisor a module the API would 403', () => {
    const supervisor = navFor(ROLES.SUPERVISOR);
    ['/uploads', '/payments', '/reports', '/settings', '/imports', '/my-jobs', '/complaints']
      .forEach((path) => expect(supervisor).not.toContain(path));
  });

  it('never shows an Installer an administrative page', () => {
    const installer = navFor(ROLES.INSTALLER);
    ['/installations', '/imports', '/assignments', '/schedule', '/users', '/reports', '/payments', '/uploads', '/settings']
      .forEach((path) => expect(installer).not.toContain(path));
  });

  it('never shows an admin-tier account the Installer-only items', () => {
    // /my-jobs is scoped to the caller's JWT and would be empty for an admin;
    // /complaints must be attributable to the installer who raised it.
    [ROLES.ADMIN, ROLES.SUPERADMIN].forEach((role) => {
      const paths = navFor(role);
      expect(paths).not.toContain('/my-jobs');
      expect(paths).not.toContain('/complaints');
      cleanup();
    });
  });

  it('offers one Installations entry, not one per installation resource', () => {
    const admin = navFor(ROLES.ADMIN);
    expect(admin.filter((p) => p.startsWith('/installation'))).toEqual(['/installations']);
  });

  it('shows nothing for an unknown or missing role', () => {
    expect(navFor(undefined)).toEqual(['/dashboard']);
    expect(navFor('NOT_A_ROLE')).toEqual(['/dashboard']);
  });
});
