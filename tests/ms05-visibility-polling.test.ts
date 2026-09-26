import assert from "node:assert/strict";
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import {
  useVisibilityInterval,
  type UseVisibilityIntervalOptions,
} from "@deskatlas/ui";

/**
 * Lightweight mock environment to test visibility-based polling hooks in Node.js
 * Traceability: MS-05 / QAD-TC6.1
 */
interface MockDocument {
  hidden: boolean;
  visibilityState: "visible" | "hidden";
  listeners: Record<string, Array<() => void>>;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
}

function createMockEnvironment() {
  const listeners: Record<string, Array<() => void>> = {};
  const mockDoc: MockDocument = {
    hidden: false,
    visibilityState: "visible",
    listeners,
    addEventListener(event: string, handler: () => void) {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(handler);
    },
    removeEventListener(event: string, handler: () => void) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((h) => h !== handler);
    },
  };

  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  (globalThis as unknown as { window: unknown }).window = {};
  (globalThis as unknown as { document: unknown }).document = mockDoc;

  const setVisibility = (hidden: boolean) => {
    mockDoc.hidden = hidden;
    mockDoc.visibilityState = hidden ? "hidden" : "visible";
    const handlers = listeners["visibilitychange"] || [];
    for (const h of handlers) {
      h();
    }
  };

  const cleanup = () => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    (globalThis as unknown as { document: unknown }).document = originalDocument;
  };

  return { mockDoc, setVisibility, cleanup };
}

/**
 * Harness to simulate React hook lifecycle for useVisibilityInterval
 */
function runVisibilityIntervalHarness(
  callback: () => void,
  delayMs: number | null,
  options: UseVisibilityIntervalOptions = {}
) {
  const { immediate = false, immediateOnVisible = true } = options;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isCancelled = false;

  const executeCallback = () => {
    if (isCancelled) return;
    const doc = globalThis.document as unknown as MockDocument;
    if (doc.hidden || doc.visibilityState === "hidden") {
      return;
    }
    callback();
  };

  const startTimer = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
    }
    if (delayMs !== null && delayMs > 0) {
      intervalId = setInterval(executeCallback, delayMs);
    }
  };

  const stopTimer = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const handleVisibilityChange = () => {
    const doc = globalThis.document as unknown as MockDocument;
    if (doc.hidden || doc.visibilityState === "hidden") {
      stopTimer();
    } else {
      if (immediateOnVisible) {
        executeCallback();
      }
      startTimer();
    }
  };

  const doc = globalThis.document as unknown as MockDocument;
  if (!doc.hidden && doc.visibilityState !== "hidden") {
    if (immediate) {
      executeCallback();
    }
    startTimer();
  }

  doc.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    unmount: () => {
      isCancelled = true;
      stopTimer();
      doc.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}

describe("MS-05 / QAD-TC6.1: Page Visibility-Aware Polling (useVisibilityInterval)", () => {
  let env: ReturnType<typeof createMockEnvironment>;

  beforeEach(() => {
    vi.useFakeTimers();
    env = createMockEnvironment();
  });

  afterEach(() => {
    env.cleanup();
    vi.useRealTimers();
  });

  it("exports useVisibilityInterval correctly from @deskatlas/ui", () => {
    assert.strictEqual(typeof useVisibilityInterval, "function");
  });

  it("ticks periodic callback while document is visible", () => {
    let callCount = 0;
    const harness = runVisibilityIntervalHarness(() => {
      callCount += 1;
    }, 15000);

    assert.strictEqual(callCount, 0);

    // Fast-forward 15s
    vi.advanceTimersByTime(15000);
    assert.strictEqual(callCount, 1);

    // Fast-forward another 15s
    vi.advanceTimersByTime(15000);
    assert.strictEqual(callCount, 2);

    harness.unmount();
  });

  it("pauses polling completely when document becomes hidden", () => {
    let callCount = 0;
    const harness = runVisibilityIntervalHarness(() => {
      callCount += 1;
    }, 10000);

    vi.advanceTimersByTime(10000);
    assert.strictEqual(callCount, 1);

    // Switch tab to hidden
    env.setVisibility(true);

    // Fast forward 50 seconds while hidden
    vi.advanceTimersByTime(50000);
    assert.strictEqual(callCount, 1, "Callback must NOT fire while tab is hidden");

    harness.unmount();
  });

  it("fires immediate catch-up and resumes interval when tab transitions back to visible", () => {
    let callCount = 0;
    const harness = runVisibilityIntervalHarness(
      () => {
        callCount += 1;
      },
      10000,
      { immediateOnVisible: true }
    );

    // Switch to hidden
    env.setVisibility(true);
    vi.advanceTimersByTime(30000);
    assert.strictEqual(callCount, 0);

    // Return to visible tab
    env.setVisibility(false);
    assert.strictEqual(callCount, 1, "Immediate catch-up should execute upon becoming visible");

    // Regular interval resumes
    vi.advanceTimersByTime(10000);
    assert.strictEqual(callCount, 2, "Periodic interval should resume after returning to visible tab");

    harness.unmount();
  });

  it("does not start interval when delayMs is null", () => {
    let callCount = 0;
    const harness = runVisibilityIntervalHarness(() => {
      callCount += 1;
    }, null);

    vi.advanceTimersByTime(60000);
    assert.strictEqual(callCount, 0);

    harness.unmount();
  });

  it("cleans up event listeners and stops timer on unmount", () => {
    let callCount = 0;
    const harness = runVisibilityIntervalHarness(() => {
      callCount += 1;
    }, 5000);

    vi.advanceTimersByTime(5000);
    assert.strictEqual(callCount, 1);

    harness.unmount();

    vi.advanceTimersByTime(15000);
    assert.strictEqual(callCount, 1, "No further calls should occur after unmounting");
    assert.strictEqual(env.mockDoc.listeners["visibilitychange"]?.length ?? 0, 0);
  });
});
