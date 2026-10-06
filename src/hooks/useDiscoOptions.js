// src/hooks/useDiscoOptions.js
// The ONE source of every disco picker. Imports, assignments, exports, meter
// prices and revenue are all scoped by discoCode.
//
// Per-disco access (2026-10-05): a scoped user (any role but SUPERADMIN) is
// offered exactly the discos on their own profile (`user.discos`, from login
// and GET /auth/profile) — never every disco from GET /discos. A SUPERADMIN is
// never profiled and gets GET /discos (active discos by default: an inactive
// disco should not be a target for a new import or dispatch). A user with no
// disco yet gets [] and `noAccess` — see utils/userDiscos.js.
//
// Access changes take effect server-side immediately; `reload()` re-reads the
// profile so the picker follows.
import { useState, useEffect, useCallback, useMemo } from 'react';
import jedApi from '../components/services/api';
import { useOptionalAuth } from '../components/contexts/AuthContext';
import { fetchAllPages } from '../utils/fetchAllPages';
import { getErrorMessage } from '../utils/errorMessage';
import { isDiscoScoped, hasNoDiscoAccess, discoOptionsForUser } from '../utils/userDiscos';

export function useDiscoOptions({ activeOnly = true } = {}) {
  const { user = null, refreshUser = null } = useOptionalAuth() || {};
  const scoped = isDiscoScoped(user);
  const [allDiscos, setAllDiscos] = useState([]);
  const [loading, setLoading] = useState(!scoped);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    jedApi.clearCache();
    if (scoped) refreshUser?.();
    setReloadKey((k) => k + 1);
  }, [scoped, refreshUser]);

  useEffect(() => {
    if (scoped) { setLoading(false); setError(null); return undefined; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await fetchAllPages(
          (params) => jedApi.getDiscos(params),
          activeOnly ? { isActive: true } : {}
        );
        if (!cancelled) setAllDiscos(list);
      } catch (err) {
        console.error('[useDiscoOptions] Failed to load discos:', err);
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load the disco list.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeOnly, reloadKey, scoped]);

  const discos = useMemo(() => discoOptionsForUser(user, allDiscos), [user, allDiscos]);

  return { discos, loading, error, reload, noAccess: hasNoDiscoAccess(user) };
}

export default useDiscoOptions;
