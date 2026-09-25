// src/components/auth/permissions.js
// Optimized permissions system aligned with latest app version
//
// CONSOLIDATION NOTE: an earlier duplicate of this file was mistakenly
// created elsewhere in this project's history (reconstructed under the
// wrong assumption that this file didn't exist yet). This is the one real
// file — the duplicate never actually reached the codebase and should be
// disregarded/deleted if a copy of it exists anywhere. Two real bugs found
// while consolidating are fixed below (see ROLE_PERMISSIONS[INSTALLER]).

// Role definitions — values match the real Pharez API's User.role enum
// exactly (SUPERADMIN/ADMIN/SUPERVISOR/INSTALLER, uppercase). Role strings
// from the API are used as-is throughout the app (no case normalization), so
// these must stay in sync with that enum.
export const ROLES = Object.freeze({
  SUPERADMIN: 'SUPERADMIN',
  ADMIN: 'ADMIN',
  // SUPERVISOR — shipped by the backend on 2026-09-24 and confirmed present in
  // User.role, UserCreate.role and UserUpdate.role on the live OpenAPI
  // document. An ADMIN narrowed to installations and assignments; it is NOT
  // part of the admin tier and inherits nothing from ADMIN, so every
  // permission it holds is listed explicitly in ROLE_PERMISSIONS below.
  SUPERVISOR: 'SUPERVISOR',
  INSTALLER: 'INSTALLER'
});

// Roles only a Super Admin may create or assign. The API's rule (Frontend
// Integration Guide, 2026-09-24) is that an ADMIN may create INSTALLER and
// ADMIN accounts but not SUPERVISOR or SUPERADMIN. This app is deliberately
// stricter still — see UserManagement.jsx, where an Admin's scope stays
// Installers only — so this set is the ceiling, not the whole rule.
export const isPrivilegedRole = (role) =>
  role === ROLES.ADMIN || role === ROLES.SUPERADMIN || role === ROLES.SUPERVISOR;

// Permission definitions organized by feature
export const PERMISSIONS = Object.freeze({
  // Dashboard permissions
  DASHBOARD: {
    VIEW: 'dashboard:view',
    VIEW_ADMIN: 'dashboard:view_admin',
    VIEW_INSTALLER: 'dashboard:view_installer'
  },
  
  // Installation permissions. There is no CREATE here — customer requests
  // are created by JED server-to-server (POST /external/jed/generate-ref),
  // never by this app; the standalone "Complete Installation" tab that
  // used to model a CREATE-shaped permission was removed (completion now
  // only happens from within a job opened from Awaiting Installation).
  INSTALLATIONS: {
    VIEW: 'installations:view',
    VIEW_ALL: 'installations:view_all',
    MANAGE: 'installations:manage',
    COMPLETE: 'installations:complete',
    // Multi-disco flow (2026-09-21): an Installer's own assigned jobs and the
    // meters in their hands (GET /installations/me/*, scoped by their JWT).
    // Distinct from VIEW/COMPLETE above, which cover the JED queue.
    FIELD_JOBS: 'installations:field_jobs'
  },

  // Multi-disco flow — admin-tier operations. Disco *configuration*
  // (create/mapping/export-template) is SUPERADMIN-only per the API and is
  // gated with `permissions.isSuperAdmin` at the point of use, the same way
  // privileged user creation is — not as a permission here, because
  // hasPermission() short-circuits to true for the whole admin tier.
  IMPORTS: {
    VIEW: 'imports:view',
    RUN: 'imports:run'
  },

  ASSIGNMENTS: {
    VIEW: 'assignments:view',
    MANAGE: 'assignments:manage'
  },
  
  // User management permissions
  USERS: {
    VIEW: 'users:view',
    CREATE: 'users:create',
    UPDATE: 'users:update',
    DELETE: 'users:delete',
    MANAGE: 'users:manage'
  },
  
  // Reports permissions
  REPORTS: {
    VIEW: 'reports:view',
    EXPORT: 'reports:export',
    GENERATE: 'reports:generate'
  },
  
  // Schedule permissions
  SCHEDULE: {
    VIEW: 'schedule:view',
    MANAGE: 'schedule:manage'
  },
  
  // Settings permissions
  SETTINGS: {
    VIEW: 'settings:view',
    MANAGE: 'settings:manage'
  },
  
  // Upload permissions
  UPLOADS: {
    EXCEL: 'uploads:excel',
    FILES: 'uploads:files'
  },
  
  // Payments permissions — added for the Payments/Remita-reconciliation
  // page (/payments): view payment records and Remita status, and the
  // more consequential ability to manually confirm a missed-webhook
  // payment. Kept admin-only (see PAGE_ACCESS and ROLE_PERMISSIONS below)
  // since manual confirmation is a money-adjacent action.
  PAYMENTS: {
    VIEW: 'payments:view',
    MANAGE: 'payments:manage'
  },

  // Complaints — an Installer reports a problem with a job. CREATE and
  // VIEW_OWN are the Installer's; MANAGE (review/triage/resolve everyone's)
  // is admin-tier and is reserved for when the backend provides a complaints
  // API — there is nothing for it to act on yet.
  COMPLAINTS: {
    CREATE: 'complaints:create',
    VIEW_OWN: 'complaints:view_own',
    MANAGE: 'complaints:manage'
  }
});

