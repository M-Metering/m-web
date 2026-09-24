// src/components/admin/AdminInstallations.jsx
// Consolidated Admin/Super Admin installation workflow: exactly two real
// backend statuses — PAID ("Awaiting Installation") and COMPLETED — no
// invented intermediate states. Supersedes the "Requests by Status" tab
// that used to live in PaymentsPage.jsx (a broader INITIATED/PAID/COMPLETED
// browser that duplicated this same PAID/COMPLETED view once this page
// existed) — general all-status browsing/export still lives in
// AdminReports.jsx, which this page does not duplicate.
//
// Assignment: the real Pharez API has no installerId field or assign
// endpoint on JedCustomerRequest (reconfirmed against the live OpenAPI spec
// — see API_GAP_REPORT.md). Selecting one or many rows and requesting an
// assignment is real, working UI state; the assignment itself cannot be
// persisted, so requesting it opens an explanatory info modal instead of
// silently succeeding or writing to client-only storage.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import JEDApiService from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import JedAssignmentNotice from '../installations/JedAssignmentNotice';
import StatusTabs from '../common/StatusTabs';
import StatusBadge from '../common/StatusBadge';
import { jedStatusLabel } from '../../utils/statusBadge';
import { formatDateOnly } from '../../utils/date';
import { fetchAllRequests } from '../../utils/fetchAllRequests';
import {
  Clock,
  CheckCircle,
  RefreshCw,
  Search,
  AlertCircle,
  ChevronRight,
  UserPlus,
  X,
} from 'lucide-react';

// Completed tab: the date that matters is when the install was completed
// (`dateCompleted`), not when the request was submitted. Neither an installer
// name nor a supervisor exists on the real JedCustomerRequest schema, so the
// "Installer" cell says so instead of showing a bare dash — see
// API_GAP_REPORT.md ("Completed Installation fields").
function getDisplayDate(job, completedView) {
  return completedView ? job.dateCompleted : job.dateRequested;
}

