import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "vitest";
import {
  createStaffOperationsService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  ReservationSupabaseRepository,
  StaffOperationsError,
} from "@deskatlas/domain";
import { POST as checkInRouteHandler } from "../apps/staff-dashboard/src/app/api/operations/reservations/[reservationId]/check-in/route";
import {
  EarlyCheckInModal,
  isEarlyCheckInError,
  formatEarlyCheckInSchedule,
} from "../apps/staff-dashboard/src/features/check-in/components/EarlyCheckInModal";

async function createTestContext() {
  const reservationRepo = new ReservationMemoryRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  let currentTime = new Date("2026-09-14T08:00:00.000Z");
  const nowProvider = () => currentTime;

  const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
  const reservationService = createReservationService(
    reservationRepo,
    workspaceRepo,
    reservationRepo,
    paymentSessionService
  );
  const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
  const staffOperationsService = createStaffOperationsService(reservationRepo, nowProvider);

  const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
  const template = await workspaceRepo.createTemplate({
    name: "Dedicated Desk",
    capacity: 1,
    rateAmount: 150,
    pricingUnit: "HOURLY",
    defaultShape: "rectangle",
    defaultColor: "#0f172a",
    isActive: true,
  });
  const instance = await workspaceRepo.createInstance({
    templateId: template.id,
    floorId: floor.id,
    instanceCode: "DD-01",
    displayName: "Dedicated Desk 1",
  });

  const helperCreateAndConfirm = async (startAt: string, endAt: string) => {
    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "Smith",
        customerEmail: "alice@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt,
            endAt,
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/test.png",
    });
    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    return res;
  };

  return {
    reservationRepo,
    workspaceRepo,
    template,
    floor,
    instance,
    setTime: (d: Date) => {
      currentTime = d;
    },
    staffOperationsService,
    helperCreateAndConfirm,
  };
}

describe("MF-95: Early Check-In Modal & Web Copy", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws StaffOperationsError when attempting to check in before the booking start time", async () => {
    const ctx = await createTestContext();
    // Booking is from 14:00 to 16:00
    const res = await ctx.helperCreateAndConfirm(
      "2026-09-14T14:00:00.000Z",
      "2026-09-14T16:00:00.000Z"
    );

    // Current time is 11:00 (before start time)
    ctx.setTime(new Date("2026-09-14T11:00:00.000Z"));

    let caughtError: any = null;
    try {
      await ctx.staffOperationsService.checkInReservation({
        reservationId: res.id,
        actor: { userId: "staff-1", role: "STAFF" },
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, "Expected checkInReservation to throw");
    assert.ok(
      caughtError instanceof StaffOperationsError,
      `Expected error to be instance of StaffOperationsError, got: ${caughtError}`
    );
    assert.equal(
      caughtError.message,
      "Reservation is not currently active for check-in."
    );
  });

  it("successfully checks in when current time is within booking window", async () => {
    const ctx = await createTestContext();
    const res = await ctx.helperCreateAndConfirm(
      "2026-09-14T14:00:00.000Z",
      "2026-09-14T16:00:00.000Z"
    );

    // Current time is 14:05 (within booking window)
    ctx.setTime(new Date("2026-09-14T14:05:00.000Z"));

    const checkInResult = await ctx.staffOperationsService.checkInReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    assert.equal(checkInResult.reservationStatus, "CHECKED_IN");
    assert.equal(checkInResult.action, "CHECK_IN");
  });

  it("ReservationSupabaseRepository wraps early check-in database exception into StaffOperationsError", async () => {
    const repo = new ReservationSupabaseRepository();
    // Mock the request method to simulate PostgREST 400 error with PostgreSQL RAISE EXCEPTION
    (repo as any).request = async () => {
      throw new Error(
        `Supabase request failed (400): {"code":"P0001","details":null,"hint":null,"message":"Reservation is not currently active for check-in"}`
      );
    };

    let caughtError: any = null;
    try {
      await repo.checkInReservation({
        reservationId: "res-test-123",
        actorUserId: "user-1",
        actorRole: "STAFF",
        actedAt: "2026-09-14T10:00:00.000Z",
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, "Expected repo.checkInReservation to throw");
    assert.ok(
      caughtError instanceof StaffOperationsError,
      "Expected error to be instance of StaffOperationsError"
    );
    assert.equal(
      caughtError.message,
      "Reservation is not currently active for check-in."
    );
  });

  it("staff check-in API route returns status 400 with EARLY_CHECK_IN code on early check-in error", async () => {
    const originalFetch = global.fetch;
    try {
      // Mock fetch in route handler to return early check-in error from Supabase
      global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("staff_profiles")) {
          return new Response(JSON.stringify([{ user_id: "00000000-0000-0000-0000-000000000001" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/rpc/check_in_reservation")) {
          return new Response(
            JSON.stringify({
              code: "P0001",
              details: null,
              hint: null,
              message: "Reservation is not currently active for check-in",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return originalFetch(input, init);
      };

      const req = new Request("http://localhost:3000/api/operations/reservations/res-123/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: {
            userId: "00000000-0000-0000-0000-000000000001",
            role: "STAFF",
          },
        }),
      });

      const res = await checkInRouteHandler(req, {
        params: Promise.resolve({ reservationId: "res-123" }),
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, "EARLY_CHECK_IN");
      assert.equal(
        json.error,
        "Reservation is not currently active for check-in."
      );
      assert.ok(
        !json.error.includes("Supabase request failed"),
        "Should not contain raw Supabase error string"
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("isEarlyCheckInError detects all early check-in error variants", () => {
    assert.equal(isEarlyCheckInError({ code: "EARLY_CHECK_IN" }), true);
    assert.equal(
      isEarlyCheckInError(new Error("Reservation is not currently active for check-in.")),
      true
    );
    assert.equal(
      isEarlyCheckInError(
        'Supabase request failed (400): {"code":"P0001","details":null,"hint":null,"message":"Reservation is not currently active for check-in"}'
      ),
      true
    );
    assert.equal(isEarlyCheckInError(new Error("Other unexpected error")), false);
    assert.equal(isEarlyCheckInError(null), false);
    assert.equal(isEarlyCheckInError(undefined), false);
  });

  it("formatEarlyCheckInSchedule formats booking schedule accurately", () => {
    const formatted = formatEarlyCheckInSchedule(
      "2026-09-14T14:00:00.000Z",
      "2026-09-14T16:00:00.000Z"
    );

    assert.ok(formatted.formattedSchedule, "Should produce schedule string");
    assert.ok(formatted.formattedStartTime, "Should produce start time");
    assert.ok(formatted.formattedEndTime, "Should produce end time");
    assert.ok(formatted.formattedStartDate, "Should produce date label");
  });

  it("EarlyCheckInModal is exported and is a functional component", () => {
    assert.equal(typeof EarlyCheckInModal, "function");
  });
});