// Full admin-tier permission set — shared base for ADMIN and SUPERADMIN.
// SUPERADMIN is a strict superset (see below); keeping one source list
// here means the two roles can't silently drift apart.
const ADMIN_TIER_PERMISSIONS = [
  // Dashboard - Full access
  PERMISSIONS.DASHBOARD.VIEW,
  PERMISSIONS.DASHBOARD.VIEW_ADMIN,
  PERMISSIONS.DASHBOARD.VIEW_INSTALLER,

  // Installations - Full access
  PERMISSIONS.INSTALLATIONS.VIEW,
  PERMISSIONS.INSTALLATIONS.VIEW_ALL,
  PERMISSIONS.INSTALLATIONS.MANAGE,
  PERMISSIONS.INSTALLATIONS.COMPLETE,

  // Users - Full access (creating/editing ADMIN or SUPERADMIN accounts is
  // additionally gated to SUPERADMIN directly in UserManagement.jsx, per
  // the API's documented "Create an Admin user (SUPERADMIN only)" rule —
  // that's a finer-grained business rule than this permission system
  // expresses, so it's enforced at the point of use, not here.)
  PERMISSIONS.USERS.VIEW,
  PERMISSIONS.USERS.CREATE,
  PERMISSIONS.USERS.UPDATE,
  PERMISSIONS.USERS.DELETE,
  PERMISSIONS.USERS.MANAGE,

  // Reports - Full access
  PERMISSIONS.REPORTS.VIEW,
  PERMISSIONS.REPORTS.EXPORT,
  PERMISSIONS.REPORTS.GENERATE,

  // Schedule - Full access
  PERMISSIONS.SCHEDULE.VIEW,
  PERMISSIONS.SCHEDULE.MANAGE,

  // Settings - Full access
  PERMISSIONS.SETTINGS.VIEW,
  PERMISSIONS.SETTINGS.MANAGE,

  // Uploads - Full access
  PERMISSIONS.UPLOADS.EXCEL,
  PERMISSIONS.UPLOADS.FILES,

  // Payments - Full access
  PERMISSIONS.PAYMENTS.VIEW,
  PERMISSIONS.PAYMENTS.MANAGE,

  // Complaints - review/manage (see PERMISSIONS.COMPLAINTS)
  PERMISSIONS.COMPLAINTS.CREATE,
  PERMISSIONS.COMPLAINTS.VIEW_OWN,
  PERMISSIONS.COMPLAINTS.MANAGE,

  // Multi-disco flow - spreadsheet import and installer dispatch
  PERMISSIONS.IMPORTS.VIEW,
  PERMISSIONS.IMPORTS.RUN,
  PERMISSIONS.ASSIGNMENTS.VIEW,
  PERMISSIONS.ASSIGNMENTS.MANAGE
];

