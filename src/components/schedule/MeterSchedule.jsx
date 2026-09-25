import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import JEDApiService from '../services/api';
import { usePermissions } from '../auth/usePermissions';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import ConfirmationModal from '../common/ConfirmationModal';
import {
  Calendar, Clock, CheckCircle,
  AlertCircle, FileText, Search, // Navigation and Filter icons removed — confirmed unused
  Zap,
  Cpu,
  Battery,
  Wrench,
  AlertTriangle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Download,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Trash2,
  Loader2,
  UserPlus,
  X
} from 'lucide-react';
import { formatDateOnly } from '../../utils/date';
import { unwrapListResponse } from '../../utils/unwrapListResponse';
import { fetchAllPagesDetailed } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';
import { downloadServerXlsx } from '../../utils/xlsx';
import {
  MANUFACTURED_LABEL, orNotRecorded, meterMakeOf, meterModelOf, manufacturedDateOf,
} from '../../utils/meterDisplay';
import {
  isAssignableMeter, meterDeletionBlockReason, partitionDeletableMeters, meterSerial,
} from '../../utils/meterInventory';
import AssignMeterModal from '../installations/AssignMeterModal';

// Constants for better maintainability
const METER_STATUS_OPTIONS = [
  { value: 'ALL', label: 'All Status', icon: Battery },
  { value: 'AVAILABLE', label: 'Available', icon: CheckCircle },
  { value: 'INSTALLED', label: 'Installed', icon: Wrench },
  { value: 'FAULTY', label: 'Faulty', icon: AlertTriangle },
  { value: 'RETIRED', label: 'Retired', icon: Battery }
];

const PHASE_TYPE_OPTIONS = [
  { value: 'ALL', label: 'All Phases' },
  { value: 'SINGLE PHASE', label: 'Single Phase', icon: Zap },
  { value: 'THREE PHASE', label: 'Three Phase', icon: Cpu }
];

const TABS = [
  { id: 'inventory', label: 'Meter Inventory' },
  { id: 'query', label: 'Meter Query' }
];

// The real GET /meters (and GET /meters/export) endpoints only document
// page/limit/status/phaseType as query parameters — confirmed against the
// live OpenAPI spec, no search/query parameter exists. Sending a `search`
// param (as this file previously did) is silently ignored server-side, so
// the "search" box was really just re-displaying whatever page 1 of the
// unfiltered/status-filtered list happened to contain — not a real search.
//
// Fix: when a search term is active, fetch every page matching the current
// status/phaseType filters (server-side, since those ARE supported) via
// fetchAllMeters below, filter client-side against the fields the real
// Meter schema actually has, then paginate the filtered result ourselves.
// Same safety-capped full-fetch pattern already used by AdminReports.jsx's
// fetchAllRequests, for the same reason: an accurate search needs the
// complete matching dataset, not just one page of it.
//
// The real Meter schema is exactly `id, meterNumber, simNumber,
// manufacturedDate, meterMake, model, phaseType, sgcNumber, status,
// uploadedAt, installedAt` — there is no accountNumber or customer-name
// field on a meter record (a meter isn't linked back to a customer/account
// until installation, via a separate JedCustomerRequest — see
// API_GAP_REPORT.md), so "Account Number"/"Customer Name" search is not
// possible here without fabricating a relationship the API doesn't have.
const MATCHABLE_METER_FIELDS = ['meterNumber', 'simNumber', 'meterMake', 'model', 'sgcNumber'];

// A complete meter number, the authoritative search criterion. 10-13 digits,
// as a string — see utils/meterNumber.js.
const COMPLETE_METER_NUMBER_RE = /^\d{10,13}$/;

// Safety ceiling for the fallback scan below. Only ever reached by a term
// that no search endpoint covers (a make, model or SGC fragment).
const FULL_METER_FETCH_MAX_PAGES = 100;

// GET /meters/search caps `limit` at 100. One page of matches is plenty for a
// search box; beyond it the result is reported as truncated rather than paged,
// so the operator narrows the term instead of scrolling.
const METER_SEARCH_LIMIT = 100;

const matchesActiveFilters = (meter, { status, phaseType } = {}) => {
  if (status && status !== 'ALL' && normalizeStatus(meter?.status) !== normalizeStatus(status)) return false;
  if (phaseType && phaseType !== 'ALL' && normalizeStatus(meter?.phaseType) !== normalizeStatus(phaseType)) return false;
  return true;
};

const isNotFoundError = (err) => String(err?.message || '').startsWith('NOT_FOUND:');

/**
 * Every meter matching the current server-side filters, paged. This is the
 * FALLBACK path — see searchMeters. Reports whether the cap cut it short.
 */
async function fetchAllMeters({ status, phaseType } = {}) {
  const params = {};
  if (status && status !== 'ALL') params.status = status;
  if (phaseType && phaseType !== 'ALL') params.phaseType = phaseType;
  // GET /meters omits `hasNext`, so a full page means "there may be more".
  return fetchAllPagesDetailed(
    (p) => JEDApiService.getMeters(p),
    params,
    { maxPages: FULL_METER_FETCH_MAX_PAGES, inferNextFromFullPage: true }
  );
}

/**
 * Find meters for a search term.
 *
 * ROOT CAUSE THIS FIXES. GET /meters has no search parameter, so search was
 * once implemented as "download the inventory, filter in the browser". That is
 * capped by definition — a meter past the cap was reported as not existing —
 * and it costs ~60 requests against a ~6,000-meter inventory. Raising the cap
 * (an earlier attempt) made it slower without making it correct.
 *
 * There are now two real server-side paths, in order of precision:
 *
 *   1. GET /meters/meter-number/{n} — a COMPLETE meter number. One request,
 *      whole inventory, exact match, no paging and no cap.
 *   2. GET /meters/search?q= — added 2026-09-24. A partial serial or SIM,
 *      matched server-side over meter_number and sim_number, paginated.
 *
 * The paged scan survives only for what neither endpoint covers: a make,
 * model or SGC term. Those are not searchable server-side, so a term with a
 * non-digit still falls back — and only then. Never widen a page cap to
 * search; add the endpoint the term needs.
 *
 * @returns {{ items: object[], truncated: boolean, exact: boolean }}
 */
