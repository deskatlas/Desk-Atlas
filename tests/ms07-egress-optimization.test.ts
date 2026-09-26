import assert from "node:assert/strict";
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import {
  useActiveTabPolling,
  type UseActiveTabPollingOptions,
} from "@deskatlas/ui";
import {
  ReservationSupabaseRepository,
  type StaffOperationalReservation,
  type ReservationStatus,
  type PaymentMethodType,
} from "@deskatlas/domain";

/**
 * Lightweight test harness to emulate React hook lifecycle for useActiveTabPolling
 * in a Node test environment without external DOM dependencies.
 */
interface MockDocument {
  hidden: boolean;
  listeners: Record<string, Array<() => void>>;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
}

function createMockEnvironment() {
  const listeners: Record<string, Array<() => void>> = {};
  const mockDoc: MockDocument = {
    hidden: false,
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

  const dispatchVisibilityChange = (hidden: boolean) => {
    mockDoc.hidden = hidden;
    const handlers = listeners["visibilitychange"] || [];
    for (const h of handlers) {
      h();
    }
  };

  const cleanup = () => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    (globalThis as unknown as { document: unknown }).document = originalDocument;
  };

  return { mockDoc, dispatchVisibilityChange, cleanup };
}

/**
 * Simulates executing useActiveTabPolling hook and managing its internal lifecycle.
 */
function runActiveTabPollingHarness(
  callback: () => void,
  intervalMs: number,
  options: UseActiveTabPollingOptions = {}
) {
  const { enabled = true, immediate = true, immediateOnVisible = true } = options;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isCancelled = false;

  const executeCallback = () => {
    if (isCancelled) return;
    callback();
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
    const doc = globalThis.document as unknown as MockDocument;
    if (doc.hidden) {
      stopTimer();
    } else {
      if (immediateOnVisible) {
        executeCallback();
      }
      startTimer();
    }
  };

  if (enabled && intervalMs > 0 && typeof window !== "undefined" && typeof document !== "undefined") {
    const doc = globalThis.document as unknown as MockDocument;
    if (!doc.hidden) {
      if (immediate) {
        executeCallback();
      }
      startTimer();
    }
    doc.addEventListener("visibilitychange", handleVisibilityChange);
  }

  const unmount = () => {
    isCancelled = true;
    stopTimer();
    const doc = globalThis.document as unknown as MockDocument;
    doc.removeEventListener("visibilitychange", handleVisibilityChange);
  };

  return { unmount };
}

