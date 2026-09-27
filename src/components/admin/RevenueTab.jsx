// src/components/admin/RevenueTab.jsx
// Recognised revenue across both discos — GET /finance/revenue/summary and
// /finance/revenue/transactions (added 2026-09-24). SUPERADMIN/ADMIN only;
// SUPERVISOR and INSTALLER get a 403, which is why this lives inside the
// Payments page rather than anywhere a Supervisor can reach.
//
// TWO THINGS THIS SCREEN MUST NOT DO:
//
//  1. Present the total as exact. Some rows are valued at today's price rather
//     than the price in force when the work completed, and some completed work
//     has no price recorded at all (it comes through as amount 0, so it drags
//     the total DOWN silently). Both counts are in the response and both are
//     shown beside the figure — see utils/financeSummary.js.
//  2. Re-derive recognition timing. JED recognises revenue when Remita
//     confirms payment, Aba Power when the installation is completed. That is
//     fixed server-side and arrives as `recognition` on each disco row; it is
//     displayed, never computed.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertCircle, Loader2, RefreshCw, Info, Search } from 'lucide-react';
import jedApi from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { formatCurrencyNGN } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  summarizeRevenue,
  normalizeRevenueTransaction,
  transactionAmountLabel,
} from '../../utils/financeSummary';
import { useDiscoOptions } from '../../hooks/useDiscoOptions';
import { METER_PHASE_TYPES, installationStatusLabel } from '../../utils/installationStatus';
import { jedStatusLabel } from '../../utils/statusBadge';
import { formatPhaseLabel } from '../../utils/installationScope';

// Exactly the documented rangePreset values — no invented ranges — plus
// "All time" (no range sent) and "Custom" (the documented from/to).
const RANGE_PRESETS = [
  { id: 'all', label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: 'thisWeek', label: 'This week' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'last30days', label: 'Last 30 days' },
  { id: 'thisYear', label: 'This year' },
  { id: 'custom', label: 'Custom' },
];

// `to` is EXCLUSIVE on the finance endpoints; the picker's "to" is the last
// day wanted, so the request asks for the day after it.
const dayAfter = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
};

// The record's own status, in each domain's vocabulary.
const sourceStatusLabel = (row) => (row.source === 'jed_customer_request'
  ? jedStatusLabel(row.sourceStatus)
  : installationStatusLabel(row.sourceStatus));

// Which event dated the record (the API's `dateBasis` column name).
const DATE_BASIS_LABELS = {
  date_paid: 'Paid', date_completed: 'Completed', date_requested: 'Requested', reported_at: 'Installed',
};

const PAGE_LIMIT = 20;

