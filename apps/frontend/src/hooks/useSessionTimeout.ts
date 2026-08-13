"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionTimeoutConfig {
  enabled: boolean;
  onExpire: () => void;
  /** How long before the access token actually expires to show the warning dialog. */
  warningBeforeMs?: number;
}

export interface SessionTimeoutResult {
  showWarning: boolean;
  countdown: number;
  extendSession: () => void;
}

const DEFAULT_WARNING_BEFORE_MS = 60_000;

// Re-pointed at the real access-token expiry carried on the session (T13, plan Correction 3) —
// this used to be a pure client-side idle timer, decoupled from whether the user was actually
// still authenticated. `accessTokenExpires` is a plain timestamp exposed on the session
// specifically so this hook can drive its countdown without polling the server every second; it's
// not a secret (see next-auth.d.ts).
export function useSessionTimeout({ enabled, onExpire, warningBeforeMs = DEFAULT_WARNING_BEFORE_MS }: SessionTimeoutConfig): SessionTimeoutResult {
  const { data: session, update } = useSession();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(Math.round(warningBeforeMs / 1000));

  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Read through a ref so the timer-scheduling effect below doesn't need `onExpire` in its
  // dependency array — call sites pass a fresh closure every render (see Secret.tsx), which would
  // otherwise tear down and reschedule every timer on every unrelated re-render.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  // Triggers the `jwt` callback with `trigger === "update"`, which always attempts a refresh
  // (auth.config.ts) even inside the early-skew window — the resulting new `accessTokenExpires`
  // flows back through `session` and reschedules the timers below.
  const extendSession = useCallback(() => {
    setShowWarning(false);
    void update();
  }, [update]);

  useEffect(() => {
    if (!enabled) return;
    clearTimers();
    setShowWarning(false);

    // A refresh already failed server-side (coalescer exhausted, token blacklisted, or cms-api
    // unreachable) — no amount of local waiting recovers this. Force the caller's expire path
    // immediately instead of counting down to a warning that can never successfully extend.
    if (session?.error) {
      onExpireRef.current();
      return;
    }

    const expiresAt = session?.accessTokenExpires;
    if (!expiresAt) return;

    const msUntilExpiry = expiresAt - Date.now();
    if (msUntilExpiry <= 0) {
      onExpireRef.current();
      return;
    }

    const msUntilWarning = msUntilExpiry - warningBeforeMs;
    if (msUntilWarning <= 0) {
      setShowWarning(true);
      setCountdown(Math.max(0, Math.round(msUntilExpiry / 1000)));
    } else {
      warningTimerRef.current = setTimeout(() => {
        setShowWarning(true);
        setCountdown(Math.round(warningBeforeMs / 1000));
      }, msUntilWarning);
    }

    countdownRef.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);

    expiryTimerRef.current = setTimeout(() => {
      onExpireRef.current();
    }, msUntilExpiry);

    return clearTimers;
  }, [enabled, session?.accessTokenExpires, session?.error, warningBeforeMs, clearTimers]);

  return { showWarning, countdown, extendSession };
}
