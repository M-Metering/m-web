import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { loadRevenueTransactions } from '../../hooks/useRevenueSummary';
import { usePaymentRevenueSummary } from '../../hooks/usePaymentRevenueSummary';
import RevenueSummaryPanel from './RevenueSummaryPanel';
import { InstallationKpis, RecentInstallationsCard } from './DashboardInstallations';
import {
  useInstallationTotals, useRecentInstallations, loadCompletedInstallationDays, loadInstallerRosterCount,
} from '../../hooks/useDashboardInstallations';
import { isCompletedInstallationRow } from '../../utils/financeSummary';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import JEDApiService from '../services/api';
import { useNavigate } from 'react-router-dom';
import { formatCurrencyNGN } from '../../utils/currency';
import { toDateInputValue } from '../../utils/date';
import { buildDailySeries } from '../../utils/trendAggregation';
import TrendChart from './TrendChart';
import { getErrorMessage } from '../../utils/errorMessage';
import { downloadServerXlsx } from '../../utils/xlsx';
import ReportExportBar from '../reports/ReportExportBar';
import { buildOverviewReport, paymentFigures } from '../../utils/reportData';
import {
  Users,
  AlertCircle,
  Download,
  FileText,
  Settings,
  X,
  LayoutDashboard,
  RefreshCw,
  ClipboardList,
  Send,
  HardHat
} from 'lucide-react';

// Reference dataviz palette slots (see the project's dataviz skill —
// palette.md). Slot 1 (blue) is the default sequential hue, used here for
// Revenue; slot 3 (aqua) is a second categorical slot, used for
// Installations so the two single-series charts stay visually distinct
// without needing cross-series CVD validation (each chart has only one
// series, so the single-hue "sequential or 1 categorical" rule for
// trend-over-time applies, not the multi-series categorical rules).
const REVENUE_COLOR = { light: '#2a78d6', dark: '#3987e5' };
const INSTALLATIONS_COLOR = { light: '#1baf7a', dark: '#199e70' };

const TREND_RANGE_PRESETS = [
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
];

