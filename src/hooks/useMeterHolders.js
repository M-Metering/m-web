// src/hooks/useMeterHolders.js
// Which meters are out with an installer right now, and with whom — read
// from the server's dispatch batches, for every installer at once.
//
// WHY THIS EXISTS. POST /assignments/meters leaves `meters.status` at
// AVAILABLE by design ("Assignment does not change meters.status", per the
// spec), and GET /meters does not document `assignmentStatus` (gap G). So a
// meter list alone cannot say whether a meter is on the shelf or in an
// installer's van. The open METER batches can: their items carry
// `assignmentStatus`, and the batch names the installer. This is the same
// server record the per-installer capacity check has always used
// (useInstallerMeterCapacity), so the inventory, the picker and the capacity
// figures can't disagree about who holds a meter.
//
// Requests: GET /assignments?assignmentType=METER&status=ACTIVE and
// &status=PARTIALLY_RETURNED (server-side filters — closed batches are never
// read), then GET /assignments/{id} per open batch, at most 4 at a time.
// Nothing is cached beyond jedApi's own 30-second cache, and every mutation
// that can move a meter clears that cache.
//
// API_GAP_REPORT.md gap G asks for `assignmentStatus`/`assignedTo` on
// GET /meters, which would make this a single request.
import { useState, useEffect, useCallback } from 'react';
import jedApi from '../components/services/api';
import { useDataRefresh } from '../components/contexts/DataRefreshContext';
import { fetchAllPages } from '../utils/fetchAllPages';
import { mapWithConcurrency } from '../utils/concurrency';
import { indexMeterHolders } from '../utils/meterInventory';
import { getErrorMessage } from '../utils/errorMessage';

const OPEN_STATUSES = ['ACTIVE', 'PARTIALLY_RETURNED'];
const DETAIL_CONCURRENCY = 4;

/** One fresh read of the open-dispatch index. */
export async function loadMeterHolders() {
  const lists = await Promise.all(OPEN_STATUSES.map((status) => fetchAllPages(
    (p) => jedApi.getAssignmentBatches(p),
    { assignmentType: 'METER', status },
    { maxPages: 50 }
  )));
  const byId = new Map();
  // Re-checked here rather than trusting the filter: a closed batch has
  // nothing out, and reading its items would only cost a request.
  lists.flat().forEach((b) => {
    if (b?.id != null && (!b.status || OPEN_STATUSES.includes(String(b.status).toUpperCase()))) byId.set(b.id, b);
  });

  const details = await mapWithConcurrency(Array.from(byId.values()), DETAIL_CONCURRENCY, async (batch) => {
    const response = await jedApi.getAssignmentBatch(batch.id);
    const detail = response?.data || response || {};
    // The list row carries installer/disco; keep them if the detail omits them.
    return { ...batch, ...detail, items: Array.isArray(detail.items) ? detail.items : [] };
  });
  return indexMeterHolders(details);
}

/**
 * @param {{ enabled?: boolean }} [options] - false issues no request (e.g. a
 *   role without ASSIGNMENTS.VIEW, or a tab that isn't showing).
 * @returns {{ holders: Map<string, object>|null, loading: boolean,
 *   error: string|null, reload: () => void }}
 *   `holders` is null until the first successful read — "not known yet" is
 *   deliberately different from "nobody holds anything".
 */
export function useMeterHolders({ enabled: enabledFlag = false } = {}) {
  // Explicit opt-in: an undefined permission flag must not start the read.
  const enabled = enabledFlag === true;
  const { refreshSignal } = useDataRefresh();
  const [holders, setHolders] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    jedApi.clearCache();
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setHolders(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const index = await loadMeterHolders();
        if (!cancelled) setHolders(index);
      } catch (err) {
        console.error('[useMeterHolders] Load failed:', err);
        if (!cancelled) setError(getErrorMessage(err, "Couldn't check which meters are with installers."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, reloadKey, refreshSignal]);

  return { holders, loading, error, reload };
}

export default useMeterHolders;
