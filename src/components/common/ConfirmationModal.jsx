import { useEffect, useRef } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, loading, confirmText = 'Confirm' }) => {
  const cancelRef = useRef(null);

  // Accessibility: Escape cancels (never while the action is in flight), and
  // focus starts on Cancel — the safe choice for a destructive/confirming
  // dialog — instead of staying on the page behind the overlay.
  useEffect(() => {
    if (!isOpen) return undefined;
    cancelRef.current?.focus();
    const onKeyDown = (e) => { if (e.key === 'Escape' && !loading) onClose?.(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, loading]);

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
