// src/components/schedule/InstalledRecordsModal.jsx
// Meter Schedule → click the "Installed" card. The card itself stays a plain
// tile; this modal holds the detail.
//
// Rows are the meters the card counts — GET /meters?status=INSTALLED
// (useInstalledMeters), the same population /meters/statistics' `installed`
// counts — each joined by meter number to the completed installation that
// reports it (useInstallationRecordsByMeter, shared with the page, read
// through the export's own field definitions). Every field shown is a real
// API field; a field the records don't carry is left out, never filled in.
//
// A row opens its details grouped as Customer, Installer, Installation, Meter,
// Seal, Location, Disco and Installation picture. Full-screen below `sm`, a
// large dialog above; no table, so nothing scrolls sideways on a phone.
// A Super Admin can unassign an installed meter from a record
// (RevertInstallationModal); saving re-reads everything via refreshSignal.
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, ChevronDown, ChevronUp, Undo2, Wrench, MapPin, Image as ImageIcon } from 'lucide-react';
import { useInstalledMeters } from '../../hooks/useInstalledMeters';
import RevertInstallationModal from '../installations/RevertInstallationModal';
import { revertTargetOf, revertBlockReason } from '../../utils/installationRevert';
import { formatDateTime, formatPlainDate } from '../../utils/date';
import { formatPhaseLabel } from '../../utils/installationScope';
import { filterInstallationDetails } from '../../utils/completedInstallationsReport';
import { meterSerial, meterAvailability } from '../../utils/meterInventory';
import { meterMakeOf, meterModelOf } from '../../utils/meterDisplay';

const PAGE = 25;
const n = (v) => Number(v).toLocaleString();
const present = (v) => v !== null && v !== undefined && v !== false && String(v).trim() !== '';