// Role-based permissions mapping
const ROLE_PERMISSIONS = Object.freeze({
  // SUPERADMIN and ADMIN share the same permission set at this granularity
  // — the real distinction between them (who can create ADMIN/SUPERADMIN
  // users, who can manage API keys/system config) is a narrower business
  // rule enforced directly where it matters (UserManagement.jsx), not a
  // separate permission tier here.
  [ROLES.SUPERADMIN]: new Set(ADMIN_TIER_PERMISSIONS),
  [ROLES.ADMIN]: new Set(ADMIN_TIER_PERMISSIONS),

  // SUPERVISOR — "an ADMIN whose access has been narrowed to installations
  // and assignments", which is the backend's own description of the role
  // (Frontend Integration Guide, 2026-09-24) and the shape this set mirrors:
  //
  //   Installations  full, same as ADMIN — create, list, search, view, cancel,
  //                  statistics, disco export, mark-exported
  //   Assignments    full, same as ADMIN — assign/return meters, assign and
  //                  unassign installation jobs, list/view batches
  //   Meters         READ-ONLY — list, search, by id, by meter number.
  //                  No upload, export, statistics or delete (all 403).
  //   Users          READ-ONLY installer roster — list/search/view INSTALLER
  //                  accounts and itself. No create, edit, delete or restore.
  //   Everything else  no access: finance, imports, settings (meter types),
  //                  disco management, API keys — all 403 server-side.
  //
  // Deliberately NOT built from ADMIN_TIER_PERMISSIONS minus exclusions: an
  // allow-list can't silently grow when a new admin permission is added to
  // that array, whereas a deny-list would. Every entry below is here because
  // the API grants it — check the guide's permission table before adding one.
  //
  // NOTE: Supervisor holds ASSIGNMENTS.MANAGE, so it CAN dispatch meters, and
  // is therefore subject to the same per-meter-type capacity rule as an Admin
  // (`enforcesMeterCapacity` is false only for SUPERADMIN).
  [ROLES.SUPERVISOR]: new Set([
    PERMISSIONS.DASHBOARD.VIEW,

    // Installations: the combined area, the detail view, and the operations on
    // an imported job (assign, unassign, cancel, export & mark sent).
    // INSTALLATIONS.COMPLETE is withheld: PATCH /:id/start, POST /:id/report
    // and POST /:id/fail are INSTALLER-only on the API, and completing a JED
    // job is the installer's task too.
    PERMISSIONS.INSTALLATIONS.VIEW,
    PERMISSIONS.INSTALLATIONS.VIEW_ALL,
    PERMISSIONS.INSTALLATIONS.MANAGE,

    // Assignments: every /assignments/* route, same as ADMIN.
    PERMISSIONS.ASSIGNMENTS.VIEW,
    PERMISSIONS.ASSIGNMENTS.MANAGE,

    // Meter inventory, read-only. SCHEDULE.MANAGE is withheld, which is what
    // gates the export and the statistics call on Meter Schedule; UPLOADS.EXCEL
    // is absent, which blocks the upload page; deleting is SUPERADMIN-only at
    // the point of use. So this grants exactly list/search/view.
    PERMISSIONS.SCHEDULE.VIEW,

    // The installer roster, read-only — this is also what makes the "assign
    // installer" picker work for a Supervisor (GET /users?role=INSTALLER is
    // the only user-list access the API gives it). USERS.CREATE/UPDATE/
    // DELETE/MANAGE are all withheld.
    PERMISSIONS.USERS.VIEW
  ]),

  [ROLES.INSTALLER]: new Set([
    // Dashboard - Installer view only
    PERMISSIONS.DASHBOARD.VIEW,
    PERMISSIONS.DASHBOARD.VIEW_INSTALLER,
    
    // Installations - Limited access
    PERMISSIONS.INSTALLATIONS.VIEW,
    PERMISSIONS.INSTALLATIONS.COMPLETE,

    // Meter Schedule is deliberately NOT granted to Installer — it's an
    // Admin/Super Admin-only inventory management page. (A previous pass
    // added SCHEDULE.VIEW here to match a stray Navigation.jsx entry that
    // showed the link to every role; the correct fix was the other way
    // around — Navigation.jsx's `schedule` item is now gated to admin-tier
    // roles instead, and the App.jsx route guard already reads this same
    // canViewSchedule permission, so removing it here blocks direct-URL
    // access too.)

    // Uploads (bulk Excel meter registration) is deliberately NOT granted to
    // Installer either (removed 2026-09-20 — it used to hold
    // UPLOADS.EXCEL). Same mechanism as Meter Schedule above: the sidebar
    // item, the /uploads route guard (App.jsx) and ExcelUpload's own
    // component-level check all read this one permission, so omitting it
    // here removes the tab, blocks direct-URL access and blocks rendering
    // the page in one place. Client-side only — see Security.md for the
    // backend-enforcement caveat on POST /meters/upload and /uploads/*.

    // Complaint form (report a problem that blocks/delays an installation).
    // Installer-only by design: a complaint must be attributable to the
    // installer who raised it. The backend has no complaints endpoint yet
    // (API_GAP_REPORT.md), so this only gates the form itself.
    PERMISSIONS.COMPLAINTS.CREATE,
    PERMISSIONS.COMPLAINTS.VIEW_OWN,

    // Multi-disco flow: the installer's own dispatched jobs and meters. The
    // API scopes both to the caller's token, so this grants no visibility of
    // anyone else's work.
    PERMISSIONS.INSTALLATIONS.FIELD_JOBS
  ])
});

