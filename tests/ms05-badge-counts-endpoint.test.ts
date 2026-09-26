import assert from "node:assert/strict";
import { describe, it } from "vitest";

/**
 * Unit and contract tests for the atomic badge counts calculation and endpoint response
 * Traceability: MS-05 / QAD-TC6.2, PRD-F13
 */

interface MockReservation {
  id: string;
  reservationStatus: string;
  status: string;
}

interface MockReviewItem {
  paymentAttemptId: string;
  reservationId: string;
}

function calculateBadgeCounts(
  reservations: MockReservation[],
  reviewQueue: MockReviewItem[]
) {
  // Awaiting proof count: PENDING_PAYMENT, PAYMENT_UNDER_REVIEW, PENDING_COUNTER_CONFIRMATION
  const reservationsCount = reservations.filter(
    (r) =>
      ["PENDING_PAYMENT", "PAYMENT_UNDER_REVIEW", "PENDING_COUNTER_CONFIRMATION"].includes(
        r.reservationStatus
      ) &&
      r.reservationStatus !== "EXPIRED" &&
      r.status.toLowerCase() !== "rejected"
  ).length;

  // Counter queue count: PENDING_COUNTER_CONFIRMATION
  const kioskCount = reservations.filter(
    (r) =>
      r.reservationStatus === "PENDING_COUNTER_CONFIRMATION" &&
      r.status.toLowerCase() !== "rejected"
  ).length;

  const paymentsCount = Array.isArray(reviewQueue) ? reviewQueue.length : 0;

  return {
    reservationsCount,
    paymentsCount,
    kioskCount,
    awaitingProof: reservationsCount,
    paymentReviews: paymentsCount,
    counterQueue: kioskCount,
  };
}

describe("MS-05 / QAD-TC6.2: Atomic Badge Counts Calculation & Endpoint Contract", () => {
  it("calculates accurate badge counts across online payment, review, and kiosk queue", () => {
    const reservations: MockReservation[] = [
      { id: "res-1", reservationStatus: "PENDING_PAYMENT", status: "Awaiting Payment" },
      { id: "res-2", reservationStatus: "PAYMENT_UNDER_REVIEW", status: "Under Review" },
      { id: "res-3", reservationStatus: "PENDING_COUNTER_CONFIRMATION", status: "Counter Queue" },
      { id: "res-4", reservationStatus: "CONFIRMED", status: "Confirmed" },
      { id: "res-5", reservationStatus: "CHECKED_IN", status: "Checked In" },
      { id: "res-6", reservationStatus: "COMPLETED", status: "Completed" },
    ];

    const reviewQueue: MockReviewItem[] = [
      { paymentAttemptId: "pay-1", reservationId: "res-2" },
    ];

    const result = calculateBadgeCounts(reservations, reviewQueue);

    assert.strictEqual(result.reservationsCount, 3);
    assert.strictEqual(result.awaitingProof, 3);
    assert.strictEqual(result.paymentsCount, 1);
    assert.strictEqual(result.paymentReviews, 1);
    assert.strictEqual(result.kioskCount, 1);
    assert.strictEqual(result.counterQueue, 1);
  });

  it("strictly excludes expired and rejected reservations from active badge counts", () => {
    const reservations: MockReservation[] = [
      { id: "res-1", reservationStatus: "EXPIRED", status: "Expired" },
      { id: "res-2", reservationStatus: "CANCELLED", status: "Rejected" },
      { id: "res-3", reservationStatus: "REJECTED", status: "Rejected" },
      { id: "res-4", reservationStatus: "PENDING_PAYMENT", status: "Rejected" },
      { id: "res-5", reservationStatus: "PENDING_COUNTER_CONFIRMATION", status: "rejected" },
    ];

    const result = calculateBadgeCounts(reservations, []);

    assert.strictEqual(result.reservationsCount, 0);
    assert.strictEqual(result.awaitingProof, 0);
    assert.strictEqual(result.kioskCount, 0);
    assert.strictEqual(result.counterQueue, 0);
    assert.strictEqual(result.paymentsCount, 0);
  });

  it("handles empty database state with zero counts", () => {
    const result = calculateBadgeCounts([], []);

    assert.strictEqual(result.reservationsCount, 0);
    assert.strictEqual(result.paymentsCount, 0);
    assert.strictEqual(result.kioskCount, 0);
    assert.strictEqual(result.awaitingProof, 0);
    assert.strictEqual(result.paymentReviews, 0);
    assert.strictEqual(result.counterQueue, 0);
  });

  it("enforces Cache-Control header directive on badge counts endpoint", async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      process.env.SUPABASE_URL = "https://mock.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";

      globalThis.fetch = async () => {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const { GET } = await import(
        "../apps/admin-portal/src/app/api/admin/badge-counts/route"
      );

      const response = await GET();
      const cacheHeader = response.headers.get("Cache-Control");

      assert.ok(cacheHeader, "Cache-Control header must be present on badge counts response");
      assert.match(
        cacheHeader,
        /private/i,
        "Badge counts endpoint must be private to prevent cross-tenant edge leakage"
      );
      assert.match(
        cacheHeader,
        /s-maxage=10/,
        "Badge counts must specify s-maxage=10"
      );
      assert.match(
        cacheHeader,
        /stale-while-revalidate=20/,
        "Badge counts must specify stale-while-revalidate=20"
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl !== undefined) {
        process.env.SUPABASE_URL = originalUrl;
      } else {
        delete process.env.SUPABASE_URL;
      }
      if (originalKey !== undefined) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
      } else {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      }
    }
  });
});