// Generate Report (fixed 2026-10-05).
//
// ROOT CAUSE of "always fails": every option except Meters exported JED
// Remita requests (GET /meters/customer-requests/export or
// /external/jed/requests/export). Those endpoints answer 404 "No requests
// found to export" whenever the JED flow is empty — which it can be, since the
// work in this system is multi-disco installations — and the modal turned that
// into "Export failed". They also only ever covered JED: "Pending Requests"
// was JED INITIATED (unpaid), not the app's Pending Installations.
//
// Now: the Summary report is the SAME report as Reports → Overview, built from
// the Dashboard's own hooks (installation totals + the shared payment figures)
// by utils/reportData.js and written by the shared ReportExportBar (Excel, CSV,
// Print). The meter inventory is still the server's own export. Detailed
// payment/deal and JED request reports live in Reports.
const ReportModal = ({ isOpen, onClose, buildSummary, summaryDisabled, summaryReason, onOpenReports }) => {
  const [meterBusy, setMeterBusy] = useState(false);
  const [meterError, setMeterError] = useState(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !meterBusy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, meterBusy]);

  if (!isOpen) return null;

  const exportMeters = async () => {
    if (meterBusy) return;
    setMeterBusy(true);
    setMeterError(null);
    try {
      const blob = await JEDApiService.exportMeters();
      const stamp = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      await downloadServerXlsx(blob, `ME-Metering-Meter-Inventory-${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}.xlsx`);
    } catch (err) {
      console.error('[Dashboard] Meter export failed:', err);
      setMeterError(/404|no meters/i.test(String(err?.message)) ? 'There are no meters to export.' : 'Unable to export this report. Please try again.');
    } finally {
      setMeterBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !meterBusy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="generate-report-title" onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4 flex items-center justify-between">
          <h3 id="generate-report-title" className="text-lg font-semibold text-gray-900 dark:text-white">Generate Report</h3>
          <button type="button" onClick={onClose} disabled={meterBusy} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:text-gray-400 disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Summary report</h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Installation totals, Total collected payments and Revenue due — the same figures as this dashboard and Reports → Overview.
            </p>
            <ReportExportBar build={buildSummary} label="Export the summary report" disabled={summaryDisabled} disabledReason={summaryReason} />
          </section>

          <section className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Meter inventory</h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">Every meter, as the server exports it (Excel).</p>
            <button type="button" onClick={exportMeters} disabled={meterBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
              {meterBusy ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500" /> : <Download className="w-4 h-4" />}
              {meterBusy ? 'Preparing Excel…' : 'Export meter inventory'}
            </button>
            {meterError && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{meterError}</p>}
          </section>

          <p className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-4">
            Payment & deal records and JED requests, with their filters, are in{' '}
            <button type="button" onClick={onOpenReports} className="font-medium text-brand-700 dark:text-brand-400 hover:underline">Reports</button>.
          </p>
        </div>
      </div>
    </div>
  );
};

// Quick Actions Component - Mobile First
// Each action has its own accent colour (tinted surface + border + icon
// chip) so the three are distinguishable at a glance — a previous pass
// flattened these to one neutral surface for every action, which was
// dark-mode-safe but visually undifferentiated. A pass before *that* used
// full pastel gradients, which weren't dark-mode aware (stayed light in
// dark mode while label text flipped to white — low-contrast, hard to
// read) — this restores per-action colour without reintroducing gradients.
// AdminDashboard (the only caller) is admin-tier only, so these actions
// are always shown — no per-button role gating needed here.
const QUICK_ACTION_STYLES = {
  brand: {
    surface: 'bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800/60 hover:bg-brand-100 dark:hover:bg-brand-900/30',
    iconWrap: 'bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400',
  },
  emerald: {
    surface: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/30',
    iconWrap: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400',
  },
  violet: {
    surface: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/60 hover:bg-violet-100 dark:hover:bg-violet-900/30',
    iconWrap: 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400',
  },
};

const QuickActionButton = ({ icon: Icon, label, onClick, accent, span2 = false }) => {
  const styles = QUICK_ACTION_STYLES[accent];
  return (
    <button
      onClick={onClick}
      className={`p-3 sm:p-4 rounded-lg transition-colors border ${styles.surface} ${span2 ? 'col-span-2' : ''}`}
    >
      <span className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center mx-auto mb-2 ${styles.iconWrap}`}>
        <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
      </span>
      <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white block text-center">
        {label}
      </span>
    </button>
  );
};

const QuickActions = ({ onManageUsers, onGoToSettings, onExportData }) => (
  <div className="card p-4 sm:p-6">
    <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h3>
    <div className="grid grid-cols-2 gap-3">
      <QuickActionButton icon={Users} label="Manage Users" onClick={onManageUsers} accent="brand" />
      <QuickActionButton icon={Download} label="Export Data" onClick={onExportData} accent="emerald" />
      <QuickActionButton icon={Settings} label="System Settings" onClick={onGoToSettings} accent="violet" span2 />
    </div>
  </div>
);

// A Supervisor's shortcuts: only the pages its role reaches, each behind the
// same permission flag as its route in App.jsx.
const SupervisorQuickActions = ({ permissions, navigate }) => (
  <div className="card p-4 sm:p-6">
    <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h3>
    <div className="grid grid-cols-2 gap-3">
      {permissions.canViewAllInstallations && (
        <QuickActionButton icon={ClipboardList} label="Installations" onClick={() => navigate('/installations')} accent="brand" />
      )}
      {permissions.canViewAssignments && (
        <QuickActionButton icon={Send} label="Assignments" onClick={() => navigate('/assignments')} accent="emerald" />
      )}
      {permissions.canViewInstallerStatus && (
        <QuickActionButton icon={HardHat} label="Installer Job Status" onClick={() => navigate('/installer-status')} accent="violet" span2 />
      )}
    </div>
  </div>
);

// AdminDashboard is only ever mounted for admin-tier users (App.jsx routes
// installers to InstallerDashboard instead), so it no longer branches on
// role internally — an earlier "installer view" code path here was dead
// (isInstallerView was never actually passed by any caller) and has been
// removed rather than kept as unreachable complexity.
function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // This dashboard serves Admin, Super Admin and Supervisor. A Supervisor
  // oversees the installation pipeline and has no access to money or to the
  // admin tools, so the financial figures and the admin shortcuts below are
  // gated rather than the whole page being duplicated.
  const permissions = usePermissions();
  const showMoney = permissions.canViewPayments;
  const showAdminTools = permissions.isAdmin;

  const { refreshSignal } = useDataRefresh();
  // Installation KPIs and the recent list — two separate reads by design (see
  // hooks/useDashboardInstallations.js): totals from server-side aggregates,
  // the list from the newest few rows. Neither is derived from the other.
  const installationTotals = useInstallationTotals({ enabled: true });
  const recentInstallations = useRecentInstallations({ enabled: true });

  // Total collected payments (the pending installations at meter-type prices)
  // and revenue due — the same hook the Payments page, Reports and the
  // Installations page use. `enabled` carries the permission check, so a role
  // without access to financial data issues no request at all.
  const paymentSummary = usePaymentRevenueSummary({ enabled: showMoney === true, totals: installationTotals.totals });

  // GET /dashboard-stats now feeds only the Installers KPI. Its
  // pendingRequests/completedRequests have no documented definition and cover
  // JED requests only, so they are no longer shown (see
  // utils/installationTotals.js for the definitions that replaced them). A
  // failure is "Unavailable", never 0 — the old fallback counted the 5
  // "recent" rows and presented that as the system total.
  const [activeInstallers, setActiveInstallers] = useState(null);
  const [installersLoading, setInstallersLoading] = useState(true);
  const [installersError, setInstallersError] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  // Manual refresh button — bumps this to re-run the fetch effects below, and
  // reloads the hooks above.
  const [refreshKey, setRefreshKey] = useState(0);

  // Revenue / Installations trend — built entirely from real payment
  // records (GET /external/jed/payments), aggregated client-side per day.
  const [trendDays, setTrendDays] = useState(30);
  const [revenueSeries, setRevenueSeries] = useState([]);
  const [installationsSeries, setInstallationsSeries] = useState([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState(null);
  const [trendTruncated, setTrendTruncated] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      setInstallersLoading(true);
      setInstallersError(null);
      try {
        let value;
        if (showMoney) {
          const response = await JEDApiService.getDashboardStats();
          value = Number((response?.data ?? response ?? {}).activeInstallers);
          if (!Number.isFinite(value)) throw new Error('activeInstallers missing from /dashboard-stats');
        } else {
          // /dashboard-stats also returns totalRevenue and is outside the
          // Supervisor's API scope, so a role without PAYMENTS.VIEW never
          // calls it. The installer roster is a read it does hold.
          value = await loadInstallerRosterCount();
        }
        if (!cancelled) setActiveInstallers(value);
      } catch (err) {
        console.error('[Dashboard] Installer count failed:', err);
        if (!cancelled) { setActiveInstallers(null); setInstallersError(getErrorMessage(err, "Couldn't load the installer count.")); }
      } finally {
        if (!cancelled) setInstallersLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // refreshSignal: re-read after any app-wide mutation; refreshKey: the
    // header's Refresh button. No polling.
  }, [user, showMoney, refreshSignal, refreshKey]);

  const refreshAll = () => {
    setRefreshKey((k) => k + 1);
    installationTotals.reload();
    recentInstallations.reload();
    if (showMoney) paymentSummary.reload();
  };
  const anyLoading = installationTotals.loading || recentInstallations.loading || installersLoading;

  // Trend charts — the SAME source as the totals above (recognised revenue),
  // windowed server-side to the selected range.
  //
  // These used to read GET /external/jed/payments and bucket by
  // `datePaid`/`dateCompleted`. That is JED-only, and where the JED/Remita
  // flow is empty both charts rendered blank for exactly the reason the
  // headline figures read ₦0 (2026-09-26). Reading the revenue records instead
  // means the charts and the cards can never disagree.
  //
  // Both series come from one request: `revenueAt` is the recognition date
  // (the payment for a JED row, the install report for a disco row, per
  // `dateBasis`), so summing `amount` by it gives collected-over-time, and
  // counting only the COMPLETED-INSTALLATION rows gives installations
  // completed. Nothing is invented — a day with no records is a real zero.
  // `revenueSeries`/`installationsSeries` are kept in state across refetches
  // (not cleared to []) so a chart holds its previous render at reduced
  // opacity while a new range loads, instead of flashing to a skeleton.
  const fetchTrendData = useCallback(async (days) => {
    setTrendLoading(true);
    setTrendError(null);
    try {
      if (!showMoney) {
        // A role without finance access (Supervisor) can't read the revenue
        // records, so its Installations Completed chart counts the completed
        // installation records themselves, by installation date. Without
        // this branch the chart sat on "Loading" forever for a Supervisor.
        const { rows, truncated } = await loadCompletedInstallationDays();
        setTrendTruncated(truncated ? { shown: rows.length, total: null } : null);
        setInstallationsSeries(buildDailySeries(rows, { dateField: 'completedOn', aggregate: 'count', days }));
        return;
      }

      const start = new Date();
      start.setDate(start.getDate() - (days - 1));
      // `to` is EXCLUSIVE on the finance endpoints, so it is tomorrow —
      // otherwise today's records fall outside the window.
      const end = new Date();
      end.setDate(end.getDate() + 1);

      const { rows, truncated } = await loadRevenueTransactions({
        from: toDateInputValue(start),
        to: toDateInputValue(end),
      });

      setTrendTruncated(truncated ? { shown: rows.length, total: null } : null);
      setRevenueSeries(buildDailySeries(rows, { dateField: 'revenueAt', valueField: 'amount', aggregate: 'sum', days }));
      setInstallationsSeries(buildDailySeries(
        rows.filter(isCompletedInstallationRow),
        { dateField: 'revenueAt', aggregate: 'count', days }
      ));
    } catch (err) {
      console.error('[Dashboard] Failed to load revenue/installations trend:', err);
      setTrendError(getErrorMessage(err, 'Failed to load trend data'));
    } finally {
      setTrendLoading(false);
    }
  }, [showMoney]);

  useEffect(() => {
    // fetchTrendData picks the source by permission: the revenue records
    // (financial data) only for a role with PAYMENTS.VIEW — hiding a chart is
    // not the same as not asking for the data behind it — and the completed
    // installation records otherwise.
    if (user) fetchTrendData(trendDays);
  }, [user, trendDays, fetchTrendData, refreshSignal, refreshKey]);

  // The Summary report — the same builder and the same values as Reports →
  // Overview (utils/reportData.js), from this dashboard's own hooks.
  const buildSummaryReport = useCallback(async () => buildOverviewReport({
    totals: installationTotals.totals,
    payment: showMoney ? paymentFigures(paymentSummary.collected, paymentSummary.revenue) : null,
    recordedTotal: showMoney ? {
      amount: paymentSummary.revenue.summary?.recognisedTotal ?? null,
      error: !!paymentSummary.revenue.error || !paymentSummary.revenue.summary || paymentSummary.revenue.summary.recognisedTotal === null,
    } : null,
    prices: showMoney ? (paymentSummary.pendingValue?.pendingValue?.prices || []) : [],
    showMoney: showMoney === true,
  }), [installationTotals.totals, showMoney, paymentSummary.collected, paymentSummary.revenue, paymentSummary.pendingValue]);
  const summaryLoading = installationTotals.loading || (showMoney && (paymentSummary.collected.loading || paymentSummary.revenue.loading));
  const summaryUnavailable = !installationTotals.totals || !!installationTotals.error;

  const handleGenerateReport = async () => {
    // Open export modal with report preset
    setShowExportModal(true);
  };

  const handleRowClick = (row) => {
    navigate(`/installations/${row.accountNumber}`);
  };

  const handleManageUsers = () => {
    navigate('/users');
  };

  const handleGoToSettings = () => {
    navigate('/settings');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg">
              <LayoutDashboard className="w-6 h-6 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
              {showAdminTools ? 'Admin Dashboard' : 'Dashboard'}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm sm:text-base">
              {showAdminTools
                ? 'Monitor system performance and manage users'
                : 'Monitor installations, assignments and installer progress'}
            </p>
          </div>
          </div>
          <div className="mt-4 sm:mt-0 flex items-center gap-2">
            <button
              onClick={refreshAll}
              disabled={anyLoading}
              aria-label="Refresh"
              className="p-2.5 sm:px-4 sm:py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${anyLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline text-sm font-medium">Refresh</span>
            </button>
            {showAdminTools && (
              <button
                onClick={handleGenerateReport}
                className="flex-1 sm:flex-none bg-brand-500 text-gray-900 px-4 py-2 rounded-lg hover:bg-brand-600 transition-colors flex items-center justify-center gap-2"
              >
                <FileText className="w-4 h-4" />
                Generate Report
              </button>
            )}
          </div>
        </div>

        {/* Statistics Grid — real GET /dashboard-stats returns only these
            4 flat numbers, no percent-change/delta fields, so none are
            fabricated here (see the Trend section below for real
            day-over-day data, sourced from actual payment records). */}
        {/* Operational counts only. The generic "Revenue" KPI that used to sit
            here — GET /dashboard-stats' single undifferentiated `totalRevenue`
            — was removed on 2026-09-26: it sat directly above two precisely
            defined money figures while answering a third, unstated question,
            which made all three ambiguous. `totalRevenue` is still returned by
            the endpoint and still read into `stats` below; nothing about the
            backend field was changed, it simply isn't shown here. Collected
            and due, which ARE defined, are in the section underneath. */}
        {/* Installation KPIs — operational counts from server aggregates
            (utils/installationTotals.js). Awaiting = installations an installer
            holds (the sum of Installer Job Status' Awaiting column). No value
            or payment figure here: that analysis lives in Admin Reports. */}
        <InstallationKpis
          totals={installationTotals.totals}
          loading={installationTotals.loading}
          error={installationTotals.error}
          onRetry={installationTotals.reload}
          activeInstallers={activeInstallers}
          installersLoading={installersLoading}
          installersError={installersError}
          onRetryInstallers={() => setRefreshKey((k) => k + 1)}
        />

        {/* Payment & Revenue Summary — the shared panel, fed by the one revenue
            calculation (hooks/useRevenueSummary.js → utils/financeSummary.js).
            The Payments and Installations pages render the same panel from the
            same hook, so the figures agree by construction. */}
        {showMoney && (
          <RevenueSummaryPanel
            id="dashboard-payments"
            title="Payment & Revenue Summary"
            collected={paymentSummary.collected}
            revenue={paymentSummary.revenue}
            onRetry={paymentSummary.reload}
          />
        )}

        {/* Revenue / Installations Trend — built from real
            GET /external/jed/payments records for the selected window */}
        <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Trend</h2>
              <div className="flex items-center gap-1.5">
                {TREND_RANGE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setTrendDays(preset.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      trendDays === preset.id
                        ? 'bg-brand-500 text-gray-900'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {trendError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300 flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {trendError}
              </div>
            )}

            {trendTruncated && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
                Showing the first {trendTruncated.shown.toLocaleString()} records in this range — the
                trend below may be incomplete. Choose a shorter range for full accuracy.
              </div>
            )}

            <div className={`grid grid-cols-1 gap-4 sm:gap-6 ${showMoney ? 'lg:grid-cols-2' : ''}`}>
              {showMoney && (
                <TrendChart
                  // Built by summing `amount` over payment records by
                  // `datePaid`, so it is collected payments over time — named
                  // for what it is. "Revenue" was ambiguous next to the two
                  // defined figures above and the old KPI it sat beside.
                  title="Collected payments"
                  data={revenueSeries}
                  type="area"
                  colorLight={REVENUE_COLOR.light}
                  colorDark={REVENUE_COLOR.dark}
                  formatValue={formatCurrencyNGN}
                  loading={trendLoading}
                  emptyMessage="No payments recorded in this range."
                />
              )}
              <TrendChart
                title="Installations Completed"
                data={installationsSeries}
                type="bar"
                colorLight={INSTALLATIONS_COLOR.light}
                colorDark={INSTALLATIONS_COLOR.dark}
                formatValue={(n) => String(Math.round(n))}
                loading={trendLoading}
                emptyMessage="No installations completed in this range."
              />
            </div>
          </div>

        {/* Main Content Grid. The admin Quick Actions are Users/Settings/
            Export — all admin-tier — so a Supervisor gets its own shortcuts
            to the pages it does reach instead. */}
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
          {/* Recent Installations */}
          <div className="lg:col-span-2">
            <RecentInstallationsCard
              recent={recentInstallations.recent}
              loading={recentInstallations.loading}
              error={recentInstallations.error}
              onRetry={recentInstallations.reload}
              onViewAll={() => navigate('/installations')}
              onOpen={handleRowClick}
              showAmounts={showMoney}
            />
          </div>

          {/* Quick Actions */}
          <div className="space-y-4 sm:space-y-6">
            {showAdminTools ? (
              <QuickActions
                onManageUsers={handleManageUsers}
                onGoToSettings={handleGoToSettings}
                onExportData={() => setShowExportModal(true)}
              />
            ) : (
              <SupervisorQuickActions permissions={permissions} navigate={navigate} />
            )}
          </div>
        </div>

      {/* Export Modal — admin-tier only; nothing opens it otherwise. */}
      {showAdminTools && (
        <ReportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          buildSummary={buildSummaryReport}
          summaryDisabled={summaryLoading || summaryUnavailable}
          summaryReason={summaryLoading ? 'Loading…' : summaryUnavailable ? 'Installation figures are unavailable.' : null}
          onOpenReports={() => navigate('/reports')}
        />
      )}
    </div>
  );
}

export default AdminDashboard;