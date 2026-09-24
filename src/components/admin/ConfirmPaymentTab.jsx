import { useState } from 'react';
import jedApi from '../services/api';
import ConfirmationModal from '../common/ConfirmationModal';
import { CheckCircle, AlertCircle, Loader2, Search, ArrowDownToLine } from 'lucide-react';
import { formatDateTime } from '../../utils/date';
import { getErrorMessage } from '../../utils/errorMessage';

// Same defensive field-name handling used elsewhere for unconfirmed
// response shapes — tries the most plausible variants for an account
// number that might come back on a Remita status lookup.
const extractAccountNumber = (data) =>
  data?.accountNumber || data?.account_number ||
  data?.data?.accountNumber || data?.data?.account_number ||
  null;

function ConfirmPaymentTab() {
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // RRR lookup — GET /external/jed/status/rrr/{rrr}, the exact endpoint
  // confirmed working via curl. Lets an admin check a transaction's real
  // Remita status before confirming, and reuse it across subsequent
  // queries/RRRs without leaving this tab.
  const [rrrQuery, setRrrQuery] = useState('');
  const [rrrResult, setRrrResult] = useState(null);
  const [rrrLoading, setRrrLoading] = useState(false);
  const [rrrError, setRrrError] = useState(null);

  const handleCheckRRR = async () => {
    if (!rrrQuery.trim()) return;
    setRrrLoading(true);
    setRrrError(null);
    setRrrResult(null);
    try {
      const response = await jedApi.checkRemitaStatusByRRR(rrrQuery.trim());
      setRrrResult(response?.data || response);
    } catch (err) {
      console.error('[ConfirmPayment] RRR status check failed:', err);
      setRrrError(getErrorMessage(err, 'RRR status check failed'));
    } finally {
      setRrrLoading(false);
    }
  };

  const handleUseAccountFromRRR = () => {
    const found = extractAccountNumber(rrrResult);
    if (found) {
      setAccountNumber(String(found));
      setError(null);
    }
  };

  // Account numbers are numeric-only (business rule).
  const accountValid = /^\d+$/.test(accountNumber.trim());

  const handleConfirm = async () => {
    // Re-entry guard: confirming a payment is money-adjacent, and the modal
    // closes the moment this starts — without this a second click on
    // "Confirm Payment" while the request is in flight sent a duplicate.
    if (confirming || !accountValid) return;

    // Close immediately on click rather than waiting for the request to
    // finish — the page shows loading/success/error state directly
    // instead of it being hidden behind the modal. This also fixes a
    // real bug: previously the modal only closed on the success path, so
    // any failed confirmation left it stuck open with the error banner
    // invisible underneath it.
    setConfirmOpen(false);
    setConfirming(true);
    setError(null);
    setResult(null);
    setSuccessMessage(null);

    try {
      // RRR carried into the confirm payload when the admin has looked
      // one up in this session — omitted entirely (not sent as an empty
      // string) when not provided, so the existing accountNumber-only
      // flow behaves exactly as before.
      const payload = { accountNumber: accountNumber.trim() };
      if (rrrQuery.trim()) {
        payload.rrr = rrrQuery.trim();
      }

      const response = await jedApi.confirmPayment(payload);
      const payload_ = response?.data || response;
      setResult(payload_);
      setSuccessMessage('Payment confirmed successfully.');
    } catch (err) {
      console.error('[ConfirmPayment] Failed to confirm payment:', err);
      setError(getErrorMessage(err, 'Failed to confirm payment'));
    } finally {
      setConfirming(false);
    }
  };

  const foundAccount = extractAccountNumber(rrrResult);

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Confirm Payment</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Confirm a customer's payment with JED after they've completed payment via Remita.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Account Number</label>
            <input
              type="text"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="Enter account number"
              inputMode="numeric"
              aria-invalid={accountNumber.trim() !== '' && !accountValid}
              className="form-input w-full px-4 py-2"
            />
            {accountNumber.trim() !== '' && !accountValid && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">
                Account numbers contain digits only.
              </p>
            )}
          </div>

          <div className="flex items-end gap-3">
            <button
              type="button"
              disabled={!accountValid || confirming}
              onClick={() => setConfirmOpen(true)}
              className="w-full sm:w-auto px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-amber-400 disabled:cursor-not-allowed text-sm font-medium"
            >
              Confirm Payment
            </button>
          </div>
        </div>

        {rrrQuery.trim() && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            RRR <span className="font-mono">{rrrQuery.trim()}</span> will be included with this confirmation.
          </p>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
            <AlertCircle className="w-4 h-4 inline-block mr-2 align-text-top" />
            {error}
          </div>
        )}

        {successMessage && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-800 dark:text-green-300 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            {successMessage}
          </div>
        )}

        {result && (
          <div className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-sm">
            <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">JED Confirm Payment Response</p>
            <pre className="whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300 max-h-72 overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
            {result?.data?.pendingInstallation && (
              <div className="mt-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-xs uppercase text-gray-500 dark:text-gray-400 mb-2">Installation details</p>
                <p className="text-sm text-gray-900 dark:text-gray-100">Applicant Name: {result.data.pendingInstallation?.applicantName || 'N/A'}</p>
                <p className="text-sm text-gray-900 dark:text-gray-100">Address: {result.data.pendingInstallation?.address || result.data.pendingInstallation?.address || 'N/A'}</p>
                <p className="text-sm text-gray-900 dark:text-gray-100">Status: {result.data.status || 'N/A'}</p>
                <p className="text-sm text-gray-900 dark:text-gray-100">Confirmed At: {formatDateTime(result.data?.confirmedAt || result.data?.data?.updatedAt || new Date())}</p>
              </div>
            )}
          </div>
        )}

        {/* RRR lookup — optional, feeds account number + rrr back into
            the confirm flow above. Uses the exact endpoint confirmed
            working via curl: GET /external/jed/status/rrr/{rrr}. */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Look up by RRR (optional)
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={rrrQuery}
                  onChange={(e) => { setRrrQuery(e.target.value); setRrrResult(null); setRrrError(null); }}
                  placeholder="e.g., 120799142825"
                  className="form-input w-full pl-9 pr-3 py-2 text-sm font-mono"
                />
              </div>
              <button
                type="button"
                onClick={handleCheckRRR}
                disabled={rrrLoading || !rrrQuery.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 disabled:bg-brand-400 disabled:cursor-not-allowed text-sm font-medium shrink-0"
              >
                {rrrLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span className="hidden sm:inline">Check Status</span>
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Checks the transaction's real-time status directly with Remita before you confirm.
            </p>
          </div>

          {rrrError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
              {rrrError}
            </div>
          )}

          {rrrResult && (
            <div className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Remita Status</p>
                {foundAccount && (
                  <button
                    type="button"
                    onClick={handleUseAccountFromRRR}
                    className="flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300"
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5" />
                    Use account {foundAccount}
                  </button>
                )}
              </div>
              <pre className="text-xs text-gray-700 dark:text-gray-300 overflow-auto max-h-48">
                {JSON.stringify(rrrResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        loading={confirming}
        confirmText="Confirm"
        title="Confirm Payment with JED"
        message={
          rrrQuery.trim()
            ? `Confirm payment for account number "${accountNumber.trim()}" (RRR: ${rrrQuery.trim()})? This will notify JED that the customer has paid via Remita.`
            : `Confirm payment for account number "${accountNumber.trim()}"? This will notify JED that the customer has paid via Remita.`
        }
      />
    </div>
  );
}

export default ConfirmPaymentTab;