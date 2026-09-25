// src/hooks/useMeterDispatch.js
// The single implementation of "dispatch these meter serials to this
// installer". Both places that can start a dispatch use it:
//
//   - Assignments → Dispatch meters (many serials, picked from inventory)
//   - Meter Schedule → Assign        (one or more selected meters)
//
// There is deliberately no second copy of this logic. Everything that decides
// whether a dispatch is legal lives here:
//   - the account must hold ASSIGNMENTS.MANAGE (a Supervisor reads the same
//     figures and cannot dispatch);
//   - capacity is read live from the API (useInstallerMeterCapacity), never
//     from component state;
//   - evaluateMeterDispatch applies the per-meter-type cap (pending jobs of
//     that phase − meters of that phase already held) and produces the
//     operator-facing message;
//   - the check is re-run against a FRESH read immediately before submitting,
//     so a job or meter that changed in the meantime cannot let an
//     over-dispatch through;
//   - while the cap applies it fails closed: no verified capacity, no dispatch.
//
// ROLES. The cap is an ADMIN rule. A Super Admin assigns installations and
// meters independently, so `permissions.enforcesMeterCapacity` is false for it
// and no capacity gate is applied — the meter's own integrity rules (exists,
// AVAILABLE, not already assigned/used/lost, real installer) still are, both
// here via the inventory helpers and server-side.
//
// This is still a client-side cap — POST /assignments/meters does not enforce
// it (API_GAP_REPORT.md, gaps D, O and AC). The backend remains authoritative
// for authorization and for per-serial rejection.
import { useState, useCallback, useMemo } from 'react';
import jedApi from '../components/services/api';
import { useInstallerMeterCapacity, loadInstallerMeterCapacity } from './useInstallerMeterCapacity';
import { evaluateMeterDispatch } from '../utils/meterCapacity';
import { getErrorMessage } from '../utils/errorMessage';
// The capacity cap is an Admin rule, not a Super Admin one, and dispatching
// at all needs ASSIGNMENTS.MANAGE. Both come from the one permission model so
// this hook, its two call sites and the route guards can't disagree.
import { usePermissions } from '../components/auth/usePermissions';

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
  // enforce === false only for a Super Admin, who may hand an installer
  // meters before (or without) any installation being assigned. Every other
  // role is capped per meter type. canManageAssignments is the separate
  // question of whether this account may dispatch at all — a Supervisor can
  // read these figures and cannot act on them.
  const { enforcesMeterCapacity: enforce, canManageAssignments } = usePermissions();
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
    () => (capacity ? evaluateMeterDispatch(capacity, serials, { phaseBySerial, enforce }) : null),
    [capacity, serials, phaseBySerial, enforce]
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
    // Authorization first: no permission, no dispatch, whatever the figures say.
    if (!canManageAssignments) return 'You do not have permission to dispatch meters.';
    if (!discoCode) return 'Select a disco.';
    if (!installerId) return 'Select the installer receiving these meters.';
    if (serials.length === 0) return 'Select at least one meter.';
    if (capacityLoading) return 'Still checking meter needs. Try again in a moment.';
    // Fails closed while the cap applies — an unverifiable capacity must not
    // become an unlimited one. A Super Admin isn't capped, so a failed read is
    // only a missing read-out for them, not a reason to refuse the dispatch.
    if (enforce && (capacityError || !capacity)) return "Couldn't check meter needs. Please retry.";
    // "Nothing new to send" before "not allowed": when the cap doesn't apply,
    // a selection of serials the installer already holds is the only way
    // `allowed` is false, and it carries no message of its own.
    if (check && check.requested === 0) return 'These meters are already with this installer.';
    if (check && !check.allowed) return check.message;
    return null;
  }, [canManageAssignments, discoCode, installerId, serials.length, capacityLoading, capacityError, capacity, check, enforce]);

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
      // Re-check against a FRESH read, not the figures loaded when the
      // installer was picked — this is what stops two admins dispatching
      // past the same remaining capacity at the same time. It is still a
      // read-then-write, so it narrows the window rather than closing it;
      // only the backend can close it (API_GAP_REPORT.md, gap AC).
      jedApi.clearCache();
      let fresh = null;
      try {
        fresh = await loadInstallerMeterCapacity({ installerId, discoCode });
      } catch (capacityErr) {
        // Capped roles fail closed; an uncapped one loses only the read-out.
        if (enforce) throw capacityErr;
        console.warn('[useMeterDispatch] Capacity re-read failed; not capped for this role.', capacityErr);
      }
      const recheck = fresh
        ? evaluateMeterDispatch(fresh, serials, { phaseBySerial, enforce })
        : { allowed: true, requested: serials.length, alreadyHeld: [], message: null };
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
  }, [blockingReason, submitting, installerId, discoCode, serials, phaseBySerial, enforce]);

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
    // Surfaced so the form can label and disable itself the same way the
    // check behaves, instead of re-deriving the role.
    enforce,
    canDispatch: canManageAssignments,
  };
}

export default useMeterDispatch;
