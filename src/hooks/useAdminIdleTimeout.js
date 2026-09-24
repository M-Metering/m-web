// src/hooks/useAdminIdleTimeout.js
// 3-minute inactivity logout for ADMIN/SUPERADMIN sessions only (not
// INSTALLER — see PROJECT_CONTEXT.md's role scope). No such timeout
// existed anywhere in this app before this hook — this is the single,
// consolidated implementation; do not add a second one elsewhere.
//
// The deadline is an absolute epoch-ms timestamp persisted via
// jedApi.setSessionDeadline()/getSessionDeadline() (localStorage, the same
// mechanism this app already uses for jedAuthToken/jedUser — see
// AuthContext.jsx) rather than a plain in-memory timer, so a page refresh
// resumes the same countdown instead of silently granting a fresh 3
// minutes. Activity handlers write to that persisted value directly, not
// to React state, so a mousemove flood never triggers a re-render — see
// the throttle below for why that still isn't enough on its own.
import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/contexts/AuthContext';
import jedApi from '../components/services/api';

const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const CHECK_INTERVAL_MS = 1000;
// Activity fires far more often than once a second (mousemove alone can
// fire hundreds of times/sec) — without this, every event would be a
// synchronous localStorage write.
const EXTEND_THROTTLE_MS = 1000;

// Mouse click, mouse movement, keyboard, touch, and scroll — the exact
// activity types this timeout is required to reset on.
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'wheel', 'scroll'];

/**
 * @param {boolean} isAdminTier - whether the current session is ADMIN or
 *   SUPERADMIN (computed by the caller via usePermissions(), so this hook
 *   doesn't duplicate that role check).
 */
export function useAdminIdleTimeout(isAdminTier) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const lastExtendRef = useRef(0);

  const extendDeadline = useCallback(() => {
    const now = Date.now();
    if (now - lastExtendRef.current < EXTEND_THROTTLE_MS) return;
    lastExtendRef.current = now;
    jedApi.setSessionDeadline(now + IDLE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    if (!isAdminTier) {
      // Not an active admin-tier session (installer, or logged out) —
      // nothing to track, and don't let a deadline from a previous admin
      // session in this browser linger.
      jedApi.clearSessionDeadline();
      return;
    }

    // Resume an already-persisted deadline (e.g. across a refresh) rather
    // than resetting it — only arm a fresh one if none exists yet.
    if (!jedApi.getSessionDeadline()) {
      jedApi.setSessionDeadline(Date.now() + IDLE_TIMEOUT_MS);
    }

    // Declared before first use (not `const`) so the immediate checkExpiry()
    // call below — which exists precisely to catch an already-expired
    // deadline from before this effect ran — can safely clear it.
    let intervalId = null;

    const handleTimeout = async () => {
      await logout();
      navigate('/login', { replace: true });
    };

    const checkExpiry = () => {
      const deadline = jedApi.getSessionDeadline();
      if (deadline && Date.now() >= deadline) {
        // Stop the interval the instant expiry is detected so a slow
        // logout() can't let this fire again before the effect re-runs.
        if (intervalId) clearInterval(intervalId);
        handleTimeout();
      }
    };

    // Covers the case where the deadline already passed while the tab was
    // closed, backgrounded, or refreshed — don't wait up to a full second
    // to notice.
    checkExpiry();
    intervalId = setInterval(checkExpiry, CHECK_INTERVAL_MS);

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, extendDeadline, { passive: true }));

    return () => {
      clearInterval(intervalId);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, extendDeadline));
    };
  }, [isAdminTier, logout, navigate, extendDeadline]);
}

export default useAdminIdleTimeout;