// Page access configuration - Maps pages to required permissions
const PAGE_ACCESS = Object.freeze({
  dashboard: [PERMISSIONS.DASHBOARD.VIEW],
  schedule: [PERMISSIONS.SCHEDULE.VIEW],
  users: [PERMISSIONS.USERS.VIEW],
  reports: [PERMISSIONS.REPORTS.VIEW],
  uploads: [PERMISSIONS.UPLOADS.EXCEL],
  settings: [PERMISSIONS.SETTINGS.VIEW],
  // Admin-only by omission from the installer Set above — same pattern
  // already used for users/reports/settings, no special-casing needed.
  payments: [PERMISSIONS.PAYMENTS.VIEW],
  complaints: [PERMISSIONS.COMPLAINTS.CREATE],
  // Multi-disco flow
  imports: [PERMISSIONS.IMPORTS.VIEW],
  assignments: [PERMISSIONS.ASSIGNMENTS.VIEW],
  // The one Installations page (both views — see InstallationsPage.jsx).
  // Renamed from 'installation-requests' when those two top-level items
  // merged; the permission itself is unchanged.
  installations: [PERMISSIONS.INSTALLATIONS.VIEW_ALL],
  'my-jobs': [PERMISSIONS.INSTALLATIONS.FIELD_JOBS]
});

// Permission check with caching
const permissionCache = new Map();

// ADMIN and SUPERADMIN are both full-access "admin tier" roles for the
// purposes of the coarse bypass checks below (see ADMIN_TIER_PERMISSIONS).
const isAdminTier = (userRole) => userRole === ROLES.ADMIN || userRole === ROLES.SUPERADMIN;

/**
 * Check if a role has a specific permission
 */
export const hasPermission = (userRole, permission) => {
  if (!userRole || !permission) return false;

  // Admin/Superadmin have all permissions
  if (isAdminTier(userRole)) return true;

  // Check cache
  const cacheKey = `${userRole}:${permission}`;
  if (permissionCache.has(cacheKey)) {
    return permissionCache.get(cacheKey);
  }

  // Check permission
  const rolePermissions = ROLE_PERMISSIONS[userRole];
  const result = rolePermissions ? rolePermissions.has(permission) : false;

  // Cache result
  permissionCache.set(cacheKey, result);

  return result;
};

/**
 * Check if role has all permissions
 */
export const hasPermissions = (userRole, permissions) => {
  if (!userRole || !Array.isArray(permissions)) return false;
  if (permissions.length === 0) return true;

  // Admin/Superadmin have all permissions
  if (isAdminTier(userRole)) return true;

  return permissions.every(permission => hasPermission(userRole, permission));
};

/**
 * Check if role has any of the permissions
 */
export const hasAnyPermission = (userRole, permissions) => {
  if (!userRole || !Array.isArray(permissions)) return false;
  if (permissions.length === 0) return false;

  // Admin/Superadmin have all permissions
  if (isAdminTier(userRole)) return true;

  return permissions.some(permission => hasPermission(userRole, permission));
};

/**
 * Check if user can access a specific page
 */
export const canAccessPage = (userRole, pageName) => {
  if (!userRole || !pageName) return false;

  // Admin/Superadmin can access all pages
  if (isAdminTier(userRole)) return true;

  const requiredPermissions = PAGE_ACCESS[pageName];
  if (!requiredPermissions) return false;

  return hasAnyPermission(userRole, requiredPermissions);
};

/**
 * Get all permissions for a role
 */
export const getAllPermissionsForRole = (userRole) => {
  if (!userRole) return [];
  
  const permissionSet = ROLE_PERMISSIONS[userRole];
  return permissionSet ? Array.from(permissionSet) : [];
};

/**
 * Get role metadata
 */
