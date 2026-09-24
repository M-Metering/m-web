// src/components/installations/InstallerSelect.jsx
// Installer picker for the dispatch screens. Loads real INSTALLER accounts via
// GET /users?role=INSTALLER (server-side role filter, so no other role's
// records ever reach the browser) and yields the user's UUID.
//
// The id is a UUID as of the 2026-09-21 migration — it is passed through as an
// opaque string and must never be coerced to a number.
import { useState, useEffect } from 'react';
import jedApi from '../services/api';
import { ROLES } from '../auth/permissions';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';

const displayName = (u) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.name || u.phone || u.email || u.id;

function InstallerSelect({ id = 'installer-select', value, onChange, disabled, error, required }) {
  const [installers, setInstallers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const list = await fetchAllPages((params) => jedApi.getUsers(params), { role: ROLES.INSTALLER });
        if (!cancelled) setInstallers(list);
      } catch (err) {
        console.error('[InstallerSelect] Failed to load installers:', err);
        if (!cancelled) setLoadError(getErrorMessage(err, 'Unable to load the installer list.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <select
        id={id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        aria-required={required ? 'true' : undefined}
        aria-invalid={!!error}
        className={`form-input w-full px-3 py-2.5 text-sm ${error ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''}`}
      >
        <option value="">{loading ? 'Loading installers…' : 'Select an installer…'}</option>
        {installers.map((u) => (
          <option key={u.id} value={u.id}>
            {displayName(u)}{u.phone ? ` — ${u.phone}` : ''}
          </option>
        ))}
      </select>
      {loadError && <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{loadError}</p>}
      {!loading && !loadError && installers.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
          No installer accounts exist yet — create one under Users first.
        </p>
      )}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  );
}

export default InstallerSelect;
