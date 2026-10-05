// src/hooks/useDashboardInstallations.js
// The Admin Dashboard's installation data, as two deliberately separate reads
// (see utils/installationTotals.js for the definitions):
//
//                         Installation APIs
//                 ┌──────────────┴──────────────┐
//        useInstallationTotals          useRecentInstallations
//        server-side aggregates         the newest few requests
//                 ↓                             ↓
//        Pending / Completed KPIs     Recent Installations card
//
// Totals NEVER come from the recent rows, and the recent rows never pretend to
// be a total. Both re-read on the app's refreshSignal (assignment, completion,
// payment confirmation and meter dispatch all fire it) and on reload(); there
// is no polling. A failed read is an error state with a message — never 0.
//
// Requests:
//   totals  GET /installations/statistics            (imported jobs, every disco)
//           GET /external/jed/requests?status=PAID|COMPLETED|INITIATED&limit=1
//                                                    (JED — only pagination.totalCount is read)
//   recent  GET /installations?page=…&limit=10       } first page and the last two
//           GET /external/jed/requests?page=…&limit=10 } (edgePages — no sort param exists)
//   Supervisor only (it has no finance or /dashboard-stats access):
//     trend      GET /installations?status=INSTALLED|EXPORTED, GET /external/jed/requests?status=COMPLETED
//     installers GET /users?role=INSTALLER&limit=1   (pagination.totalCount)
// `/dashboard-stats` is no longer used for these two KPIs: its spec gives
// "pending"/"completed" no definition, and it covers JED requests only, so it
// read 0/0 while imported installation work existed (2026-09-26).
import { useState, useEffect, useCallback } from 'react';
import jedApi from '../components/services/api';
import { useDataRefresh } from '../components/contexts/DataRefreshContext';
import { getErrorMessage } from '../utils/errorMessage';
import { unwrapListResponse } from '../utils/unwrapListResponse';
import { normalizeMultiRow, normalizeJedRow, JED_BUCKET } from '../utils/installationScope';
import { fetchAllPagesDetailed } from '../utils/fetchAllPages';
import { completionDayOf } from '../utils/completedInstallationsReport';
import { isPermissionError } from '../utils/apiResult';

// JED's Remita requests are outside some roles' API scope (SUPERVISOR gets a
// 403 on /external/jed/*). Such a read resolves to null — "not this role's" —
// and the figures say they exclude JED. Any other failure still fails.
const unlessForbidden = (promise) => promise.catch((err) => {
  if (isPermissionError(err)) return null;
  throw err;
});
import {
  summarizeInstallationTotals, jedTotalCount, edgePages, pickRecentRequests,
} from '../utils/installationTotals';

const JED_STATUSES = ['PAID', 'COMPLETED', 'INITIATED'];
const RECENT_PAGE_SIZE = 10;

/** One read of the system-wide pending/completed counts. */
export async function loadInstallationTotals() {
  const [importedStats, jed] = await Promise.all([
    jedApi.getInstallationStatistics({}),
    unlessForbidden(Promise.all(JED_STATUSES.map((status) => jedApi.getAllCustomerRequests({ status, page: 1, limit: 1 })))),
  ]);
  const jedCounts = jed === null ? null : Object.fromEntries(JED_STATUSES.map((s, i) => [s, jedTotalCount(jed[i])]));
  return summarizeInstallationTotals({ importedStats, jedCounts });
}

