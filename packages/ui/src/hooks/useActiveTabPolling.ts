'use client';

import { useEffect, useRef } from 'react';

export interface UseActiveTabPollingOptions {
  /**
   * If false, polling is disabled. Defaults to true.
   */
  enabled?: boolean;
  /**
   * Whether to execute the callback immediately when the component mounts.
   * Defaults to true.
   */
  immediate?: boolean;
  /**
   * Whether to execute the callback immediately when the browser tab transitions
   * from hidden to visible. Defaults to true.
   */
  immediateOnVisible?: boolean;
}

/**
 * A visibility-guarded polling hook that executes a periodic callback exclusively
 * while the browser tab is actively visible to the user.
 *
 * When the user switches tabs, minimizes the window, or locks their screen,
 * all background interval executions are suspended immediately to eliminate
 * redundant database egress and CPU cycles.
 *
 * When the tab returns to active focus, an optional immediate catch-up execution
 * is triggered and the periodic interval resumes automatically.
 */
export function useActiveTabPolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: UseActiveTabPollingOptions = {}
): void {
  const { enabled = true, immediate = true, immediateOnVisible = true } = options;

  // Store the latest callback reference to avoid re-triggering effects on closure mutations
  const savedCallback = useRef(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) {
      return;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let isCancelled = false;

    const executeCallback = () => {
      if (isCancelled) return;
      try {
        const result = savedCallback.current();
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          (result as Promise<unknown>).catch(() => {
            // Ignore polling errors in background loop
          });
        }
      } catch {
        // Ignore synchronous polling errors in background loop
      }
    };

    const startTimer = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      intervalId = setInterval(executeCallback, intervalMs);
    };

    const stopTimer = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopTimer();
      } else {
        if (immediateOnVisible) {
          executeCallback();
        }
        startTimer();
      }
    };

    // Initial trigger if tab is visible
    if (!document.hidden) {
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
  }, [enabled, intervalMs, immediate, immediateOnVisible]);
}
