// src/components/schedule/InstallationDetails.jsx
// The complete installation behind ONE installed meter, shared by:
//   - InstallationDetailsModal (below): Meter Schedule → click an installed
//     meter card;
//   - InstalledRecordsModal: Meter Schedule → Installed summary card → a row.
//
// Meter fields come from the meter record (GET /meters); everything else from
// the installation that reports the meter number (useInstallationRecordsByMeter
// → installationDetailsOf, the export's own field definitions). A field the
// records don't carry is left out — nothing is filled in.
import { useEffect, useRef } from 'react';
import { X, Wrench, MapPin, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { formatDateOnly, formatDateTime, formatPlainDate } from '../../utils/date';
import { formatPhaseLabel } from '../../utils/installationScope';
import { meterSerial, meterAvailability } from '../../utils/meterInventory';
import { meterMakeOf, meterModelOf, manufacturedDateOf } from '../../utils/meterDisplay';

const present = (v) => v !== null && v !== undefined && v !== false && String(v).trim() !== '';
const mono = (v) => (present(v) ? <span className="font-mono break-all">{v}</span> : null);

function Section({ title, rows }) {
  const shown = rows.filter(([, value]) => present(value));
  if (shown.length === 0) return null;
  return (
    <section className="min-w-0">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{title}</h4>
      <dl className="grid grid-cols-1 gap-0.5 text-xs">
        {shown.map(([label, value]) => (
          <div key={label} className="flex gap-2 min-w-0">
            <dt className="text-gray-500 dark:text-gray-400 shrink-0 w-28">{label}</dt>
            <dd className="text-gray-900 dark:text-white min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * @param {{ meter: object|null, record: object|null, showPhone: boolean, showPayment: boolean }} props
 *   record: installationDetailsOf output, or null when no installation reports
 *   the meter. showPhone: admin tier only. showPayment: PAYMENTS.VIEW.
 */
export function InstallationDetails({ meter, record, showPhone, showPayment }) {
  const r = record || {};
  const hasGps = present(r.latitude) && present(r.longitude);
  const phase = meter?.phaseType || r.meterType;
  const serial = meterSerial(meter) || r.meterNumber;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      <Section title="Meter Information" rows={[
        ['Meter number', mono(serial)],
        ['Meter type', phase ? formatPhaseLabel(phase) : null],
        ['Meter status', meter ? meterAvailability(meter, meter.holder || null).label : null],
        ['Make', meterMakeOf(meter)],
        ['Model', meterModelOf(meter)],
        ['SIM number', mono(meter?.simNumber)],
        ['SGC', mono(meter?.sgcNumber)],
        ['Manufactured date', manufacturedDateOf(meter)],
        ['Uploaded', meter?.uploadedAt ? formatDateOnly(meter.uploadedAt) : null],
      ]} />
      <Section title="Customer Information" rows={[
        ['Customer', r.customerName],
        ['Account number', mono(r.accountNumber)],
        ['Address', r.customerAddress],
        ['Phone', showPhone ? r.customerPhone : null],
        ['Disco', r.disco],
        ['Region', r.region],
        ['Area', r.area],
        ['Feeder', [r.feederName, r.transformerName && `Transformer ${r.transformerName}`, r.transformerCode && `DT ID ${r.transformerCode}`].filter(Boolean).join(' · ')],
        ...(r.extras || []).map((e) => [e.label, e.value]),
      ]} />
      <div className="sm:col-span-2">
        <Section title="Installation Information" rows={[
          ['Status', r.status],
          ['Installation date', r.installationDate ? formatPlainDate(r.installationDate) : null],
          ['Request date', r.requestDate ? formatDateTime(r.requestDate) : null],
          ['Paid', showPayment && r.datePaid ? formatDateTime(r.datePaid) : null],
          ['Assigned', r.assignedAt ? formatDateTime(r.assignedAt) : null],
          ['Reported', r.completedAt ? formatDateTime(r.completedAt) : null],
          ['Installer', r.installerName],
          ['Installer ID', mono(r.installerId)],
          ['Location', r.installationPosition],
          ['GPS coordinates', hasGps ? (
            <a href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 hover:underline break-all">
              <MapPin className="w-3 h-3 shrink-0" /> {Number(r.latitude).toFixed(6)}, {Number(r.longitude).toFixed(6)}
            </a>
          ) : null],
          ['Seal number', mono(r.sealNumber)],
          ['Disco supervisor', r.discoSupervisor],
          ['Notes', r.notes],
        ]} />
      </div>
      {present(r.photoUrl) && (
        <section className="sm:col-span-2 min-w-0">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Installation picture</h4>
          {/* A plain <img> of the public link — never crossOrigin (CLAUDE.md, uploads). */}
          <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" className="inline-block max-w-full">
            <img src={r.photoUrl} alt={`Installation of meter ${serial}`} loading="lazy"
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

/** Why a meter has no installation shown, given whether every record loaded. */
export function MissingRecordNote({ complete, className = '' }) {
  return (
    <p className={`text-xs text-gray-500 dark:text-gray-400 ${className}`}>
      {complete === false
        ? 'Not every installation record could be loaded, so this meter’s may be among those missing.'
        : 'No completed installation reports this meter number, so there are no customer or installation details to show.'}
    </p>
  );
}

/**
 * One installed meter's installation, in a dialog. Reads the page's shared
 * lookup — it never issues a request of its own per meter.
 * @param {{ meter: object|null, onClose: () => void,
 *   lookup: ReturnType<typeof import('../../hooks/useInstallationRecordsByMeter').useInstallationRecordsByMeter>,
 *   showPhone: boolean, showPayment: boolean }} props
 */
export default function InstallationDetailsModal({ meter, onClose, lookup, showPhone, showPayment }) {
  const closeRef = useRef(null);
  const isOpen = !!meter;

  useEffect(() => {
    if (!isOpen) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const { records } = lookup;
  const loading = !records && !lookup.error;
  const record = records?.index?.get(meterSerial(meter)) || null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-4 animate-fade-in"
      onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="installation-details-title"
        className="bg-white dark:bg-gray-800 sm:border border-gray-200 dark:border-gray-700 sm:rounded-lg shadow-2xl w-full sm:max-w-2xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col min-w-0"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0 flex items-start gap-3">
            <div className="p-2 rounded-full bg-purple-100 dark:bg-purple-900/30 shrink-0">
              <Wrench className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="min-w-0">
              <h3 id="installation-details-title" className="text-lg font-semibold text-gray-900 dark:text-white">Installation Details</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">{meterSerial(meter)}</p>
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close installation details"
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400" role="status">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading installation details...
            </p>
          ) : lookup.error ? (
            <div role="alert" className="text-sm text-red-800 dark:text-red-300 space-y-3">
              <p>Unable to load the installation details. Please try again.</p>
              <button type="button" onClick={lookup.reload} className="font-medium underline">Try again</button>
            </div>
          ) : (
            <div className="space-y-3">
              <InstallationDetails meter={meter} record={record} showPhone={showPhone} showPayment={showPayment} />
              {!record && <MissingRecordNote complete={records?.complete} />}
              {record && !present(record.photoUrl) && (
                <p className="text-xs text-gray-500 dark:text-gray-400">No installation picture was recorded.</p>
              )}
              {records?.jedForbidden && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  JED Remita requests aren’t available to your role, so their installation details aren’t shown.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button type="button" onClick={onClose}
            className="w-full sm:w-auto px-6 py-2 bg-brand-500 text-gray-900 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
