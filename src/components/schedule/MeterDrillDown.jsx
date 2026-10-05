// src/components/schedule/MeterDrillDown.jsx
// InstallationRecord — the installation behind an installed meter, read through
// the export's own field definitions (installationDetailsOf). Used by
// Installer Job Status. (The card drill-down list views that also lived here
// were removed on 2026-10-05: Meter Schedule's cards are plain tiles again and
// the Installed card opens InstalledRecordsModal.)
import { MapPin, Image as ImageIcon } from 'lucide-react';
import { formatDateTime, formatPlainDate } from '../../utils/date';
import { formatPhaseLabel } from '../../utils/installationScope';

const Row = ({ label, children }) => (children === null || children === undefined || children === '' ? null : (
  <div className="flex gap-2 min-w-0">
    <dt className="text-gray-500 dark:text-gray-400 shrink-0 w-28">{label}</dt>
    <dd className="text-gray-900 dark:text-white min-w-0 break-words">{children}</dd>
  </div>
));

/**
 * @param {{ record: object|null, loading: boolean, error: string|null,
 *   complete: boolean, showPhone: boolean, showPayment?: boolean }} props
 *   showPhone: admin tier only. showPayment: PAYMENTS.VIEW (date paid).
 */
export function InstallationRecord({ record, loading, error, complete, showPhone, showPayment = false }) {
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
  const location = [record.area, record.region].filter(Boolean).join(', ');
  return (
    <dl className="grid grid-cols-1 gap-1 text-xs">
      <Row label="Customer">{record.customerName}</Row>
      <Row label="Account">{record.accountNumber && <span className="font-mono break-all">{record.accountNumber}</span>}</Row>
      <Row label="Address">{record.customerAddress}</Row>
      <Row label="Area / region">{location}</Row>
      <Row label="Feeder">{[record.feederName, record.transformerName && `Transformer ${record.transformerName}`].filter(Boolean).join(' · ')}</Row>
      {showPhone && <Row label="Phone">{record.customerPhone}</Row>}
      <Row label="Meter">{record.meterNumber && (
        <span className="font-mono break-all">{record.meterNumber}{record.meterType ? <span className="font-sans"> · {formatPhaseLabel(record.meterType)}</span> : null}</span>
      )}</Row>
      <Row label="Status">{record.status}</Row>
      <Row label="Requested">{record.requestDate ? formatDateTime(record.requestDate) : null}</Row>
      {showPayment && <Row label="Paid">{record.datePaid ? formatDateTime(record.datePaid) : null}</Row>}
      <Row label="Assigned">{record.assignedAt ? formatDateTime(record.assignedAt) : null}</Row>
      <Row label="Installed">{record.installationDate ? formatPlainDate(record.installationDate) : null}</Row>
      <Row label="Reported">{record.completedAt ? formatDateTime(record.completedAt) : null}</Row>
      <Row label="Seal">{record.sealNumber}</Row>
      <Row label="Position">{record.installationPosition}</Row>
      <Row label="Installer">{record.installerName}</Row>
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
