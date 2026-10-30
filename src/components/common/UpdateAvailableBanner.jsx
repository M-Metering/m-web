// src/components/common/UpdateAvailableBanner.jsx
// "A new version is ready" for the installed PWA and open tabs alike. The
// user reloads when it suits them; see hooks/useServiceWorkerUpdate.js.
import { RefreshCw, X } from 'lucide-react';
import { useServiceWorkerUpdate } from '../../hooks/useServiceWorkerUpdate';

function UpdateAvailableBanner() {
  const { needRefresh, reload, dismiss } = useServiceWorkerUpdate();
  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md flex items-center gap-3 rounded-lg border border-brand-200 dark:border-brand-800 bg-white dark:bg-gray-800 px-4 py-3 shadow-lg"
    >
      <RefreshCw className="w-4 h-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
      <p className="flex-1 text-sm text-gray-800 dark:text-gray-100">A new version of the app is ready.</p>
      <button
        type="button"
        onClick={reload}
        className="px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss update notice"
        className="p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default UpdateAvailableBanner;
