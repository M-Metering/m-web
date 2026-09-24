// src/components/installation/RequestInfoPanel.jsx
// Presentation-only panel for displaying a customer request's details,
// used by InstallationDetail.jsx (the single installation-workflow view —
// the standalone "Complete Installation" account-lookup tab that used to
// also reuse this panel was removed; see PROJECT_CONTEXT.md).
import {
  User,
  Hash,
  Zap,
  ShieldCheck,
  CheckCircle,
  MapPin,
  Phone,
  Mail,
  Gauge,
  Wallet,
} from 'lucide-react';
import { formatDateTime } from '../../utils/date';
import { formatCurrencyNGN } from '../../utils/currency';

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900 dark:text-white break-words">{value}</p>
      </div>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Object|null} props.data - request/customer object. Real fields
 *   confirmed against the live JedCustomerRequest schema/response:
 *   custNames, applicantName, gsm (phone — NOT `phone`/`phoneNumber`,
 *   which don't exist on the real schema and previously made this panel's
 *   Phone row silently disappear), email, address, region, accountNumber,
 *   meterRecommended (phase type requested at submission), meterNo,
 *   meterNumber, sealNo, amount, rrr/paymentReference/paymentRef,
 *   dateRequested (used as "Submitted" — there is no separate
 *   `submittedAt` field on the real schema).
 * @param {string} [props.title] - optional section heading
 */
function RequestInfoPanel({ data, title = 'Request Details' }) {
  if (!data) return null;

  return (
    <div className="card p-4 sm:p-6">
      {title && (
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
          {title}
        </h2>
      )}
      <InfoRow icon={User} label="Customer" value={data.custNames || data.applicantName} />
      <InfoRow icon={Phone} label="Phone" value={data.gsm || data.phone1 || data.phone2 || data.phone || data.phoneNumber} />
      <InfoRow icon={Mail} label="Email" value={data.email || data.emailAddress} />
      <InfoRow icon={MapPin} label="Address" value={data.address} />
      <InfoRow icon={MapPin} label="Region" value={data.region} />
      <InfoRow icon={Hash} label="Account Number" value={data.accountNumber} />
      <InfoRow icon={Gauge} label="Meter Type Requested" value={data.meterRecommended} />
      <InfoRow icon={Zap} label="Meter Number" value={data.meterNo || data.meterNumber} />
      <InfoRow icon={ShieldCheck} label="Seal Number" value={data.sealNo} />
      <InfoRow icon={Wallet} label="Amount" value={data.amount != null ? formatCurrencyNGN(data.amount) : null} />
      <InfoRow
        icon={CheckCircle}
        label="Payment Reference / RRR"
        value={data.rrr || data.paymentReference || data.paymentRef || data.remitaRef}
      />
      <InfoRow
        icon={User}
        label="Submitted"
        value={formatDateTime(data.dateRequested || data.submittedAt)}
      />
    </div>
  );
}

export default RequestInfoPanel;