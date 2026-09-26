'use client';

import { useEffect, useRef } from 'react';

export interface UseVisibilityIntervalOptions {
  /**
   * Whether to execute the callback immediately upon component mount.
   * Defaults to false (standard setInterval behavior), but can be enabled.
   */
  immediate?: boolean;
  /**
   * Whether to fire an immediate catch-up refresh when the browser tab transitions
   * from hidden to visible. Defaults to true.
   */
  immediateOnVisible?: boolean;
}

/**
 * Page visibility-aware polling hook (MS-05 / QAD-TC6.1).
 *
 * Automatically pauses periodic timer ticks when the document tab is inactive, hidden,
 * or minimized, completely suppressing redundant serverless invocations and network egress.
 *
 * When the user returns to the active tab, resumes periodic ticks and optionally executes
 * an immediate catch-up fetch.
 *
 * Passing null for delayMs suspends the interval entirely.
 */
export function useVisibilityInterval(
  callback: () => void | Promise<void>,
  delayMs: number | null,
  options: UseVisibilityIntervalOptions = {}
): void {
  const { immediate = false, immediateOnVisible = true } = options;

  const savedCallback = useRef(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null || delayMs <= 0) {
      return;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let isCancelled = false;

    const executeCallback = () => {
      if (isCancelled) return;
      if (typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')) {
        return;
      }
      try {
        const result = savedCallback.current();
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          (result as Promise<unknown>).catch(() => {
            // Suppress unhandled rejections during background polling
          });
        }
      } catch {
        // Suppress synchronous polling errors in background loop
      }
    };

    const startTimer = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      intervalId = setInterval(executeCallback, delayMs);
    };

    const stopTimer = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        stopTimer();
      } else {
        if (immediateOnVisible) {
          executeCallback();
        }
        startTimer();
      }
    };

    // Initial check: if tab is visible, run immediate if requested and start timer
    if (!document.hidden && document.visibilityState !== 'hidden') {
      if (immediate) {
        executeCallback();
      }
      startTimer();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCancelled = true;
      stopTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [delayMs, immediate, immediateOnVisible]);
}