async function searchMeters(term, filters) {
  if (COMPLETE_METER_NUMBER_RE.test(term)) {
    try {
      // The term is passed through as a string, exactly as typed — never
      // padded, trimmed to a length, or coerced to a number.
      const response = await JEDApiService.getMeterByNumber(term);
      const payload = response?.data ?? response;
      const meter = Array.isArray(payload) ? payload[0] : payload;
      const items = meter?.meterNumber && matchesActiveFilters(meter, filters) ? [meter] : [];
      return { items, truncated: false, exact: true };
    } catch (err) {
      // A genuine "no such meter" is an empty result, not an error.
      if (isNotFoundError(err)) return { items: [], truncated: false, exact: true };
      // Anything else (network, 500): fall through rather than failing a
      // search a slower path could still satisfy.
      console.warn('[MeterSchedule] Exact meter lookup unavailable, searching instead:', err?.message);
    }
  }

  // A digits-only partial is a serial or SIM fragment — exactly what
  // /meters/search covers, and it covers the WHOLE inventory.
  if (/^\d+$/.test(term)) {
    try {
      const params = { q: term, limit: METER_SEARCH_LIMIT };
      if (filters?.status && filters.status !== 'ALL') params.status = filters.status;
      if (filters?.phaseType && filters.phaseType !== 'ALL') params.phaseType = filters.phaseType;
      const response = await JEDApiService.searchMeters(params);
      // A search that legitimately matches nothing returns an envelope with an
      // empty list — that is a real "no matches" and must NOT trigger a
      // 60-request scan. No envelope at all is a different thing: the search
      // didn't happen, so fall through rather than report an empty inventory.
      if (!response) throw new Error('Empty meter search response');
      const items = unwrapListResponse(response);
      const total = response?.pagination?.totalCount;
      return {
        items,
        // More matches than one page holds: say so rather than implying the
        // list is everything.
        truncated: Number.isFinite(total) ? total > items.length : items.length >= METER_SEARCH_LIMIT,
        exact: false,
      };
    } catch (err) {
      console.warn('[MeterSchedule] Meter search unavailable, scanning instead:', err?.message);
    }
  }

  // Make / model / SGC, or a failed search above: nothing server-side covers
  // these, so the capped scan remains the only option.
  const all = await fetchAllMeters(filters);
  const needle = term.toLowerCase();
  return {
    items: all.items.filter((m) => meterMatchesSearch(m, needle)),
    truncated: all.truncated,
    exact: false,
  };
}

function meterMatchesSearch(meter, lowerCaseTerm) {
  return MATCHABLE_METER_FIELDS.some((field) => {
    const value = meter?.[field];
    return value && String(value).toLowerCase().includes(lowerCaseTerm);
  });
}

