import { useEffect, useRef } from 'react';
import { Info } from 'lucide-react';

const InfoModal = ({ isOpen, onClose, title, children }) => {
  const okRef = useRef(null);

  // Accessibility: Escape closes, and focus moves into the dialog on open
  // (previously keyboard users stayed on the page behind the overlay).
  useEffect(() => {
    if (!isOpen) return undefined;
    okRef.current?.focus();
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="sm:flex sm:items-start">
            <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-brand-100 dark:bg-brand-900/30 sm:mx-0 sm:h-10 sm:w-10">
              <Info className="h-6 w-6 text-brand-600 dark:text-brand-400" aria-hidden="true" />
            </div>
            <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left min-w-0 flex-1">
              <h3 className="text-lg font-semibold leading-6 text-gray-900 dark:text-white" id="modal-title">
                {title}
              </h3>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {children}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-3 sm:px-6 flex justify-end">
          <button
            ref={okRef}
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto justify-center px-6 py-2 bg-brand-500 text-gray-900 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default InfoModal;
