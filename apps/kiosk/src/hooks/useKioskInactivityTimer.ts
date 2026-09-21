"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  DEFAULT_KIOSK_INACTIVITY_TOTAL_TIMEOUT_MS,
  DEFAULT_KIOSK_INACTIVITY_WARNING_TIMEOUT_MS,
  calculateKioskWarningStartTime,
  calculateKioskRemainingWarningSeconds,
} from "@deskatlas/domain";

export interface UseKioskInactivityTimerOptions {
  totalTimeoutMs?: number;
  warningTimeoutMs?: number;
  onWarning?: () => void;
  onReset?: () => void;
  enabled?: boolean;
}

export interface UseKioskInactivityTimerResult {
  isWarningActive: boolean;
  remainingSeconds: number;
  resetTimer: () => void;
  triggerReset: () => void;
}

export function useKioskInactivityTimer({
  totalTimeoutMs = DEFAULT_KIOSK_INACTIVITY_TOTAL_TIMEOUT_MS,
  warningTimeoutMs = DEFAULT_KIOSK_INACTIVITY_WARNING_TIMEOUT_MS,
  onWarning,
  onReset,
  enabled = true,
}: UseKioskInactivityTimerOptions = {}): UseKioskInactivityTimerResult {
  const initialWarningSeconds = Math.max(1, Math.ceil(warningTimeoutMs / 1000));
  const [isWarningActive, setIsWarningActive] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(initialWarningSeconds);

  // Store callbacks in refs to prevent timer resets when parent components re-render with new function identities
  const onWarningRef = useRef(onWarning);
  const onResetRef = useRef(onReset);
  useEffect(() => {
    onWarningRef.current = onWarning;
    onResetRef.current = onReset;
  }, [onWarning, onReset]);

  const isWarningActiveRef = useRef(false);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const resetDeadlineRef = useRef<number>(0);

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const triggerReset = useCallback(() => {
    clearAllTimers();
    isWarningActiveRef.current = false;
    setIsWarningActive(false);
    setRemainingSeconds(0);
    onResetRef.current?.();
  }, [clearAllTimers]);

  const resetTimer = useCallback(() => {
    if (!enabled) return;

    clearAllTimers();
    isWarningActiveRef.current = false;
    setIsWarningActive(false);
    const startSecs = Math.max(1, Math.ceil(warningTimeoutMs / 1000));
    setRemainingSeconds(startSecs);

    const warningDelayMs = calculateKioskWarningStartTime(totalTimeoutMs, warningTimeoutMs);

    // 1. Schedule warning modal
    warningTimerRef.current = setTimeout(() => {
      isWarningActiveRef.current = true;
      setIsWarningActive(true);
      const deadline = Date.now() + warningTimeoutMs;
      resetDeadlineRef.current = deadline;
      setRemainingSeconds(Math.max(1, Math.ceil(warningTimeoutMs / 1000)));
      onWarningRef.current?.();

      // Start live countdown interval
      countdownIntervalRef.current = setInterval(() => {
        const remaining = calculateKioskRemainingWarningSeconds(resetDeadlineRef.current, Date.now());
        setRemainingSeconds(remaining);
        if (remaining <= 0) {
          triggerReset();
        }
      }, 500);
    }, warningDelayMs);

    // 2. Schedule hard reset
    resetTimerRef.current = setTimeout(() => {
      triggerReset();
    }, totalTimeoutMs);
  }, [enabled, totalTimeoutMs, warningTimeoutMs, clearAllTimers, triggerReset]);

  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      isWarningActiveRef.current = false;
      setIsWarningActive(false);
      return;
    }

    resetTimer();

    // Intentional user interactions on kiosk screen / keyboard / mouse
    const events = ["mousedown", "touchstart", "keydown", "click", "pointerdown"];
    const handleActivity = () => {
      resetTimer();
    };

    events.forEach((evt) => {
      window.addEventListener(evt, handleActivity, { passive: true });
    });

    return () => {
      clearAllTimers();
      events.forEach((evt) => {
        window.removeEventListener(evt, handleActivity);
      });
    };
  }, [enabled, totalTimeoutMs, warningTimeoutMs, resetTimer, clearAllTimers]);

  return {
    isWarningActive,
    remainingSeconds,
    resetTimer,
    triggerReset,
  };
}
