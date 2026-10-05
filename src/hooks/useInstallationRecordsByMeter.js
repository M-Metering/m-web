// src/hooks/useInstallationRecordsByMeter.js
// Meter Schedule → Installed: which installation each installed meter went
// into, so the drill-down can show the customer, installation and installer
// behind a meter.
//
// A meter record (GET /meters) carries no customer or installation fields,
// and no endpoint looks an installation up by meter number (gap AK), so the
// completed installations are read — ONLY completed statuses, by server-side
// filter: imported INSTALLED and EXPORTED, JED COMPLETED — and indexed by the
// meter number each one reports (utils/completedInstallationsReport.js).
// Loaded only while the Installed view is open; jedApi's 30-second cache and
// the app's refreshSignal govern freshness. `complete: false` means a read
// hit its cap, so "no installation record" can't be claimed for a meter.
import { useState, useEffect, useCallback } from 'react';
import jedApi from '../components/services/api';
import { useDataRefresh } from '../components/contexts/DataRefreshContext';
import { fetchAllPagesDetailed } from '../utils/fetchAllPages';
import { getErrorMessage } from '../utils/errorMessage';
import { normalizeMultiRow, normalizeJedRow, JED_BUCKET } from '../utils/installationScope';
import { COMPLETED_INSTALLATION_STATUSES } from '../utils/installationTotals';
import { indexInstallationsByMeter } from '../utils/completedInstallationsReport';
import { isPermissionError } from '../utils/apiResult';

const MAX_PAGES = 100;

// `jedForbidden`: the role can't read JED's Remita requests (a Supervisor may
// get 403 on /external/jed/*). That source is left out and said so — never a
// load failure, which used to empty the whole Installed view for that role.
export async function loadInstallationRecordsByMeter() {
  let jedForbidden = false;
  const [imported, jed] = await Promise.all([
    Promise.all(COMPLETED_INSTALLATION_STATUSES.imported.map((status) =>
      fetchAllPagesDetailed((p) => jedApi.getInstallations(p), { status }, { maxPages: MAX_PAGES }))),
    Promise.all(COMPLETED_INSTALLATION_STATUSES.jed.map((status) =>
      fetchAllPagesDetailed((p) => jedApi.getAllCustomerRequests(p), { status }, { maxPages: MAX_PAGES })))
      .catch((err) => {
        if (!isPermissionError(err)) throw err;
        jedForbidden = true;
        return [];
      }),
  ]);
  const rows = [
    ...imported.flatMap((r) => r.items.map(normalizeMultiRow)),
    ...jed.flatMap((r) => r.items.map((x) => normalizeJedRow(x, JED_BUCKET))),
  ];
  const { index, conflicts } = indexInstallationsByMeter(rows);
  return { index, conflicts, complete: ![...imported, ...jed].some((r) => r.truncated), jedForbidden };
}

/** @param {{ enabled?: boolean }} [options] - explicit opt-in */
export function useInstallationRecordsByMeter({ enabled = false } = {}) {
  const on = enabled === true;
  const { refreshSignal } = useDataRefresh();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => { jedApi.clearCache(); setReloadKey((k) => k + 1); }, []);

  useEffect(() => {
    if (!on) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadInstallationRecordsByMeter();
        if (!cancelled) setData(result);
      } catch (err) {
        console.error('[InstallationRecordsByMeter] Load failed:', err);
        if (!cancelled) { setData(null); setError(getErrorMessage(err, "Couldn't load the installation records.")); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [on, reloadKey, refreshSignal]);

  return { records: data, loading, error, reload };
}

export default useInstallationRecordsByMeter;
