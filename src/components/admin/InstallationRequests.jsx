// src/components/admin/InstallationRequests.jsx
// Admin view of every installation request across discos: the multi-disco
// jobs imported from a disco's sheet (InstallationRequest, GET /installations)
// AND JED's Remita customer requests (JedCustomerRequest, GET
// /external/jed/requests), with disco scoping, status counts, upload-field
// filters/sorting, installer dispatch, payments, and the disco response sheet.
//
// The two resources are shown side by side, never merged into one status
// scheme — each row keeps its own real status (see utils/installationScope.js
// and CLAUDE.md, "Two installation domains"). Previously this page read only
// GET /installations, so choosing JED showed nothing and "All discos" left
// JED out entirely.
//
// Loading: each source is fetched once per scope (pages in parallel — see
// fetchAllPagesDetailed) and status/attribute/search filtering happens on the
// loaded rows, so switching status is instant instead of a full refetch.
// Rows render in pages of PAGE_SIZE to keep large scopes responsive.
//
// Assigning an imported job is the real, backend-persisted installer
// assignment (POST /assignments/installations). JED requests have no
// assignment field or endpoint on the API, so their Assign action explains
// that instead of pretending (see API_GAP_REPORT.md).
import { useState, useEffect, useCallback, useMemo, useDeferredValue } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Search, AlertCircle, Loader2, UserPlus, X,
  Download, Ban, Undo2, Inbox, MapPin, ExternalLink, ArrowDownUp, Filter,
  ChevronRight, FileSpreadsheet, CalendarClock, ClipboardPaste,
} from 'lucide-react';
import jedApi from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { usePermissions } from '../auth/usePermissions';
import StatusBadge from '../common/StatusBadge';
import ConfirmationModal from '../common/ConfirmationModal';
import JedAssignmentNotice from '../installations/JedAssignmentNotice';
import InstallerSelect from '../installations/InstallerSelect';
import BatchResultSummary from '../installations/BatchResultSummary';
import MeterCapacitySummary from '../installations/MeterCapacitySummary';
import { useDiscoOptions } from '../../hooks/useDiscoOptions';
import { useInstallerMeterCapacity } from '../../hooks/useInstallerMeterCapacity';
import { fetchAllPagesDetailed } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';
import { formatPlainDate, formatDateTime, formatDateOnly } from '../../utils/date';
import { formatCurrencyNGN } from '../../utils/currency';
import { downloadServerXlsx, downloadXlsx } from '../../utils/xlsx';
import {
  isCompletedRow, filterByCompletionDate, buildMeterIndex, buildCompletedInstallationsReport,
} from '../../utils/completedInstallationsReport';
import { isAwaitingInstallationStatus } from '../../utils/statusBadge';
import { getAvailableActions, getCoordinates } from '../../utils/installationStatus';
import { revenueScopeFilter } from '../../utils/financeSummary';
import { usePaymentRevenueSummary } from '../../hooks/usePaymentRevenueSummary';
import { totalCollectedPayment } from '../../utils/meterPricing';
import { useInstallationTotals } from '../../hooks/useDashboardInstallations';
import {
  PENDING_INSTALLATION_FILTER, isPendingInstallationRow, filterByInstallationStatus,
} from '../../utils/installationTotals';
import RevenueSummaryPanel from './RevenueSummaryPanel';
import { classifyPastedAccounts, accountBatchMessage, mergeAssignmentResults } from '../../utils/accountBatch';
import {
  ROW_SOURCE, JED_BUCKET, ATTRIBUTE_FILTERS, SORT_OPTIONS, NOT_RECORDED,
  buildScopeOptions, resolveScope, attributeRemitaRecord, nonJedCodeSet,
  normalizeMultiRow, normalizeJedRow, dedupeRows, rowStatusLabel, statusesForScope,
  buildFilterOptions, applyAttributeFilters, applyStatusFilter, countByStatus, sortRows,
  filterByImportDate,
} from '../../utils/installationScope';

const PAGE_SIZE = 50;
// Up to 10,000 records per source. Past that the page says the list is
// incomplete rather than silently showing a subset.
const MAX_PAGES = 100;

const EMPTY_ATTRIBUTES = Object.fromEntries(ATTRIBUTE_FILTERS.map((f) => [f.field, '']));

const unwrapStats = (resp) => resp?.data || resp || null;

