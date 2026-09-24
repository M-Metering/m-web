// src/components/common/GenerateRRRModal.jsx
// Generate RRR wizard: Preview (review the payload built from an already-
// loaded customer request) -> Confirm (submit) -> Success. There's no
// separate "form" step because every field POST /external/jed/generate-ref
// needs is already on the loaded request — the preview step doubles as
// both review and confirmation of what will be sent.
//
// Used by InstallationDetail.jsx to generate an RRR for the installation
// currently being viewed (a standalone duplicate in PaymentsPage was
// removed — RRR generation is always in the context of a specific job).
import { CheckCircle, AlertCircle, Loader2, X, Receipt, Info } from 'lucide-react';
import { formatCurrencyNGN } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';
import { REQUIRED_RRR_FIELDS } from '../../utils/rrrPayload';

function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 gap-3">
      <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className={`text-sm font-medium text-gray-900 dark:text-white text-right truncate ${mono ? 'font-mono' : ''}`}>
        {value || '-'}
      </span>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {Object|null} props.payload - built via buildRrrPayload(job)
 * @param {boolean} props.loading
 * @param {string|null} props.error
 * @param {Object|null} props.result - the generate-ref response data once submitted
 * @param {Date|null} props.generatedAt - client-side timestamp captured on success
 * @param {() => void} props.onConfirm
 */
function GenerateRRRModal({ isOpen, onClose, payload, loading, error, result, generatedAt, onConfirm }) {
  if (!isOpen) return null;

  const missing = REQUIRED_RRR_FIELDS.filter((f) => !String(payload?.[f.key] || '').trim());
  const step = result ? 'success' : 'preview';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {step === 'success' ? 'RRR Generated' : 'Generate Payment Reference'}
          </h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {step === 'preview' && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Review the details that will be sent to Remita before generating a payment reference (RRR).
              </p>

              {missing.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex gap-2 text-sm text-amber-800 dark:text-amber-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Missing required field(s): {missing.map((f) => f.label).join(', ')}. Update the request record before generating a reference.</span>
                </div>
              )}

              <div className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
                {REQUIRED_RRR_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center justify-between px-4 py-2.5 gap-3">
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{f.label}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white text-right truncate">
                      {payload?.[f.key] || <span className="text-red-500">missing</span>}
                    </span>
                  </div>
                ))}
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300 flex gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900/50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={loading || missing.length > 0}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                  {loading ? 'Generating...' : 'Confirm & Generate RRR'}
                </button>
              </div>
            </>
          )}

          {step === 'success' && (
            <>
              <div className="flex flex-col items-center text-center gap-2 py-2">
                <CheckCircle className="w-10 h-10 text-green-600" />
                <p className="text-sm text-gray-600 dark:text-gray-400">Payment reference generated successfully.</p>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
                <Row label="RRR" value={result?.RRR || result?.rrr} mono />
                <Row label="Amount" value={formatCurrencyNGN(result?.amount)} />
                <Row label="Customer" value={payload?.custNames} />
                <Row label="Account Number" value={result?.accountNumber || payload?.accountNumber} mono />
                <Row label="Status" value={result?.status} />
                <Row label="Gateway" value={result?.gateway} />
                <Row label="Order ID" value={result?.orderId} mono />
                <Row label="Date Generated" value={formatDateTime(generatedAt)} />
              </div>

              <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg p-3 flex gap-2 text-sm text-brand-800 dark:text-brand-300">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Payment Instructions</p>
                  <p className="mt-0.5">Give the RRR above to the customer. They can pay at any bank branch, via USSD, or online through Remita using this reference.</p>
                  <p className="mt-1 text-xs text-brand-700/80 dark:text-brand-400/80">
                    The exact payment expiry isn't shown here — confirm the RRR's validity window with Remita if needed.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default GenerateRRRModal;