const pagesOf = (resp) => Number(resp?.pagination?.totalPages ?? resp?.data?.pagination?.totalPages) || 1;
const countOf = (resp) => {
  const raw = resp?.pagination?.totalCount ?? resp?.data?.pagination?.totalCount;
  const n = raw === null || raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Page 1, then the last two pages when there are more — see edgePages. */
async function readEdges(fetchPage) {
  const first = await fetchPage({ page: 1, limit: RECENT_PAGE_SIZE });
  const rows = [...unwrapListResponse(first)];
  const rest = edgePages(pagesOf(first)).filter((p) => p !== 1);
  const more = await Promise.all(rest.map((page) => fetchPage({ page, limit: RECENT_PAGE_SIZE })));
  more.forEach((resp) => rows.push(...unwrapListResponse(resp)));
  return { rows, total: countOf(first) };
}

/**
 * The newest requests across both domains. Each source can fail on its own;
 * the other still shows, with the failure named. Both failing is an error.
 */
export async function loadRecentInstallations(limit = 5) {
  const [imported, jedRead] = await Promise.allSettled([
    readEdges((p) => jedApi.getInstallations(p)),
    readEdges((p) => jedApi.getAllCustomerRequests(p)),
  ]);
  // A role that may not read JED requests gets none, not a failure notice.
  const jedForbidden = jedRead.status === 'rejected' && isPermissionError(jedRead.reason);
  const jed = jedForbidden ? { status: 'fulfilled', value: { rows: [], total: 0 } } : jedRead;
  if (imported.status === 'rejected' && jed.status === 'rejected') throw imported.reason;
  const rows = [
    ...(imported.status === 'fulfilled' ? imported.value.rows.map(normalizeMultiRow) : []),
    ...(jed.status === 'fulfilled' ? jed.value.rows.map((r) => normalizeJedRow(r, JED_BUCKET)) : []),
  ];
  const totals = [imported, jed].map((s) => (s.status === 'fulfilled' ? s.value.total : null));
  return {
    rows: pickRecentRequests(rows, limit),
    total: totals.every((t) => t !== null) ? totals[0] + totals[1] : null,
    failedSources: [
      imported.status === 'rejected' && 'imported installation requests',
      jed.status === 'rejected' && 'JED requests',
    ].filter(Boolean),
  };
}

/**
 * Every completed installation across both domains, each reduced to the day it
 * was installed — the Installations Completed trend for a role that can't read
 * the finance endpoints (Supervisor: GET /finance/* is 403 for it). Completed
 * is the same definition as the Completed KPI (imported INSTALLED/EXPORTED +
 * JED COMPLETED) and the day is the same one the Installations page's
 * "Installed from / to" filter uses (completionDateOf).
 */
export async function loadCompletedInstallationDays() {
  const [installed, exported, jedRead] = await Promise.all([
    fetchAllPagesDetailed((p) => jedApi.getInstallations(p), { status: 'INSTALLED' }),
    fetchAllPagesDetailed((p) => jedApi.getInstallations(p), { status: 'EXPORTED' }),
    unlessForbidden(fetchAllPagesDetailed((p) => jedApi.getAllCustomerRequests(p), { status: 'COMPLETED' })),
  ]);
  const jed = jedRead || { items: [], truncated: false };
  const rows = [
    ...installed.items.map(normalizeMultiRow),
    ...exported.items.map(normalizeMultiRow),
    ...jed.items.map((r) => normalizeJedRow(r, JED_BUCKET)),
  ];
  return {
    rows: rows.map((row) => ({ completedOn: completionDayOf(row) })),
    truncated: installed.truncated || exported.truncated || jed.truncated,
  };
}

/** The installer roster's size (GET /users?role=INSTALLER), from the server's totalCount. */
export async function loadInstallerRosterCount() {
  const count = countOf(await jedApi.getUsers({ role: 'INSTALLER', page: 1, limit: 1 }));
  if (count === null) throw new Error('totalCount missing from GET /users');
  return count;
}

function useLoader(load, { enabled, fallbackMessage }) {
  const { refreshSignal } = useDataRefresh();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => { jedApi.clearCache(); setReloadKey((k) => k + 1); }, []);

  useEffect(() => {
    if (!enabled) { setData(null); setLoading(false); setError(null); return undefined; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await load();
        if (!cancelled) setData(result);
      } catch (err) {
        console.error('[Dashboard] Installation data failed:', err);
        if (!cancelled) { setData(null); setError(getErrorMessage(err, fallbackMessage)); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, reloadKey, refreshSignal, load, fallbackMessage]);

  return { data, loading, error, reload };
}

/** @param {{ enabled?: boolean }} [options] - explicit opt-in */
export function useInstallationTotals({ enabled = false } = {}) {
  const { data, ...rest } = useLoader(loadInstallationTotals, {
    enabled: enabled === true, fallbackMessage: "Couldn't load installation totals.",
  });
  return { totals: data, ...rest };
}

const loadRecentFive = () => loadRecentInstallations(5);

/** @param {{ enabled?: boolean }} [options] - explicit opt-in */
export function useRecentInstallations({ enabled = false } = {}) {
  const { data, ...rest } = useLoader(loadRecentFive, {
    enabled: enabled === true, fallbackMessage: "Couldn't load recent installations.",
  });
  return { recent: data, ...rest };
}
