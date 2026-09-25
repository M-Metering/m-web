// The permission model itself, role by role. Navigation.test.jsx pins what
// each role SEES; this pins what each role MAY DO, which is what the route
// guards and the action-level checks read. A role gaining a permission it
// wasn't meant to have is the failure mode these tests exist to catch.
import { describe, it, expect } from 'vitest';
import {
  ROLES,
  PERMISSIONS,
  isPrivilegedRole,
  hasPermission,
  canAccessPage,
  getAllPermissionsForRole,
  getRoleMetadata,
} from '../permissions';

const PAGES = [
  'dashboard', 'installations', 'assignments', 'imports', 'schedule',
  'users', 'reports', 'payments', 'uploads', 'settings', 'complaints', 'my-jobs',
];

// The scope is the backend's, from the Frontend Integration Guide (2026-09-24):
// installations and assignments in full, meters and the installer roster
// read-only, nothing else.
describe('SUPERVISOR — module access', () => {
  it('reaches installations, assignments, meters and users — and the dashboard', () => {
    const reachable = PAGES.filter((page) => canAccessPage(ROLES.SUPERVISOR, page));
    expect(reachable.sort()).toEqual(['assignments', 'dashboard', 'installations', 'schedule', 'users']);
  });

  it.each(['uploads', 'payments', 'reports', 'settings', 'imports', 'complaints', 'my-jobs'])(
    'cannot reach %s',
    (page) => {
      expect(canAccessPage(ROLES.SUPERVISOR, page)).toBe(false);
    }
  );
});

describe('SUPERVISOR — exactly the permissions the API grants', () => {
  it('holds these and nothing else', () => {
    expect(getAllPermissionsForRole(ROLES.SUPERVISOR).sort()).toEqual([
      PERMISSIONS.ASSIGNMENTS.VIEW,
      PERMISSIONS.ASSIGNMENTS.MANAGE,
      PERMISSIONS.DASHBOARD.VIEW,
      PERMISSIONS.INSTALLATIONS.VIEW,
      PERMISSIONS.INSTALLATIONS.VIEW_ALL,
      PERMISSIONS.INSTALLATIONS.MANAGE,
      PERMISSIONS.SCHEDULE.VIEW,
      PERMISSIONS.USERS.VIEW,
    ].sort());
  });

  it.each([
    ['dispatch meters', PERMISSIONS.ASSIGNMENTS.MANAGE],
    ['assign and cancel installation jobs', PERMISSIONS.INSTALLATIONS.MANAGE],
    ['see the meter inventory', PERMISSIONS.SCHEDULE.VIEW],
    ['see the installer roster', PERMISSIONS.USERS.VIEW],
  ])('can %s', (_label, permission) => {
    expect(hasPermission(ROLES.SUPERVISOR, permission)).toBe(true);
  });

  it.each([
    // Installer-only on the API: start / report / fail a job.
    ['complete an installation', PERMISSIONS.INSTALLATIONS.COMPLETE],
    // Read-only on meters: no upload, export, statistics or delete.
    ['manage the meter inventory', PERMISSIONS.SCHEDULE.MANAGE],
    ['upload spreadsheets', PERMISSIONS.UPLOADS.EXCEL],
    // Read-only on users: no create, edit, delete or restore.
    ['create users', PERMISSIONS.USERS.CREATE],
    ['edit users', PERMISSIONS.USERS.UPDATE],
    ['delete users', PERMISSIONS.USERS.DELETE],
    ['manage users', PERMISSIONS.USERS.MANAGE],
    // No access at all.
    ['run imports', PERMISSIONS.IMPORTS.RUN],
    ['view imports', PERMISSIONS.IMPORTS.VIEW],
    ['view finance', PERMISSIONS.PAYMENTS.VIEW],
    ['view reports', PERMISSIONS.REPORTS.VIEW],
    ['change settings', PERMISSIONS.SETTINGS.VIEW],
  ])('cannot %s', (_label, permission) => {
    expect(hasPermission(ROLES.SUPERVISOR, permission)).toBe(false);
  });

  it('does not inherit the admin tier, which would bypass every check above', () => {
    // hasPermission() short-circuits to true for ADMIN/SUPERADMIN. If
    // SUPERVISOR were ever added to that tier, every "cannot" assertion here
    // would silently pass, so the bypass itself is asserted directly.
    expect(hasPermission(ROLES.SUPERVISOR, 'anything:at:all')).toBe(false);
    expect(hasPermission(ROLES.ADMIN, 'anything:at:all')).toBe(true);
  });
});

describe('the roles that were already here are unchanged', () => {
  it('keeps Admin and Super Admin at full access', () => {
    [ROLES.ADMIN, ROLES.SUPERADMIN].forEach((role) => {
      PAGES.forEach((page) => expect(canAccessPage(role, page)).toBe(true));
    });
  });

  it('keeps Installer on its own operational set', () => {
    const reachable = PAGES.filter((page) => canAccessPage(ROLES.INSTALLER, page));
    expect(reachable.sort()).toEqual(['complaints', 'dashboard', 'my-jobs']);
  });
});

describe('isPrivilegedRole', () => {
  it('covers every staff role, so only a Super Admin can create one', () => {
    expect(isPrivilegedRole(ROLES.SUPERADMIN)).toBe(true);
    expect(isPrivilegedRole(ROLES.ADMIN)).toBe(true);
    expect(isPrivilegedRole(ROLES.SUPERVISOR)).toBe(true);
  });

  it('leaves Installer as the one role an Admin may manage', () => {
    expect(isPrivilegedRole(ROLES.INSTALLER)).toBe(false);
    expect(isPrivilegedRole(undefined)).toBe(false);
  });
});

describe('role metadata', () => {
  it('names the Supervisor role for every screen that displays a role', () => {
    expect(getRoleMetadata(ROLES.SUPERVISOR).displayName).toBe('Supervisor');
  });

  it('places Supervisor below Admin on the display ordinal', () => {
    expect(getRoleMetadata(ROLES.SUPERVISOR).level).toBeLessThan(getRoleMetadata(ROLES.ADMIN).level);
    expect(getRoleMetadata(ROLES.SUPERVISOR).level).toBeGreaterThan(getRoleMetadata(ROLES.INSTALLER).level);
  });
});
