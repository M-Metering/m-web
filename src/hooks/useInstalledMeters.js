// src/hooks/useInstalledMeters.js
// The meters behind Meter Schedule's "Installed" card: GET /meters with the
// server-side filter status=INSTALLED, every page. The card's figure is
// /meters/statistics' `installed`, which counts the same population, so the
// modal lists the records the count is made of. Loaded only while the modal
// is open; re-read on the app's refreshSignal (e.g. after an unassign).
import { useState, useEffect, useCallback } from 'react';
import jedApi from '../components/services/api';
import { useDataRefresh } from '../components/contexts/DataRefreshContext';
import { fetchAllPagesDetailed } from '../utils/fetchAllPages';

const MAX_PAGES = 100;

/** @param {{ enabled?: boolean }} [options] - explicit opt-in */
export function useInstalledMeters({ enabled = false } = {}) {
  const on = enabled === true;
  const { refreshSignal } = useDataRefresh();
  const [data, setData] = useState(null); // { items, totalCount, truncated }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => { jedApi.clearCache(); setReloadKey((k) => k + 1); }, []);

  useEffect(() => {
    if (!on) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const result = await fetchAllPagesDetailed(
          (p) => jedApi.getMeters(p), { status: 'INSTALLED' }, { maxPages: MAX_PAGES, inferNextFromFullPage: true }
        );
        if (!cancelled) setData(result);
      } catch (err) {
        console.error('[useInstalledMeters] Load failed:', err);
        if (!cancelled) { setData(null); setError(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [on, reloadKey, refreshSignal]);

  return { meters: data, loading, error, reload };
}

export default useInstalledMeters;
