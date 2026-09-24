// src/components/common/StatusBadge.jsx
// Shared payment/installation status pill, replacing the ~6 near-identical
// `<span className={getStatusBadgeClass(status)}>{label}</span>` copies
// that used to live in AdminDashboard, AdminInstallations,
// InstallerDashboard, InstallationDetail, and PaymentsPage.
//
// Adds a small live indicator dot per the real JedCustomerRequest.status
// enum (INITIATED / PAID / COMPLETED — see PROJECT_CONTEXT.md, no
// invented intermediate states): INITIATED and PAID are still-open,
// awaiting-action states and get a subtle pulse; COMPLETED is terminal
// and gets a plain static dot. Any other/unrecognized status gets no dot
// at all rather than guessing what it means. The dot is decorative only —
// the visible status text is always present and is what screen readers
// announce.
import { normalizeStatus, getStatusBadgeClass } from '../../utils/statusBadge';
import LiveStatusDot from './LiveStatusDot';

const DOT_STYLES = {
  INITIATED: { color: 'bg-slate-400', pulse: true },
  PAID: { color: 'bg-amber-500', pulse: true },
  COMPLETED: { color: 'bg-green-500', pulse: false },
};

/**
 * @param {Object} props
 * @param {string} props.status - real backend status (INITIATED/PAID/COMPLETED, etc.)
 * @param {string} [props.label] - display text; defaults to `status` if omitted
 * @param {boolean} [props.live] - set false to suppress the dot even for a live-eligible status
 * @param {string} [props.className] - extra classes merged onto the pill
 */
function StatusBadge({ status, label, live = true, className = '' }) {
  const dotConfig = DOT_STYLES[normalizeStatus(status)];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${getStatusBadgeClass(status)} ${className}`}
    >
      {live && dotConfig && <LiveStatusDot pulse={dotConfig.pulse} colorClass={dotConfig.color} />}
      {label || status}
    </span>
  );
}

export default StatusBadge;