export const getRoleMetadata = (role) => {
  // `level` is a display-only ordinal (highest = most access). Nothing in the
  // app authorizes on it — every check goes through hasPermission/
  // canAccessPage — so Supervisor slotting in between Installer and Admin is
  // presentational, not a privilege ladder.
  const metadata = {
    [ROLES.SUPERADMIN]: {
      displayName: 'Super Administrator',
      description: 'Full system access, including privileged user management',
      level: 4,
      color: 'red'
    },
    [ROLES.ADMIN]: {
      displayName: 'Administrator',
      description: 'Full system access',
      level: 3,
      color: 'purple'
    },
    [ROLES.SUPERVISOR]: {
      displayName: 'Supervisor',
      description: 'Installations and assignments, with read-only meters and installers',
      level: 2,
      color: 'amber'
    },
    [ROLES.INSTALLER]: {
      displayName: 'Installer',
      description: 'Field technician',
      level: 1,
      color: 'blue'
    }
  };

  return metadata[role] || {};
};

/**
 * Get display name for a permission
 */
export const getPermissionDisplayName = (permission) => {
  const names = {
    [PERMISSIONS.DASHBOARD.VIEW]: 'View Dashboard',
    [PERMISSIONS.DASHBOARD.VIEW_ADMIN]: 'View Admin Dashboard',
    [PERMISSIONS.DASHBOARD.VIEW_INSTALLER]: 'View Installer Dashboard',
    [PERMISSIONS.INSTALLATIONS.VIEW]: 'View Installations',
    [PERMISSIONS.INSTALLATIONS.VIEW_ALL]: 'View All Installations',
    [PERMISSIONS.INSTALLATIONS.MANAGE]: 'Manage Installations',
    [PERMISSIONS.INSTALLATIONS.COMPLETE]: 'Complete Installations',
    [PERMISSIONS.USERS.VIEW]: 'View Users',
    [PERMISSIONS.USERS.CREATE]: 'Create Users',
    [PERMISSIONS.USERS.UPDATE]: 'Update Users',
    [PERMISSIONS.USERS.DELETE]: 'Delete Users',
    [PERMISSIONS.USERS.MANAGE]: 'Manage Users',
    [PERMISSIONS.REPORTS.VIEW]: 'View Reports',
    [PERMISSIONS.REPORTS.EXPORT]: 'Export Reports',
    [PERMISSIONS.REPORTS.GENERATE]: 'Generate Reports',
    [PERMISSIONS.SCHEDULE.VIEW]: 'View Schedule',
    [PERMISSIONS.SCHEDULE.MANAGE]: 'Manage Schedule',
    [PERMISSIONS.SETTINGS.VIEW]: 'View Settings',
    [PERMISSIONS.SETTINGS.MANAGE]: 'Manage Settings',
    [PERMISSIONS.UPLOADS.EXCEL]: 'Upload Excel Files',
    [PERMISSIONS.UPLOADS.FILES]: 'Upload Files',
    [PERMISSIONS.PAYMENTS.VIEW]: 'View Payments',
    [PERMISSIONS.PAYMENTS.MANAGE]: 'Manage Payments',
    [PERMISSIONS.COMPLAINTS.CREATE]: 'Submit Complaints',
    [PERMISSIONS.COMPLAINTS.VIEW_OWN]: 'View Own Complaints',
    [PERMISSIONS.COMPLAINTS.MANAGE]: 'Manage Complaints',
    [PERMISSIONS.INSTALLATIONS.FIELD_JOBS]: 'View Own Dispatched Jobs',
    [PERMISSIONS.IMPORTS.VIEW]: 'View Imports',
    [PERMISSIONS.IMPORTS.RUN]: 'Run Spreadsheet Imports',
    [PERMISSIONS.ASSIGNMENTS.VIEW]: 'View Assignments',
    [PERMISSIONS.ASSIGNMENTS.MANAGE]: 'Assign Meters and Jobs'
  };
  
  return names[permission] || permission;
};

/**
 * Clear permission cache
 */
export const clearPermissionCache = () => {
  permissionCache.clear();
};

export default {
  ROLES,
  PERMISSIONS,
  isPrivilegedRole,
  hasPermission,
  hasPermissions,
  hasAnyPermission,
  canAccessPage,
  getAllPermissionsForRole,
  getRoleMetadata,
  getPermissionDisplayName,
  clearPermissionCache
};