function JobRow({ job, onClick, selectable, selected, onToggleSelect, onAssignOne, completedView }) {
  return (
    <div className="w-full p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors flex items-start gap-3">
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(job.accountNumber); }}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 shrink-0"
          aria-label={`Select account ${job.accountNumber}`}
        />
      )}
      {/* A native <button> can't contain another <button> (invalid HTML —
          caused a real hydration warning when the "Assign Installer"
          button lived inside this row's clickable wrapper). This is a
          div with the same click/keyboard-activation behavior instead,
          same pattern already used by AdminDashboard's clickable <tr>. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick(job)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(job); } }}
        className="min-w-0 flex-1 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
            {job.custNames || `Account ${job.accountNumber}`}
          </p>
          <StatusBadge
            status={job.status}
            label={jedStatusLabel(job.status)}
            className="shrink-0 text-[11px]"
          />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
          Acct: {job.accountNumber} &middot; Meter: {job.meterNo || 'N/A'}
          {completedView && <> &middot; Seal: {job.sealNo || 'N/A'}</>}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {completedView ? 'Installed ' : ''}{formatDateOnly(getDisplayDate(job, completedView))}
        </p>
        {selectable && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAssignOne(job); }}
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Assign Installer
          </button>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 mt-1" />
    </div>
  );
}

function JobTableRow({ job, onClick, selectable, selected, onToggleSelect, onAssignOne, completedView }) {
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
      {selectable && (
        <td className="px-4 py-3 w-8">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(job.accountNumber)}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
            aria-label={`Select account ${job.accountNumber}`}
          />
        </td>
      )}
      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white cursor-pointer" onClick={() => onClick(job)}>{job.accountNumber}</td>
      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 cursor-pointer" onClick={() => onClick(job)}>{job.custNames || '-'}</td>
      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 font-mono cursor-pointer" onClick={() => onClick(job)}>{job.meterNo || 'N/A'}</td>
      {completedView && (
        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 font-mono cursor-pointer" onClick={() => onClick(job)}>{job.sealNo || 'N/A'}</td>
      )}
      <td className="px-4 py-3 cursor-pointer" onClick={() => onClick(job)}>
        <StatusBadge status={job.status} label={jedStatusLabel(job.status)} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 cursor-pointer" onClick={() => onClick(job)}>{formatDateOnly(getDisplayDate(job, completedView))}</td>
      <td className="px-4 py-3">
        {selectable ? (
          <button
            type="button"
            onClick={() => onAssignOne(job)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Assign Installer
          </button>
        ) : (
          <span className="text-xs italic text-gray-400 dark:text-gray-500">Not recorded</span>
        )}
      </td>
      <td className="px-4 py-3 text-right cursor-pointer" onClick={() => onClick(job)}>
        <ChevronRight className="w-4 h-4 text-gray-400 inline-block" />
      </td>
    </tr>
  );
}

function JobList({ jobs, onRowClick, emptyIcon: EmptyIcon, emptyMessage, selectable, selectedSet, onToggleSelect, onAssignOne, completedView }) {
  if (jobs.length === 0) {
    return (
      <div className="py-16 text-center">
        <EmptyIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p className="text-gray-600 dark:text-gray-400 font-medium">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div className="sm:hidden divide-y divide-gray-200 dark:divide-gray-700">
        {jobs.map((job) => (
          <JobRow
            key={job.id || job.accountNumber}
            job={job}
            onClick={onRowClick}
            selectable={selectable}
            selected={selectedSet.has(job.accountNumber)}
            onToggleSelect={onToggleSelect}
            onAssignOne={onAssignOne}
            completedView={completedView}
          />
        ))}
      </div>

      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 text-xs">
              {selectable && <th className="px-4 py-3 w-8"></th>}
              <th className="px-4 py-3 font-semibold">Account</th>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Meter No.</th>
              {completedView && <th className="px-4 py-3 font-semibold">Seal No.</th>}
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">{completedView ? 'Installed' : 'Date'}</th>
              <th className="px-4 py-3 font-semibold">Installer</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {jobs.map((job) => (
              <JobTableRow
                key={job.id || job.accountNumber}
                job={job}
                onClick={onRowClick}
                selectable={selectable}
                selected={selectedSet.has(job.accountNumber)}
                onToggleSelect={onToggleSelect}
                onAssignOne={onAssignOne}
                completedView={completedView}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AdminInstallations() {
  const navigate = useNavigate();
  const { refreshSignal } = useDataRefresh();

  const [awaitingJobs, setAwaitingJobs] = useState([]);
  const [completedJobs, setCompletedJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('awaiting');
  const [searchTerm, setSearchTerm] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [selected, setSelected] = useState(() => new Set());
  const [assignTarget, setAssignTarget] = useState(null); // { accounts: [...] } for the info modal

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Every page, not just the server's default page of 10 — the
      // previous per-status call sent no page/limit and so silently
      // truncated both tabs to 10 records.
      const [paidList, completedList] = await Promise.all([
        fetchAllRequests('PAID'),
        fetchAllRequests('COMPLETED'),
      ]);

      setAwaitingJobs(paidList);
      setCompletedJobs(completedList);
    } catch (err) {
      console.error('[AdminInstallations] Failed to load installations:', err);
      setError('Unable to load installations. Tap refresh to try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs, refreshKey, refreshSignal]);

  // Selection only makes sense for the still-actionable Awaiting tab —
  // clear it whenever the tab, data, or an app-wide refresh changes so a
  // stale selection can't linger against a list that's moved on.
  useEffect(() => {
    setSelected(new Set());
  }, [activeTab, awaitingJobs]);

  const visibleJobs = useMemo(() => {
    const source = activeTab === 'awaiting' ? awaitingJobs : completedJobs;
    if (!searchTerm.trim()) return source;
    const term = searchTerm.toLowerCase();
    return source.filter(
      (j) =>
        j.accountNumber?.toString().toLowerCase().includes(term) ||
        j.custNames?.toLowerCase().includes(term) ||
        j.meterNo?.toString().toLowerCase().includes(term)
    );
  }, [activeTab, awaitingJobs, completedJobs, searchTerm]);

  const handleRowClick = (job) => {
    navigate(`/installations/${job.accountNumber}`);
  };

  const handleToggleSelect = useCallback((accountNumber) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(accountNumber)) next.delete(accountNumber);
      else next.add(accountNumber);
      return next;
    });
  }, []);

  const handleAssignOne = (job) => setAssignTarget({ accounts: [job.accountNumber] });
  const handleAssignSelected = () => setAssignTarget({ accounts: Array.from(selected) });

  if (loading && awaitingJobs.length === 0 && completedJobs.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400 text-sm">Loading installations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* The page title lives on InstallationsPage, which hosts this view —
          only the actions for this view belong here. */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          aria-label="Refresh"
          className="p-2.5 sm:px-4 sm:py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 disabled:bg-brand-400 shrink-0 flex items-center gap-2 transition-all duration-150 active:scale-[0.98]"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline text-sm font-medium">Refresh</span>
        </button>
      </div>

      {error && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 p-3 sm:p-4 rounded-r-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-800 dark:text-yellow-300">{error}</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <StatusTabs
          tabs={[
            { id: 'awaiting', label: 'Awaiting Installation', icon: Clock, count: awaitingJobs.length },
            { id: 'completed', label: 'Completed', icon: CheckCircle, count: completedJobs.length },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by account, customer, or meter number..."
              className="form-input w-full pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>

        {activeTab === 'awaiting' && selected.size > 0 && (
          <div className="px-3 sm:px-4 py-2.5 bg-brand-50 dark:bg-brand-900/20 border-b border-brand-200 dark:border-brand-800 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-brand-800 dark:text-brand-300">
              {selected.size} selected
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAssignSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-gray-900 rounded-lg text-xs font-medium hover:bg-brand-600"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Assign to Installer
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                aria-label="Clear selection"
                className="p-1.5 text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-900/40 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <JobList
          jobs={visibleJobs}
          onRowClick={handleRowClick}
          emptyIcon={activeTab === 'awaiting' ? Clock : CheckCircle}
          emptyMessage={
            activeTab === 'awaiting'
              ? 'No installations awaiting installation — check back after a payment is confirmed'
              : 'No completed installations yet'
          }
          selectable={activeTab === 'awaiting'}
          completedView={activeTab === 'completed'}
          selectedSet={selected}
          onToggleSelect={handleToggleSelect}
          onAssignOne={handleAssignOne}
        />
      </div>

      <JedAssignmentNotice isOpen={!!assignTarget} onClose={() => setAssignTarget(null)} />
    </div>
  );
}

export default AdminInstallations;
