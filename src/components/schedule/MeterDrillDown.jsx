// src/components/schedule/MeterDrillDown.jsx
// Meter Schedule's card drill-down pieces (2026-09-27):
//   DrillSummary        — which card is open, its count beside the list's own
//                         server total, and a plain warning if they disagree
//   InstallationRecord  — the installation behind an INSTALLED meter
//   AssignedMetersList  — the "Assigned" card's records: exactly the open
//                         dispatch index its count is taken from
import { useMemo, useState } from 'react';
import { X, MapPin, Image as ImageIcon, Search } from 'lucide-react';
import { formatDateTime, formatPlainDate } from '../../utils/date';
import { formatPhaseLabel } from '../../utils/installationScope';

const n = (v) => Number(v).toLocaleString();

/**
 * @param {{ label: string, cardCount: number|null, listTotal: number|null,
 *   searching: boolean, onClear: () => void }} props
 */
export function DrillSummary({ label, cardCount, listTotal, searching, onClear }) {
  const comparable = !searching && cardCount !== null && listTotal !== null;
  return (
    <div className="card p-3 flex flex-wrap items-center justify-between gap-2" role="status">
      <p className="text-sm text-gray-800 dark:text-gray-200">
        Showing <span className="font-semibold">{label}</span>
        {listTotal !== null && <> — {n(listTotal)} matching record{listTotal === 1 ? '' : 's'}</>}
        {searching && ' (narrowed by your search)'}
      </p>
      <button type="button" onClick={onClear}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline">
        <X className="w-3.5 h-3.5" /> Show all meters
      </button>
      {comparable && cardCount !== listTotal && (
        <p className="w-full text-xs text-amber-700 dark:text-amber-400">
          The card reports {n(cardCount)} but the list has {n(listTotal)}. Both are the server&apos;s own figures
          (statistics vs. the filtered list); refresh, and report it if it persists.
        </p>
      )}
    </div>
  );
}

const Row = ({ label, children }) => (children === null || children === undefined || children === '' ? null : (
  <div className="flex gap-2 min-w-0">
    <dt className="text-gray-500 dark:text-gray-400 shrink-0 w-28">{label}</dt>
    <dd className="text-gray-900 dark:text-white min-w-0 break-words">{children}</dd>
  </div>
));

/**
 * @param {{ record: object|null, loading: boolean, error: string|null,
 *   complete: boolean, showPhone: boolean }} props
 */
export function InstallationRecord({ record, loading, error, complete, showPhone }) {
  if (loading) return <p className="text-xs text-gray-500 dark:text-gray-400">Loading installation record…</p>;
  if (error) return <p className="text-xs text-red-700 dark:text-red-300">{error}</p>;
  if (!record) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {complete
          ? 'No installation record reports this meter number.'
          : 'Not every installation record could be loaded, so this meter’s may be among those missing.'}
      </p>
    );
  }
  const hasGps = record.latitude !== null && record.longitude !== null;
  return (
    <dl className="grid grid-cols-1 gap-1 text-xs">
      <Row label="Customer">{record.customerName}</Row>
      <Row label="Account">{record.accountNumber && <span className="font-mono break-all">{record.accountNumber}</span>}</Row>
      <Row label="Address">{record.customerAddress}</Row>
      {showPhone && <Row label="Phone">{record.customerPhone}</Row>}
      <Row label="Status">{record.status}</Row>
      <Row label="Installed">{record.installationDate ? formatPlainDate(record.installationDate) : null}</Row>
      <Row label="Seal">{record.sealNumber}</Row>
      <Row label="Installer">{record.installerName}</Row>
      <Row label="Assigned">{record.assignedAt ? formatDateTime(record.assignedAt) : null}</Row>
      <Row label="Disco">{record.disco}</Row>
      <Row label="Supervisor">{record.discoSupervisor}</Row>
      <Row label="GPS">{hasGps && (
        <a href={`https://www.google.com/maps?q=${record.latitude},${record.longitude}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 hover:underline">
          <MapPin className="w-3 h-3" /> {Number(record.latitude).toFixed(6)}, {Number(record.longitude).toFixed(6)}
        </a>
      )}</Row>
      <Row label="Photo">{record.photoUrl && (
        <a href={record.photoUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 hover:underline">
          <ImageIcon className="w-3 h-3" /> View installation photo
        </a>
      )}</Row>
      <Row label="Notes">{record.notes}</Row>
    </dl>
  );
}

const PAGE = 25;

/**
 * @param {{ holders: Map<string, object>|null, loading: boolean, error: string|null }} props
 */
export function AssignedMetersList({ holders, loading, error }) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => {
    const list = holders ? Array.from(holders.entries()).map(([serial, h]) => ({ serial, ...h })) : [];
    const needle = query.trim().toLowerCase();
    return (needle
      ? list.filter((r) => r.serial.includes(needle) || String(r.installerName || '').toLowerCase().includes(needle))
      : list
    ).sort((a, b) => String(b.assignedAt || '').localeCompare(String(a.assignedAt || '')));
  }, [holders, query]);

  if (loading && !holders) return <div className="card p-6 text-sm text-gray-600 dark:text-gray-400" role="status">Loading assigned meters…</div>;
  if (error) return <div role="alert" className="card p-4 text-sm text-red-800 dark:text-red-300">{error}</div>;

  return (
    <div className="card overflow-hidden">
      <div className="p-3 border-b border-gray-200 dark:border-gray-700 relative">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
          placeholder="Meter number or installer" aria-label="Search assigned meters"
          className="form-input w-full pl-9 pr-3 py-2 text-sm" />
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-600 dark:text-gray-400">
          {holders?.size ? 'No assigned meter matches that search.' : 'No meters are with installers right now.'}
        </p>
      ) : (
        <ul aria-label="Assigned meters" className="divide-y divide-gray-200 dark:divide-gray-700">
          {rows.slice(0, shown).map((r) => (
            <li key={r.serial} className="p-3 sm:p-4 text-sm">
              <p className="font-mono text-gray-900 dark:text-white break-all">{r.serial}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                {[r.phaseType && formatPhaseLabel(r.phaseType), r.installerName ? `With ${r.installerName}` : 'With an installer',
                  r.discoCode, r.assignedAt && `since ${formatDateTime(r.assignedAt)}`, r.batchRef && `batch ${r.batchRef}`]
                  .filter(Boolean).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown && (
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-center">
          <button type="button" onClick={() => setShown((s) => s + PAGE)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
            Show {Math.min(PAGE, rows.length - shown)} more
          </button>
        </div>
      )}
      <p className="px-3 pb-3 text-xs text-gray-500 dark:text-gray-400">
        {n(rows.length)} of {n(holders?.size || 0)} meters out with installers (open dispatch batches).
      </p>
    </div>
  );
}
