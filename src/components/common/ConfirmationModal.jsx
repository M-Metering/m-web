import { useEffect, useRef } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

// `children` (optional) renders under the message — e.g. a reason field. Existing
// callers pass none and are unchanged.
const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, loading, confirmText = 'Confirm', children }) => {
  const cancelRef = useRef(null);
  // The latest onClose/loading, read by the Escape handler without being an
  // effect dependency (callers pass a new onClose on every render).
  const latest = useRef({ onClose, loading });
  useEffect(() => { latest.current = { onClose, loading }; });

  // Accessibility: focus starts on Cancel — the safe choice for a destructive
  // dialog — ONCE, when the dialog opens. It must not depend on onClose: a
  // caller's inline onClose is new on every render, so typing in a field inside
  // the dialog (e.g. the unassign reason) re-ran this and pulled focus to
  // Cancel after each character, closing the phone keyboard.
  useEffect(() => {
    if (isOpen) cancelRef.current?.focus();
  }, [isOpen]);

  // Escape cancels (never while the action is in flight).
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape' && !latest.current.loading) latest.current.onClose?.(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-message"
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl max-w-md w-full overflow-hidden"
      >
        <div className="p-6">
          <div className="sm:flex sm:items-start">
            <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 sm:mx-0 sm:h-10 sm:w-10">
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" />
            </div>
            <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
              <h3 className="text-lg font-semibold leading-6 text-gray-900 dark:text-white" id="modal-title">
                {title}
              </h3>
              {/* whitespace-pre-line lets a caller separate paragraphs with
                  blank lines (e.g. "what will be deleted" then "what will be
                  left alone"); single-line messages are unaffected. The cap
                  keeps a long list from pushing the buttons off a phone. */}
              <div className="mt-2 max-h-[40vh] overflow-y-auto">
                <p id="modal-message" className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line break-words">
                  {message}
                </p>
              </div>
              {children && <div className="mt-3 text-left">{children}</div>}
            </div>
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-3 sm:px-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-full sm:w-auto justify-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="w-full sm:w-auto justify-center inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
