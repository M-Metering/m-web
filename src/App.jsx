// App.jsx - Final optimized version with admin full access
import { useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './components/contexts/AuthContext';
import { ThemeProvider, useTheme } from './components/contexts/ThemeContext';
import { DataRefreshProvider } from './components/contexts/DataRefreshContext';
import Login from './components/auth/Login';
import Header from './components/common/Header';
import Footer from './components/common/Footer';
import Navigation, {
  CONTENT_OFFSET_EXPANDED_CLASS,
  CONTENT_OFFSET_COLLAPSED_CLASS
} from './components/common/Navigation';
import { Suspense, lazy } from 'react';
import ErrorBoundary from './components/common/ErrorBoundary';
import { Loader2, Lock } from 'lucide-react';
import ErrorNotification from './components/common/ErrorNotification';
import { usePermissions } from './components/auth/usePermissions';
import { useAdminIdleTimeout } from './hooks/useAdminIdleTimeout';
import jedApi from './components/services/api';
import { getErrorMessage } from './utils/errorMessage';

const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'));
// Installer-facing tabbed dashboard (Pending/Completed) — added this project.
const InstallerDashboard = lazy(() => import('./components/dashboard/InstallerDashboard'));
// Click-through detail view reached from either dashboard's rows — added this project.
const InstallationDetail = lazy(() => import('./components/installation/InstallationDetail'));
const AdminReports = lazy(() => import('./components/admin/AdminReports'));
// The single Admin/Super Admin Installations area (2026-09-23). It carries
// two views — the combined request list and JED's PAID/COMPLETED queue —
// which used to be two top-level nav items. Each view is lazy-loaded inside
// it, so opening one doesn't download the other. See InstallationsPage.jsx
// for why they stayed two views rather than one merged table.
const InstallationsPage = lazy(() => import('./components/installations/InstallationsPage'));
// Simple operational Payments experience: real payment records, Confirm
// Payment, and bulk-import. The old diagnostic "RRR / Order Lookup" and
// "Webhook Replay" tabs were removed — see PaymentsPage.jsx's own header
// comment and API_GAP_REPORT.md.
const PaymentsPage = lazy(() => import('./components/admin/PaymentsPage'));
// Meter Schedule is the single entry point for meter inventory (list,
// filter, search, export, statistics, delete via the real GET /meters,
// GET /meters/statistics, DELETE /meters/{meterNumber} endpoints) — a
// separate standalone "Meters" page/route was removed as a duplicate.
const MeterSchedule = lazy(() => import('./components/schedule/MeterSchedule'));
const UserManagement = lazy(() => import('./components/admin/UserManagement'));
const ExcelUpload = lazy(() => import('./components/uploads/ExcelUpload'));
// Installer-only complaint form (report a problem that blocks/delays a job).
const ComplaintForm = lazy(() => import('./components/complaints/ComplaintForm'));
// Multi-disco installation flow (2026-09-21). A separate domain from the JED
// screens above — see API_GAP_REPORT.md and utils/installationStatus.js.
const ImportsPage = lazy(() => import('./components/admin/ImportsPage'));
const AssignmentsPage = lazy(() => import('./components/admin/AssignmentsPage'));
const MyJobs = lazy(() => import('./components/installations/MyJobs'));
// Tabbed Settings page (Meter Types + API Keys) — replaces direct
// MeterTypeSettings mount so both settings resources live under one route.
const SettingsPage = lazy(() => import('./components/settings/SettingsPage'));

const PageLoader = () => (
  <div className="flex flex-col items-center justify-center min-h-[50vh]">
    <Loader2 className="w-10 h-10 animate-spin text-brand-600 mb-4" />
    <p className="text-gray-500 font-medium">Loading...</p>
  </div>
);

// Access Denied Component - Only shown to installers on restricted pages
const AccessDenied = () => (
  <div className="min-h-[400px] flex items-center justify-center p-4">
    <div className="text-center max-w-md">
      <Lock className="w-16 h-16 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Access Denied
      </h2>
      <p className="text-gray-600 dark:text-gray-400">
        You don't have permission to access this page. Please contact your administrator.
      </p>
    </div>
  </div>
);

function AppContent() {
  const { user, login, logout, isAuthenticated } = useAuth();
  const permissions = usePermissions();
  const { isDark } = useTheme();
  const [globalError, setGlobalError] = useState(null);
  const navigate = useNavigate();

  // 3-minute inactivity logout for office accounts — Admin, Super Admin and
  // Supervisor. It no-ops entirely for Installer (a field technician is not
  // sitting at a desk between jobs) and for a logged-out user.
  useAdminIdleTimeout(isAuthenticated && (permissions.isAdmin || permissions.isSupervisor));

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Desktop sidebar collapse — persisted so the choice survives a reload,
  // consistent with the app's existing localStorage-backed preferences
  // (theme, auth token). Only meaningful at lg+; the mobile drawer ignores it.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem('jedSidebarCollapsed') === 'true'
  );
  const toggleSidebarCollapsed = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('jedSidebarCollapsed', String(next));
      return next;
    });
  }, []);

  const handleLogin = useCallback(async (credentials) => {
    try {
      const userData = await jedApi.login(credentials);
      login(userData);
      // Always land on the role-appropriate dashboard after a fresh login.
      // The browser's current URL can still point at a route left over
      // from a previous session on this device/tab (e.g. an Admin's
      // /schedule open before an Installer signs in) — since React Router
      // doesn't reset location on its own, that stale URL would otherwise
      // be re-evaluated against the new role's permissions immediately
      // after login and render Access Denied instead of the dashboard.
      // /dashboard itself already branches to AdminDashboard/
      // InstallerDashboard per role, so this one redirect is role-aware
      // for every role without needing separate landing routes.
      navigate('/dashboard', { replace: true });
      return userData;
    } catch (error) {
      console.error('[App] Login failed:', error);
      setGlobalError(getErrorMessage(error, 'Failed to log in. Please check your credentials.'));
      throw error;
    }
  }, [login, navigate]);

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className={`min-h-screen transition-colors duration-300 print:bg-white ${isDark ? 'app-bg-dark' : 'app-bg-light'}`}>
      {/* Sidebar: off-canvas drawer on mobile, persistent fixed column at
          lg+. Rendered outside the content column below since it's
          `fixed` regardless of breakpoint. */}
      {/* print:hidden — a printed report (see AdminReports.jsx's "Print to
          PDF") shouldn't include the app's own navigation chrome. Plain
          wrapper div rather than editing Navigation.jsx's own root classes:
          its `fixed`-positioned drawer/rail are still viewport-relative
          inside a plain (non-transformed) wrapper, so this hides it at
          print time without touching the component's multiple return paths. */}
      <div className="print:hidden">
        <Navigation
          userRole={user?.role}
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
          collapsed={isSidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapsed}
        />
      </div>

      {/* Content column — offset right at lg+ to clear the persistent
          sidebar (no offset needed on mobile, where the sidebar is
          off-canvas and doesn't occupy layout space). Offset tracks
          whether the sidebar is currently collapsed to an icon-only rail. */}
      <div className={`min-h-screen flex flex-col ${isSidebarCollapsed ? CONTENT_OFFSET_COLLAPSED_CLASS : CONTENT_OFFSET_EXPANDED_CLASS} print:pl-0 transition-[padding] duration-200`}>
        <Header
          user={user}
          onLogout={logout}
          onMenuToggle={() => setIsMobileMenuOpen(prev => !prev)}
          isMenuOpen={isMobileMenuOpen}
        />

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
          {globalError && (
            <ErrorNotification
              message={globalError}
              onDismiss={() => setGlobalError(null)}
            />
          )}
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                {/* Dashboard routes by role: admin/superadmin/supervisor get
                    the full-pipeline AdminDashboard (all requests, all
                    installers, payment stages — the money figures on it are
                    gated separately inside, so a Supervisor sees the
                    operational view without the financial one); installer
                    gets the tabbed Pending/Completed InstallerDashboard. */}
                <Route
                  path="/dashboard"
                  element={permissions.canViewAdminDashboard ? <AdminDashboard /> : <InstallerDashboard />}
                />
                {/* The one Installations area: the combined request list
                    (imported jobs + JED's Remita requests, with disco scoping
                    and dispatch) and JED's PAID/COMPLETED operational queue,
                    as two views of one page. Admin/Super Admin get the
                    dispatch actions; a Supervisor holds INSTALLATIONS.VIEW_ALL
                    without MANAGE, so the same page renders read-only for it.
                    Installers never come here — they use /dashboard (the
                    shared JED queue) and /my-jobs (their dispatched jobs). */}
                <Route
                  path="/installations"
                  element={permissions.canViewAllInstallations ? <InstallationsPage /> : <AccessDenied />}
                />
                {/* Click-through detail view from either dashboard's rows —
                    the completion action lives here directly (a PAID job
                    shows the complete-installation form; a COMPLETED job
                    shows a read-only summary). There is no separate
                    "Complete Installation" tab/route anymore — completing
                    a job always happens from within the job you opened
                    from Awaiting Installation, not a standalone
                    account-number lookup form. */}
                <Route
                  path="/installations/:accountNumber"
                  element={
                    permissions.canViewAllInstallations || permissions.canViewInstallations
                      ? <InstallationDetail />
                      : <AccessDenied />
                  }
                />
                {/* Meter Schedule and Users are reachable by Supervisor too,
                    read-only in both cases: the API gives it list/search/view
                    on meters and the Installer roster only, and each page
                    gates its own privileged actions (upload, export,
                    statistics, delete, create/edit) on the permissions the
                    Supervisor doesn't hold. */}
                <Route path="/schedule" element={permissions.canViewSchedule ? <MeterSchedule /> : <AccessDenied />} />
                <Route path="/users" element={permissions.canViewUsers ? <UserManagement /> : <AccessDenied />} />
                {/* Uploads: admin-tier only. `canUploadExcel` is the
                    permission-model check (Installer no longer holds
                    UPLOADS.EXCEL); ExcelUpload repeats it internally as a
                    second layer. Direct URL access as Installer renders
                    AccessDenied here, before the page module even loads. */}
                <Route path="/uploads" element={permissions.canUploadExcel ? <ExcelUpload /> : <AccessDenied />} />
                {/* Complaint form — Installer only. No admin equivalent yet:
                    there is no complaints API to review (API_GAP_REPORT.md). */}
                <Route path="/complaints" element={permissions.canSubmitComplaints ? <ComplaintForm /> : <AccessDenied />} />
                {/* ---- Multi-disco installation flow ----
                    Admin: import the disco's spreadsheets, dispatch meters and
                    jobs, then export the response sheet. Installer: the jobs
                    dispatched to them and the meters in their hands. Distinct
                    from the JED routes above, which are unchanged. */}
                <Route path="/imports" element={permissions.canRunImports ? <ImportsPage /> : <AccessDenied />} />
                {/* Assignments: reaching the page needs ASSIGNMENTS.VIEW,
                    dispatching from it needs ASSIGNMENTS.MANAGE. A Supervisor
                    holds only the first, so it lands on the batch history
                    with no Dispatch form (the page enforces that itself too). */}
                <Route path="/assignments" element={permissions.canViewAssignments ? <AssignmentsPage /> : <AccessDenied />} />
                {/* Kept working for bookmarks and any external link: the
                    page moved into /installations as its default view. */}
                <Route path="/installation-requests" element={<Navigate to="/installations" replace />} />
                <Route path="/my-jobs" element={permissions.canViewMyJobs ? <MyJobs /> : <AccessDenied />} />
                <Route path="/reports" element={permissions.isAdmin ? <AdminReports /> : <AccessDenied />} />
                <Route path="/payments" element={permissions.isAdmin ? <PaymentsPage /> : <AccessDenied />} />
                <Route path="/settings" element={permissions.isAdmin ? <SettingsPage /> : <AccessDenied />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>

        <Footer />
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataRefreshProvider>
          <Router>
            <AppContent />
          </Router>
        </DataRefreshProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;