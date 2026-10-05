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

// The scope is the backend's own role table (Frontend Integration Update,
// 2026-10-04): installations, assignments and imports in full; meters
// including upload, export and statistics (not delete); the installer roster
// read-only; no money, prices, settings or users management.
describe('SUPERVISOR — module access', () => {
  it('reaches installations, assignments, imports (view), meters and users — and the dashboard, not meter upload', () => {
    // 2026-10-05: POST /meters/upload is 403 for SUPERVISOR, so /uploads is gone.
    const reachable = PAGES.filter((page) => canAccessPage(ROLES.SUPERVISOR, page));
    expect(reachable.sort()).toEqual(['assignments', 'dashboard', 'imports', 'installations', 'schedule', 'users']);
  });

  it.each(['payments', 'reports', 'settings', 'complaints', 'my-jobs'])(
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
      PERMISSIONS.SCHEDULE.MANAGE,
      PERMISSIONS.IMPORTS.VIEW,
      PERMISSIONS.USERS.VIEW,
      PERMISSIONS.INSTALLERS.VIEW_STATUS,
      PERMISSIONS.INSTALLATIONS.EXPORT,
    ].sort());
  });

  it('can export installations without gaining any admin-only module', () => {
    expect(hasPermission(ROLES.SUPERVISOR, PERMISSIONS.INSTALLATIONS.EXPORT)).toBe(true);
    [PERMISSIONS.USERS.CREATE, PERMISSIONS.SETTINGS.VIEW, PERMISSIONS.PAYMENTS.VIEW, PERMISSIONS.REPORTS.VIEW]
      .forEach((p) => expect(hasPermission(ROLES.SUPERVISOR, p)).toBe(false));
    expect(hasPermission(ROLES.INSTALLER, PERMISSIONS.INSTALLATIONS.EXPORT)).toBe(false);
  });

  it('never gives an Installer the overview of other installers', () => {
    expect(hasPermission(ROLES.INSTALLER, PERMISSIONS.INSTALLERS.VIEW_STATUS)).toBe(false);
  });

  it.each([
    ['dispatch meters', PERMISSIONS.ASSIGNMENTS.MANAGE],
    ['assign and cancel installation jobs', PERMISSIONS.INSTALLATIONS.MANAGE],
    ['see the meter inventory', PERMISSIONS.SCHEDULE.VIEW],
    ['export meters and read meter statistics', PERMISSIONS.SCHEDULE.MANAGE],
    ['view imports, history and templates', PERMISSIONS.IMPORTS.VIEW],
    ['see the installer roster', PERMISSIONS.USERS.VIEW],
  ])('can %s', (_label, permission) => {
    expect(hasPermission(ROLES.SUPERVISOR, permission)).toBe(true);
  });

  // Per-Disco Access update §6 (2026-10-05): export yes, import/upload/undo no.
  it.each([
    ['upload the meter workbook', PERMISSIONS.UPLOADS.EXCEL],
    ['run or undo imports', PERMISSIONS.IMPORTS.RUN],
  ])('can no longer %s', (_label, permission) => {
    expect(hasPermission(ROLES.SUPERVISOR, permission)).toBe(false);
  });

  it.each([
    // Installer-only on the API: start / report / fail a job.
    ['complete an installation', PERMISSIONS.INSTALLATIONS.COMPLETE],
    // Read-only on users: no create, edit, delete or restore.
    ['create users', PERMISSIONS.USERS.CREATE],
    ['edit users', PERMISSIONS.USERS.UPDATE],
    ['delete users', PERMISSIONS.USERS.DELETE],
    ['manage users', PERMISSIONS.USERS.MANAGE],
    // No access at all.
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
