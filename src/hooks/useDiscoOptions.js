// src/hooks/useDiscoOptions.js
// Shared loader for the disco list (GET /discos). Every admin screen in the
// multi-disco flow needs it — imports, assignments and exports are all scoped
// by discoCode — so the fetch lives here rather than being repeated.
//
// Returns active discos only by default: an inactive disco should not be a
// target for a new import or dispatch.
import { useState, useEffect, useCallback } from 'react';
import jedApi from '../components/services/api';
import { fetchAllPages } from '../utils/fetchAllPages';
import { getErrorMessage } from '../utils/errorMessage';

export function useDiscoOptions({ activeOnly = true } = {}) {
  const [discos, setDiscos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    jedApi.clearCache();
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await fetchAllPages(
          (params) => jedApi.getDiscos(params),
          activeOnly ? { isActive: true } : {}
        );
        if (!cancelled) setDiscos(list);
      } catch (err) {
        console.error('[useDiscoOptions] Failed to load discos:', err);
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load the disco list.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeOnly, reloadKey]);

  return { discos, loading, error, reload };
}

export default useDiscoOptions;