function Figure({ label, value, muted = false }) {
  return (
    <div className="min-w-0">
      <p className={`text-xl sm:text-2xl font-bold leading-tight ${muted ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>
        {value}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight mt-0.5">{label}</p>
    </div>
  );
}

/**
 * @param {{ defaultRange?: string }} [props] - initial range preset ('thisMonth'
 *   on the Payments page; Reports opens on 'all').
 */
function RevenueTab({ defaultRange = 'thisMonth' } = {}) {
  const { refreshSignal } = useDataRefresh();
  const { discos } = useDiscoOptions();
  const [rangePreset, setRangePreset] = useState(defaultRange);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [meterType, setMeterType] = useState('');
  const [discoCode, setDiscoCode] = useState('');
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(null);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState(null);

  // Every filter here is a documented server-side parameter of both
  // /finance/revenue/summary and /transactions, so the totals above the table
  // and the rows in it always describe the same filtered set — nothing is
  // filtered in the browser.
  const filters = useMemo(() => {
    const f = {};
    if (rangePreset === 'custom') {
      if (customFrom) f.from = customFrom;
      if (customTo) f.to = dayAfter(customTo);
    } else if (rangePreset !== 'all') {
      f.rangePreset = rangePreset;
    }
    if (meterType) f.meterType = meterType;
    if (discoCode) f.discoCode = discoCode;
    return f;
  }, [rangePreset, customFrom, customTo, meterType, discoCode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const response = await jedApi.getRevenueSummary(filters);
        if (!cancelled) setSummary(summarizeRevenue(response));
      } catch (err) {
        console.error('[Revenue] Summary failed:', err);
        if (!cancelled) setSummaryError(getErrorMessage(err, "Couldn't load revenue for this range."));
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filters, refreshKey, refreshSignal]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRowsLoading(true);
      setRowsError(null);
      try {
        const params = { ...filters, page, limit: PAGE_LIMIT };
        if (searchTerm) params.search = searchTerm;
        const response = await jedApi.getRevenueTransactions(params);
        if (cancelled) return;
        const list = Array.isArray(response?.data) ? response.data : [];
        setRows(list.map(normalizeRevenueTransaction));
        setMeta(response?.meta || null);
        setPagination(response?.pagination || null);
      } catch (err) {
        console.error('[Revenue] Transactions failed:', err);
        if (!cancelled) setRowsError(getErrorMessage(err, "Couldn't load the revenue records."));
      } finally {
        if (!cancelled) setRowsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filters, page, searchTerm, refreshKey, refreshSignal]);

  const applySearch = useCallback(() => {
    setPage(1);
    setSearchTerm(search.trim());
  }, [search]);

  const changeRange = (id) => { setRangePreset(id); setPage(1); };

  // meta.totals covers the WHOLE filtered set, not just this page — so the
  // count under the table is the real one without a second request.
  const totalCount = pagination?.totalCount ?? meta?.totals?.count ?? rows.length;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => changeRange(preset.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                rangePreset === preset.id
                  ? 'bg-brand-500 text-gray-900'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={summaryLoading || rowsLoading}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${summaryLoading || rowsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {rangePreset === 'custom' && (
          <>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              From <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1); }}
                aria-label="Revenue from date" className="form-input px-2 py-1.5 text-sm flex-1" />
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              To <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(1); }}
                aria-label="Revenue to date" className="form-input px-2 py-1.5 text-sm flex-1" />
            </label>
          </>
        )}
        <select value={meterType} onChange={(e) => { setMeterType(e.target.value); setPage(1); }}
          aria-label="Filter revenue by meter type" className="form-input px-3 py-2 text-sm">
          <option value="">All meter types</option>
          {METER_PHASE_TYPES.map((t) => <option key={t} value={t}>{formatPhaseLabel(t)}</option>)}
        </select>
        <select value={discoCode} onChange={(e) => { setDiscoCode(e.target.value); setPage(1); }}
          aria-label="Filter revenue by disco" className="form-input px-3 py-2 text-sm">
          <option value="">All discos</option>
          {discos.map((d) => <option key={d.code} value={d.code}>{d.name ? `${d.name} (${d.code})` : d.code}</option>)}
        </select>
      </div>

      {/* Summary */}
      {summaryLoading ? (
        <div className="card p-6 flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400" role="status">
          <Loader2 className="w-4 h-4 animate-spin text-brand-600" /> Loading revenue…
        </div>
      ) : summaryError ? (
        <div role="alert" className="card p-4 flex items-start gap-2 border-red-200 dark:border-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-300">{summaryError}</p>
        </div>
      ) : summary && (
        <div className="card p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Figure label="Recognised revenue" value={formatCurrencyNGN(summary.amount)} />
            <Figure label="Records counted" value={summary.count.toLocaleString()} />
          </div>

          {/* Never a bare currency figure — the caveat rides with it. */}
          {summary.note && (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              {summary.note}
            </p>
          )}

          {summary.byDisco.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
              {summary.byDisco.map((disco) => (
                <div key={disco.discoCode} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{disco.discoCode}</p>
                    {disco.recognitionText && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">{disco.recognitionText}</p>
                    )}
                    {disco.note && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">{disco.note}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrencyNGN(disco.amount)}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{disco.count.toLocaleString()} record{disco.count === 1 ? '' : 's'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transactions */}
      <div className="card overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
              placeholder="Search by account number or customer name"
              aria-label="Search revenue records"
              className="form-input w-full pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={applySearch}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Search
          </button>
        </div>

        {rowsError ? (
          <div role="alert" className="p-4 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-800 dark:text-red-300">{rowsError}</p>
          </div>
        ) : rowsLoading ? (
          <div className="p-8 flex items-center justify-center" role="status">
            <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No revenue recorded for these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Disco</th>
                  <th className="px-4 py-3 font-semibold">Meter type</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                  <th className="px-4 py-3 font-semibold">Recognised</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.map((row) => (
                  <tr key={`${row.source}-${row.sourceId}-${row.reference}`} className="text-sm">
                    {/* The account number is an identifier string — shown as
                        given, never coerced or reformatted. */}
                    <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">{row.reference || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.customerName || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.discoCode || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.meterType ? formatPhaseLabel(row.meterType) : '—'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs">{row.sourceStatus ? sourceStatusLabel(row) : '—'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${
                      row.amountMissing ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-white'
                    }`}>
                      {transactionAmountLabel(row)}
                      {row.isEstimated && (
                        <span className="block text-[11px] font-normal text-amber-700 dark:text-amber-400">estimated</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
                      {row.revenueAt ? formatDateTime(row.revenueAt) : '—'}
                      {row.dateBasis && DATE_BASIS_LABELS[row.dateBasis] && (
                        <span className="block text-[11px] text-gray-400 dark:text-gray-500">{DATE_BASIS_LABELS[row.dateBasis]} date</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!rowsLoading && !rowsError && rows.length > 0 && (
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Page {pagination?.currentPage ?? page} of {totalPages} · {totalCount.toLocaleString()} record{totalCount === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={(pagination?.currentPage ?? page) <= 1}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={!pagination?.hasNext && (pagination?.currentPage ?? page) >= totalPages}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RevenueTab;
