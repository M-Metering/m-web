import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import JEDApiService from '../services/api';
import { useNavigate } from 'react-router-dom';
import { formatCurrencyNGN } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';
import { buildDailySeries } from '../../utils/trendAggregation';
import TrendChart from './TrendChart';
import StatusBadge from '../common/StatusBadge';
import { getErrorMessage } from '../../utils/errorMessage';
import { downloadServerXlsx } from '../../utils/xlsx';
import {
  BarChart,
  Users,
  CheckCircle,
  Clock,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  FileText,
  Settings,
  X,
  LayoutDashboard,
  RefreshCw
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

// Stat Card Component - Mobile First
 
const StatCard = ({ title, value, icon: Icon, change, changeType = 'neutral' }) => (
  <div className="card p-4 sm:p-6 flex flex-col transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 dark:hover:shadow-black/30">
    <div className="flex items-center justify-between mb-3">
      <div className={`p-2 rounded-lg ${
        changeType === 'positive' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' :
        changeType === 'negative' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' :
        'bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400'
      }`}>
        <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
      </div>
      {change !== undefined && change !== 0 && (
        <div className={`flex items-center text-xs sm:text-sm font-medium ${
          changeType === 'positive' ? 'text-green-600 dark:text-green-400' :
          changeType === 'negative' ? 'text-red-600 dark:text-red-400' :
          'text-brand-600 dark:text-brand-400'
        }`}>
          {changeType === 'positive' ? <ArrowUpRight className="w-3 h-3 sm:w-4 sm:h-4" /> :
           changeType === 'negative' ? <ArrowDownRight className="w-3 h-3 sm:w-4 sm:h-4" /> : null}
          <span>{Math.abs(change)}%</span>
        </div>
      )}
    </div>
    <h3 className="text-gray-500 dark:text-gray-400 text-xs sm:text-sm font-medium">{title}</h3>
    <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
  </div>
);

/**
 * Resolve a display-ready request date. Real JedCustomerRequest schema
 * field is `dateRequested`; `datePaid`/`dateCompleted` are used as a
 * fallback for rows where it's genuinely absent from the row shape.
 */
const getInstallDate = (install) => {
  const raw = install?.dateRequested || install?.datePaid || install?.dateCompleted || null;
  if (!raw) return '-';
  return formatDateTime(raw);
};

// Recent Installations Table - Mobile Optimized
const RecentInstallations = ({ installations, totalCount, onViewAll, onItemClick }) => (
  <div className="card overflow-hidden">
    <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Recent Installations</h3>
      <button 
        onClick={onViewAll} 
        className="text-xs sm:text-sm text-brand-600 hover:text-brand-700 font-medium"
      >
        View All ({totalCount})
      </button>
    </div>
    
    {/* Mobile Card View */}
    <div className="sm:hidden divide-y divide-gray-200 dark:divide-gray-700">
      {installations.length === 0 ? (
        <div className="p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
          No installations found
        </div>
      ) : (
        installations.map((install) => (
          <button
            key={install.id}
            type="button"
            onClick={() => onItemClick(install)}
            className="w-full text-left p-4 hover:bg-gray-50 dark:bg-gray-900/50 transition-colors"
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="font-medium text-gray-900 dark:text-white text-sm">{install.accountNumber}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                  {install.custNames || install.applicantName || install.installer?.name || '-'}
                </p>
              </div>
              <StatusBadge status={install.status} />
            </div>
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {getInstallDate(install)}
                </span>
                <span className="font-semibold text-gray-900 dark:text-white text-sm">
                  {formatCurrencyNGN(install.amount)}
                </span>
              </div>
              {install.email && (
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Email: {install.email}
                </div>
              )}
              {(install.rrr || install.paymentReference || install.paymentRef || install.remitaRef) && (
                <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                  RRR: {install.rrr || install.paymentReference || install.paymentRef || install.remitaRef}
                </div>
              )}
            </div>
          </button>
        ))
      )}
    </div>

    {/* Desktop Table View */}
    <div className="hidden sm:block overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-left text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 text-xs sm:text-sm">
            <th className="px-4 py-3 font-semibold">Account</th>
            <th className="px-4 py-3 font-semibold">Customer</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold text-right">Amount</th>
            <th className="px-4 py-3 font-semibold">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {installations.length === 0 ? (
            <tr>
              <td colSpan="5" className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                No installations found
              </td>
            </tr>
          ) : (
            installations.map((install) => (
              <tr
                key={install.id}
                onClick={() => onItemClick(install)}
                tabIndex={0}
                role="button"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    onItemClick(install);
                  }
                }}
                className="hover:bg-gray-50 dark:bg-gray-900/50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 text-gray-700 dark:text-gray-300 font-medium text-sm">{install.accountNumber}</td>
                <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-sm">
                  {install.custNames || install.applicantName || install.installer?.name || '-'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={install.status} />
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-white text-sm">
                  {formatCurrencyNGN(install.amount)}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-sm">
                  {getInstallDate(install)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

// Export Modal Component
const ExportModal = ({ isOpen, onClose, onExport }) => {
  const [exportType, setExportType] = useState('all');
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await onExport(exportType);
      onClose();
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Export Data</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Data Type
            </label>
            <select
              value={exportType}
              onChange={(e) => setExportType(e.target.value)}
              className="form-input w-full px-3 py-2"
            >
              <option value="all">All Data</option>
              <option value="pending">Pending Requests</option>
              <option value="completed">Completed Requests</option>
              <option value="jed">All Requests — Detailed (JED)</option>
              <option value="meters">Meters</option>
            </select>
            {/* "Installer Performance" was removed — there is no backing
                endpoint on the real API for it (see API_GAP_REPORT.md);
                the option previously fell through to exporting "All Data"
                under a misleading label instead of erroring. */}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Exports download as Excel (.xlsx) files.
          </p>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-4">
            <button
              onClick={onClose}
              disabled={isExporting}
              className="w-full sm:w-auto px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="w-full sm:w-auto px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isExporting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export
                </>
              )}
            </button>
          </div>
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

// AdminDashboard is only ever mounted for admin-tier users (App.jsx routes
// installers to InstallerDashboard instead), so it no longer branches on
// role internally — an earlier "installer view" code path here was dead
// (isInstallerView was never actually passed by any caller) and has been
// removed rather than kept as unreachable complexity.
function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refreshSignal } = useDataRefresh();
  const [stats, setStats] = useState({
    pendingRequests: 0,
    completedRequests: 0,
    activeInstallers: 0,
    totalRevenue: 0,
  });
  const [recentInstallations, setRecentInstallations] = useState([]);
  const [requestsTotalCount, setRequestsTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  // Manual refresh button — bumps this to re-run both fetch effects below
  // (stats/recent installations and the trend chart), same pattern already
  // used by AdminInstallations.jsx/InstallerDashboard.jsx's Refresh buttons.
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
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        setError(null);

        const installationsResponse = await JEDApiService.getAllCustomerRequests({
          page: 1,
          limit: 5
        });
        const installations = Array.isArray(installationsResponse)
          ? installationsResponse
          : (installationsResponse?.data || []);
        const paginationData = installationsResponse?.pagination || {};

        setRecentInstallations(installations);
        setRequestsTotalCount(paginationData.totalCount || installations.length);

        try {
          const statsResponse = await JEDApiService.getDashboardStats();
          const payload = statsResponse?.data ?? statsResponse ?? {};
          // Real GET /dashboard-stats returns exactly these 4 flat numbers
          // — no percent-change/delta fields exist server-side, so none
          // are fabricated here.
          setStats({
            pendingRequests: payload.pendingRequests ?? 0,
            completedRequests: payload.completedRequests ?? 0,
            activeInstallers: payload.activeInstallers ?? 0,
            totalRevenue: payload.totalRevenue ?? 0,
          });
        } catch (statsError) {
          // Fallback: compute from the fetched page of requests using the
          // real status enum (INITIATED/PAID/COMPLETED), not guessed
          // lowercase values.
          console.warn('[Dashboard] Failed to fetch admin stats, calculating from installations:', statsError.message);
          setStats({
            pendingRequests: installations.filter((inst) => inst.status === 'INITIATED' || inst.status === 'PAID').length,
            completedRequests: installations.filter((inst) => inst.status === 'COMPLETED').length,
            activeInstallers: 0,
            totalRevenue: installations
              .filter((inst) => inst.status === 'COMPLETED')
              .reduce((sum, inst) => sum + (parseFloat(inst.amount) || 0), 0)
          });
        }
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError('Failed to load dashboard data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      fetchDashboardData();
    }
    // NOTE: `recentInstallations` intentionally excluded — it's set inside
    // this effect, so including it as a dependency caused a refetch loop.
    // `refreshSignal` re-runs this on any app-wide data mutation (e.g. a
    // bulk payment import) so stats/recent installations stay live without
    // a full page reload — see DataRefreshContext. `refreshKey` re-runs it
    // on a manual click of the header's Refresh button.
  }, [user, refreshSignal, refreshKey]);

  // Revenue / Installations trend — admin-only, mirrors the KPI section's
  // admin-vs-installer scoping above. Fetches real payment records for the
  // selected window (GET /external/jed/payments) and buckets them
  // client-side; nothing here is invented. `revenueSeries`/`installationsSeries`
  // are kept in state across refetches (not cleared to []) so the chart can
  // hold its previous render at reduced opacity while a new range loads,
  // instead of flashing to a skeleton or empty state.
  const fetchTrendData = useCallback(async (days) => {
    setTrendLoading(true);
    setTrendError(null);
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (days - 1));
      startDate.setHours(0, 0, 0, 0);

      const response = await JEDApiService.getPayments({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit: 100,
      });

      const records = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
          ? response.data
          : [];
      const pagination = response?.pagination || {};
      const totalCount = pagination.totalCount ?? records.length;

      setTrendTruncated(totalCount > records.length ? { shown: records.length, total: totalCount } : null);
      setRevenueSeries(buildDailySeries(records, { dateField: 'datePaid', valueField: 'amount', aggregate: 'sum', days }));
      setInstallationsSeries(buildDailySeries(records, { dateField: 'dateCompleted', aggregate: 'count', days }));
    } catch (err) {
      console.error('[Dashboard] Failed to load revenue/installations trend:', err);
      setTrendError(getErrorMessage(err, 'Failed to load trend data'));
    } finally {
      setTrendLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchTrendData(trendDays);
    }
  }, [user, trendDays, fetchTrendData, refreshSignal, refreshKey]);

  // Every export endpoint is documented as returning an Excel (.xlsx) file
  // only — none accepts a `format` param. The modal used to offer a "CSV"
  // option that sent an ignored `format=csv` and saved the (still xlsx)
  // response under a `.csv` name, producing a mislabelled file; that option
  // is gone and files are always named for what the API actually returns.
  const handleExportData = async (exportType) => {
    try {
      let blob;
      let filename;

      switch (exportType) {
        case 'meters':
          blob = await JEDApiService.exportMeters();
          filename = `meters_export_${Date.now()}.xlsx`;
          break;
        case 'pending':
          blob = await JEDApiService.exportCustomerRequests({ status: 'INITIATED' });
          filename = `pending_requests_${Date.now()}.xlsx`;
          break;
        case 'completed':
          blob = await JEDApiService.exportCustomerRequests({ status: 'COMPLETED' });
          filename = `completed_requests_${Date.now()}.xlsx`;
          break;
        case 'jed':
          // Activates the previously dormant JED-group export endpoint
          // (/external/jed/requests/export), distinct from the
          // METERS-group exportCustomerRequests used above. `exportAll` is
          // its documented "ignore pagination" switch.
          blob = await JEDApiService.exportJedRequests({ exportAll: 'true' });
          filename = `jed_requests_detailed_${Date.now()}.xlsx`;
          break;
        default:
          blob = await JEDApiService.exportCustomerRequests();
          filename = `all_requests_${Date.now()}.xlsx`;
      }

      // Numeric identifier cells in the server's workbook are rewritten as
      // text first, so Excel can't show meter numbers in scientific notation.
      await downloadServerXlsx(blob, filename);
    } catch (error) {
      console.error('Export error:', error);
      throw error;
    }
  };

  const handleGenerateReport = async () => {
    // Open export modal with report preset
    setShowExportModal(true);
  };

  const handleRowClick = (install) => {
    navigate(`/installations/${install.accountNumber}`);
  };

  const handleManageUsers = () => {
    navigate('/users');
  };

  const handleGoToSettings = () => {
    navigate('/settings');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400 text-sm">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-900 dark:text-white mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

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
              Admin Dashboard
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm sm:text-base">
              Monitor system performance and manage users
            </p>
          </div>
          </div>
          <div className="mt-4 sm:mt-0 flex items-center gap-2">
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              aria-label="Refresh"
              className="p-2.5 sm:px-4 sm:py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline text-sm font-medium">Refresh</span>
            </button>
            <button
              onClick={handleGenerateReport}
              className="flex-1 sm:flex-none bg-brand-500 text-gray-900 px-4 py-2 rounded-lg hover:bg-brand-600 transition-colors flex items-center justify-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Generate Report
            </button>
          </div>
        </div>

        {/* Statistics Grid — real GET /dashboard-stats returns only these
            4 flat numbers, no percent-change/delta fields, so none are
            fabricated here (see the Trend section below for real
            day-over-day data, sourced from actual payment records). */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
          <StatCard title="Pending" value={stats.pendingRequests} icon={Clock} />
          <StatCard title="Completed" value={stats.completedRequests} icon={CheckCircle} />
          <StatCard title="Installers" value={stats.activeInstallers} icon={Users} />
          <StatCard
            title="Revenue"
            value={
              typeof stats.totalRevenue === 'number'
                ? formatCurrencyNGN(stats.totalRevenue)
                : stats.totalRevenue
            }
            icon={BarChart}
          />
        </div>

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
                Showing {trendTruncated.shown} of {trendTruncated.total} matching transactions in this range (API page limit is 100) — the trend below may be incomplete. Narrow the date range for full accuracy.
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <TrendChart
                title="Revenue"
                data={revenueSeries}
                type="area"
                colorLight={REVENUE_COLOR.light}
                colorDark={REVENUE_COLOR.dark}
                formatValue={formatCurrencyNGN}
                loading={trendLoading}
                emptyMessage="No payments recorded in this range."
              />
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

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Recent Installations */}
          <div className="lg:col-span-2">
            <RecentInstallations 
              installations={recentInstallations}
              totalCount={requestsTotalCount}
              onViewAll={() => navigate('/reports')}
              onItemClick={handleRowClick}
            />
          </div>

          {/* Quick Actions */}
          <div className="space-y-4 sm:space-y-6">
            <QuickActions
              onManageUsers={handleManageUsers}
              onGoToSettings={handleGoToSettings}
              onExportData={() => setShowExportModal(true)}
            />
          </div>
        </div>

      {/* Export Modal */}
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onExport={handleExportData}
      />
    </div>
  );
}

export default AdminDashboard;