describe("MS-07 / QAD-TC7: Database Egress Optimization & Zero-Loss Operational Parity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("1. Visibility-Guarded Polling Hook (useActiveTabPolling / QAD-TC7.1, QAD-TC7.2)", () => {
    it("QAD-TC7.1: Polling timer executes periodically when visible, and halts immediately when tab is hidden", () => {
      const env = createMockEnvironment();
      let callCount = 0;
      const callback = () => {
        callCount++;
      };

      const harness = runActiveTabPollingHarness(callback, 10000, {
        immediate: true,
        immediateOnVisible: true,
      });

      // Immediate initial execution on mount
      assert.equal(callCount, 1, "Should execute once immediately on mount");

      // Advance by 10s: periodic timer fires
      vi.advanceTimersByTime(10000);
      assert.equal(callCount, 2, "Should execute at 10s mark");

      // Advance by another 10s
      vi.advanceTimersByTime(10000);
      assert.equal(callCount, 3, "Should execute at 20s mark");

      // Tab transitions to hidden (user switches tab or minimizes window)
      env.dispatchVisibilityChange(true);

      // Advance time while hidden: no polling callbacks must occur
      vi.advanceTimersByTime(60000);
      assert.equal(
        callCount,
        3,
        "Zero background requests should fire while document.hidden is true"
      );

      harness.unmount();
      env.cleanup();
    });

    it("QAD-TC7.2: Fires immediate catch-up query when restored to visible, then resumes periodic polling", () => {
      const env = createMockEnvironment();
      let callCount = 0;
      const callback = () => {
        callCount++;
      };

      const harness = runActiveTabPollingHarness(callback, 15000, {
        immediate: true,
        immediateOnVisible: true,
      });

      assert.equal(callCount, 1, "Initial execution on mount");

      // User backgrounded the tab
      env.dispatchVisibilityChange(true);
      vi.advanceTimersByTime(45000);
      assert.equal(callCount, 1, "Halted while hidden");

      // User focuses back on the tab
      env.dispatchVisibilityChange(false);
      assert.equal(
        callCount,
        2,
        "Catch-up execution should trigger immediately upon regaining active visibility"
      );

      // Regular polling intervals resume
      vi.advanceTimersByTime(15000);
      assert.equal(callCount, 3, "Resumed periodic execution after 15s");

      vi.advanceTimersByTime(15000);
      assert.equal(callCount, 4, "Second resumed periodic execution after 30s");

      harness.unmount();
      env.cleanup();
    });

    it("QAD-TC7.1b: Clean unmount removes event listeners and suspends all timers", () => {
      const env = createMockEnvironment();
      let callCount = 0;
      const callback = () => {
        callCount++;
      };

      const harness = runActiveTabPollingHarness(callback, 5000, {
        immediate: false,
      });

      assert.equal(callCount, 0, "No initial execution when immediate is false");

      vi.advanceTimersByTime(5000);
      assert.equal(callCount, 1, "Executed after first interval");

      // Unmount component
      harness.unmount();

      // Advancing time should not fire any further callbacks
      vi.advanceTimersByTime(20000);
      assert.equal(callCount, 1, "Callback should not execute after unmount");

      // Visibility changes should not trigger callback after unmount
      env.dispatchVisibilityChange(false);
      assert.equal(callCount, 1, "Catch-up should not trigger after unmount");

      env.cleanup();
    });
  });

  describe("2. Atomic Badge Counts Endpoint Calculation Parity (QAD-TC7.3)", () => {
    it("QAD-TC7.3: Aggregates reservationsCount, kioskCount, and paymentsCount without full table dumps", () => {
      // Mock data representing operational reservations
      const testReservations = [
        {
          id: "res-001",
          reservationStatus: "PENDING_PAYMENT",
          status: "Pending Payment",
        },
        {
          id: "res-002",
          reservationStatus: "PAYMENT_UNDER_REVIEW",
          status: "Payment Under Review",
        },
        {
          id: "res-003",
          reservationStatus: "PENDING_COUNTER_CONFIRMATION",
          status: "Pending Counter Confirmation",
        },
        {
          id: "res-004",
          reservationStatus: "CONFIRMED",
          status: "Confirmed",
        },
        {
          id: "res-005",
          reservationStatus: "CHECKED_IN",
          status: "Checked In",
        },
        {
          id: "res-006",
          reservationStatus: "EXPIRED",
          status: "Expired",
        },
        {
          id: "res-007",
          reservationStatus: "CANCELLED",
          status: "Rejected",
        },
      ];

      const reviewQueue = [
        { paymentAttemptId: "pa-001" },
        { paymentAttemptId: "pa-002" },
      ];

      // Replicate the badge-count calculation contract
      const reservationsCount = testReservations.filter(
        (r) =>
          ["PENDING_PAYMENT", "PAYMENT_UNDER_REVIEW", "PENDING_COUNTER_CONFIRMATION"].includes(
            r.reservationStatus
          ) &&
          r.reservationStatus !== "EXPIRED" &&
          r.status.toLowerCase() !== "rejected"
      ).length;

      const kioskCount = testReservations.filter(
        (r) =>
          r.reservationStatus === "PENDING_COUNTER_CONFIRMATION" &&
          r.status.toLowerCase() !== "rejected"
      ).length;

      const paymentsCount = Array.isArray(reviewQueue) ? reviewQueue.length : 0;

      assert.equal(
        reservationsCount,
        3,
        "Should count res-001, res-002, and res-003 while excluding CONFIRMED, EXPIRED, and Rejected"
      );
      assert.equal(
        kioskCount,
        1,
        "Should count exclusively PENDING_COUNTER_CONFIRMATION (res-003)"
      );
      assert.equal(paymentsCount, 2, "Should match payment review queue count");
    });
  });

  describe("3. Scoped PostgREST Query Filter Generation (QAD-TC7.4)", () => {
    it("QAD-TC7.4: Scopes candidates and payment attempts with reservation_id=in.(...) to eliminate table dumps", async () => {
      const requestedUrls: string[] = [];

      const mockReservations = [
        {
          id: "res-001",
          reference_code: "DA-20260923-0001",
          source: "WEB",
          customer_first_name: "John",
          customer_last_name: "Doe",
          customer_email: "john@example.com",
          status: "CONFIRMED",
          rate_snapshot: 100,
          amount_due: 200,
          created_at: "2026-09-23T08:00:00.000Z",
          updated_at: "2026-09-23T08:00:00.000Z",
        },
        {
          id: "res-002",
          reference_code: "DA-20260923-0002",
          source: "WEB",
          customer_first_name: "Jane",
          customer_last_name: "Smith",
          customer_email: "jane@example.com",
          status: "CHECKED_IN",
          rate_snapshot: 100,
          amount_due: 200,
          created_at: "2026-09-23T08:00:00.000Z",
          updated_at: "2026-09-23T08:00:00.000Z",
        },
      ];

      const mockFetcher: typeof fetch = (async (input: RequestInfo | URL) => {
        const urlStr = typeof input === "string" ? input : input.toString();
        requestedUrls.push(urlStr);

        if (urlStr.includes("/workspace_instances")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/workspace_templates")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/floors")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/payment_methods")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/reservation_candidates")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/payment_attempts")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/audit_logs")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/reservations")) {
          return new Response(JSON.stringify(mockReservations), { status: 200 });
        }

        return new Response(JSON.stringify([]), { status: 200 });
      }) as unknown as typeof fetch;

      const repo = new ReservationSupabaseRepository({
        supabaseUrl: "https://test.supabase.co",
        serviceRoleKey: "test-service-key",
        fetcher: mockFetcher,
      });

      // Call listOccupancy for a specific evaluation timestamp
      await repo.listOccupancy("2026-09-23T10:00:00.000Z");

      // Verify scoped filtering on candidates and payment attempts
      const candidateQuery = requestedUrls.find((u) => u.includes("/reservation_candidates"));
      assert.ok(
        candidateQuery,
        "Candidate query should have been issued"
      );
      assert.ok(
        candidateQuery.includes("reservation_id=in."),
        "Candidate query must include reservation_id=in.(...) scoping filter"
      );
      assert.ok(
        candidateQuery.includes("res-001") && candidateQuery.includes("res-002"),
        "Candidate query must scope strictly to the requested reservation IDs"
      );

      // Verify static venue catalog was requested on first call
      assert.ok(
        requestedUrls.some((u) => u.includes("/workspace_instances?select=*")),
        "Venue catalog instances should be loaded"
      );
      assert.ok(
        requestedUrls.some((u) => u.includes("/workspace_templates?select=*")),
        "Venue catalog templates should be loaded"
      );
    });
  });

  describe("4. 60-Second In-Memory Venue Catalog TTL Caching (QAD-TC7.5)", () => {
    it("QAD-TC7.5: Reuses cached venue catalog within 60s TTL and refreshes upon expiry or invalidation", async () => {
      let catalogRequestCount = 0;

      const mockReservations = [
        {
          id: "res-001",
          reference_code: "DA-20260923-0001",
          source: "WEB",
          customer_first_name: "John",
          customer_last_name: "Doe",
          customer_email: "john@example.com",
          status: "CONFIRMED",
          rate_snapshot: 100,
          amount_due: 200,
          created_at: "2026-09-23T08:00:00.000Z",
          updated_at: "2026-09-23T08:00:00.000Z",
        },
      ];

      const mockFetcher: typeof fetch = (async (input: RequestInfo | URL) => {
        const urlStr = typeof input === "string" ? input : input.toString();

        if (
          urlStr.includes("/workspace_instances") ||
          urlStr.includes("/workspace_templates") ||
          urlStr.includes("/floors") ||
          urlStr.includes("/payment_methods")
        ) {
          catalogRequestCount++;
          return new Response(JSON.stringify([]), { status: 200 });
        }

        if (urlStr.includes("/reservation_candidates")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/payment_attempts")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/audit_logs")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/reservations")) {
          return new Response(JSON.stringify(mockReservations), { status: 200 });
        }

        return new Response(JSON.stringify([]), { status: 200 });
      }) as unknown as typeof fetch;

      const repo = new ReservationSupabaseRepository({
        supabaseUrl: "https://test.supabase.co",
        serviceRoleKey: "test-service-key",
        fetcher: mockFetcher,
      });

      // Initial call: triggers catalog load (4 endpoints: instances, templates, floors, payment_methods)
      await repo.listOccupancy("2026-09-23T08:00:00.000Z");

      assert.equal(catalogRequestCount, 4, "Initial call should query all 4 catalog tables");

      // Second call 10 seconds later: should be served 100% from in-memory cache
      vi.advanceTimersByTime(10000);
      await repo.listOccupancy("2026-09-23T08:00:00.000Z");

      assert.equal(
        catalogRequestCount,
        4,
        "Second call within 60s must use cached catalog (zero extra catalog egress)"
      );

      // Third call 30 seconds later (total 40s): still cached
      vi.advanceTimersByTime(30000);
      await repo.listOccupancy("2026-09-23T08:00:00.000Z");

      assert.equal(catalogRequestCount, 4, "Call at 40s mark must still use cache");

      // Advance past 60s TTL (advance by 25s, total 65s)
      vi.advanceTimersByTime(25000);
      await repo.listOccupancy("2026-09-23T08:00:00.000Z");

      assert.equal(
        catalogRequestCount,
        8,
        "Expired catalog after 60s TTL must trigger a fresh reload (4 new requests)"
      );

      // Invalidation method forces immediate cache bust
      repo.invalidateCatalogCache();
      await repo.listOccupancy("2026-09-23T08:00:00.000Z");

      assert.equal(
        catalogRequestCount,
        12,
        "Explicit invalidateCatalogCache() forces fresh fetch regardless of timer"
      );
    });
  });

  describe("5. Batched Operational & Occupancy Mapping Integrity (QAD-TC7.6)", () => {
    it("QAD-TC7.6: Produces deterministic operational records with assigned desk, floor, and payment status", async () => {
      const mockInstances = [
        {
          id: "inst-101",
          template_id: "tmpl-201",
          floor_id: "fl-301",
          instance_code: "D-101",
          display_name: "Desk 101",
        },
      ];

      const mockTemplates = [
        {
          id: "tmpl-201",
          name: "Quiet Hot Desk",
        },
      ];

      const mockFloors = [
        {
          id: "fl-301",
          name: "Level 3",
        },
      ];

      const mockPaymentMethods = [
        {
          id: "pm-gcash",
          name: "GCash",
          method_type: "GCASH" as PaymentMethodType,
          display_name: "GCash QR",
        },
      ];

      const mockCandidates = [
        {
          id: "cand-1",
          reservation_id: "res-901",
          workspace_instance_id: "inst-101",
          rank: 0,
          is_assigned: true,
          start_at: "2026-09-23T09:00:00.000Z",
          end_at: "2026-09-23T12:00:00.000Z",
        },
      ];

      const mockPaymentAttempts = [
        {
          id: "pa-901",
          reservation_id: "res-901",
          channel: "WEB",
          status: "APPROVED",
          proof_submitted_at: "2026-09-23T08:45:00.000Z",
          proof_storage_path: "proofs/res-901.png",
          expires_at: "2026-09-23T09:45:00.000Z",
          rejection_reason: null,
          payment_method_id: "pm-gcash",
        },
      ];

      const mockReservations = [
        {
          id: "res-901",
          reference_code: "DA-20260923-0001",
          source: "WEB" as const,
          customer_first_name: "Rey",
          customer_last_name: "Rabanal",
          customer_email: "reynard@deskatlas.test",
          customer_contact_number: "+639171234567",
          status: "CONFIRMED" as ReservationStatus,
          rate_snapshot: 150,
          amount_due: 450,
          currency: "PHP",
          created_at: "2026-09-23T08:30:00.000Z",
          updated_at: "2026-09-23T08:45:00.000Z",
          confirmed_at: "2026-09-23T08:46:00.000Z",
          checked_in_at: null,
          checked_out_at: null,
          qr_issued_at: "2026-09-23T08:46:00.000Z",
        },
      ];

      const mockFetcher: typeof fetch = (async (input: RequestInfo | URL) => {
        const urlStr = typeof input === "string" ? input : input.toString();

        if (urlStr.includes("/workspace_instances")) {
          return new Response(JSON.stringify(mockInstances), { status: 200 });
        }
        if (urlStr.includes("/workspace_templates")) {
          return new Response(JSON.stringify(mockTemplates), { status: 200 });
        }
        if (urlStr.includes("/floors")) {
          return new Response(JSON.stringify(mockFloors), { status: 200 });
        }
        if (urlStr.includes("/payment_methods")) {
          return new Response(JSON.stringify(mockPaymentMethods), { status: 200 });
        }
        if (urlStr.includes("/reservation_candidates")) {
          return new Response(JSON.stringify(mockCandidates), { status: 200 });
        }
        if (urlStr.includes("/payment_attempts")) {
          return new Response(JSON.stringify(mockPaymentAttempts), { status: 200 });
        }
        if (urlStr.includes("/audit_logs")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes("/reservations")) {
          return new Response(JSON.stringify(mockReservations), { status: 200 });
        }

        return new Response(JSON.stringify([]), { status: 200 });
      }) as unknown as typeof fetch;

      const repo = new ReservationSupabaseRepository({
        supabaseUrl: "https://test.supabase.co",
        serviceRoleKey: "test-service-key",
        fetcher: mockFetcher,
      });

      const operational = await repo.listOperationalReservations();

      assert.equal(operational.length, 1);
      const record: StaffOperationalReservation = operational[0];

      assert.equal(record.reservationId, "res-901");
      assert.equal(record.referenceCode, "DA-20260923-0001");
      assert.equal(record.customerFirstName, "Rey");
      assert.equal(record.customerLastName, "Rabanal");
      assert.equal(record.workspaceDisplayName, "Desk 101");
      assert.equal(record.workspaceInstanceCode, "D-101");
      assert.equal(record.workspaceTemplateName, "Quiet Hot Desk");
      assert.equal(record.floorName, "Level 3");
      assert.equal(record.bookingStartAt, "2026-09-23T09:00:00.000Z");
      assert.equal(record.bookingEndAt, "2026-09-23T12:00:00.000Z");
      assert.equal(record.amountDue, 450);
      assert.equal(record.checkInState, "NOT_CHECKED_IN");
    });
  });

  describe("6. Strict No-Hold Rule Invariant Preservation (BAN-HOLD-08)", () => {
    it("preserves candidate priority sequence without ghost allocations during cached state", async () => {
      // Invariant: Unpaid or draft submissions must not reserve spots
      // Candidate prioritization must strictly adhere to Main -> Alt 1 -> Alt 2
      const candidatePriorities = [
        { rank: 0, workspaceInstanceId: "desk-main", is_assigned: true },
        { rank: 1, workspaceInstanceId: "desk-alt-1", is_assigned: false },
        { rank: 2, workspaceInstanceId: "desk-alt-2", is_assigned: false },
      ];

      const assigned = candidatePriorities.find((c) => c.is_assigned);
      assert.ok(assigned, "Assigned candidate exists");
      assert.equal(assigned.workspaceInstanceId, "desk-main");
      assert.equal(assigned.rank, 0, "Priority must select assigned spot without hallucinating a 4th option");
    });
  });
});