function StatTile({ label, value, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-2 rounded-lg border text-left transition-colors min-w-0 ${
        active
          ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-300 dark:border-brand-700'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/50'
      }`}
    >
      <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{value}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight truncate">{label}</p>
    </button>
  );
}

const attributeLine = (row) =>
  [
    row.feederName && `Feeder ${row.feederName}`,
    row.transformerName && `DT ${row.transformerName}`,
    row.installationPosition,
  ].filter(Boolean).join(' · ');

function RequestRow({ row, selectable, selected, onToggle, onCancel, onUnassign, busy, canCancel = true, canUnassign = true }) {
  const job = row.raw;
  const actions = getAvailableActions(row.status);
  const coords = getCoordinates(job);
  const attrs = attributeLine(row);

  return (
    <div className="p-4 flex items-start gap-3">
      {selectable ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(row)}
          aria-label={`Select account ${row.accountNumber}`}
          className="mt-1 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 shrink-0"
        />
      ) : <span className="w-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
              {row.customerName || `Account ${row.accountNumber}`}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              Acct {row.accountNumber}
              {row.meterType ? ` · ${row.meterType}` : ''}
              {row.discoCode ? ` · ${row.discoCode}` : ''}
            </p>
          </div>
          <StatusBadge status={row.status} label={rowStatusLabel(row)} className="shrink-0 text-[11px]" />
        </div>

        {row.customerAddress && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 truncate">{row.customerAddress}</p>
        )}
        {attrs && <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">{attrs}</p>}

        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
          {/* Three separate events, never conflated: when the record was
              imported, when it was assigned, when it was installed. */}
          {row.importedAt && <p>Imported {formatDateOnly(row.importedAt)}</p>}
          {job.assigneeName && <p>Assigned to {job.assigneeName}{job.assignedAt ? ` · ${formatDateTime(job.assignedAt)}` : ''}</p>}
          {job.meterNumber && (
            <p className="font-mono">
              Meter {job.meterNumber}{job.sealNumber ? ` · seal ${job.sealNumber}` : ''}
            </p>
          )}
          {job.installationDate && <p>Installed {formatPlainDate(job.installationDate)}{job.installerName ? ` by ${job.installerName}` : ''}</p>}
          {job.discoSupervisor && <p>Supervisor {job.discoSupervisor}</p>}
          {job.failureReason && <p className="text-red-700 dark:text-red-400">Failed: {job.failureReason}</p>}
          <div className="flex flex-wrap gap-x-3">
            {coords && (
              <a href={`https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 hover:underline">
                <MapPin className="w-3 h-3" />
                {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
              </a>
            )}
            {job.installationPhotoUrl && (
              <a href={job.installationPhotoUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 hover:underline">
                Photo <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Read-only roles (Supervisor) see the row and its status, never the
            actions that would change it. */}
        {((canUnassign && actions.unassign) || (canCancel && actions.cancel)) && (
          <div className="flex flex-wrap gap-2 mt-2">
            {canUnassign && actions.unassign && (
              <button type="button" onClick={() => onUnassign(job)} disabled={busy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
                <Undo2 className="w-3.5 h-3.5" /> Unassign
              </button>
            )}
            {canCancel && actions.cancel && (
              <button type="button" onClick={() => onCancel(job)} disabled={busy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50">
                <Ban className="w-3.5 h-3.5" /> Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// `showAmount` is PAYMENTS.VIEW: a Supervisor sees the request, not the money.
function JedRequestRow({ row, onAssign, canAssign = true, showAmount = false }) {
  const job = row.raw;
  return (
    <div className="p-4 flex items-start gap-3">
      <span className="w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
              {row.customerName || `Account ${row.accountNumber}`}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              Acct {row.accountNumber}
              {row.meterType ? ` · ${row.meterType}` : ''}
              {` · JED Remita${row.discoCode ? ` (${row.discoCode})` : ''}`}
            </p>
          </div>
          <StatusBadge status={row.status} label={rowStatusLabel(row)} className="shrink-0 text-[11px]" />
        </div>
        {row.customerAddress && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 truncate">{row.customerAddress}</p>
        )}
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
          <p>
            {showAmount && job.amount != null && job.amount !== '' ? `${formatCurrencyNGN(job.amount)} · ` : ''}
            Requested {formatDateOnly(job.dateRequested)}
            {job.dateCompleted ? ` · Installed ${formatDateOnly(job.dateCompleted)}` : ''}
          </p>
          {job.meterNo && <p className="font-mono">Meter {job.meterNo}{job.sealNo ? ` · seal ${job.sealNo}` : ''}</p>}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {canAssign && isAwaitingInstallationStatus(row.status) && (
            <button type="button" onClick={() => onAssign(row)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
              <UserPlus className="w-3.5 h-3.5" /> Assign installer
            </button>
          )}
          {/^\d+$/.test(row.accountNumber) && (
            <Link to={`/installations/${row.accountNumber}`}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-brand-700 dark:text-brand-400 hover:bg-gray-100 dark:hover:bg-gray-700">
              Open <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function InstallationRequests() {
  const permissions = usePermissions();
  // Dispatching jobs and taking them back are ASSIGNMENTS.MANAGE; cancelling a
  // request and exporting-and-marking-sent are INSTALLATIONS.MANAGE. A
  // Supervisor holds neither, so it gets this page's full read-only view.
  const canAssign = permissions.canManageAssignments;
  const canManageJobs = permissions.canManageInstallations;
  const { refreshSignal, notifyDataChanged } = useDataRefresh();
  const { discos, loading: discosLoading } = useDiscoOptions();

  const [scope, setScope] = useState('');
  const [status, setStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const search = useDeferredValue(searchTerm);
  const [attributes, setAttributes] = useState(EMPTY_ATTRIBUTES);
  // Import date range — when the record entered ME Metering, NOT its
  // assignment, payment or installation date (see filterByImportDate).
  const [importedFrom, setImportedFrom] = useState('');
  const [importedTo, setImportedTo] = useState('');
  const [sortKey, setSortKey] = useState('requestedAt');
  const [sortDir, setSortDir] = useState('desc');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [refreshKey, setRefreshKey] = useState(0);

  // Each source keeps the scope it was loaded for, so a slow response for a
  // previous scope can never be shown under the current one.
  const [multi, setMulti] = useState({ scopeKey: null, rows: [], totalCount: null, truncated: false, stats: null });
  const [multiLoading, setMultiLoading] = useState(true);
  const [multiError, setMultiError] = useState(null);
  const [jed, setJed] = useState({ loaded: false, records: [], totalCount: null, truncated: false });
  const [jedLoading, setJedLoading] = useState(true);
  const [jedError, setJedError] = useState(null);

  const [selected, setSelected] = useState(() => new Map()); // key -> row
  const [assignOpen, setAssignOpen] = useState(false);
  const [installerId, setInstallerId] = useState('');
  const [dispatchRef, setDispatchRef] = useState('');
  const [assignError, setAssignError] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState(null);
  const [jedAssignTarget, setJedAssignTarget] = useState(null);

  // Paste-many account numbers (utils/accountBatch.js). `accountBatch` is the
  // classified paste; `accountFilter` narrows the list to the accounts it
  // found, so the ordinary selection, capacity check and Assign modal apply to
  // them unchanged. `pendingBatchSelect` holds the row keys to select once
  // the narrowed list has rendered (see the effect below).
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [accountBatch, setAccountBatch] = useState(null);
  const [accountFilter, setAccountFilter] = useState(null); // Set<rowKey> | null
  const [pendingBatchSelect, setPendingBatchSelect] = useState(null); // Set<rowKey> | null

  const [cancelTarget, setCancelTarget] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [exporting, setExporting] = useState(false);
  const [markExported, setMarkExported] = useState(false);

  // Completed-installations workbook
  const [completedFrom, setCompletedFrom] = useState('');
  const [completedTo, setCompletedTo] = useState('');
  const [exportingCompleted, setExportingCompleted] = useState(false);
  const [completedExportError, setCompletedExportError] = useState(null);

  const scopeInfo = useMemo(() => resolveScope(scope), [scope]);
  const scopeOptions = useMemo(() => buildScopeOptions(discos), [discos]);
  const nonJedCodes = useMemo(() => nonJedCodeSet(discos), [discos]);

  const refreshAll = useCallback(() => {
    jedApi.clearCache();
    setRefreshKey((k) => k + 1);
  }, []);

  // Imported (multi-disco) jobs for the current disco scope. discoCode is a
  // documented server-side filter; everything else is filtered locally.
  const { includeMulti, multiDiscoCode } = scopeInfo;
  useEffect(() => {
    if (!includeMulti) {
      setMultiLoading(false);
      setMultiError(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setMultiLoading(true);
      setMultiError(null);
      const params = multiDiscoCode ? { discoCode: multiDiscoCode } : {};
      try {
        const [list, statsResp] = await Promise.all([
          fetchAllPagesDetailed((p) => jedApi.getInstallations(p), params, { maxPages: MAX_PAGES }),
          // The counts are a completeness cross-check only; a failure here
          // must not hide the list.
          jedApi.getInstallationStatistics(params).catch((err) => {
            console.warn('[InstallationRequests] Statistics unavailable:', err);
            return null;
          }),
        ]);
        if (!cancelled) {
          setMulti({
            scopeKey: multiDiscoCode,
            rows: list.items,
            totalCount: list.totalCount,
            truncated: list.truncated,
            stats: unwrapStats(statsResp),
          });
        }
      } catch (err) {
        console.error('[InstallationRequests] Load failed:', err);
        if (!cancelled) setMultiError(getErrorMessage(err, 'Unable to load imported installation requests.'));
      } finally {
        if (!cancelled) setMultiLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [includeMulti, multiDiscoCode, refreshKey, refreshSignal]);

  // JED's Remita requests, every status. Loaded once per refresh regardless
  // of scope — they're attributed to a disco locally, and they are also the
  // only records that carry a payment amount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setJedLoading(true);
      setJedError(null);
      try {
        const list = await fetchAllPagesDetailed(
          (p) => jedApi.getAllCustomerRequests(p), {}, { maxPages: MAX_PAGES }
        );
        if (!cancelled) setJed({ loaded: true, records: list.items, totalCount: list.totalCount, truncated: list.truncated });
      } catch (err) {
        console.error('[InstallationRequests] JED requests failed:', err);
        if (!cancelled) setJedError(getErrorMessage(err, 'Unable to load JED requests.'));
      } finally {
        if (!cancelled) setJedLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey, refreshSignal]);

  const multiReady = includeMulti && multi.scopeKey === multiDiscoCode;

  const multiRows = useMemo(
    () => (multiReady ? dedupeRows(multi.rows.map(normalizeMultiRow)) : []),
    [multiReady, multi.rows]
  );

  const jedRowsAll = useMemo(
    () => dedupeRows(jed.records.map((r) => normalizeJedRow(r, attributeRemitaRecord(r, nonJedCodes)))),
    [jed.records, nonJedCodes]
  );

  const jedRowsInScope = useMemo(
    () => (scopeInfo.remitaBucket === null
      ? jedRowsAll
      : jedRowsAll.filter((r) => r.bucket === scopeInfo.remitaBucket)),
    [jedRowsAll, scopeInfo.remitaBucket]
  );

  const scopeRows = useMemo(() => [...multiRows, ...jedRowsInScope], [multiRows, jedRowsInScope]);
  // A pasted account list narrows everything below it — tiles, list, options.
  const listRows = useMemo(
    () => (accountFilter ? scopeRows.filter((r) => accountFilter.has(r.key)) : scopeRows),
    [scopeRows, accountFilter]
  );

  // JED statuses are offered for "All", for JED itself, and for any disco
  // that actually has Remita requests attributed to it.
  const includeJed = scopeInfo.remitaBucket === null
    || scopeInfo.remitaBucket === JED_BUCKET
    || jedRowsInScope.length > 0;
  const statusOptions = useMemo(
    () => statusesForScope({ includeMulti, includeJed }),
    [includeMulti, includeJed]
  );

  // Import-date range applies before the status counts, so every tile, the
  // list, the totals and the exports all describe the same set of rows.
  const attrFiltered = useMemo(
    () => filterByImportDate(applyAttributeFilters(listRows, { attributes, search }), importedFrom, importedTo),
    [listRows, attributes, search, importedFrom, importedTo]
  );
  const statusCounts = useMemo(() => countByStatus(attrFiltered), [attrFiltered]);

  // "Pending installations" — the same population and rule as the Admin
  // Dashboard and Reports (utils/installationTotals.js). Unfiltered, at "All
  // discos", the tile shows the SERVER aggregate the Dashboard shows, so the
  // two are one number by construction. Once a disco, search, attribute, date
  // or pasted-account filter narrows the list, it is the same predicate
  // recounted over exactly the rows shown — and the "Pending installations"
  // status filter lists those very rows.
  const systemTotals = useInstallationTotals({ enabled: true });
  const pendingRowCount = useMemo(() => attrFiltered.filter(isPendingInstallationRow).length, [attrFiltered]);
  const visibleRows = useMemo(
    () => sortRows(filterByInstallationStatus(attrFiltered, status), sortKey, sortDir),
    [attrFiltered, status, sortKey, sortDir]
  );

  // Faceted options: each dropdown lists the values that exist given every
  // OTHER active filter, so Feeder → Transformer narrows naturally.
  const filterOptions = useMemo(() => {
    const out = {};
    ATTRIBUTE_FILTERS.forEach(({ field }) => {
      const others = { ...attributes, [field]: '' };
      const base = filterByImportDate(
        applyAttributeFilters(listRows, { attributes: others, search }), importedFrom, importedTo
      );
      const options = buildFilterOptions(base, field);
      const current = attributes[field];
      if (current && !options.some((o) => o.value === current)) {
        options.push({ value: current, label: current === NOT_RECORDED ? 'Not recorded' : current, count: 0 });
      }
      out[field] = options;
    });
    return out;
  }, [listRows, attributes, search, importedFrom, importedTo]);

  const shownFilters = ATTRIBUTE_FILTERS.filter(
    (f) => f.always || filterOptions[f.field].some((o) => o.value !== NOT_RECORDED)
  );
  const activeFilterCount = Object.values(attributes).filter(Boolean).length
    + (search.trim() ? 1 : 0)
    + (importedFrom || importedTo ? 1 : 0);

  const clearAllFilters = useCallback(() => {
    setAttributes(EMPTY_ATTRIBUTES);
    setSearchTerm('');
    setStatus('');
    setImportedFrom('');
    setImportedTo('');
  }, []);

  // Scope change: filters from another disco don't carry over.
  useEffect(() => {
    setAccountFilter(null);
    setAccountBatch(null);
    setAttributes(EMPTY_ATTRIBUTES);
    setStatus('');
    setImportedFrom('');
    setImportedTo('');
  }, [scope]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [scope, status, attributes, search, sortKey, sortDir, importedFrom, importedTo]);

  // Keep the selection to rows that are still visible and still assignable,
  // using their freshest copy — hidden or stale rows must never be dispatched.
  const visibleByKey = useMemo(() => new Map(visibleRows.map((r) => [r.key, r])), [visibleRows]);
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map();
      prev.forEach((_, key) => {
        const row = visibleByKey.get(key);
        if (row && getAvailableActions(row.status).assign) next.set(key, row);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [visibleByKey]);

  // Select a pasted batch once the narrowed list is on screen. Waits for the
  // deferred search to settle (clearing it is part of applying a batch), so a
  // row isn't dropped by the prune above for being hidden by a stale term.
  useEffect(() => {
    if (!pendingBatchSelect || search !== searchTerm) return;
    const next = new Map();
    pendingBatchSelect.forEach((key) => {
      const row = visibleByKey.get(key);
      if (row && getAvailableActions(row.status).assign) next.set(key, row);
    });
    setSelected(next);
    setPendingBatchSelect(null);
  }, [pendingBatchSelect, visibleByKey, search, searchTerm]);

  const selectedRows = useMemo(() => Array.from(selected.values()), [selected]);
  const assignableVisible = useMemo(
    () => visibleRows.filter((r) => r.source === ROW_SOURCE.MULTI && getAvailableActions(r.status).assign),
    [visibleRows]
  );
  const allAssignableSelected = assignableVisible.length > 0 && assignableVisible.every((r) => selected.has(r.key));

  // Assignment is per disco: a mixed-disco selection (e.g. a pasted account
  // list under "All discos") goes out as one bulk request per disco — see
  // handleAssign. Meter capacity is per disco too, so it is only shown for a
  // single-disco selection.
  const selectionDiscos = useMemo(
    () => Array.from(new Set(selectedRows.map((r) => r.discoCode).filter(Boolean))),
    [selectedRows]
  );
  const mixedDiscos = selectionDiscos.length > 1;
  const selectionDisco = selectionDiscos[0] || multiDiscoCode;

  const {
    capacity, loading: capacityLoading, error: capacityError, reload: reloadCapacity,
  } = useInstallerMeterCapacity({
    installerId: assignOpen && !assignResult && !mixedDiscos ? installerId : '',
    discoCode: selectionDisco,
  });

  const toggleRow = useCallback((row) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.key)) next.delete(row.key);
      else next.set(row.key, row);
      return next;
    });
  }, []);

  const toggleAllAssignable = () => {
    setSelected(allAssignableSelected ? new Map() : new Map(assignableVisible.map((r) => [r.key, r])));
  };

  // Money for this scope comes from the ONE revenue calculation the Dashboard
  // and Payments page use (recognised revenue, GET /finance/revenue/*), narrowed
  // to the scope with the same disco attribution as the rows below — so at
  // "All discos" these figures equal the Dashboard's exactly. It is financial
  // data: only a role with PAYMENTS.VIEW sees it or triggers the read (a
  // Supervisor reaches this page and gets neither — the endpoint is a 403 for
  // it anyway).
  const canViewMoney = permissions.canViewPayments;
  const revenueSelect = useMemo(
    () => revenueScopeFilter(scopeInfo, (code) => attributeRemitaRecord({ discoCode: code }, nonJedCodes)),
    [scopeInfo, nonJedCodes]
  );
  const paymentSummary = usePaymentRevenueSummary({
    enabled: canViewMoney === true, select: revenueSelect, totals: systemTotals.totals,
  });
  // Total collected payments for the rows this page is showing: the SAME
  // formula (totalCollectedPayment) and the same live prices as the shared
  // figure, applied to exactly the rows the "Pending installations" tile
  // counts — so under any disco, filter or pasted list the count and the
  // value describe the same records.
  const filteredValuation = useMemo(
    () => (paymentSummary.priceIndex ? totalCollectedPayment(attrFiltered, paymentSummary.priceIndex) : null),
    [attrFiltered, paymentSummary.priceIndex]
  );
  const scopeLabel = scopeOptions.find((o) => o.value === scope)?.label || 'All discos';

  const handleFindAccounts = () => {
    const result = classifyPastedAccounts(pasteText, scopeRows);
    setAccountBatch(result.accounts.length ? result : null);
  };

  // Show exactly the accounts the paste found and select the assignable ones.
  // Other filters are cleared first — a pasted list is its own filter, and a
  // leftover feeder or status filter would silently hide pasted rows.
  const applyAccountBatch = () => {
    if (!accountBatch) return;
    clearAllFilters();
    setAccountFilter(new Set(accountBatch.matchedKeys));
    setPendingBatchSelect(new Set(accountBatch.assignableRows.map((r) => r.key)));
    setPasteOpen(false);
  };

  const clearAccountBatch = () => {
    setAccountFilter(null);
    setAccountBatch(null);
    setPasteText('');
    setSelected(new Map());
  };

  const handleAssign = async () => {
    if (assigning) return;
    if (!installerId) { setAssignError('Select an installer.'); return; }
    if (selectedRows.length === 0) { setAssignError('No jobs selected.'); return; }

    setAssigning(true);
    setAssignError(null);
    setAssignResult(null);
    // POST /assignments/installations is scoped to one disco, so a selection
    // spanning discos is sent as one bulk request PER DISCO (never one per
    // job). Each is partial-success on the server; a disco whose request
    // fails outright is reported against its own rows while the others still
    // land — one bad group never undoes another.
    const groups = new Map();
    selectedRows.forEach((r) => {
      const code = r.discoCode || multiDiscoCode;
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push(r);
    });
    const results = [];
    let failures = 0;
    for (const [code, rows] of groups) {
      try {
        // `ids` and `accountNumbers` are mutually exclusive — ids are used
        // because they're unambiguous across discos.
        const payload = { discoCode: code, installerId, ids: rows.map((r) => r.id) };
        if (dispatchRef.trim()) payload.dispatchRef = dispatchRef.trim();
        const response = await jedApi.assignInstallations(payload);
        results.push(response?.data || response);
      } catch (err) {
        console.error(`[InstallationRequests] Assign failed for ${code}:`, err);
        failures += 1;
        const reason = getErrorMessage(err, 'Could not assign these jobs.');
        results.push({
          assignedCount: 0,
          rejectedCount: rows.length,
          rejected: rows.map((r) => ({ accountNumber: r.accountNumber, reason })),
        });
      }
    }
    const merged = mergeAssignmentResults(results);
    if (failures === groups.size) {
      setAssignError(merged.rejected[0]?.reason || 'Could not assign these jobs.');
    } else {
      setAssignResult(merged);
    }
    if (merged.assignedCount > 0) {
      notifyDataChanged();
      refreshAll();
    }
    setAssigning(false);
  };

  const handleUnassign = async (job) => {
    setActionBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await jedApi.unassignInstallations({ discoCode: job.discoCode, ids: [job.id] });
      setNotice(`Account ${job.accountNumber} returned to the pending pool.`);
      notifyDataChanged();
      refreshAll();
    } catch (err) {
      console.error('[InstallationRequests] Unassign failed:', err);
      setActionError(getErrorMessage(err, 'Could not unassign this job.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await jedApi.cancelInstallation(cancelTarget.id, 'Cancelled by administrator');
      setNotice(`Account ${cancelTarget.accountNumber} cancelled.`);
      setCancelTarget(null);
      notifyDataChanged();
      refreshAll();
    } catch (err) {
      console.error('[InstallationRequests] Cancel failed:', err);
      setActionError(getErrorMessage(err, 'Could not cancel this request.'));
      setCancelTarget(null);
    } finally {
      setActionBusy(false);
    }
  };

  // The response sheet is per registered disco — not available for "All"
  // or for JED's Remita requests.
  const exportDisco = includeMulti ? multiDiscoCode : '';
  const handleExport = async () => {
    if (!exportDisco || exporting) return;
    setExporting(true);
    setActionError(null);
    setNotice(null);
    try {
      const params = markExported ? { markExported: true } : {};
      const { blob, filename } = await jedApi.exportInstallations(exportDisco, params);
      await downloadServerXlsx(blob, filename || `${exportDisco}-installations.xlsx`);
      setNotice(
        markExported
          ? 'Response sheet downloaded. The included rows are now marked EXPORTED.'
          : 'Preview downloaded. Rows are unchanged — tick "Mark as sent" when you deliver the file.'
      );
      if (markExported) { notifyDataChanged(); refreshAll(); }
    } catch (err) {
      console.error('[InstallationRequests] Export failed:', err);
      setActionError(getErrorMessage(err, 'Could not export the response sheet.'));
    } finally {
      setExporting(false);
    }
  };

  // Completed installations in the current scope, honouring the upload-field
  // filters and search (attrFiltered), a completed status if one is selected,
  // and the report's own completion-date range.
  const completedCandidates = useMemo(() => {
    const byStatus = status && isCompletedRow({ source: statusOptions.find((s) => s.value === status)?.source, status })
      ? applyStatusFilter(attrFiltered, status)
      : attrFiltered;
    return filterByCompletionDate(byStatus.filter(isCompletedRow), completedFrom, completedTo);
  }, [attrFiltered, status, statusOptions, completedFrom, completedTo]);

  const handleExportCompleted = async () => {
    if (exportingCompleted || completedCandidates.length === 0) return;
    setExportingCompleted(true);
    setCompletedExportError(null);
    setNotice(null);
    try {
      // Meter/SIM details for the installed meters in the report, joined by
      // serial. Best effort: the report still downloads without them, and
      // its Summary sheet says whether they were matched.
      const serials = new Set(
        completedCandidates
          .map((r) => String((r.source === ROW_SOURCE.JED ? r.raw.meterNo : r.raw.meterNumber) ?? '').trim())
          .filter(Boolean)
      );
      let meterIndex = new Map();
      let meterDetails = '';
      if (serials.size > 0) {
        try {
          const list = await fetchAllPagesDetailed(
            (p) => jedApi.getMeters(p),
            { status: 'INSTALLED' },
            { maxPages: MAX_PAGES, inferNextFromFullPage: true }
          );
          meterIndex = buildMeterIndex(list.items.filter((m) => serials.has(String(m.meterNumber ?? '').trim())));
          if (list.truncated) meterDetails = 'meter list incomplete';
        } catch (err) {
          console.error('[InstallationRequests] Meter details unavailable for export:', err);
          meterDetails = 'meter list could not be loaded';
        }
      }

      const filterNotes = [];
      if (search.trim()) filterNotes.push(`Search "${search.trim()}"`);
      ATTRIBUTE_FILTERS.forEach(({ field, label }) => {
        const v = attributes[field];
        if (v) filterNotes.push(`${label}: ${filterOptions[field].find((o) => o.value === v)?.label || v}`);
      });
      if (status && completedCandidates.every((r) => r.status === status)) {
        filterNotes.push(`Status: ${statusOptions.find((s) => s.value === status)?.label || status}`);
      }
      if (importedFrom || importedTo) {
        filterNotes.push(`Imported ${importedFrom || '…'} to ${importedTo || '…'}`);
      }
      if (completedFrom || completedTo) {
        filterNotes.push(`Installed ${completedFrom || '…'} to ${completedTo || '…'}`);
      }

      const { sheets, count } = buildCompletedInstallationsReport({
        rows: completedCandidates,
        meterIndex,
        context: { scopeLabel, filters: filterNotes, generatedAt: new Date(), meterDetails },
      });
      const slug = (scope || 'all-discos').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'jed';
      await downloadXlsx(`completed-installations-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`, sheets);
      setNotice(`Exported ${count.toLocaleString()} completed installation${count === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error('[InstallationRequests] Completed export failed:', err);
      setCompletedExportError("Couldn't create the export. Please try again.");
    } finally {
      setExportingCompleted(false);
    }
  };

  if (!permissions.canViewInstallationRequests) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Access Denied</h2>
        <p className="text-gray-600 dark:text-gray-400">You don't have permission to view installation requests.</p>
      </div>
    );
  }

  const listLoading = (includeMulti && (multiLoading || !multiReady) && !multiError) || (jedLoading && !jedError);
  const multiStatuses = statusOptions.filter((s) => s.source === ROW_SOURCE.MULTI);
  const jedStatuses = statusOptions.filter((s) => s.source === ROW_SOURCE.JED);

  // Completeness: the page says so when it could not load every record,
  // instead of presenting a partial list (and partial counts) as the whole.
  const completenessWarnings = [];
  if (multiReady && multi.truncated) {
    completenessWarnings.push(`Only the first ${multi.rows.length.toLocaleString()} imported requests were loaded${multi.totalCount ? ` of ${multi.totalCount.toLocaleString()}` : ''}. Choose one disco to see the rest.`);
  } else if (multiReady && multi.stats && Number.isFinite(Number(multi.stats.total)) && Number(multi.stats.total) !== multi.rows.length) {
    completenessWarnings.push("Some requests didn't load. Refresh to try again.");
  }
  if (jed.loaded && jed.truncated) {
    completenessWarnings.push(`Only the first ${jed.records.length.toLocaleString()} JED requests were loaded${jed.totalCount ? ` of ${jed.totalCount.toLocaleString()}` : ''}. JED totals may be incomplete.`);
  }

  const assignJobCount = selectedRows.length;
  const pendingUnfiltered = !scope && activeFilterCount === 0 && !accountFilter;

  // The completed-installations export claims to cover the whole scope, so it
  // is only offered once every source in scope has loaded in full.
  const completedExportBlocked = listLoading
    ? 'Loading…'
    : (includeMulti && (multiError || (multiReady && multi.truncated))) || jedError || jed.truncated
      ? 'Not every record loaded, so the export is unavailable.'
      : null;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* The page title lives on InstallationsPage, which hosts this view —
          only the actions for this view belong here. */}
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={refreshAll} disabled={listLoading} aria-label="Refresh"
          className="p-2.5 sm:px-4 sm:py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 disabled:bg-brand-400 shrink-0 flex items-center gap-2">
          <RefreshCw className={`w-4 h-4 ${listLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline text-sm font-medium">Refresh</span>
        </button>
      </div>

      {[multiError && includeMulti && `Imported requests: ${multiError}`, jedError && `JED requests: ${jedError}`, actionError]
        .filter(Boolean)
        .map((msg) => (
          <div key={msg} role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-800 dark:text-red-300">{msg}</p>
          </div>
        ))}
      {completenessWarnings.map((msg) => (
        <div key={msg} role="status" className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300">{msg}</p>
        </div>
      ))}
      {notice && (
        <div role="status" className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
          <p className="text-sm text-green-800 dark:text-green-300">{notice}</p>
        </div>
      )}

      {/* Scope */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <label htmlFor="ir-scope" className="text-sm font-medium text-gray-700 dark:text-gray-300 shrink-0">Disco</label>
        <select
          id="ir-scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          disabled={discosLoading}
          className="form-input w-full sm:max-w-sm px-3 py-2 text-sm"
        >
          {scopeOptions.map((o) => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
        </select>
        {listLoading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
          </span>
        )}
      </div>

      {/* Payments — the shared revenue panel, scoped to this disco */}
      {canViewMoney && (
        <RevenueSummaryPanel
          id="ir-payments"
          title={`Payment & Revenue Summary · ${scopeLabel}`}
          collected={pendingUnfiltered
            // The overall scope: the shared figure, identical to the Dashboard's.
            ? paymentSummary.collected
            : {
              valuation: completenessWarnings.length ? null : filteredValuation,
              loading: paymentSummary.collected.loading || listLoading,
              error: paymentSummary.collected.error,
              incomplete: completenessWarnings.length > 0,
            }}
          revenue={paymentSummary.revenue}
          onRetry={paymentSummary.reload}
        />
      )}

      {/* Status counts — for exactly the rows the filters below produce */}
      {scopeRows.length > 0 && (
        <section aria-label="Status counts" className="space-y-2">
          {pendingUnfiltered && systemTotals.error && (
            <p role="alert" className="text-xs text-red-700 dark:text-red-300">Unable to load the pending installation total. {systemTotals.error}</p>
          )}
          {pendingUnfiltered && !listLoading && systemTotals.totals && systemTotals.totals.pending !== pendingRowCount && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {systemTotals.totals.pending.toLocaleString()} installations are pending, but {pendingRowCount.toLocaleString()} of them are in
              the list loaded here{completenessWarnings.length ? ' (not every record loaded)' : ' — refresh to reconcile'}.
            </p>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <StatTile
              label="Pending installations"
              value={pendingUnfiltered
                ? (systemTotals.loading ? '…' : systemTotals.error || !systemTotals.totals ? '—' : systemTotals.totals.pending.toLocaleString())
                : pendingRowCount}
              active={status === PENDING_INSTALLATION_FILTER}
              onClick={() => setStatus(status === PENDING_INSTALLATION_FILTER ? '' : PENDING_INSTALLATION_FILTER)}
            />
            <StatTile label="All" value={attrFiltered.length} active={status === ''} onClick={() => setStatus('')} />
            {multiStatuses.map((s) => (
              <StatTile key={s.value} label={s.label} value={statusCounts[s.value] || 0}
                active={status === s.value} onClick={() => setStatus(status === s.value ? '' : s.value)} />
            ))}
          </div>
          {jedStatuses.length > 0 && (
            <div>
              {multiStatuses.length > 0 && <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">JED (Remita)</p>}
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {jedStatuses.map((s) => (
                  <StatTile key={s.value} label={s.label} value={statusCounts[s.value] || 0}
                    active={status === s.value} onClick={() => setStatus(status === s.value ? '' : s.value)} />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="card overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
          {/* Paste many account numbers — only for a role that can dispatch. */}
          {canAssign && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPasteOpen((v) => !v)}
                  aria-expanded={pasteOpen}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" /> Paste account numbers
                </button>
                {accountFilter && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-brand-100 dark:bg-brand-900/30 text-brand-800 dark:text-brand-300">
                    Showing {accountFilter.size.toLocaleString()} pasted account{accountFilter.size === 1 ? '' : 's'}
                    <button type="button" onClick={clearAccountBatch} aria-label="Clear pasted account list"
                      className="p-0.5 rounded-full hover:bg-brand-200 dark:hover:bg-brand-800">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>

              {pasteOpen && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                  <label htmlFor="ir-paste-accounts" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Account numbers — one per line, or separated by commas, spaces or tabs
                  </label>
                  <textarea
                    id="ir-paste-accounts"
                    rows={4}
                    value={pasteText}
                    onChange={(e) => { setPasteText(e.target.value); setAccountBatch(null); }}
                    placeholder={'1234567890\n1234567891'}
                    className="form-input w-full px-3 py-2 text-sm font-mono"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleFindAccounts}
                      disabled={!pasteText.trim() || listLoading}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                    >
                      {listLoading ? 'Loading requests…' : 'Find accounts'}
                    </button>
                    {accountBatch && accountBatch.assignableRows.length > 0 && (
                      <button
                        type="button"
                        onClick={applyAccountBatch}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-gray-900 rounded-lg text-xs font-medium hover:bg-brand-600"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        Select {accountBatch.assignableRows.length.toLocaleString()} assignable
                      </button>
                    )}
                  </div>

                  {accountBatch && (
                    <div role="status" className="text-xs space-y-1 text-gray-700 dark:text-gray-300">
                      <p>
                        {accountBatch.accounts.length.toLocaleString()} account number{accountBatch.accounts.length === 1 ? '' : 's'} checked
                        {accountBatch.duplicates.length > 0 && ` (${accountBatch.duplicates.length} duplicate${accountBatch.duplicates.length === 1 ? '' : 's'} removed)`}
                        {' '}in {scopeLabel}.
                      </p>
                      <ul className="space-y-0.5">
                        <li><span className="font-semibold text-green-700 dark:text-green-400">{accountBatch.assignable.length}</span> found and ready to assign</li>
                        {accountBatch.alreadyAssigned.length > 0 && (
                          <li>
                            <span className="font-semibold">{accountBatch.alreadyAssigned.length}</span> already assigned:{' '}
                            <span className="font-mono break-all">{accountBatch.alreadyAssigned.map((a) => (a.installer ? `${a.account} (${a.installer})` : a.account)).join(', ')}</span>
                          </li>
                        )}
                        {accountBatch.cannotAssign.length > 0 && (
                          <li>
                            <span className="font-semibold text-amber-700 dark:text-amber-400">{accountBatch.cannotAssign.length}</span> can&apos;t be assigned now:{' '}
                            <span className="break-all">{accountBatch.cannotAssign.map((a) => `${a.account} (${a.reason})`).join(', ')}</span>
                          </li>
                        )}
                        {accountBatch.notFound.length > 0 && (
                          <li>
                            <span className="font-semibold text-red-700 dark:text-red-400">{accountBatch.notFound.length}</span> not found:{' '}
                            <span className="font-mono break-all">{accountBatch.notFound.join(', ')}</span>
                          </li>
                        )}
                      </ul>
                      {completenessWarnings.length > 0 && accountBatch.notFound.length > 0 && (
                        <p className="text-amber-700 dark:text-amber-400">Not every request loaded, so &ldquo;not found&rdquo; may be incomplete.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search account, customer, meter, feeder…"
                aria-label="Search installation requests"
                className="form-input w-full pl-9 pr-3 py-2 text-sm"
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
              className="form-input w-full px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              <option value={PENDING_INSTALLATION_FILTER}>Pending installations (every not-yet-installed request)</option>
              {multiStatuses.length > 0 && (
                <optgroup label="Imported jobs">
                  {multiStatuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </optgroup>
              )}
              {jedStatuses.length > 0 && (
                <optgroup label="JED (Remita)">
                  {jedStatuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </optgroup>
              )}
            </select>
          </div>

          {/* Upload-field filters */}
          <fieldset>
            <legend className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
              <Filter className="w-3.5 h-3.5" /> Filter by uploaded fields
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {shownFilters.map(({ field, label }) => {
                const options = filterOptions[field];
                const id = `ir-filter-${field}`;
                return (
                  <div key={field}>
                    <label htmlFor={id} className="block text-xs text-gray-600 dark:text-gray-400 mb-1">{label}</label>
                    <select
                      id={id}
                      value={attributes[field]}
                      onChange={(e) => setAttributes((prev) => ({ ...prev, [field]: e.target.value }))}
                      disabled={options.length === 0}
                      className="form-input w-full px-3 py-2 text-sm"
                    >
                      <option value="">{options.length === 0 ? 'No data recorded' : `Any ${label.toLowerCase()}`}</option>
                      {options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label} ({o.count})</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </fieldset>

          {/* Import date — when the record was imported into ME Metering.
              Deliberately separate from the installation-date range further
              down, and from assignment/payment dates, which it never uses. */}
          <fieldset>
            <legend className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
              <CalendarClock className="w-3.5 h-3.5" /> Filter by import date
            </legend>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-3">
              <div className="min-w-0">
                <label htmlFor="ir-imported-from" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Imported from</label>
                <input
                  id="ir-imported-from"
                  type="date"
                  value={importedFrom}
                  max={importedTo || undefined}
                  onChange={(e) => setImportedFrom(e.target.value)}
                  className="form-input w-full sm:w-auto px-3 py-2 text-sm"
                />
              </div>
              <div className="min-w-0">
                <label htmlFor="ir-imported-to" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Imported to</label>
                <input
                  id="ir-imported-to"
                  type="date"
                  value={importedTo}
                  min={importedFrom || undefined}
                  onChange={(e) => setImportedTo(e.target.value)}
                  className="form-input w-full sm:w-auto px-3 py-2 text-sm"
                />
              </div>
              {(importedFrom || importedTo) && (
                <div className="col-span-2 sm:col-auto flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { setImportedFrom(''); setImportedTo(''); }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    <X className="w-3.5 h-3.5" /> Clear dates
                  </button>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    JED&apos;s Remita requests aren&apos;t imported, so they are excluded while this is set.
                  </p>
                </div>
              )}
            </div>
          </fieldset>

          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex items-end gap-2">
              <div>
                <label htmlFor="ir-sort" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Sort by</label>
                <select id="ir-sort" value={sortKey} onChange={(e) => setSortKey(e.target.value)}
                  className="form-input px-3 py-2 text-sm">
                  {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}. Click to reverse.`}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                <ArrowDownUp className="w-4 h-4" />
                {sortDir === 'asc' ? 'Asc' : 'Desc'}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 sm:ml-auto" aria-live="polite">
              {visibleRows.length.toLocaleString()} of {scopeRows.length.toLocaleString()} shown
            </p>
            {activeFilterCount > 0 && (
              <button type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
                <X className="w-4 h-4" /> Clear filters
              </button>
            )}
          </div>
          {/* Export — only meaningful for a single registered disco. Hidden
              from read-only roles because "Export & mark sent" moves rows to
              EXPORTED: this panel is a handoff to the disco, not a report. */}
          {canManageJobs && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={markExported}
                onChange={(e) => setMarkExported(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
              />
              Mark rows as sent (moves them to Exported)
            </label>
            <button
              type="button"
              onClick={handleExport}
              disabled={!exportDisco || exporting}
              title={!exportDisco ? 'Choose a registered disco to export its response sheet' : undefined}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 sm:ml-auto"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {markExported ? 'Export & mark sent' : 'Export preview'}
            </button>
          </div>
          )}

          {/* Completed installations workbook — current disco scope, filters and search */}
          <fieldset className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <legend className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Completed installations report</legend>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-3">
                <div>
                  <label htmlFor="ir-completed-from" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Installed from</label>
                  <input id="ir-completed-from" type="date" value={completedFrom} max={completedTo || undefined}
                    onChange={(e) => setCompletedFrom(e.target.value)} className="form-input w-full px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="ir-completed-to" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Installed to</label>
                  <input id="ir-completed-to" type="date" value={completedTo} min={completedFrom || undefined}
                    onChange={(e) => setCompletedTo(e.target.value)} className="form-input w-full px-3 py-2 text-sm" />
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 sm:ml-auto" aria-live="polite">
                {completedExportBlocked || `${completedCandidates.length.toLocaleString()} completed installation${completedCandidates.length === 1 ? '' : 's'} in scope`}
              </p>
              <button
                type="button"
                onClick={handleExportCompleted}
                disabled={!!completedExportBlocked || exportingCompleted || completedCandidates.length === 0}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-brand-500 text-gray-900 hover:bg-brand-600 disabled:opacity-50"
              >
                {exportingCompleted ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                {exportingCompleted ? 'Preparing…' : 'Export Completed Installations'}
              </button>
            </div>
            {completedExportError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-2">{completedExportError}</p>
            )}
          </fieldset>
        </div>

        {canAssign && assignableVisible.length > 0 && (
          <div className="px-3 sm:px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={allAssignableSelected}
                onChange={toggleAllAssignable}
                className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
              />
              Select all {assignableVisible.length.toLocaleString()} assignable request{assignableVisible.length === 1 ? '' : 's'} matching these filters
            </label>
          </div>
        )}

        {canAssign && selectedRows.length > 0 && (
          <div className="px-3 sm:px-4 py-2.5 bg-brand-50 dark:bg-brand-900/20 border-b border-brand-200 dark:border-brand-800 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-brand-800 dark:text-brand-300">
              {selectedRows.length} selected
              {mixedDiscos && (
                <span className="block text-xs font-normal">
                  Across {selectionDiscos.length} discos — sent as one request per disco
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setAssignError(null); setAssignResult(null); setAssignOpen(true); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-gray-900 rounded-lg text-xs font-medium hover:bg-brand-600 disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Assign to installer
              </button>
              <button type="button" onClick={() => setSelected(new Map())} aria-label="Clear selection"
                className="p-1.5 text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-900/40 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {listLoading && visibleRows.length === 0 ? (
          <div className="py-16 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>
        ) : visibleRows.length === 0 ? (
          <div className="py-16 text-center px-4">
            <Inbox className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-400 font-medium">
              {scopeRows.length === 0 ? 'No installation requests for this disco yet' : 'No installation requests match these filters'}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {scopeRows.length === 0
                ? "Import a disco's customer sheet to create them."
                : 'Clear or change a filter to see more.'}
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {visibleRows.slice(0, visibleCount).map((row) => (
                row.source === ROW_SOURCE.JED ? (
                  <JedRequestRow key={row.key} row={row} onAssign={setJedAssignTarget} canAssign={canAssign} showAmount={canViewMoney} />
                ) : (
                  <RequestRow
                    key={row.key}
                    row={row}
                    selectable={canAssign && getAvailableActions(row.status).assign}
                    selected={selected.has(row.key)}
                    onToggle={toggleRow}
                    onCancel={setCancelTarget}
                    onUnassign={handleUnassign}
                    busy={actionBusy}
                    canCancel={canManageJobs}
                    canUnassign={canAssign}
                  />
                )
              ))}
            </div>
            {visibleRows.length > visibleCount && (
              <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-center gap-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {visibleCount.toLocaleString()} of {visibleRows.length.toLocaleString()}
                </p>
                <button type="button" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
                  Show {Math.min(PAGE_SIZE, visibleRows.length - visibleCount)} more
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Assign modal */}
      {canAssign && assignOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="assign-title"
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col">
            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="assign-title" className="text-lg font-semibold text-gray-900 dark:text-white">Assign to installer</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {assignJobCount} job{assignJobCount === 1 ? '' : 's'} &middot; {mixedDiscos ? `${selectionDiscos.length} discos` : selectionDisco}
                </p>
              </div>
              <button type="button" onClick={() => setAssignOpen(false)} aria-label="Close"
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {assignResult ? (
                <>
                  {accountFilter && accountBatch && (
                    <p role="status" className="text-sm text-gray-800 dark:text-gray-200">
                      {accountBatchMessage({
                        assigned: assignResult.assignedCount,
                        rejected: assignResult.rejectedCount,
                        alreadyAssigned: accountBatch.alreadyAssigned.length,
                        cannotAssign: accountBatch.cannotAssign.length,
                        notFound: accountBatch.notFound.length,
                      })}
                    </p>
                  )}
                  <BatchResultSummary data={assignResult} acceptedLabel="Jobs assigned" />
                </>
              ) : (
                <>
                  <div>
                    <label htmlFor="assign-job-installer" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Installer<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
                    </label>
                    <InstallerSelect
                      id="assign-job-installer"
                      value={installerId}
                      onChange={setInstallerId}
                      disabled={assigning}
                      required
                    />
                  </div>
                  {installerId && mixedDiscos && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Meter capacity is worked out per disco, so it isn&apos;t shown for a selection across discos.
                    </p>
                  )}
                  {installerId && !mixedDiscos && (
                    <MeterCapacitySummary
                      capacity={capacity}
                      loading={capacityLoading}
                      error={capacityError}
                      onRetry={reloadCapacity}
                      addJobs={assignJobCount}
                    />
                  )}
                  <div>
                    <label htmlFor="assign-job-ref" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Dispatch reference
                    </label>
                    <input
                      id="assign-job-ref"
                      type="text"
                      value={dispatchRef}
                      onChange={(e) => setDispatchRef(e.target.value)}
                      disabled={assigning}
                      placeholder="Use the same reference as the meter dispatch"
                      className="form-input w-full px-3 py-2.5 text-sm"
                    />
                  </div>
                  {assignError && (
                    <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                      <p className="text-sm text-red-800 dark:text-red-300">{assignError}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 sm:px-6 border-t border-gray-200 dark:border-gray-700 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
              <button type="button" onClick={() => setAssignOpen(false)} disabled={assigning}
                className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
                {assignResult ? 'Close' : 'Cancel'}
              </button>
              {!assignResult && (
                <button type="button" onClick={handleAssign} disabled={assigning}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-brand-500 text-gray-900 hover:bg-brand-600 disabled:opacity-60">
                  {assigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  {assigning ? 'Assigning…' : 'Assign'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <JedAssignmentNotice isOpen={!!jedAssignTarget} onClose={() => setJedAssignTarget(null)} />

      <ConfirmationModal
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancel}
        loading={actionBusy}
        title="Cancel this installation?"
        message={
          cancelTarget
            ? `Account ${cancelTarget.accountNumber} (${cancelTarget.customerName || 'customer'}) will be cancelled and cannot be dispatched.`
            : ''
        }
        confirmText="Cancel request"
      />
    </div>
  );
}

export default InstallationRequests;
