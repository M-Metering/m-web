// src/components/common/Navigation.jsx
// Single sidebar navigation surface, mobile-first: base (unprefixed)
// classes render it as an off-canvas drawer (the old MobileSidebar
// behavior); `lg:` classes turn it into a persistent, always-visible
// column fixed to the left edge of the viewport. There is no longer a
// separate desktop top tab bar or mobile bottom tab bar — one nav
// surface, one set of items, across every breakpoint.
//
// The persistent lg+ sidebar can also be collapsed to an icon-only rail
// (`collapsed`/`onToggleCollapse`, lifted to App.jsx since the content
// column's offset has to track the sidebar's current width). Collapsing
// only ever applies at lg+ — the mobile drawer always shows full labels,
// since there's no room pressure to save there the way there is on a
// permanently-docked desktop rail.
import {
  LayoutDashboard, Database, Users, BarChart3,
  Upload, Settings, X, CreditCard, ChevronsLeft, ChevronsRight,
  ClipboardList, MessageSquareWarning, FileSpreadsheet, Send, Wrench
} from 'lucide-react';
import { useEffect, useCallback, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import InfoModal from './InfoModal';
import { ROLES, canAccessPage } from '../auth/permissions';

// Role strings match the real API's User.role enum (uppercase). SUPERVISOR is
// NOT admin tier — the items still gated on this helper (Meter Schedule,
// Users, Reports, Payments, Settings) are exactly the ones a Supervisor must
// not see, so they need no further change.
const isAdminTierRole = (role) => role === ROLES.ADMIN || role === ROLES.SUPERADMIN;

// Sidebar widths — kept in one place since App.jsx's content column needs
// a matching `lg:pl-*` offset to sit beside (not under) the persistent
// desktop sidebar, and that offset has to track collapsed/expanded state.
export const SIDEBAR_WIDTH_EXPANDED_CLASS = 'lg:w-64';
export const SIDEBAR_WIDTH_COLLAPSED_CLASS = 'lg:w-20';
export const CONTENT_OFFSET_EXPANDED_CLASS = 'lg:pl-64';
export const CONTENT_OFFSET_COLLAPSED_CLASS = 'lg:pl-20';

const NAVIGATION_CONFIG = {
  ITEMS: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      path: '/dashboard',
      icon: LayoutDashboard,
      description: 'Overview and statistics',
      accessible: () => true,
    },
    {
      id: 'my-jobs',
      label: 'My Jobs',
      path: '/my-jobs',
      icon: Wrench,
      description: 'Jobs dispatched to you and your meters',
      // Installer only — GET /installations/me/* is scoped to the caller's
      // own token, so it would be empty for an admin-tier account.
      accessible: (userRole) => userRole === ROLES.INSTALLER && canAccessPage(userRole, 'my-jobs'),
    },
    {
      // One Installations area (2026-09-23). It holds both views that used
      // to be separate top-level items — "All Requests" (imported jobs +
      // JED's Remita requests, dispatch, disco export) and "JED Queue"
      // (PAID -> COMPLETED) — because their data overlapped while their
      // workflows did not. See InstallationsPage.jsx.
      id: 'installations',
      label: 'Installations',
      path: '/installations',
      icon: ClipboardList,
      description: 'Every disco\'s requests, dispatch, and the JED queue',
      // Permission-driven rather than a hard-coded role list, so it can't
      // drift from App.jsx's route guard: admin-tier accounts get it through
      // canAccessPage's admin short-circuit, Supervisor through its explicit
      // INSTALLATIONS.VIEW_ALL grant.
      accessible: (userRole) => canAccessPage(userRole, 'installations'),
    },
    {
      id: 'imports',
      label: 'Imports',
      path: '/imports',
      icon: FileSpreadsheet,
      description: 'Import disco customer & meter spreadsheets',
      accessible: (userRole) => canAccessPage(userRole, 'imports'),
    },
    {
      id: 'assignments',
      label: 'Assignments',
      path: '/assignments',
      icon: Send,
      description: 'Meter dispatch batches and installer assignments',
      accessible: (userRole) => canAccessPage(userRole, 'assignments'),
    },
    {
      id: 'schedule',
      label: 'Meter Schedule',
      path: '/schedule',
      icon: Database,
      description: 'View and query meter inventory',
      // Permission-driven: admin-tier in full, Supervisor read-only (it holds
      // SCHEDULE.VIEW without SCHEDULE.MANAGE). Installer holds neither and
      // must not see or reach this page, nor Uploads below.
      accessible: (userRole) => canAccessPage(userRole, 'schedule'),
    },
    {
      id: 'users',
      label: 'Users',
      path: '/users',
      icon: Users,
      description: 'Manage system users',
      // Admin-tier manages; Supervisor sees the Installer roster read-only.
      accessible: (userRole) => canAccessPage(userRole, 'users'),
    },
    {
      id: 'reports',
      label: 'Reports',
      path: '/reports',
      icon: BarChart3,
      description: 'Analytics & exports',
      accessible: (userRole) => isAdminTierRole(userRole)
    },
    {
      id: 'payments',
      label: 'Payments',
      path: '/payments',
      icon: CreditCard,
      description: 'Payment reconciliation & Remita status',
      accessible: (userRole) => isAdminTierRole(userRole)
    },
    {
      id: 'uploads',
      label: 'Uploads',
      path: '/uploads',
      icon: Upload,
      description: 'Upload meter data',
      // Driven by the permission model (auth/permissions.js), not a
      // hard-coded role list, so it can't drift from the route guard in
      // App.jsx and ExcelUpload's own check: Installer no longer holds
      // UPLOADS.EXCEL, so this is Admin/Super Admin only.
      accessible: (userRole) => canAccessPage(userRole, 'uploads')
    },
    {
      id: 'complaints',
      label: 'Complaints',
      path: '/complaints',
      icon: MessageSquareWarning,
      description: 'Report a problem with a job',
      // Installer only — a complaint must be attributable to the installer
      // who raised it (admin-tier accounts bypass canAccessPage, so the
      // role is checked explicitly).
      accessible: (userRole) => userRole === ROLES.INSTALLER && canAccessPage(userRole, 'complaints')
    },
    {
      id: 'settings',
      label: 'Settings',
      path: '/settings',
      icon: Settings,
      description: 'Application settings',
      accessible: (userRole) => isAdminTierRole(userRole)
    }
  ]
};

