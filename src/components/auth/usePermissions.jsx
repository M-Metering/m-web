// src/components/auth/usePermissions.js
// Optimized permissions hook aligned with latest app version
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  ROLES,
  PERMISSIONS,
  hasPermission,
  hasPermissions,
  hasAnyPermission,
  canAccessPage,
  getAllPermissionsForRole,
  getRoleMetadata
} from './permissions';

/**
 * Main permissions hook providing comprehensive access control
 */
export function usePermissions() {
  const { user } = useAuth();
  // Role strings from the API (and AuthContext's normalizeUser) are
  // uppercase (SUPERADMIN/ADMIN/INSTALLER) — used as-is, no case translation.
  const userRole = user?.role || null;

  // Compute role flags
  const isSuperAdmin = useMemo(() => userRole === ROLES.SUPERADMIN, [userRole]);
  const isAdminRole = useMemo(() => userRole === ROLES.ADMIN, [userRole]);
  // "isAdmin" here means admin-tier access (ADMIN or SUPERADMIN) — kept as
  // the name every call site already uses for the coarse full-access check.
  // Use isSuperAdmin/isAdminRole directly where the distinction matters
  // (e.g. gating creation of ADMIN/SUPERADMIN accounts).
  const isAdmin = useMemo(() => isAdminRole || isSuperAdmin, [isAdminRole, isSuperAdmin]);
  const isInstaller = useMemo(() => userRole === ROLES.INSTALLER, [userRole]);
  // Supervisor is deliberately OUTSIDE `isAdmin`: every existing
  // `permissions.isAdmin` gate in the app (users, reports, payments,
  // settings, schedule, imports, every *:MANAGE action) therefore denies it
  // without any of those call sites having to learn about the new role.
  // What a Supervisor may reach is granted explicitly below instead.
  const isSupervisor = useMemo(() => userRole === ROLES.SUPERVISOR, [userRole]);

  // Get role metadata
  const roleMetadata = useMemo(() => getRoleMetadata(userRole), [userRole]);

  // Get all permissions for user's role
  const permissions = useMemo(() => getAllPermissionsForRole(userRole), [userRole]);

  // Pre-compute common permission checks for better performance
  const permissionChecks = useMemo(() => ({
    // Dashboard permissions
    canViewDashboard: isAdmin || hasPermission(userRole, PERMISSIONS.DASHBOARD.VIEW),
    // Which dashboard /dashboard renders. Supervisor gets the pipeline
    // dashboard rather than the Installer one — it has no field jobs of its
    // own — but the money figures on it are gated separately below.
    canViewAdminDashboard: isAdmin || isSupervisor,
    canViewInstallerDashboard: hasPermission(userRole, PERMISSIONS.DASHBOARD.VIEW_INSTALLER),

    // Installation permissions
    canViewInstallations: hasPermission(userRole, PERMISSIONS.INSTALLATIONS.VIEW),
    canViewAllInstallations: isAdmin || hasPermission(userRole, PERMISSIONS.INSTALLATIONS.VIEW_ALL),
    canManageInstallations: isAdmin || hasPermission(userRole, PERMISSIONS.INSTALLATIONS.MANAGE),
    canCompleteInstallations: hasPermission(userRole, PERMISSIONS.INSTALLATIONS.COMPLETE),
    
    // User management permissions
    canViewUsers: isAdmin || hasPermission(userRole, PERMISSIONS.USERS.VIEW),
    canManageUsers: isAdmin,
    canCreateUsers: isAdmin,
    canUpdateUsers: isAdmin,
    canDeleteUsers: isAdmin,
    
    // Report permissions
    canViewReports: isAdmin || hasPermission(userRole, PERMISSIONS.REPORTS.VIEW),
    canExportReports: isAdmin || hasPermission(userRole, PERMISSIONS.REPORTS.EXPORT),
    canGenerateReports: isAdmin,
    
    // Schedule permissions
    canViewSchedule: hasPermission(userRole, PERMISSIONS.SCHEDULE.VIEW),
    canManageSchedule: isAdmin || hasPermission(userRole, PERMISSIONS.SCHEDULE.MANAGE),
    
    // Settings permissions
    canViewSettings: isAdmin,
    canManageSettings: isAdmin,
    
    // Upload permissions
    canUploadExcel: hasPermission(userRole, PERMISSIONS.UPLOADS.EXCEL),
    canUploadFiles: isAdmin || hasPermission(userRole, PERMISSIONS.UPLOADS.FILES),

    // Payments / money. Named explicitly because Supervisor must not see
    // financial figures anywhere, including the revenue KPI and trend chart
    // on the dashboard it CAN reach — `isAdmin` alone already excludes it,
    // but a named check says why at the point of use.
    canViewPayments: isAdmin || hasPermission(userRole, PERMISSIONS.PAYMENTS.VIEW),
    canManagePayments: isAdmin,

    // Complaint form — Installer only (a complaint must be attributable to
    // the installer who raised it; admin-tier accounts bypass hasPermission()
    // for every permission, so the role is checked explicitly here).
    canSubmitComplaints: userRole === ROLES.INSTALLER && hasPermission(userRole, PERMISSIONS.COMPLAINTS.CREATE),

    // Multi-disco installation flow (2026-09-21).
    // "My Jobs" is Installer-only: the API scopes /installations/me/* to the
    // caller's token, so an admin-tier account would get an empty list rather
    // than an overview — admins use the Installation Requests page instead.
    canViewMyJobs: userRole === ROLES.INSTALLER && hasPermission(userRole, PERMISSIONS.INSTALLATIONS.FIELD_JOBS),
    canRunImports: isAdmin || hasPermission(userRole, PERMISSIONS.IMPORTS.RUN),
    // Reaching the Assignments page vs. actually dispatching from it. These
    // were one check until Supervisor existed; they are separate now because
    // Supervisor holds ASSIGNMENTS.VIEW and not ASSIGNMENTS.MANAGE.
    canViewAssignments: isAdmin || hasPermission(userRole, PERMISSIONS.ASSIGNMENTS.VIEW),
    canManageAssignments: isAdmin || hasPermission(userRole, PERMISSIONS.ASSIGNMENTS.MANAGE),
    canViewInstallationRequests: isAdmin || hasPermission(userRole, PERMISSIONS.INSTALLATIONS.VIEW_ALL),

    // Meter dispatch capacity rule (see utils/meterCapacity.js). An Admin may
    // only hand an installer meters the installer has matching open jobs for;
    // a Super Admin may dispatch independently of any job assignment. This is
    // the ONE place that decides which, so the hook, the pickers and the
    // summary can never disagree about it.
    enforcesMeterCapacity: !isSuperAdmin,
  }), [userRole, isAdmin, isSuperAdmin, isSupervisor]);

  return {
    // User context
    user,
    userRole,
    isAuthenticated: !!user,
    
    // Role flags
    isAdmin,
    isAdminRole,
    isSuperAdmin,
    isInstaller,
    isSupervisor,
    
    // Role metadata
    roleDisplayName: roleMetadata.displayName,
    roleDescription: roleMetadata.description,
    roleLevel: roleMetadata.level,
    roleColor: roleMetadata.color,
    
    // All permissions
    permissions,
    
    // Permission checks
    ...permissionChecks,
    
    // Helper functions
    hasPermission: (permission) => isAdmin || hasPermission(userRole, permission),
    hasPermissions: (perms) => isAdmin || hasPermissions(userRole, perms),
    hasAnyPermission: (perms) => isAdmin || hasAnyPermission(userRole, perms),
    canAccessPage: (page) => isAdmin || canAccessPage(userRole, page)
  };
}

export default usePermissions;
