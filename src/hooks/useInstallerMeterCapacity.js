// src/hooks/useInstallerMeterCapacity.js
// Loads what computeMeterCapacity needs for one installer within one disco,
// straight from the API (never from client-side state):
//   - open jobs:   GET /installations?installerId&discoCode&status=ASSIGNED
//                  and status=IN_PROGRESS (all documented filters)
//   - held meters: GET /assignments?assignmentType=METER&installerId&discoCode,
//                  then GET /assignments/{id} for each batch that still has
//                  meters out (ACTIVE / PARTIALLY_RETURNED — a CLOSED batch has
//                  nothing left out, per the spec), keeping ASSIGNED items.
import { useState, useEffect, useCallback } from 'react';
import jedApi from '../components/services/api';
import { fetchAllPages } from '../utils/fetchAllPages';
import { getErrorMessage } from '../utils/errorMessage';
import { computeMeterCapacity } from '../utils/meterCapacity';
import { INSTALLATION_STATUS } from '../utils/installationStatus';
import { normalizeStatus } from '../utils/statusBadge';

const OPEN_BATCH_STATUSES = new Set(['ACTIVE', 'PARTIALLY_RETURNED']);

/** One fresh read of the installer's capacity (also used to re-check at submit time). */
export async function loadInstallerMeterCapacity({ installerId, discoCode }) {
  const scope = { installerId, discoCode };
  const [assignedJobs, inProgressJobs, batches] = await Promise.all([
    fetchAllPages((p) => jedApi.getInstallations(p), { ...scope, status: INSTALLATION_STATUS.ASSIGNED }),
    fetchAllPages((p) => jedApi.getInstallations(p), { ...scope, status: INSTALLATION_STATUS.IN_PROGRESS }),
    fetchAllPages((p) => jedApi.getAssignmentBatches(p), { ...scope, assignmentType: 'METER' }),
  ]);

  const openBatches = batches.filter((b) => OPEN_BATCH_STATUSES.has(normalizeStatus(b.status)));
  const details = await Promise.all(openBatches.map((b) => jedApi.getAssignmentBatch(b.id)));
  const heldMeters = details.flatMap((d) => {
    const batch = d?.data || d;
    return Array.isArray(batch?.items) ? batch.items : [];
  });

  return computeMeterCapacity({ openJobs: [...assignedJobs, ...inProgressJobs], heldMeters });
}

export function useInstallerMeterCapacity({ installerId, discoCode, refreshKey = 0 }) {
  const [capacity, setCapacity] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    jedApi.clearCache();
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!installerId || !discoCode) {
      setCapacity(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setCapacity(null);
      try {
        const result = await loadInstallerMeterCapacity({ installerId, discoCode });
        if (!cancelled) setCapacity(result);
      } catch (err) {
        console.error('[useInstallerMeterCapacity] Load failed:', err);
        if (!cancelled) setError(getErrorMessage(err, "Couldn't load this installer's jobs and meters."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [installerId, discoCode, refreshKey, reloadKey]);

  return { capacity, loading, error, reload };
}

export default useInstallerMeterCapacity;
