// src/components/admin/DashboardInstallations.jsx
// The Admin Dashboard's installation KPIs and Recent Installations card.
// Data: hooks/useDashboardInstallations.js; definitions:
// utils/installationTotals.js (the pending/completed status mapping).
//
// Every figure has three states that never look alike: loading (skeleton),
// error (a message and a retry — never 0), and a value, where a genuine zero
// is shown as 0 with the reason underneath.
import { Clock, CheckCircle, Users, AlertCircle, RefreshCw, Inbox } from 'lucide-react';
import StatusBadge from '../common/StatusBadge';
import { formatCurrencyNGN } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';
import { ROW_SOURCE, formatPhaseLabel, rowStatusLabel } from '../../utils/installationScope';

const TONES = {
  amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  green: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  brand: 'bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400',
};

const n = (value) => Number(value).toLocaleString();

/** A count KPI with its own loading/error state and optional extra lines. */
function KpiCard({ icon: Icon, tone, title, value, loading, error, onRetry, children }) {
  return (
    <div className="card p-4 sm:p-6 flex flex-col min-w-0">
      <div className={`p-2 rounded-lg self-start mb-3 ${TONES[tone]}`}>
        <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
      </div>
      <h3 className="text-gray-500 dark:text-gray-400 text-xs sm:text-sm font-medium">{title}</h3>
      {loading ? (
        <>
          <div className="h-7 sm:h-8 w-20 mt-1 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" aria-hidden="true" />
          <span className="sr-only">Loading {title}</span>
        </>
      ) : error ? (
        <div role="alert" className="mt-1">
          <p className="text-sm text-red-700 dark:text-red-300 flex items-start gap-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Unavailable
          </p>
          {onRetry && (
            <button type="button" onClick={onRetry}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline">
              <RefreshCw className="w-3 h-3" /> Try again
            </button>
          )}
        </div>
      ) : (
        <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mt-1 break-words">{value}</p>
      )}
      {!loading && !error && children}
    </div>
  );
}

/**
 * @param {object} props
 * @param {ReturnType<import('../../utils/installationTotals').summarizeInstallationTotals>|null} props.totals
 *   Operational counts only — this component renders no money.
 */
export function InstallationKpis({
  totals, loading, error, onRetry,
  activeInstallers, installersLoading, installersError, onRetryInstallers,
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
      {/* Pending Installations and Awaiting Installations are ONE population
          (utils/installationTotals.js, `pending`): both lines below read the
          same server-aggregate figure, so they cannot differ. The breakdown
          says where those installations are in the workflow. No money here. */}
      <KpiCard icon={Clock} tone="amber" title="Pending Installations" loading={loading} error={error} onRetry={onRetry}
        value={totals ? n(totals.pending) : null}>
        {totals && (
          <>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
              Awaiting installation: <span className="font-semibold text-gray-900 dark:text-white">{n(totals.pending)}</span>
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 break-words">
              {n(totals.breakdown.pending.withInstaller)} with installers · {n(totals.breakdown.pending.unassigned)} not yet
              assigned · {n(totals.breakdown.pending.failed)} after a failed attempt · {n(totals.breakdown.pending.jedPaid)} paid JED
            </p>
          </>
        )}
      </KpiCard>
      <KpiCard icon={CheckCircle} tone="green" title="Completed Installations" loading={loading} error={error} onRetry={onRetry}
        value={totals ? n(totals.completed) : null}>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 break-words">
          {totals && `${n(totals.breakdown.completed.jed)} JED · ${n(totals.breakdown.completed.imported)} imported`}
        </p>
        {totals && (totals.awaitingPayment > 0 || totals.cancelled > 0) && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            Not counted: {n(totals.awaitingPayment)} awaiting payment, {n(totals.cancelled)} cancelled.
          </p>
        )}
      </KpiCard>
      <KpiCard icon={Users} tone="brand" title="Installers" loading={installersLoading} error={installersError}
        onRetry={onRetryInstallers} value={activeInstallers === null ? null : n(activeInstallers)} />
    </div>
  );
}

/**
 * @param {object} props
 * @param {{ rows: object[], total: number|null, failedSources: string[] }|null} props.recent
 */
export function RecentInstallationsCard({ recent, loading, error, onRetry, onViewAll, onOpen, showAmounts }) {
  const rows = recent?.rows || [];
  const amountOf = (row) => (row.source === ROW_SOURCE.JED && row.raw?.amount != null && row.raw.amount !== ''
    ? formatCurrencyNGN(row.raw.amount) : null);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Recent Installations</h3>
        <button type="button" onClick={onViewAll} className="text-xs sm:text-sm text-brand-700 dark:text-brand-400 hover:underline font-medium shrink-0">
          View all{recent?.total != null ? ` (${n(recent.total)})` : ''}
        </button>
      </div>

      {loading ? (
        <ul aria-label="Loading recent installations" className="divide-y divide-gray-200 dark:divide-gray-700">
          {[0, 1, 2].map((i) => (
            <li key={i} className="p-4 space-y-2" aria-hidden="true">
              <div className="h-4 w-40 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              <div className="h-3 w-56 max-w-full rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            </li>
          ))}
        </ul>
      ) : error ? (
        <div role="alert" className="p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          <button type="button" onClick={onRetry} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline">
            <RefreshCw className="w-3 h-3" /> Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center">
          <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-600 dark:text-gray-400">No installation requests yet.</p>
        </div>
      ) : (
        <ul aria-label="Recent installations" className="divide-y divide-gray-200 dark:divide-gray-700">
          {rows.map((row) => {
            const amount = showAmounts ? amountOf(row) : null;
            const clickable = row.source === ROW_SOURCE.JED;
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {row.customerName || `Account ${row.accountNumber}`}
                    </p>
                    {/* Account numbers wrap rather than truncate — every digit matters. */}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-all">
                      Acct <span className="font-mono">{row.accountNumber}</span>
                      {row.meterType ? ` · ${formatPhaseLabel(row.meterType)}` : ''}
                      {` · ${row.source === ROW_SOURCE.JED ? 'JED Remita' : row.discoCode || 'Imported'}`}
                    </p>
                  </div>
                  <StatusBadge status={row.status} label={rowStatusLabel(row)} className="shrink-0 text-[11px]" />
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                  <span>
                    Requested {row.requestedAt ? formatDateTime(row.requestedAt) : '—'}
                    {row.installer ? ` · ${row.installer}` : ''}
                  </span>
                  {amount && <span className="font-semibold text-gray-900 dark:text-white">{amount}</span>}
                </div>
              </>
            );
            return (
              <li key={row.key}>
                {clickable ? (
                  <button type="button" onClick={() => onOpen(row)}
                    className="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
                    {body}
                  </button>
                ) : <div className="p-4">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && !error && recent?.failedSources?.length > 0 && (
        <p className="px-4 pb-3 text-xs text-amber-700 dark:text-amber-400">
          Couldn&apos;t load {recent.failedSources.join(' or ')}, so this list may be missing some.
        </p>
      )}
    </div>
  );
}
