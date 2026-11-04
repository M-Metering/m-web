// src/components/admin/AssignedMetersPanel.jsx
// The Assignments page's "Assigned meters" tab (2026-11-04): who has which
// meter, filtered and paged by the server, exportable as it stands; and bulk
// search, where a pasted or uploaded list of meter numbers comes back with one
// result per number, exportable too.
import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Search, Upload } from 'lucide-react';
import jedApi from '../services/api';
import InstallerSelect from '../installations/InstallerSelect';
import StatusBadge from '../common/StatusBadge';
import { useDiscoOptions } from '../../hooks/useDiscoOptions';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { getErrorMessage } from '../../utils/errorMessage';
import { formatDateTime } from '../../utils/date';
import { downloadServerFile } from '../../utils/xlsx';
import { METER_PHASE_TYPES } from '../../utils/installationStatus';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;
const MAX_NUMBERS = 5000;

const STATUS_OPTIONS = [
  { value: 'ASSIGNED', label: 'Currently held' },
  { value: 'USED', label: 'Used on a job' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'LOST', label: 'Lost' },
  { value: 'ASSIGNED,USED,RETURNED,LOST', label: 'All dispatches' },
];

const RESULT_LABELS = { ASSIGNED: 'Assigned', NOT_ASSIGNED: 'Not assigned', NOT_FOUND: 'Not found' };
const RESULT_STYLES = {
  ASSIGNED: 'text-green-700 dark:text-green-400',
  NOT_ASSIGNED: 'text-amber-700 dark:text-amber-400',
  NOT_FOUND: 'text-red-700 dark:text-red-400',
};

const selectClass = 'form-input w-full px-3 py-2 text-sm';
const secondaryButton = 'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';
const dash = (value) => value || '—';

/** One meter number per line, or separated by commas or spaces. */
export const parsePastedNumbers = (text = '') => text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