// Shared hook for meter data fetching
//
// FIXED (2 issues):
// 1. `updateFilters` previously called `fetchMeters()` directly AND updated
//    `filters` state, which independently re-triggered the effect below
//    (since it watches `filters`) — every filter/search change fired two
//    identical network requests. Now `updateFilters` only updates state;
//    the effect is the single source of truth for "filters changed, fetch."
// 2. Added an `enabled` param. Previously this hook fetched on mount
//    unconditionally, so both the Inventory tab's instance AND the Query
//    tab's instance fired a request immediately even though only one tab
//    is ever visible at a time. Now each instance only fetches once its
//    tab is actually active.
const useMeterData = (initialFilters = {}, enabled = true) => {
  const { refreshSignal } = useDataRefresh();
  const [meters, setMeters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    pages: 0
  });
  const [filters, setFilters] = useState({
    status: 'ALL',
    phaseType: 'ALL',
    searchTerm: '',
    ...initialFilters
  });

  // Guards against a race where an in-flight request resolves after a
  // *newer* one was already issued (e.g. the user searches "SIM1", then
  // "SIM12" before the first full-dataset fetch above finishes) — without
  // this, the slower, stale response could overwrite the newer one's
  // results. Every fetchMeters call claims the next id; a response is only
  // applied if its id is still the latest by the time it resolves.
  const requestIdRef = useRef(0);
  // Caches the last search's full matching dataset (before client-side
  // pagination) so clicking Next/Prev while a search is active re-slices
  // already-fetched data instead of re-running the full multi-page fetch
  // on every page click. Invalidated automatically whenever the search
  // term or status/phaseType filters change (the cache key changes too).
  const searchCacheRef = useRef({ key: null, matches: [], truncated: false });

  const fetchMeters = useCallback(async (page = 1, currentFilters = filters, pageLimit = null) => {
    const limit = pageLimit || pagination.limit;
    const searchTerm = currentFilters.searchTerm?.trim();
    const requestId = ++requestIdRef.current;

    // Search mode: the real API has no search parameter (see the comment
    // above fetchAllMeters), so an active search fetches every
    // status/phaseType-matching page, filters client-side, and paginates
    // the filtered result itself — entirely separate from the normal
    // single-page server-side path below.
    if (searchTerm) {
      try {
        setLoading(true);
        setError(null);

        // refreshSignal is part of the key so a mutation elsewhere in the
        // app (e.g. a meter's status changing) invalidates the cache too,
        // not just a changed search term/filter.
        const cacheKey = JSON.stringify({ searchTerm, status: currentFilters.status, phaseType: currentFilters.phaseType, refreshSignal });
        let matches;
        let truncated;
        if (searchCacheRef.current.key === cacheKey) {
          ({ matches, truncated } = searchCacheRef.current);
        } else {
          const result = await searchMeters(searchTerm, currentFilters);
          matches = result.items;
          truncated = result.truncated;
          searchCacheRef.current = { key: cacheKey, matches, truncated };
        }

        if (requestIdRef.current !== requestId) return; // a newer request superseded this one

        // An incomplete scan must never look like a confident "not found".
        setError(truncated
          ? 'The inventory is larger than this search can scan, so some meters may be missing. Narrow the status or phase filter and search again.'
          : null);

        const total = matches.length;
        const pages = Math.max(1, Math.ceil(total / limit));
        const safePage = Math.min(Math.max(1, page), pages);
        const start = (safePage - 1) * limit;

        setMeters(matches.slice(start, start + limit));
        setPagination((prev) => ({ ...prev, page: safePage, limit, total, pages }));
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        console.error('[MeterData] Error searching meters:', err);
        setError(getErrorMessage(err, 'Failed to search meters'));
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const params = { page, limit };

      if (currentFilters.status !== 'ALL') {
        params.status = currentFilters.status;
      }

      if (currentFilters.phaseType !== 'ALL') {
        params.phaseType = currentFilters.phaseType;
      }

      const response = await JEDApiService.getMeters(params);
      if (requestIdRef.current !== requestId) return; // a newer request superseded this one

      const payload = response?.data ?? response;
      const metersData = unwrapListResponse(response);

      const metadata = response?.meta ?? response?.data?.meta ?? payload?.meta ?? {};
      const paginationData = response?.pagination
        || response?.data?.pagination
        || response?.data?.pageInfo
        || payload?.pagination
        || payload?.pageInfo
        || metadata
        || {};

      // NOTE: the real GET /meters endpoint returns pagination.currentPage as a
      // STRING ("1", "2", ...) while every other paginated endpoint in this app
      // (e.g. GET /external/jed/requests) returns it as a number. Every field
      // extracted here is coerced with Number() so page/limit/total/pages are
      // always numeric — without this, `pagination.page + 1` in the Next button
      // handler does string concatenation ("1" + 1 = "11") instead of numeric
      // addition, silently requesting a wildly out-of-range page that legitimately
      // comes back empty (looked like a pagination bug, was actually this).
      const totalCount = Number(paginationData.total ?? paginationData.totalCount ?? paginationData.total_items ?? paginationData.count ?? paginationData.total_documents ?? paginationData.totalRecords ?? response?.total ?? response?.count ?? response?.totalCount ?? response?.count ?? response?.data?.total ?? response?.data?.count ?? response?.data?.totalCount ?? response?.data?.count ?? metersData.length);
      const currentPage = Number(paginationData.page ?? paginationData.currentPage ?? paginationData.current_page ?? paginationData.currentPageNo ?? paginationData.current_page_no ?? response?.page ?? response?.currentPage ?? response?.current_page ?? response?.pageNumber ?? response?.data?.page ?? response?.data?.currentPage ?? response?.data?.current_page ?? page);
      const limitCount = Number(paginationData.limit ?? paginationData.perPage ?? paginationData.pageSize ?? paginationData.per_page ?? paginationData.per_page_size ?? paginationData.pageSize ?? metadata.perPage ?? metadata.pageSize ?? metadata.per_page ?? metadata.per_page_size ?? response?.limit ?? response?.perPage ?? response?.pageSize ?? pageLimit ?? pagination.limit);
      const inferredTotal = totalCount || metersData.length;
      const totalPages = Number(paginationData.pages ?? paginationData.totalPages ?? paginationData.total_pages ?? paginationData.pageCount ?? Math.max(1, Math.ceil(inferredTotal / (limitCount || pagination.limit || 1)), currentPage));

      setMeters(metersData);
      setPagination(prev => ({
        ...prev,
        page: currentPage,
        limit: limitCount,
        total: inferredTotal,
        pages: totalPages
      }));
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      console.error('[MeterData] Error fetching meters:', err);
      setError(getErrorMessage(err, 'Failed to load meters'));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [pagination.limit, filters, refreshSignal]);

  const updateFilters = useCallback((newFilters) => {
    setFilters(newFilters);
  }, []);

  const changePage = useCallback((page, newLimit = null) => {
    if (newLimit && newLimit !== pagination.limit) {
      setPagination(prev => ({ ...prev, limit: newLimit }));
      fetchMeters(1, filters, newLimit);
    } else {
      fetchMeters(page, filters);
    }
  }, [fetchMeters, filters, pagination.limit]);

  const exportMeters = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      
      if (filters.status !== 'ALL') {
        params.status = filters.status;
      }
      if (filters.phaseType !== 'ALL') {
        params.phaseType = filters.phaseType;
      }
      // No `search` param here — GET /meters/export only documents
      // status/phaseType (confirmed against the live OpenAPI spec, same as
      // GET /meters above). This export is generated entirely server-side,
      // so an active on-screen search term can't be reflected in it without
      // fetching+filtering client-side and generating the file ourselves —
      // out of scope for the search fix; exporting still respects
      // status/phaseType, just not a search term.

      const blob = await JEDApiService.exportMeters(params);
      // Meter/SIM numbers stored as numbers by the server are rewritten as
      // text before saving (utils/xlsx.js) — no scientific notation in Excel.
      await downloadServerXlsx(blob, `meters-export-${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      console.error('[MeterData] Export failed:', err);
      setError('Failed to export meters');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (!enabled) return;
    fetchMeters(1, filters);
    // refreshSignal: re-fetch after an app-wide data mutation elsewhere
    // (e.g. a completed installation) — see DataRefreshContext.
  }, [enabled, fetchMeters, filters, refreshSignal]);

  return {
    meters,
    loading,
    error,
    pagination,
    filters,
    fetchMeters: () => fetchMeters(pagination.page, filters),
    updateFilters,
    changePage,
    exportMeters
  };
};

// Custom hook for meter statistics.
// `enabled` is false for a role the API won't serve this to (Supervisor holds
// SCHEDULE.VIEW without SCHEDULE.MANAGE, and GET /meters/statistics is
// admin-tier only).
const useMeterStatistics = (enabled = true) => {
  const { refreshSignal } = useDataRefresh();
  const [meterStats, setMeterStats] = useState({
    totalMeters: 0,
    available: 0,
    installed: 0,
    faulty: 0,
    retired: 0,
    singlePhase: 0,
    threePhase: 0,
    completed: 0,
    paid: 0,
    pending: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasPermission, setHasPermission] = useState(true);

  const normalizeStats = (data) => {
    const stats = {
      totalMeters: data.totalMeters ?? data.total_meters ?? data.totalMetersCount ?? data.total_meters_count ?? data.total ?? data.count ?? 0,
      available: data.available ?? data.available_meters ?? data.availableMeters ?? data.available_count ?? data.availableCount ?? 0,
      installed: data.installed ?? data.installed_meters ?? data.installedMeters ?? data.installed_count ?? data.installedCount ?? 0,
      faulty: data.faulty ?? data.faulty_meters ?? data.faultyMeters ?? data.faulty_count ?? data.faultyCount ?? 0,
      retired: data.retired ?? data.retired_meters ?? data.retiredMeters ?? data.retired_count ?? data.retiredCount ?? 0,
      singlePhase: data.singlePhase ?? data.single_phase ?? data.singlePhaseMeters ?? data.single_phase_meters ?? 0,
      threePhase: data.threePhase ?? data.three_phase ?? data.threePhaseMeters ?? data.three_phase_meters ?? 0,
      completed: data.completed ?? data.completed_meters ?? data.completedMeters ?? data.completed_count ?? data.completedCount ?? 0,
      paid: data.paid ?? data.paid_meters ?? data.paidMeters ?? data.paid_count ?? data.paidCount ?? 0,
      pending: data.pending ?? data.pending_meters ?? data.pendingMeters ?? data.pending_count ?? data.pendingCount ?? 0
    };

    return stats;
  };

  const unwrapStatsResponse = (response) => {
    if (!response) return null;
    if (response.success && response.data) return response.data;
    if (response.data?.data) return response.data.data;
    return response.data ?? response;
  };

  const fetchMeterStatistics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await JEDApiService.getMeterStatistics();
      const payload = unwrapStatsResponse(response);

      if (!payload) {
        throw new Error('Empty meter statistics response');
      }

      setMeterStats(normalizeStats(payload));
      setHasPermission(true);
    } catch (err) {
      console.error('[MeterSchedule] Error fetching meter statistics:', err);
      
      const errorMessage = String(err.message || '').toLowerCase();
      if (errorMessage.includes('permission') || 
          errorMessage.includes('403') || 
          errorMessage.includes('insufficient')) {
        console.warn('[MeterSchedule] User lacks permission for meter statistics - hiding stats section');
        setHasPermission(false);
        setError(null);
      } else if (errorMessage.includes('not_found') || errorMessage.includes('404')) {
        console.warn('[MeterSchedule] Meter statistics endpoint not found');
        setError('Meter statistics service unavailable');
      } else {
        setError(getErrorMessage(err, 'Failed to load meter statistics'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // GET /meters/statistics is admin-tier only — a Supervisor gets a 403.
    // Skipping the call entirely beats firing one we know will be refused and
    // then hiding the section after the fact.
    if (!enabled) {
      setLoading(false);
      return;
    }
    fetchMeterStatistics();
  }, [enabled, fetchMeterStatistics, refreshSignal]);

  return {
    meterStats,
    loading,
    error,
    hasPermission,
    refetch: fetchMeterStatistics
  };
};

// Stats Cards Component
 
const StatsCard = ({ title, value, icon: Icon, bgColor, iconColor, loading = false, error = false }) => (
  <div className="card p-4 sm:p-6 hover:shadow-lg transition-shadow duration-200">
    <div className="flex items-center justify-between">
      <div className="min-w-0">
        <p className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-1 truncate">{title}</p>
        <p className={`text-2xl sm:text-3xl font-bold ${error ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
          {loading ? '...' : error ? 'Error' : value}
        </p>
        {error && (
          <p className="text-xs text-red-500 mt-1">Failed to load</p>
        )}
      </div>
      <div className={`${bgColor} rounded-full p-2 sm:p-3 flex-shrink-0 ml-4`}>
        <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${iconColor}`} />
      </div>
    </div>
  </div>
);

// Meter Status Badge Component
const normalizeStatus = (status) => String(status || '').toUpperCase().trim();
const getMeterStatus = (meter) => {
  const installedAt = meter?.installedAt ?? meter?.installed_at ?? meter?.installedDate ?? meter?.installed_date;
  const isInstalledFlag = meter?.isInstalled === true || meter?.is_installed === true || meter?.installed === true || normalizeStatus(meter?.installed) === 'INSTALLED';
  const status = normalizeStatus(meter?.status);

  if (installedAt || isInstalledFlag || status === 'INSTALLED') {
    return 'INSTALLED';
  }

  if (status === 'FAULTY') {
    return 'FAULTY';
  }

  if (status === 'RETIRED') {
    return 'RETIRED';
  }

  if (status === 'AVAILABLE') {
    return 'AVAILABLE';
  }

  return status || 'AVAILABLE';
};

const getInstalledAtValue = (meter) => {
  return meter?.installedAt ?? meter?.installed_at ?? meter?.installedDate ?? meter?.installed_date ?? null;
};

const MeterStatusBadge = ({ status }) => {
  const getStatusConfig = (status) => {
    switch (status) {
      case 'AVAILABLE':
        return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300', label: 'Available' };
      case 'INSTALLED':
        return { bg: 'bg-brand-100 dark:bg-brand-900/30', text: 'text-brand-800 dark:text-brand-300', label: 'Installed' };
      case 'FAULTY':
        return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300', label: 'Faulty' };
      case 'RETIRED':
        return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-800 dark:text-gray-200', label: 'Retired' };
      default:
        return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-800 dark:text-gray-200', label: status || 'Unknown' };
    }
  };

  const config = getStatusConfig(status);
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
};

// Phase Type Badge Component
const PhaseTypeBadge = ({ phaseType }) => {
  const getPhaseConfig = (phaseType) => {
    switch (phaseType) {
      case 'SINGLE PHASE':
        // Cyan, not amber/gold — gold is now this app's brand colour (see
        // tailwind.config.js), so a phase-type badge doesn't collide with it.
        return { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-800 dark:text-cyan-300', icon: Zap, label: 'Single Phase' };
      case 'THREE PHASE':
        return { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-800 dark:text-indigo-300', icon: Cpu, label: 'Three Phase' };
      default:
        return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-800 dark:text-gray-200', icon: null, label: phaseType };
    }
  };

  const config = getPhaseConfig(phaseType);
  const Icon = config.icon;
  
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text} flex items-center gap-1`}>
      {Icon && <Icon className="w-3 h-3" />}
      {config.label}
    </span>
  );
};


// Meter Card Component
const MeterCard = ({
  meter, canDelete, canAssignMeters, deleting, onDeleteClick, onAssignClick,
  selectable, selected, onToggleSelect,
}) => {
  const status = getMeterStatus(meter);
  // Dispatchable per the shared inventory rule (status AVAILABLE and not
  // already out with someone) — the same rule the Assignments picker uses, so
  // the two screens can never offer different meters.
  const canAssign = canAssignMeters && isAssignableMeter(meter);
  const deleteBlockedReason = canDelete ? meterDeletionBlockReason(meter) : null;
  return (
  <div className={`card p-4 sm:p-6 hover:shadow-lg transition-shadow duration-200 ${
    selected ? 'ring-2 ring-brand-500 dark:ring-brand-400' : ''
  }`}>
    <div className="flex items-start justify-between mb-3 gap-2">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(meter)}
            aria-label={`Select meter ${meter.meterNumber}`}
            className="mt-1 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base truncate mb-1">
            {meter.meterNumber}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            SIM: {orNotRecorded(meter.simNumber)}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          <MeterStatusBadge status={status} />
          {canDelete && (
            <button
              onClick={() => onDeleteClick(meter)}
              disabled={deleting || !!deleteBlockedReason}
              className="p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={deleteBlockedReason
                ? `Cannot be deleted. ${deleteBlockedReason}`
                : 'Delete meter from inventory'}
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
        <PhaseTypeBadge phaseType={meter.phaseType} />
      </div>
    </div>

    <div className="grid grid-cols-1 gap-2 text-xs sm:text-sm">
      {/* Make and Model are always shown, even when the record doesn't carry
          them: "Make:" with nothing after it reads as a rendering bug, while
          "Not recorded" says what is actually true of the data. The API has no
          separate manufacturer field — meterMake is it — and manufacturedDate
          is a build DATE, so it is labelled as one. See utils/meterDisplay.js. */}
      <div className="flex items-center text-gray-600 dark:text-gray-400">
        <Wrench className="w-3 h-3 mr-2 flex-shrink-0" />
        <span className="truncate">Make: {orNotRecorded(meterMakeOf(meter))}</span>
      </div>
      <div className="flex items-center text-gray-600 dark:text-gray-400">
        <FileText className="w-3 h-3 mr-2 flex-shrink-0" />
        <span className="truncate">Model: {orNotRecorded(meterModelOf(meter))}</span>
      </div>
      <div className="flex items-center text-gray-600 dark:text-gray-400">
        <Calendar className="w-3 h-3 mr-2 flex-shrink-0" />
        <span className="truncate">{MANUFACTURED_LABEL}: {orNotRecorded(manufacturedDateOf(meter))}</span>
      </div>
      {meter.sgcNumber && (
        <div className="flex items-center text-gray-600 dark:text-gray-400">
          <FileText className="w-3 h-3 mr-2 flex-shrink-0" />
          <span>SGC: {meter.sgcNumber}</span>
        </div>
      )}
    </div>

    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p>Uploaded: {formatDateOnly(meter.uploadedAt)}</p>
          {getInstalledAtValue(meter) && (
            <p>Installed: {formatDateOnly(getInstalledAtValue(meter))}</p>
          )}
        </div>
        {canAssign && (
          <button
            onClick={() => onAssignClick(meter)}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-brand-200 dark:border-brand-800 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors text-xs font-medium"
            title="Assign this meter to an installer/job"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Assign
          </button>
        )}
      </div>
    </div>
  </div>
  );
};

// Meter Table Component for Query Tab
const MeterTable = ({ meters, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="w-6 h-6 animate-spin text-brand-600" />
        <span className="ml-2 text-gray-600 dark:text-gray-400">Loading meters...</span>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Meter Number
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                SIM Number
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Make & Model
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Phase Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {MANUFACTURED_LABEL}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Installed
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {meters.map((meter) => (
              <tr key={meter.id} className="hover:bg-gray-50 dark:bg-gray-900/50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900 dark:text-white">
                  {meter.meterNumber}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {meter.simNumber}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  <div>{orNotRecorded(meterMakeOf(meter))}</div>
                  <div className="text-gray-500 dark:text-gray-400 text-xs">
                    {orNotRecorded(meterModelOf(meter))}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <PhaseTypeBadge phaseType={meter.phaseType} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <MeterStatusBadge status={getMeterStatus(meter)} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {orNotRecorded(manufacturedDateOf(meter))}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {getInstalledAtValue(meter)
                    ? formatDateOnly(getInstalledAtValue(meter))
                    // A meter can genuinely be status INSTALLED with no
                    // installedAt timestamp on the real API (confirmed:
                    // this happens in production data) — "Not Installed"
                    // would contradict the Status column right next to it,
                    // so this only says that when the meter really isn't
                    // installed yet. Never fabricates a date either way.
                    : getMeterStatus(meter) === 'INSTALLED'
                      ? 'Installed (date unavailable)'
                      : 'Not Installed'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Loading Skeleton Component
const MeterLoadingSkeleton = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
    {[...Array(6)].map((_, i) => (
      <div key={i} className="card p-4 sm:p-6 animate-pulse">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
        </div>
      </div>
    ))}
  </div>
);

// Empty State Component
const EmptyState = ({ hasFilters, searchTerm, type = 'meters' }) => (
  <div className="card p-8 sm:p-12 text-center">
    <AlertCircle className="w-8 h-8 sm:w-12 sm:h-12 text-gray-400 mx-auto mb-2 sm:mb-3" />
    <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base mb-2">
      {hasFilters
        ? `No ${type} match your criteria`
        : `No ${type} found`}
    </p>
    {searchTerm && (
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">You searched for: <strong className="text-gray-700 dark:text-gray-300">"{searchTerm}"</strong></p>
    )}
    {(hasFilters || searchTerm) && (
      <p className="text-gray-400 text-xs sm:text-sm">
        Try adjusting your search criteria
      </p>
    )}
  </div>
);

// Filter Controls Component for Meter Inventory
const MeterFilterControls = ({ filters, onFilterChange, loading, onRefresh, onExport }) => {
  const [localSearchTerm, setLocalSearchTerm] = useState(filters.searchTerm);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (localSearchTerm !== filters.searchTerm) {
        onFilterChange({ ...filters, searchTerm: localSearchTerm });
      }
    }, 500); // 500ms debounce delay

    return () => {
      clearTimeout(handler);
    };
  }, [localSearchTerm, filters, onFilterChange]);

  const handleStatusChange = useCallback((status) => {
    onFilterChange({ ...filters, status });
  }, [filters, onFilterChange]);

  const handlePhaseChange = useCallback((phaseType) => {
    onFilterChange({ ...filters, phaseType });
  }, [filters, onFilterChange]);

  return (
    <div className="card p-4">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={localSearchTerm}
              onChange={(e) => setLocalSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                // Enter commits immediately instead of waiting out the
                // debounce — same eventual result, just without the delay.
                if (e.key === 'Enter' && localSearchTerm !== filters.searchTerm) {
                  onFilterChange({ ...filters, searchTerm: localSearchTerm });
                }
              }}
              placeholder="Search by Meter Number, SIM, SGC..."
              className="form-input w-full pl-10 pr-3 py-2 text-sm"
              disabled={loading}
            />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <div className="flex-1">
              <label htmlFor="meter-status-1" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <select
                id="meter-status-1"
                value={filters.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="form-input w-full px-3 py-2 text-sm"
                disabled={loading}
              >
                {METER_STATUS_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label htmlFor="meter-phase-1" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phase Type</label>
              <select
                id="meter-phase-1"
                value={filters.phaseType}
                onChange={(e) => handlePhaseChange(e.target.value)}
                className="form-input w-full px-3 py-2 text-sm"
                disabled={loading}
              >
                {PHASE_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:self-end">
            {/* Omitted for a role the API won't serve GET /meters/export to
                (Supervisor) — the caller passes no handler in that case. */}
            {onExport && (
              <button
                onClick={onExport}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-green-400 disabled:cursor-not-allowed text-sm"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            )}
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors disabled:bg-brand-400 disabled:cursor-not-allowed text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Advanced Query Controls Component
const QueryFilterControls = ({ filters, onFilterChange, loading, onRefresh, onExport }) => {
  const [localSearchTerm, setLocalSearchTerm] = useState(filters.searchTerm);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (localSearchTerm !== filters.searchTerm) {
        onFilterChange({ ...filters, searchTerm: localSearchTerm });
      }
    }, 500); // 500ms debounce delay

    return () => {
      clearTimeout(handler);
    };
  }, [localSearchTerm, filters, onFilterChange]);

  const handleStatusChange = useCallback((status) => {
    onFilterChange({ ...filters, status });
  }, [filters, onFilterChange]);

  const handlePhaseChange = useCallback((phaseType) => {
    onFilterChange({ ...filters, phaseType });
  }, [filters, onFilterChange]);

  return (
    <div className="card p-4">
      <div className="space-y-4">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={localSearchTerm}
              onChange={(e) => setLocalSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                // Enter commits immediately instead of waiting out the
                // debounce — same eventual result, just without the delay.
                if (e.key === 'Enter' && localSearchTerm !== filters.searchTerm) {
                  onFilterChange({ ...filters, searchTerm: localSearchTerm });
                }
              }}
              placeholder="Search by Meter Number, SIM, SGC..."
              className="form-input w-full pl-10 pr-3 py-2 text-sm"
              disabled={loading}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1">
            <div className="flex-1">
              <label htmlFor="meter-status-2" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <select
                id="meter-status-2"
                value={filters.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="form-input w-full px-3 py-2 text-sm"
                disabled={loading}
              >
                {METER_STATUS_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label htmlFor="meter-phase-2" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phase Type</label>
              <select
                id="meter-phase-2"
                value={filters.phaseType}
                onChange={(e) => handlePhaseChange(e.target.value)}
                className="form-input w-full px-3 py-2 text-sm"
                disabled={loading}
              >
                {PHASE_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:self-end">
            {/* Omitted for a role the API won't serve GET /meters/export to
                (Supervisor) — the caller passes no handler in that case. */}
            {onExport && (
              <button
                onClick={onExport}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-green-400 disabled:cursor-not-allowed text-sm"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            )}
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors disabled:bg-brand-400 disabled:cursor-not-allowed text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Enhanced Pagination Component
const Pagination = ({ pagination, onPageChange, loading }) => {
  const { page, pages, total, limit } = pagination;

  if (pages <= 1) return null;

  const getPageNumbers = () => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];

    for (
      let i = Math.max(2, page - delta);
      i <= Math.min(pages - 1, page + delta);
      i++
    ) {
      range.push(i);
    }

    if (page - delta > 2) {
      rangeWithDots.push(1, '...');
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (page + delta < pages - 1) {
      rangeWithDots.push('...', pages);
    } else if (pages > 1) {
      rangeWithDots.push(pages);
    }

    return rangeWithDots;
  };

  const pageNumbers = getPageNumbers();
  const startItem = (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between card p-4 gap-4">
      <div className="text-sm text-gray-700 dark:text-gray-300 order-2 sm:order-1">
        Showing <span className="font-medium">{startItem}</span> to{' '}
        <span className="font-medium">{endItem}</span> of{' '}
        <span className="font-medium">{total}</span> results
      </div>

      <div className="flex items-center space-x-2 order-1 sm:order-2">
        <button
          onClick={() => onPageChange(1)}
          disabled={page <= 1 || loading}
          className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900/50 disabled:opacity-50 disabled:cursor-not-allowed hidden sm:block"
          title="First page"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>

        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || loading}
          className="flex items-center gap-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Previous</span>
        </button>

        <div className="flex items-center space-x-1">
          {pageNumbers.map((pageNum, index) => {
            if (pageNum === '...') {
              return (
                <span
                  key={`ellipsis-${index}`}
                  className="px-3 py-2 text-gray-500 dark:text-gray-400"
                >
                  ...
                </span>
              );
            }

            return (
              <button
                key={pageNum}
                onClick={() => onPageChange(pageNum)}
                disabled={loading}
                className={`min-w-[40px] px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  page === pageNum
                    ? 'bg-brand-500 text-gray-900'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900/50 border border-gray-300 dark:border-gray-600'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages || loading}
          className="flex items-center gap-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          onClick={() => onPageChange(pages)}
          disabled={page >= pages || loading}
          className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900/50 disabled:opacity-50 disabled:cursor-not-allowed hidden sm:block"
          title="Last page"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300 order-3">
        <span className="hidden md:inline">Items per page:</span>
        <select
          value={limit}
          onChange={(e) => onPageChange(1, parseInt(e.target.value))}
          disabled={loading}
          className="form-input px-2 py-1 disabled:opacity-50"
        >
          <option value="10">10</option>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>
    </div>
  );
};

// Meter Inventory Component
/**
 * What the confirmation actually says will happen: how many records, which
 * ones, and which of the selection will be left alone and why. Nothing is
 * deleted that isn't named here.
 */
function deleteConfirmationMessage(meters) {
  const { deletable, blocked } = partitionDeletableMeters(meters);
  const lines = [];
  if (deletable.length === 0) {
    lines.push('None of the selected meters can be deleted.');
  } else {
    lines.push(
      `This will permanently remove ${deletable.length} imported meter record${deletable.length === 1 ? '' : 's'} from inventory. This action cannot be undone.`
    );
    const shown = deletable.slice(0, 8).map(meterSerial).join(', ');
    lines.push(deletable.length > 8 ? `${shown} and ${deletable.length - 8} more.` : shown);
  }
  if (blocked.length > 0) {
    lines.push(
      `${blocked.length} selected meter${blocked.length === 1 ? ' is' : 's are'} in use and will be left unchanged.`
    );
  }
  return lines.join('\n\n');
}

const MeterInventory = ({ meterInventory, canDeleteMeters, canAssignMeters, canExportMeters, onDataChanged }) => {
  const { meters, loading, error, pagination, filters, fetchMeters, updateFilters, changePage, exportMeters } = meterInventory;

  // Deletion is scoped to what a Super Admin selected, one meter at a time
  // against DELETE /meters/{meterNumber} — the only delete the API offers for
  // anything an upload created. `pendingDelete` is always an explicit list,
  // so nothing can be removed by a stray click or an Enter key.
  const [pendingDelete, setPendingDelete] = useState(null); // object[] | null
  const [deletingNumber, setDeletingNumber] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleteOutcome, setDeleteOutcome] = useState(null);
  const [selected, setSelected] = useState(() => new Map()); // serial -> meter
  const [metersToAssign, setMetersToAssign] = useState(null); // object[] | null

  // Never keep a meter selected once the page it was on is gone, and never
  // act on a stale copy — the selection always tracks the rows on screen.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const onScreen = new Map(meters.map((m) => [meterSerial(m), m]));
      const next = new Map();
      prev.forEach((_, serial) => {
        const fresh = onScreen.get(serial);
        if (fresh && !meterDeletionBlockReason(fresh)) next.set(serial, fresh);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [meters]);

  const toggleSelect = useCallback((meter) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const serial = meterSerial(meter);
      if (next.has(serial)) next.delete(serial);
      else next.set(serial, meter);
      return next;
    });
  }, []);

  const selectedMeters = useMemo(() => Array.from(selected.values()), [selected]);
  const selectableOnPage = useMemo(
    () => meters.filter((m) => !meterDeletionBlockReason(m)),
    [meters]
  );

  const closeDeleteDialog = useCallback(() => {
    setPendingDelete(null);
    setDeleteOutcome(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!pendingDelete || deleteBusy) return;
    // Re-checked here, not only when the button was rendered: the list may
    // have refreshed while the dialog was open.
    const { deletable, blocked } = partitionDeletableMeters(pendingDelete);
    if (deletable.length === 0) {
      setDeleteError('None of the selected meters can be deleted.');
      setPendingDelete(null);
      return;
    }

    setDeleteBusy(true);
    setDeleteError(null);
    const failures = [];
    let deleted = 0;
    try {
      for (const meter of deletable) {
        const serial = meterSerial(meter);
        setDeletingNumber(serial);
        try {
          // Sequential on purpose: one documented single-record endpoint per
          // meter, so each outcome stays attributable to its serial.
          await JEDApiService.deleteMeter(serial);
          deleted += 1;
        } catch (err) {
          console.error('[MeterInventory] Failed to delete meter:', serial, err);
          failures.push({ serial, reason: getErrorMessage(err, 'It could not be deleted.') });
        }
      }
    } finally {
      setDeletingNumber(null);
      setDeleteBusy(false);
    }

    setSelected(new Map());
    setPendingDelete(null);
    // The server is the source of truth for what is left — re-read rather
    // than dropping rows from local state.
    JEDApiService.clearCache();
    await fetchMeters();
    onDataChanged?.();
    setDeleteOutcome({ deleted, failures, skipped: blocked.length });
  }, [pendingDelete, deleteBusy, fetchMeters, onDataChanged]);

  const handleAssigned = useCallback(async ({ accepted }) => {
    setMetersToAssign(null);
    setSelected(new Map());
    JEDApiService.clearCache();
    await fetchMeters();
    onDataChanged?.();
    if (accepted?.length) {
      setDeleteOutcome({
        deleted: 0,
        failures: [],
        skipped: 0,
        assigned: accepted.length,
      });
    }
  }, [fetchMeters, onDataChanged]);

  const deleteCount = pendingDelete ? partitionDeletableMeters(pendingDelete).deletable.length : 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      <MeterFilterControls
        filters={filters}
        onFilterChange={updateFilters}
        loading={loading}
        onRefresh={fetchMeters}
        onExport={canExportMeters ? exportMeters : null}
      />

      {(error || deleteError) && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start gap-2 text-red-800 dark:text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="text-sm break-words">{error || deleteError}</span>
          </div>
        </div>
      )}

      {deleteOutcome && (
        <div role="status" className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 sm:p-4 flex items-start justify-between gap-3">
          <div className="min-w-0 text-sm text-green-800 dark:text-green-300 space-y-1">
            {deleteOutcome.assigned > 0 && (
              <p>{deleteOutcome.assigned} meter{deleteOutcome.assigned === 1 ? '' : 's'} assigned successfully.</p>
            )}
            {deleteOutcome.deleted > 0 && (
              <p>{deleteOutcome.deleted} meter{deleteOutcome.deleted === 1 ? '' : 's'} deleted.</p>
            )}
            {deleteOutcome.failures?.length > 0 && (
              <div className="text-red-800 dark:text-red-300">
                <p>{deleteOutcome.failures.length} could not be deleted:</p>
                <ul className="list-disc list-inside">
                  {deleteOutcome.failures.map((f) => (
                    <li key={f.serial} className="break-words">
                      <span className="font-mono">{f.serial}</span> — {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDeleteOutcome(null)}
            aria-label="Dismiss"
            className="p-1 rounded-lg text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Selection bar — only for the roles that can act on a selection */}
      {(canDeleteMeters || canAssignMeters) && selectedMeters.length > 0 && (
        <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm font-medium text-brand-800 dark:text-brand-300">
            {selectedMeters.length} meter{selectedMeters.length === 1 ? '' : 's'} selected
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canAssignMeters && (
              <button
                type="button"
                onClick={() => setMetersToAssign(selectedMeters.filter(isAssignableMeter))}
                disabled={!selectedMeters.some(isAssignableMeter)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-gray-900 rounded-lg text-xs font-medium hover:bg-brand-600 disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5" /> Assign to installer
              </button>
            )}
            {canDeleteMeters && (
              <button
                type="button"
                onClick={() => setPendingDelete(selectedMeters)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-800"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete {selectedMeters.length}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelected(new Map())}
              aria-label="Clear selection"
              className="p-1.5 text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-900/40 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Destructive, so: an explicit list, the exact count on the button,
          and no default-confirm path. Cancel does nothing at all. */}
      <ConfirmationModal
        isOpen={!!pendingDelete}
        onClose={closeDeleteDialog}
        onConfirm={handleDelete}
        loading={deleteBusy}
        title={deleteCount === 1 ? 'Delete imported meter?' : 'Delete imported meters?'}
        message={pendingDelete ? deleteConfirmationMessage(pendingDelete) : ''}
        confirmText={deleteCount === 1 ? 'Delete 1 meter' : `Delete ${deleteCount} meters`}
      />

      {/* Mounted only when there is something to assign. The modal loads the
          disco list and the installer's capacity on mount, so rendering it
          permanently (returning null when closed) would fire GET /discos on
          every visit to this page for a dialog nobody opened. */}
      {metersToAssign?.length > 0 && (
        <AssignMeterModal
          meters={metersToAssign}
          isOpen
          onClose={() => setMetersToAssign(null)}
          onAssigned={handleAssigned}
        />
      )}

      {loading && <MeterLoadingSkeleton />}

      {!loading && meters.length > 0 && (
        <>
          {canDeleteMeters && selectableOnPage.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={selectableOnPage.every((m) => selected.has(meterSerial(m)))}
                onChange={(e) => setSelected(e.target.checked
                  ? new Map(selectableOnPage.map((m) => [meterSerial(m), m]))
                  : new Map())}
                className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
              />
              Select all {selectableOnPage.length} deletable meter{selectableOnPage.length === 1 ? '' : 's'} on this page
            </label>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {meters.map(meter => (
              <MeterCard
                key={meter.id}
                meter={meter}
                canDelete={canDeleteMeters}
                canAssignMeters={canAssignMeters}
                deleting={deletingNumber === meterSerial(meter)}
                onDeleteClick={(m) => setPendingDelete([m])}
                onAssignClick={(m) => setMetersToAssign([m])}
                selectable={canDeleteMeters && !meterDeletionBlockReason(meter)}
                selected={selected.has(meterSerial(meter))}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>

          <Pagination
            pagination={pagination}
            onPageChange={changePage}
            loading={loading}
          />
        </>
      )}

      {!loading && meters.length === 0 && (
        <EmptyState
          hasFilters={filters.status !== 'ALL' || filters.phaseType !== 'ALL' || !!filters.searchTerm}
          searchTerm={filters.searchTerm}
          type="meters"
        />
      )}
    </div>
  );
};

// Meter Query Component
const MeterQuery = ({ meterQuery, canExportMeters }) => {
  const { meters, loading, error, pagination, filters, fetchMeters, updateFilters, changePage, exportMeters } = meterQuery;

  return (
    <div className="space-y-4 sm:space-y-6">
      <QueryFilterControls
        filters={filters}
        onFilterChange={updateFilters}
        loading={loading}
        onRefresh={fetchMeters}
        onExport={canExportMeters ? exportMeters : null}
      />

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-800 dark:text-red-300">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {!loading && meters.length > 0 && (
        <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-brand-800 dark:text-brand-300">
              Found <span className="font-semibold">{pagination.total}</span> meters matching your criteria
            </div>
            <div className="text-xs text-brand-600 dark:text-brand-400 flex items-center gap-2">
              <span>Page {pagination.page} of {pagination.pages}</span>
              <span>•</span>
              <span>Showing {((pagination.page - 1) * pagination.limit) + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)}</span>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-brand-600" />
          <span className="ml-3 text-gray-600 dark:text-gray-400">Loading meters...</span>
        </div>
      )}

      {!loading && meters.length > 0 ? (
        <>
          <MeterTable meters={meters} loading={loading} />
          <Pagination
            pagination={pagination}
            onPageChange={changePage}
            loading={loading}
          />
        </>
      ) : !loading ? (
        <EmptyState 
          hasFilters={filters.status !== 'ALL' || filters.phaseType !== 'ALL' || filters.searchTerm} 
          searchTerm={filters.searchTerm}
          type="meters"
        />
      ) : null}
    </div>
  );
};

// Main Component
function MeterSchedule() {
  // Two distinct capabilities on this page, not one "can manage" flag
  // (the route itself is already admin-gated in App.jsx):
  //  - canManageAssignments: dispatch meters — the same permission the
  //    Assignments page gates on, so Meter Schedule can never hand out a
  //    meter to someone the Assignments page wouldn't.
  //  - isSuperAdmin: delete records an upload/import created. Deliberately
  //    narrower than "can upload" — matching how User Management already
  //    reserves destructive actions for a Super Admin. The backend is still
  //    authoritative (DELETE /meters/{meterNumber} documents a 403).
  //  - canManageSchedule: the admin-tier meter operations the API reserves —
  //    the statistics call and the server-side export. A Supervisor reaches
  //    this page read-only (list, search, view) and gets a 403 on both, so
  //    they are not offered rather than offered and refused.
  const { canManageAssignments, isSuperAdmin, canManageSchedule } = usePermissions();
  const { notifyDataChanged } = useDataRefresh();
  const {
    meterStats, loading: statsLoading, error: statsError, refetch: refetchStats,
  } = useMeterStatistics(canManageSchedule);

  // activeTab now declared before the two useMeterData() instances so each
  // can be told whether it's the currently-visible tab (see fix note above
  // the useMeterData hook definition).
  const [activeTab, setActiveTab] = useState('inventory');
  const meterInventory = useMeterData({ searchTerm: '' }, activeTab === 'inventory');
  const meterQuery = useMeterData({ searchTerm: '' }, activeTab === 'query');

  const statsCards = useMemo(() => {
    const cards = [
      { 
        title: 'Total Meters', 
        value: meterStats.totalMeters, 
        icon: Database, 
        bgColor: 'bg-brand-100 dark:bg-brand-900/30', 
        iconColor: 'text-brand-600 dark:text-brand-400',
        loading: statsLoading,
        error: !!statsError
      },
      { 
        title: 'Available', 
        value: meterStats.available, 
        icon: CheckCircle, 
        bgColor: 'bg-green-100 dark:bg-green-900/30', 
        iconColor: 'text-green-600 dark:text-green-400',
        loading: statsLoading,
        error: !!statsError
      },
      { 
        title: 'Installed', 
        value: meterStats.installed, 
        icon: Wrench, 
        bgColor: 'bg-purple-100 dark:bg-purple-900/30', 
        iconColor: 'text-purple-600 dark:text-purple-400',
        loading: statsLoading,
        error: !!statsError
      },
      { 
        title: 'Faulty', 
        value: meterStats.faulty, 
        icon: AlertTriangle, 
        bgColor: 'bg-red-100 dark:bg-red-900/30', 
        iconColor: 'text-red-600 dark:text-red-400',
        loading: statsLoading,
        error: !!statsError
      },
      { 
        title: 'Retired', 
        value: meterStats.retired, 
        icon: Battery, 
        bgColor: 'bg-gray-100 dark:bg-gray-700',
        iconColor: 'text-gray-600 dark:text-gray-300',
        loading: statsLoading,
        error: !!statsError
      },
      { 
        title: 'Pending', 
        value: meterStats.pending, 
        icon: Clock, 
        bgColor: 'bg-brand-100 dark:bg-brand-900/30', 
        iconColor: 'text-brand-600 dark:text-brand-400',
        loading: statsLoading,
        error: !!statsError
      },
      { 
        title: 'Paid', 
        value: meterStats.paid, 
        icon: CheckCircle, 
        bgColor: 'bg-teal-100 dark:bg-teal-900/30', 
        iconColor: 'text-teal-600 dark:text-teal-400',
        loading: statsLoading,
        error: !!statsError
      },
      {
        title: 'Single Phase',
        value: meterStats.singlePhase,
        icon: Zap,
        bgColor: 'bg-cyan-100 dark:bg-cyan-900/30',
        iconColor: 'text-cyan-600 dark:text-cyan-400',
        loading: statsLoading,
        error: !!statsError
      },
      { 
        title: 'Three Phase', 
        value: meterStats.threePhase, 
        icon: Cpu, 
        bgColor: 'bg-indigo-100 dark:bg-indigo-900/30', 
        iconColor: 'text-indigo-600 dark:text-indigo-400',
        loading: statsLoading,
        error: !!statsError
      }
    ];

    return cards;
  }, [meterStats, statsLoading, statsError]);

  const handleTabChange = useCallback((tabId) => {
    setActiveTab(tabId);
  }, []);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg flex-shrink-0">
            <Database className="w-6 h-6 text-brand-600 dark:text-brand-400" />
          </div>
          <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-1">Meter Management</h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">
            Query your meter inventory and check stock levels
          </p>
          </div>
        </div>
        {statsError && (
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span className="text-red-600 text-sm">{statsError}</span>
            <button
              onClick={refetchStats}
              className="text-brand-600 hover:text-brand-800 text-sm font-medium"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {canManageSchedule && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4">
          {statsCards.map((card, index) => (
            <StatsCard key={index} {...card} />
          ))}
        </div>
      )}

      <div className="card p-3 sm:p-4">
        <div className="flex space-x-1 sm:space-x-2 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap text-xs sm:text-sm ${
                activeTab === tab.id
                  ? 'bg-brand-500 text-gray-900'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'inventory' && (
        <MeterInventory
          meterInventory={meterInventory}
          canDeleteMeters={isSuperAdmin}
          canAssignMeters={canManageAssignments}
          canExportMeters={canManageSchedule}
          onDataChanged={notifyDataChanged}
        />
      )}

      {activeTab === 'query' && (
        <MeterQuery meterQuery={meterQuery} canExportMeters={canManageSchedule} />
      )}
    </div>
  );
}

export default MeterSchedule;