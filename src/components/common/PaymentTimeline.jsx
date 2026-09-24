// src/components/common/PaymentTimeline.jsx
// Chronological view of a customer request's payment lifecycle, built
// strictly from the timestamp fields the real API actually returns
// (dateRequested / datePaid / dateCompleted on JedCustomerRequest, per
// GET /external/jed/requests/{accountNumber} and
// GET /webhooks/verify-payment/{rrr}). Deliberately does NOT invent
// intermediate events like "Customer Viewed Payment" or "Webhook
// Received" — the backend has no event log to source those from, so
// fabricating them would show timestamps/state that never happened.
// Any event whose timestamp is missing from the response is simply
// omitted rather than rendered with a guessed date.
import { FileText, Wallet, Wrench } from 'lucide-react';
import { formatDateTime } from '../../utils/date';
import { isCompletedStatus } from '../../utils/statusBadge';
import LiveStatusDot from './LiveStatusDot';

// `dotColor` is only set for non-terminal steps — it drives the small live
// pulse next to whichever step is currently the *last* one on the
// timeline (see isCurrent below). The terminal step (dateCompleted) has
// no dotColor, so it never pulses regardless of position.
const STEPS = [
  {
    key: 'dateRequested',
    label: 'RRR Generated',
    description: 'Payment reference was generated for this request.',
    icon: FileText,
    color: 'text-brand-600 dark:text-brand-400 bg-brand-100 dark:bg-brand-900/30',
    dotColor: 'bg-slate-400',
  },
  {
    key: 'datePaid',
    label: 'Payment Received',
    description: 'Customer completed payment via Remita.',
    icon: Wallet,
    color: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30',
    dotColor: 'bg-amber-500',
  },
  {
    key: 'dateCompleted',
    label: 'Installation Completed',
    description: 'Meter installation was completed and confirmed.',
    icon: Wrench,
    color: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    dotColor: null,
  },
];

/**
 * @param {Object} props
 * @param {string|Date|number} [props.dateRequested]
 * @param {string|Date|number} [props.datePaid]
 * @param {string|Date|number} [props.dateCompleted]
 * @param {string} [props.status] - the record's actual current status
 *   (INITIATED/PAID/COMPLETED). Optional, but when provided it's the
 *   authoritative source for whether the timeline is "done" — a record
 *   can be genuinely COMPLETED with a missing/late-arriving
 *   `dateCompleted` field, and without this the last populated timestamp
 *   would otherwise still show a live pulse on a job that's actually finished.
 */
function PaymentTimeline({ dateRequested, datePaid, dateCompleted, status }) {
  const values = { dateRequested, datePaid, dateCompleted };
  const events = STEPS.filter((step) => values[step.key]);

  if (events.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No timeline data available yet.
      </p>
    );
  }

  const isTerminal = status ? isCompletedStatus(status) : events.some((e) => e.key === 'dateCompleted');

  return (
    <div className="space-y-0">
      {events.map((step, i) => {
        const Icon = step.icon;
        const isLast = i === events.length - 1;
        // The last-rendered step pulses only when the record is genuinely
        // still open (per the real `status`, not just "did this step's
        // date field happen to be missing") — a completed record never
        // pulses, an in-progress one pulses on wherever it currently sits.
        const isCurrent = isLast && !isTerminal && !!step.dotColor;
        return (
          <div key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${step.color}`}>
                <Icon className="w-4 h-4" />
              </div>
              {!isLast && <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 my-1" />}
            </div>
            <div className={isLast ? 'pb-0' : 'pb-5'}>
              <p className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                {step.label}
                {isCurrent && <LiveStatusDot pulse colorClass={step.dotColor} />}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{step.description}</p>
              <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mt-1">
                {formatDateTime(values[step.key])}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default PaymentTimeline;