// Locks background scroll only while the mobile drawer (or the support
// modal) is actually open as an overlay — irrelevant at lg+, where the
// sidebar is part of the normal layout, not an overlay.
const useBodyScroll = (isOpen) => {
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);
};

function NavItem({ item, onClick, collapsed }) {
  const Icon = item.icon;

  return (
    <NavLink to={item.path} onClick={onClick} end title={collapsed ? item.label : undefined}>
      {({ isActive }) => (
        <div
          className={`w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-3.5 rounded-lg transition-colors duration-150 ${
            collapsed ? 'lg:justify-center lg:gap-0 lg:px-2.5' : ''
          } ${
            isActive
              ? 'bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800'
              : 'hover:bg-gray-50 dark:hover:bg-white/5 border border-transparent hover:border-gray-200 dark:hover:border-white/10'
          }`}
        >
          <div className={`p-2 rounded-lg flex-shrink-0 ${
            isActive
              ? 'bg-brand-500 text-gray-900'
              : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400'
          }`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className={`flex-1 text-left min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
            <p className={`font-semibold text-sm truncate ${isActive ? 'text-brand-900 dark:text-brand-300' : 'text-gray-800 dark:text-gray-200'}`}>
              {item.label}
            </p>
            <p className={`text-xs mt-0.5 truncate ${isActive ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500 dark:text-gray-500'}`}>
              {item.description}
            </p>
          </div>
          {isActive && <div className={`w-1.5 h-1.5 rounded-full bg-brand-600 flex-shrink-0 ${collapsed ? 'lg:hidden' : ''}`} />}
        </div>
      )}
    </NavLink>
  );
}

function Navigation({ userRole, isOpen, onClose, collapsed = false, onToggleCollapse }) {
  const [isSupportModalOpen, setSupportModalOpen] = useState(false);

  useBodyScroll(isOpen || isSupportModalOpen);

  const handleOpenSupportModal = useCallback(() => setSupportModalOpen(true), []);
  const handleCloseSupportModal = useCallback(() => setSupportModalOpen(false), []);

  const handleLinkClick = useCallback(() => {
    if (window.navigator.vibrate) window.navigator.vibrate(50);
    onClose?.();
  }, [onClose]);

  const filteredNavItems = useMemo(
    () => NAVIGATION_CONFIG.ITEMS.filter((item) => item.accessible(userRole)),
    [userRole]
  );

  return (
    <>
      {/* Overlay — mobile-only; the persistent lg+ sidebar has nothing to
          dim behind it. */}
      <div
        className={`
          fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden
          transition-all duration-300 ease-in-out
          ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
        onClick={onClose}
        aria-hidden={!isOpen}
      />

      {/* Sidebar — mobile-first: base classes are the off-canvas drawer
          (fixed, off-screen until `isOpen`, high z-index, overlay shadow).
          `lg:` classes override into a persistent column: always
          translated on-screen, fixed to the viewport's left edge, lower
          z-index (sits under the sticky header instead of above it), no
          backdrop shadow needed since it's part of the layout, not an
          overlay. Width switches between the expanded/collapsed constants
          based on `collapsed` (desktop-only concern, mobile always uses
          the full-width drawer). */}
      <aside
        className={`
          fixed top-0 left-0 bottom-0 w-80 max-w-[85vw] z-50 flex flex-col
          bg-white dark:bg-gray-900 shadow-lg
          border-r border-gray-200 dark:border-white/10
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:z-30 lg:shadow-none lg:max-w-none lg:transition-[width] lg:duration-200
          ${collapsed ? SIDEBAR_WIDTH_COLLAPSED_CLASS : SIDEBAR_WIDTH_EXPANDED_CLASS}
        `}
      >
        {/* Sidebar header / branding */}
        <div className="bg-brand-500 text-gray-900 p-5 flex-shrink-0">
          <div className={`flex items-center ${collapsed ? 'lg:justify-center' : 'justify-between'}`}>
            <div className={`flex items-center gap-3 min-w-0 ${collapsed ? 'lg:gap-0' : ''}`}>
              <img
                src="/brand-logo.png"
                alt="ME Metering"
                className="w-9 h-9 rounded-lg object-contain bg-white/90 p-0.5 flex-shrink-0"
              />
              <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
                <h2 className="font-bold text-base truncate">ME Metering System</h2>
              </div>
            </div>
            <button
              onClick={onClose}
              className={`p-2 hover:bg-white/10 rounded-lg transition-colors lg:hidden flex-shrink-0 ${collapsed ? 'lg:hidden' : ''}`}
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Collapse/expand toggle — desktop-only; the mobile drawer has
            no equivalent (it's already full-width or fully closed). */}
        <button
          onClick={onToggleCollapse}
          className={`hidden lg:flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-white/10 flex-shrink-0 ${
            collapsed ? 'lg:justify-center' : ''
          }`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>

        {/* Nav items */}
        <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
          {filteredNavItems.map((item) => (
            <NavItem key={item.id} item={item} onClick={handleLinkClick} collapsed={collapsed} />
          ))}
        </nav>

        {/* Support box — hidden in the collapsed rail; not enough room to
            say anything useful at icon-only width. */}
        <div className={`p-4 border-t border-gray-100 dark:border-white/10 flex-shrink-0 ${collapsed ? 'lg:hidden' : ''}`}>
          <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg p-3">
            <p className="text-xs font-semibold text-brand-900 dark:text-brand-300 mb-1">Need Help?</p>
            <p className="text-xs text-brand-700 dark:text-brand-400 mb-2.5">Contact the support team</p>
            <button
              className="w-full px-3 py-2 bg-brand-500 text-gray-900 text-xs font-semibold rounded-lg hover:bg-brand-600 transition-colors"
              onClick={handleOpenSupportModal}
            >
              Get Support
            </button>
          </div>
        </div>
      </aside>

      <InfoModal
        isOpen={isSupportModalOpen}
        onClose={handleCloseSupportModal}
        title="Contact Support"
      >
        <div className="text-center text-sm text-gray-600 dark:text-gray-400">
          <p className="mb-2">For any assistance or questions, please do not hesitate to reach out to our support team.</p>
          <p>You can email us at:</p>
          <a
            href="mailto:support@jedc.com"
            className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            support@jedc.com
          </a>
        </div>
      </InfoModal>
    </>
  );
}

export default Navigation;