function Section({ title, rows }) {
  const shown = rows.filter(([, value]) => present(value));
  if (shown.length === 0) return null;
  return (
    <section className="min-w-0">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{title}</h4>
      <dl className="grid grid-cols-1 gap-0.5 text-xs">
        {shown.map(([label, value]) => (
          <div key={label} className="flex gap-2 min-w-0">
            <dt className="text-gray-500 dark:text-gray-400 shrink-0 w-24">{label}</dt>
            <dd className="text-gray-900 dark:text-white min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function InstalledDetails({ meter, record, showPhone, showPayment }) {
  const r = record || {};
  const hasGps = present(r.latitude) && present(r.longitude);
  const phase = meter?.phaseType || r.meterType;
  const mono = (v) => (present(v) ? <span className="font-mono break-all">{v}</span> : null);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      <Section title="Customer" rows={[
        ['Name', r.customerName],
        ['Account', mono(r.accountNumber)],
        ['Address', r.customerAddress],
        ['Area / region', [r.area, r.region].filter(Boolean).join(', ')],
        ['Feeder', [r.feederName, r.transformerName && `Transformer ${r.transformerName}`].filter(Boolean).join(' · ')],
        ['Phone', showPhone ? r.customerPhone : null],
      ]} />
      <Section title="Installer" rows={[
        ['Name', r.installerName],
        ['Installer ID', mono(r.installerId)],
      ]} />
      <Section title="Installation" rows={[
        ['Status', r.status],
        ['Requested', r.requestDate ? formatDateTime(r.requestDate) : null],
        ['Paid', showPayment && r.datePaid ? formatDateTime(r.datePaid) : null],
        ['Assigned', r.assignedAt ? formatDateTime(r.assignedAt) : null],
        ['Installed', r.installationDate ? formatPlainDate(r.installationDate) : null],
        ['Completed', r.completedAt ? formatDateTime(r.completedAt) : null],
        ['Position', r.installationPosition],
        ['Notes', r.notes],
      ]} />
      <Section title="Meter" rows={[
        ['Number', mono(meterSerial(meter))],
        ['Type', phase ? formatPhaseLabel(phase) : null],
        ['Status', meterAvailability(meter).label],
        ['Make', meterMakeOf(meter)],
        ['Model', meterModelOf(meter)],
      ]} />
      <Section title="Seal" rows={[['Seal number', mono(r.sealNumber)]]} />
      <Section title="Location" rows={[
        ['GPS', hasGps ? (
          <a href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 hover:underline">
            <MapPin className="w-3 h-3" /> {Number(r.latitude).toFixed(6)}, {Number(r.longitude).toFixed(6)}
          </a>
        ) : null],
      ]} />
      <Section title="Disco" rows={[['Disco', r.disco], ['Supervisor', r.discoSupervisor]]} />
      {present(r.photoUrl) && (
        <section className="sm:col-span-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Installation picture</h4>
          {/* A plain <img> of the public link — never crossOrigin (CLAUDE.md, uploads). */}
          <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
            <img src={r.photoUrl} alt={`Installation of meter ${meterSerial(meter)}`} loading="lazy"
              className="max-h-48 max-w-full rounded-lg border border-gray-200 dark:border-gray-700 object-contain bg-gray-100 dark:bg-gray-700" />
          </a>
          <a href={r.photoUrl} target="_blank" rel="noopener noreferrer"
            className="mt-1 flex items-center gap-1 text-xs text-brand-700 dark:text-brand-400 hover:underline">
            <ImageIcon className="w-3 h-3" /> View picture
          </a>
        </section>
      )}
    </div>
  );
}

/**
 * @param {{ isOpen: boolean, onClose: () => void,
 *   lookup: ReturnType<typeof import('../../hooks/useInstallationRecordsByMeter').useInstallationRecordsByMeter>,
 *   cardCount: number|null, showPhone: boolean, showPayment: boolean, canRevert: boolean }} props
 */
export default function InstalledRecordsModal({ isOpen, onClose, lookup, cardCount = null, showPhone, showPayment, canRevert }) {
  const installed = useInstalledMeters({ enabled: isOpen });
  const { records } = lookup;
  const [query, setQuery] = useState('');
  const [installer, setInstaller] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [expanded, setExpanded] = useState(null);
  const [revertTarget, setRevertTarget] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    closeRef.current?.focus();
    // The unassign confirmation handles its own Escape.
    const onKeyDown = (e) => { if (e.key === 'Escape' && !revertTarget) onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, revertTarget]);

  // One row per installed meter, with its installation (or none).
  const all = useMemo(() => {
    const list = (installed.meters?.items || []).map((meter) => {
      const serial = meterSerial(meter);
      const record = records?.index?.get(serial) || null;
      return {
        key: serial, meter, record, meterNumber: serial,
        accountNumber: record?.accountNumber || null, customerName: record?.customerName || null, installerName: record?.installerName || null,
      };
    }).filter((r) => r.key);
    return list.sort((a, b) => String(b.record?.installationDate || '').localeCompare(String(a.record?.installationDate || ''))
      || a.key.localeCompare(b.key));
  }, [installed.meters, records]);
  const installers = useMemo(
    () => Array.from(new Set(all.map((r) => r.installerName).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [all]
  );
  const rows = useMemo(() => filterInstallationDetails(all, { query, installer }), [all, query, installer]);

  if (!isOpen) return null;

  const loading = (installed.loading && !installed.meters) || (lookup.loading && !records);
  const failed = installed.error || !!lookup.error;
  const retry = () => { if (installed.error) installed.reload(); if (lookup.error) lookup.reload(); };
  const narrowed = !!(query.trim() || installer);
  const resetPaging = () => { setShown(PAGE); setExpanded(null); };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-4 animate-fade-in"
        onClick={onClose}>
        <div role="dialog" aria-modal="true" aria-labelledby="installed-records-title"
          className="bg-white dark:bg-gray-800 sm:border border-gray-200 dark:border-gray-700 sm:rounded-lg shadow-2xl w-full sm:max-w-3xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="min-w-0 flex items-start gap-3">
              <div className="p-2 rounded-full bg-purple-100 dark:bg-purple-900/30 shrink-0">
                <Wrench className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="min-w-0">
                <h3 id="installed-records-title" className="text-lg font-semibold text-gray-900 dark:text-white">Installed Installations</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Each installed meter and the installation it went into. Select one to see its details.
                </p>
              </div>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close installed installations"
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          {!loading && !failed && all.length > 0 && (
            <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="relative sm:col-span-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); resetPaging(); }}
                  placeholder="Meter, account, customer or installer" aria-label="Search installed meters"
                  className="form-input w-full pl-9 pr-3 py-2 text-sm" />
              </div>
              <select value={installer} onChange={(e) => { setInstaller(e.target.value); resetPaging(); }}
                aria-label="Filter by installer" className="form-input px-3 py-2 text-sm">
                <option value="">All installers</option>
                {installers.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-6 text-sm text-gray-600 dark:text-gray-400" role="status">Loading installed installations...</p>
            ) : failed ? (
              <div role="alert" className="p-6 text-sm text-red-800 dark:text-red-300">
                Unable to load installed installation details. Please try again.{' '}
                <button type="button" onClick={retry} className="font-medium underline">Try again</button>
              </div>
            ) : all.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-600 dark:text-gray-400">No installed installations found.</p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-600 dark:text-gray-400">No installed meter matches that search.</p>
            ) : (
              <ul aria-label="Installed meters" className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.slice(0, shown).map(({ key, meter, record }) => {
                  const open = expanded === key;
                  const target = canRevert && record ? revertTargetOf(record.row) : null;
                  const blocked = canRevert && record && !target ? revertBlockReason(record.row) : null;
                  const phase = meter.phaseType || record?.meterType;
                  return (
                    <li key={key}>
                      <button type="button" onClick={() => setExpanded(open ? null : key)} aria-expanded={open}
                        className="w-full text-left p-3 sm:p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                            <p className="text-sm font-mono text-gray-900 dark:text-white break-all">{key}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {record?.installationDate ? `Installed ${formatPlainDate(record.installationDate)}` : 'Installation date not recorded'}
                            </p>
                          </div>
                          <p className="text-sm text-gray-800 dark:text-gray-200 truncate">
                            {record ? (record.customerName || 'Customer not recorded') : 'No installation record reports this meter'}
                            {record?.accountNumber && <span className="text-gray-500 dark:text-gray-400"> · Acct <span className="font-mono">{record.accountNumber}</span></span>}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                            {[phase && formatPhaseLabel(phase), record?.installerName && `By ${record.installerName}`, record?.disco]
                              .filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 mt-1" />}
                      </button>
                      {open && (
                        <div className="px-3 sm:px-4 pb-4 space-y-3">
                          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
                            <InstalledDetails meter={meter} record={record} showPhone={showPhone} showPayment={showPayment} />
                            {!record && (
                              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                {records?.complete === false
                                  ? 'Not every installation record could be loaded, so this meter’s may be among those missing.'
                                  : 'No completed installation reports this meter number, so there are no customer or installation details to show.'}
                              </p>
                            )}
                          </div>
                          {target && (
                            <button type="button" onClick={() => setRevertTarget(target)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40">
                              <Undo2 className="w-3.5 h-3.5" /> Unassign installed meter
                            </button>
                          )}
                          {blocked && <p className="text-xs text-gray-500 dark:text-gray-400">Can’t unassign: {blocked}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!loading && !failed && rows.length > shown && (
              <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-center">
                <button type="button" onClick={() => setShown((s) => s + PAGE)}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
                  Show {Math.min(PAGE, rows.length - shown)} more
                </button>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5 min-w-0">
              {!loading && !failed && (
                <p>
                  {narrowed ? `${n(rows.length)} of ` : ''}{n(all.length)} installed meter{all.length === 1 ? '' : 's'}
                  {cardCount !== null && cardCount !== undefined && cardCount !== all.length ? ` (the card reports ${n(cardCount)})` : ''}.
                </p>
              )}
              {installed.meters?.truncated && <p className="text-amber-700 dark:text-amber-400">Not every installed meter could be loaded.</p>}
              {records?.jedForbidden && <p>JED Remita requests aren’t available to your role, so their installation details aren’t shown.</p>}
            </div>
            <button type="button" onClick={onClose}
              className="w-full sm:w-auto px-6 py-2 bg-brand-500 text-gray-900 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>

      <RevertInstallationModal target={revertTarget} onClose={() => setRevertTarget(null)} onReverted={() => setExpanded(null)} />
    </>
  );
}
