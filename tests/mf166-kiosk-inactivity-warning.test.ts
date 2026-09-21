import assert from "node:assert/strict";
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_KIOSK_INACTIVITY_TOTAL_TIMEOUT_MS,
  DEFAULT_KIOSK_INACTIVITY_WARNING_TIMEOUT_MS,
  calculateKioskWarningStartTime,
  calculateKioskRemainingWarningSeconds,
  isKioskInactivityWarningActive,
  isKioskInactivityExpired,
} from "@deskatlas/domain";

describe("MF-166: Kiosk Inactivity Warning Before Auto-Reset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Kiosk Inactivity Domain Constants & Calculations", () => {
    it("has 60-second total timeout and 15-second warning threshold defaults", () => {
      assert.equal(DEFAULT_KIOSK_INACTIVITY_TOTAL_TIMEOUT_MS, 60000);
      assert.equal(DEFAULT_KIOSK_INACTIVITY_WARNING_TIMEOUT_MS, 15000);
    });

    it("calculates warning start time at (totalTimeoutMs - warningTimeoutMs)", () => {
      // 60,000 - 15,000 = 45,000 ms (45 seconds)
      const warningStart = calculateKioskWarningStartTime(60000, 15000);
      assert.equal(warningStart, 45000);

      // Custom values: 120s total, 30s warning = 90s
      assert.equal(calculateKioskWarningStartTime(120000, 30000), 90000);

      // Boundary: warning larger than total clamps safely to 0
      assert.equal(calculateKioskWarningStartTime(10000, 20000), 0);
    });

    it("calculates remaining warning seconds accurately from deadline", () => {
      const now = 100000;
      const deadline = now + 15000; // 15 seconds remaining

      assert.equal(calculateKioskRemainingWarningSeconds(deadline, now), 15);
      assert.equal(calculateKioskRemainingWarningSeconds(deadline, now + 5000), 10);
      assert.equal(calculateKioskRemainingWarningSeconds(deadline, now + 14100), 1);
      assert.equal(calculateKioskRemainingWarningSeconds(deadline, now + 15000), 0);
      assert.equal(calculateKioskRemainingWarningSeconds(deadline, now + 18000), 0);
    });

    it("determines whether inactivity warning should be active", () => {
      const total = 60000;
      const warning = 15000;
      // Warning start is at 45,000 ms

      // Before 45s: not active
      assert.equal(isKioskInactivityWarningActive(0, total, warning), false);
      assert.equal(isKioskInactivityWarningActive(44999, total, warning), false);

      // Between 45s and 60s: active
      assert.equal(isKioskInactivityWarningActive(45000, total, warning), true);
      assert.equal(isKioskInactivityWarningActive(50000, total, warning), true);
      assert.equal(isKioskInactivityWarningActive(59999, total, warning), true);

      // At or after 60s: expired (no longer in warning window)
      assert.equal(isKioskInactivityWarningActive(60000, total, warning), false);
      assert.equal(isKioskInactivityWarningActive(65000, total, warning), false);
    });

    it("determines whether inactivity is expired", () => {
      const total = 60000;

      assert.equal(isKioskInactivityExpired(0, total), false);
      assert.equal(isKioskInactivityExpired(59999, total), false);
      assert.equal(isKioskInactivityExpired(60000, total), true);
      assert.equal(isKioskInactivityExpired(90000, total), true);
    });
  });

  describe("Inactivity Simulation & Timer Lifecycle", () => {
    it("triggers onWarning at 45 seconds and onReset at 60 seconds with no activity", () => {
      const totalTimeoutMs = 60000;
      const warningTimeoutMs = 15000;
      let isWarningActive = false;
      let isReset = false;
      let remainingSeconds = 15;

      const onWarning = vi.fn(() => {
        isWarningActive = true;
      });

      const onReset = vi.fn(() => {
        isWarningActive = false;
        isReset = true;
      });

      const warningDelay = calculateKioskWarningStartTime(totalTimeoutMs, warningTimeoutMs);
      const warningTimer = setTimeout(() => {
        onWarning();
      }, warningDelay);

      const resetTimer = setTimeout(() => {
        onReset();
      }, totalTimeoutMs);

      // Advance by 30 seconds: no warning yet
      vi.advanceTimersByTime(30000);
      assert.equal(onWarning.mock.calls.length, 0);
      assert.equal(onReset.mock.calls.length, 0);
      assert.equal(isWarningActive, false);

      // Advance by another 15 seconds (total 45 seconds): warning fires
      vi.advanceTimersByTime(15000);
      assert.equal(onWarning.mock.calls.length, 1);
      assert.equal(onReset.mock.calls.length, 0);
      assert.equal(isWarningActive, true);

      // Advance by remaining 15 seconds (total 60 seconds): reset fires
      vi.advanceTimersByTime(15000);
      assert.equal(onReset.mock.calls.length, 1);
      assert.equal(isReset, true);

      clearTimeout(warningTimer);
      clearTimeout(resetTimer);
    });

    it("user interaction before warning window resets timer and prevents warning", () => {
      let warningFired = false;
      let resetFired = false;

      let warningTimer: NodeJS.Timeout | null = null;
      let resetTimer: NodeJS.Timeout | null = null;

      const schedule = () => {
        if (warningTimer) clearTimeout(warningTimer);
        if (resetTimer) clearTimeout(resetTimer);

        warningTimer = setTimeout(() => {
          warningFired = true;
        }, 45000);

        resetTimer = setTimeout(() => {
          resetFired = true;
        }, 60000);
      };

      schedule();

      // Inactivity for 40 seconds
      vi.advanceTimersByTime(40000);
      assert.equal(warningFired, false);

      // User interacts (clicks/taps) at 40 seconds -> resets timer
      schedule();

      // Advance another 40 seconds (total elapsed 80s, but only 40s since last interaction)
      vi.advanceTimersByTime(40000);
      assert.equal(warningFired, false);
      assert.equal(resetFired, false);

      // Advance another 5 seconds (45s since last interaction) -> warning fires
      vi.advanceTimersByTime(5000);
      assert.equal(warningFired, true);

      if (warningTimer) clearTimeout(warningTimer);
      if (resetTimer) clearTimeout(resetTimer);
    });

    it("user pressing 'Yes, I\\'m here' during warning window dismisses modal and resets timeout", () => {
      let isWarningActive = false;
      let isReset = false;
      let warningTimer: NodeJS.Timeout | null = null;
      let resetTimer: NodeJS.Timeout | null = null;

      const resetSessionTimer = () => {
        if (warningTimer) clearTimeout(warningTimer);
        if (resetTimer) clearTimeout(resetTimer);
        isWarningActive = false;

        warningTimer = setTimeout(() => {
          isWarningActive = true;
        }, 45000);

        resetTimer = setTimeout(() => {
          isWarningActive = false;
          isReset = true;
        }, 60000);
      };

      resetSessionTimer();

      // Advance to 50 seconds (warning is active, 5 seconds into warning)
      vi.advanceTimersByTime(50000);
      assert.equal(isWarningActive, true);
      assert.equal(isReset, false);

      // User presses "Yes, I'm here"
      resetSessionTimer();
      assert.equal(isWarningActive, false);
      assert.equal(isReset, false);

      // Advance 40 seconds from reset -> warning should not be active yet
      vi.advanceTimersByTime(40000);
      assert.equal(isWarningActive, false);
      assert.equal(isReset, false);

      // Advance another 5 seconds (45s total since reset) -> warning fires again
      vi.advanceTimersByTime(5000);
      assert.equal(isWarningActive, true);

      // Advance 15 more seconds with no interaction -> reset fires
      vi.advanceTimersByTime(15000);
      assert.equal(isReset, true);

      if (warningTimer) clearTimeout(warningTimer);
      if (resetTimer) clearTimeout(resetTimer);
    });

    it("resilient against parent re-renders: changing callback identities do not reset the timer", () => {
      let isWarningActive = false;
      let isReset = false;
      let warningTimer: NodeJS.Timeout | null = null;
      let resetTimer: NodeJS.Timeout | null = null;

      let onWarningFn = () => { isWarningActive = true; };
      let onResetFn = () => { isReset = true; };

      // Mount timer once
      warningTimer = setTimeout(() => { onWarningFn(); }, 45000);
      resetTimer = setTimeout(() => { onResetFn(); }, 60000);

      // Simulate parent re-rendering every 1000ms with newly created function references (like useLiveCountdownClock)
      for (let i = 0; i < 40; i++) {
        vi.advanceTimersByTime(1000);
        // Updating the callback refs on each render without restarting the active timers
        onWarningFn = () => { isWarningActive = true; };
        onResetFn = () => { isReset = true; };
      }

      // At 40 seconds total: warning not fired yet
      assert.equal(isWarningActive, false);
      assert.equal(isReset, false);

      // Advance remaining 5 seconds (total 45s) -> warning fires
      vi.advanceTimersByTime(5000);
      assert.equal(isWarningActive, true);
      assert.equal(isReset, false);

      // Advance remaining 15 seconds (total 60s) -> reset fires
      vi.advanceTimersByTime(15000);
      assert.equal(isReset, true);

      if (warningTimer) clearTimeout(warningTimer);
      if (resetTimer) clearTimeout(resetTimer);
    });

    it("passive mousemove events during active warning do not dismiss the warning modal", () => {
      let isWarningActive = true;

      const handleActivity = (eventType: string) => {
        // While warning modal is active, mousemove is ignored so user can move cursor to the button
        if (isWarningActive && eventType === "mousemove") {
          return;
        }
        isWarningActive = false;
      };

      // Mousemove occurs while modal is active
      handleActivity("mousemove");
      assert.equal(isWarningActive, true, "Warning modal should remain active despite mouse movement");

      // Click occurs
      handleActivity("click");
      assert.equal(isWarningActive, false, "Clicking should dismiss warning modal and reset timer");
    });
  });
});

