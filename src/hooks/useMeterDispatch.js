// src/hooks/useMeterDispatch.js
// The single implementation of "dispatch these meter serials to this
// installer". Both places that can start a dispatch use it:
//
//   - Assignments → Dispatch meters (many serials, picked from inventory)
//   - Meter Schedule → Assign        (one or more selected meters)
//
// There is deliberately no second copy of this logic. Everything that decides
// whether a dispatch is legal lives here:
//   - capacity is read live from the API (useInstallerMeterCapacity), never
//     from component state;
//   - evaluateMeterDispatch applies the per-meter-type cap (pending jobs of
//     that phase − meters of that phase already held) and produces the
//     operator-facing message;
//   - the check is re-run against a FRESH read immediately before submitting,
//     so a job or meter that changed in the meantime cannot let an
//     over-dispatch through;
//   - it fails closed: no verified capacity means no dispatch.
//
// This is still a client-side cap — POST /assignments/meters does not enforce
// it (API_GAP_REPORT.md, gaps D and O). The backend remains authoritative for
// authorization and for per-serial rejection.
import { useState, useCallback, useMemo } from 'react';
import jedApi from '../components/services/api';
import { useInstallerMeterCapacity, loadInstallerMeterCapacity } from './useInstallerMeterCapacity';
import { evaluateMeterDispatch } from '../utils/meterCapacity';
import { getErrorMessage } from '../utils/errorMessage';

/** Serials the API named in `rejected`, as a Set of strings. */
export function rejectedSerialsOf(data) {
  const rejected = Array.isArray(data?.rejected) ? data.rejected : [];
  return new Set(
    rejected
      .map((r) => String(typeof r === 'string' ? r : r?.meterNumber ?? r?.key ?? '').trim())
      .filter(Boolean)
  );
}

/**
 * @param {object} input
 * @param {string} input.discoCode
 * @param {string} input.installerId
 * @param {string[]} input.serials - de-duplicated serials to dispatch
 * @param {Map<string,string>|Record<string,string>} [input.phaseBySerial] - serial → phase type
 * @param {boolean} [input.enabled] - false pauses the capacity read (e.g. modal closed)
 */
export function useMeterDispatch({ discoCode, installerId, serials = [], phaseBySerial, enabled = true }) {
  const [capacityRefresh, setCapacityRefresh] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const {
    capacity, loading: capacityLoading, error: capacityError, reload: reloadCapacity,
  } = useInstallerMeterCapacity({
    installerId: enabled ? installerId : '',
    discoCode: enabled ? discoCode : '',
    refreshKey: capacityRefresh,
  });

  const check = useMemo(
    () => (capacity ? evaluateMeterDispatch(capacity, serials, { phaseBySerial }) : null),
    [capacity, serials, phaseBySerial]
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  /**
   * Why the dispatch can't go ahead right now, or null. Same order of checks
   * the submit uses, so the button's inline error and the submit agree.
   */
  const blockingReason = useCallback(() => {
    if (!discoCode) return 'Select a disco.';
    if (!installerId) return 'Select the installer receiving these meters.';
    if (serials.length === 0) return 'Select at least one meter.';
    if (capacityLoading) return 'Still checking meter needs. Try again in a moment.';
    if (capacityError || !capacity) return "Couldn't check meter needs. Please retry.";
    if (!check.allowed) return check.message;
    if (check.requested === 0) return 'These meters are already with this installer.';
    return null;
  }, [discoCode, installerId, serials.length, capacityLoading, capacityError, capacity, check]);

  /**
   * Dispatch. Returns { ok, reason?, data?, accepted?, rejected? } and never
   * throws — the caller renders `reason` on the serial field and `data`
   * through BatchResultSummary.
   * @param {{ note?: string, dispatchRef?: string }} [extras]
   */
  const submit = useCallback(async (extras = {}) => {
    const reason = blockingReason();
    if (reason) return { ok: false, reason };
    if (submitting) return { ok: false, reason: null };

    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      // Re-check against a fresh read, not the figures loaded when the
      // installer was picked.
      jedApi.clearCache();
      const fresh = await loadInstallerMeterCapacity({ installerId, discoCode });
      const recheck = evaluateMeterDispatch(fresh, serials, { phaseBySerial });
      if (!recheck.allowed || recheck.requested === 0) {
        setCapacityRefresh((k) => k + 1);
        return {
          ok: false,
          reason: recheck.message || 'These meters are already with this installer.',
        };
      }

      // Serials already with this installer are left out — re-sending them
      // would only come back as per-row rejections.
      const held = new Set(recheck.alreadyHeld);
      const meterNumbers = serials.filter((s) => !held.has(s));
      const payload = { discoCode, installerId, meterNumbers };
      if (extras.note?.trim()) payload.note = extras.note.trim();
      if (extras.dispatchRef?.trim()) payload.dispatchRef = extras.dispatchRef.trim();

      const response = await jedApi.assignMeters(payload);
      const data = response?.data || response;
      setResult(data);
      const rejected = rejectedSerialsOf(data);
      setCapacityRefresh((k) => k + 1);
      return {
        ok: true,
        data,
        accepted: meterNumbers.filter((s) => !rejected.has(s)),
        rejected,
      };
    } catch (err) {
      console.error('[useMeterDispatch] Dispatch failed:', err);
      const message = getErrorMessage(err, "Couldn't dispatch these meters. Please try again.");
      setError(message);
      return { ok: false, reason: null, error: message };
    } finally {
      setSubmitting(false);
    }
  }, [blockingReason, submitting, installerId, discoCode, serials, phaseBySerial]);

  return {
    capacity,
    capacityLoading,
    capacityError,
    reloadCapacity,
    check,
    blockingReason,
    submit,
    submitting,
    result,
    error,
    reset,
  };
}

export default useMeterDispatch;
