// src/components/common/NoDiscoAccessNotice.jsx
// Shown on every page to a non-SUPERADMIN whose profile carries no disco yet
// (Per-Disco Access, 2026-10-05): the API then returns empty lists and 403s
// every action, which would otherwise look like "there is no data". Access is
// read server-side on every request, so "Check again" just re-reads
// GET /auth/profile — no sign-out needed once a Super Admin grants a disco.
import { useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasNoDiscoAccess, NO_DISCO_ACCESS_MESSAGE } from '../../utils/userDiscos';

export default function NoDiscoAccessNotice() {
  const { user, refreshUser } = useAuth();
  const [checking, setChecking] = useState(false);
  if (!hasNoDiscoAccess(user)) return null;

  const check = async () => {
    setChecking(true);
    try { await refreshUser(); } finally { setChecking(false); }
  };

  return (
    <div role="alert" className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">You don&apos;t have access to any disco yet.</p>
        <p className="text-sm text-amber-800 dark:text-amber-300">{NO_DISCO_ACCESS_MESSAGE}</p>
      </div>
      <button type="button" onClick={check} disabled={checking}
        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-gray-700 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-gray-600 disabled:opacity-60">
        <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} /> Check again
      </button>
    </div>
  );
}