function ExportButtons({ onExport, busy, disabled }) {
  return (
    <div className="flex gap-2">
      {[['xlsx', 'Export Excel'], ['csv', 'Export CSV']].map(([format, label]) => (
        <button key={format} type="button" className={secondaryButton} disabled={disabled || !!busy} onClick={() => onExport(format)}>
          {busy === format ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {label}
        </button>
      ))}
    </div>
  );
}

function AssignedList() {
  const { discos } = useDiscoOptions();
  const { refreshSignal } = useDataRefresh();
  const [filters, setFilters] = useState({ status: 'ASSIGNED', discoCode: '', installerId: '', phaseType: '', from: '', to: '' });
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [exportError, setExportError] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => { setQ(term.trim()); setPage(1); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const setFilter = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const params = { ...filters, q };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await jedApi.getAssignedMeters({ ...params, page, limit: PAGE_SIZE });
        if (cancelled) return;
        setRows(response?.data || []);
        setPagination(response?.pagination || null);
      } catch (err) {
        console.error('[AssignedMeters] Failed to load:', err);
        if (!cancelled) setError(getErrorMessage(err, "Couldn't load assigned meters."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, q, page, refreshSignal]);

  const handleExport = async (format) => {
    setExporting(format);
    setExportError(null);
    try {
      const { blob, filename } = await jedApi.exportAssignedMeters({ ...params, format });
      await downloadServerFile(blob, filename || `assigned-meters.${format}`);
    } catch (err) {
      console.error('[AssignedMeters] Export failed:', err);
      setExportError(getErrorMessage(err, "Couldn't export assigned meters."));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Status
          <select className={`${selectClass} mt-1`} value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Disco
          <select className={`${selectClass} mt-1`} value={filters.discoCode} onChange={(e) => setFilter('discoCode', e.target.value)}>
            <option value="">All discos</option>
            {discos.map((d) => <option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}
          </select>
        </label>
        <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
          <span className="block mb-1">Installer</span>
          <div className="flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              <InstallerSelect id="assigned-installer" value={filters.installerId} onChange={(v) => setFilter('installerId', v)} discoCode={filters.discoCode || null} />
            </div>
            {filters.installerId && (
              <button type="button" className={secondaryButton} onClick={() => setFilter('installerId', '')}>Clear</button>
            )}
          </div>
        </div>
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Meter type
          <select className={`${selectClass} mt-1`} value={filters.phaseType} onChange={(e) => setFilter('phaseType', e.target.value)}>
            <option value="">All types</option>
            {METER_PHASE_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Assigned from
          <input type="date" className={`${selectClass} mt-1`} value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
        </label>
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Assigned to
          <input type="date" className={`${selectClass} mt-1`} value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search meter or SIM number"
            placeholder="Meter or SIM number…"
            className={`${selectClass} pl-9`}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <ExportButtons onExport={handleExport} busy={exporting} disabled={loading || !pagination?.totalCount} />
      </div>

      {exportError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{exportError}</p>}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}

      <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs text-gray-600 dark:text-gray-300">
            <tr>
              {['Meter', 'Type', 'Installer', 'Disco', 'Batch', 'Status', 'Assigned', 'Account'].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-gray-800 dark:text-gray-200">
            {rows.map((r) => (
              <tr key={`${r.batchId}-${r.meterNumber}`}>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.meterNumber}</td>
                <td className="px-3 py-2 whitespace-nowrap">{dash(r.phaseType)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{dash(r.installerName)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{dash(r.discoCode)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">{dash(r.batchRef)}</td>
                <td className="px-3 py-2"><StatusBadge status={r.assignmentStatus} /></td>
                <td className="px-3 py-2 whitespace-nowrap">{r.assignedAt ? formatDateTime(r.assignedAt) : '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">{dash(r.accountNumber)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500 dark:text-gray-400">No meters match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
        <span role="status">
          {loading ? 'Loading…' : `${(pagination?.totalCount ?? 0).toLocaleString()} meter record${pagination?.totalCount === 1 ? '' : 's'}`}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" className={secondaryButton} disabled={loading || !pagination?.hasPrev} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {pagination?.currentPage ?? page} of {Math.max(pagination?.totalPages ?? 1, 1)}</span>
          <button type="button" className={secondaryButton} disabled={loading || !pagination?.hasNext} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}

function BulkSearch() {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState(null);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(null);
  const fileInput = useRef(null);
  // What the results came from, so the export is of exactly those results.
  const [source, setSource] = useState(null);

  const pasted = parsePastedNumbers(text);
  const tooMany = !file && pasted.length > MAX_NUMBERS;

  const handleSearch = async () => {
    const input = file ? { file } : { meterNumbers: pasted };
    setSearching(true);
    setError(null);
    setFound(null);
    try {
      const response = await jedApi.searchAssignedMeters(input);
      setFound({ results: response?.data || [], summary: response?.summary || null });
      setSource(input);
    } catch (err) {
      console.error('[AssignedMeters] Bulk search failed:', err);
      setError(getErrorMessage(err, "Couldn't search these meters."));
    } finally {
      setSearching(false);
    }
  };

  const handleExport = async (format) => {
    setExporting(format);
    setError(null);
    try {
      const { blob, filename } = await jedApi.exportAssignedMeterSearch({ ...source, format });
      await downloadServerFile(blob, filename || `assigned-meters-search.${format}`);
    } catch (err) {
      console.error('[AssignedMeters] Search export failed:', err);
      setError(getErrorMessage(err, "Couldn't export these results."));
    } finally {
      setExporting(null);
    }
  };

  const summary = found?.summary;

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Meter numbers, one per line or separated by commas (up to {MAX_NUMBERS.toLocaleString()})
        <textarea
          rows={4}
          className="form-input w-full mt-1 px-3 py-2 text-sm font-mono"
          value={text}
          disabled={!!file}
          onChange={(e) => setText(e.target.value)}
          placeholder={'0239110211103\n0239110211111'}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xls,.csv"
          aria-label="Upload a file of meter numbers"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <button type="button" className={secondaryButton} onClick={() => fileInput.current?.click()}>
          <Upload className="w-4 h-4" /> Upload Excel or CSV
        </button>
        {file && (
          <span className="text-xs text-gray-600 dark:text-gray-300">
            {file.name}{' '}
            <button
              type="button"
              className="underline"
              onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}
            >
              Remove
            </button>
          </span>
        )}
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching || tooMany || (!file && pasted.length === 0)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-brand-500 text-gray-900 hover:bg-brand-600 disabled:opacity-60"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {tooMany && <p role="alert" className="text-sm text-red-700 dark:text-red-400">That&apos;s {pasted.length.toLocaleString()} numbers; search at most {MAX_NUMBERS.toLocaleString()} at a time.</p>}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}

      {found && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {summary && (
              <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
                {summary.requested.toLocaleString()} searched: {summary.assigned.toLocaleString()} assigned, {summary.notAssigned.toLocaleString()} not assigned, {summary.notFound.toLocaleString()} not found
                {summary.duplicatesRemoved > 0 ? ` (${summary.duplicatesRemoved.toLocaleString()} duplicate${summary.duplicatesRemoved === 1 ? '' : 's'} removed)` : ''}.
              </p>
            )}
            <ExportButtons onExport={handleExport} busy={exporting} disabled={found.results.length === 0} />
          </div>
          <div className="overflow-x-auto max-h-[28rem] border border-gray-200 dark:border-gray-700 rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-left text-xs text-gray-600 dark:text-gray-300">
                <tr>
                  {['Meter', 'Result', 'Type', 'Installer', 'Disco', 'Batch', 'Dispatch status', 'Assigned'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-gray-800 dark:text-gray-200">
                {found.results.map((r) => (
                  <tr key={r.meterNumber}>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.meterNumber}</td>
                    <td className={`px-3 py-2 whitespace-nowrap font-medium ${RESULT_STYLES[r.result] || ''}`}>{RESULT_LABELS[r.result] || r.result}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dash(r.phaseType)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dash(r.installerName)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dash(r.discoCode)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{dash(r.batchRef)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dash(r.assignmentStatus)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.assignedAt ? formatDateTime(r.assignedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function AssignedMetersPanel() {
  return (
    <div className="p-4 sm:p-6 space-y-8">
      <section aria-labelledby="assigned-list-heading" className="space-y-3">
        <h2 id="assigned-list-heading" className="text-sm font-semibold text-gray-900 dark:text-white">Assigned meters</h2>
        <AssignedList />
      </section>
      <section aria-labelledby="bulk-search-heading" className="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-6">
        <h2 id="bulk-search-heading" className="text-sm font-semibold text-gray-900 dark:text-white">Bulk search</h2>
        <BulkSearch />
      </section>
    </div>
  );
}

export default AssignedMetersPanel;
