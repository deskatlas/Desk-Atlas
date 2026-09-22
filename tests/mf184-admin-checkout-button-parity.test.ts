import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffOperationsService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createAdminReservationService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  StaffOperationsConflictError,
  StaffOperationsError,
} from "@deskatlas/domain";

async function createTestContext() {
  let currentTime = new Date("2026-09-23T09:00:00.000Z");
  const nowProvider = () => currentTime;
  const reservationRepo = new ReservationMemoryRepository(nowProvider);
  const workspaceRepo = new InMemoryWorkspaceRepository();

  const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
  const reservationService = createReservationService(
    reservationRepo,
    workspaceRepo,
    reservationRepo,
    paymentSessionService
  );
  const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
  const staffOperationsService = createStaffOperationsService(reservationRepo, nowProvider);
  const adminReservationService = createAdminReservationService(reservationRepo, nowProvider);

  const floor = await workspaceRepo.createFloor({ name: "Ground Floor" });
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
    instanceCode: "ADM-01",
    displayName: "Admin Desk 1",
  });

  const helperCreateAndConfirm = async (startAt: string, endAt: string, customerEmail = "guest@example.com") => {
    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Admin",
        customerLastName: "Guest",
        customerEmail,
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
    setTime: (date: Date) => {
      currentTime = date;
    },
    nowProvider,
    paymentSessionService,
    reservationService,
    paymentReviewService,
    staffOperationsService,
    adminReservationService,
    helperCreateAndConfirm,
  };
}

describe("MF-184: Admin Reservation Detail Checkout Button Parity with Staff", () => {
  it("allows Admin actor to check out a checked-in reservation, transitioning to COMPLETED", async () => {
    const ctx = await createTestContext();
    const startAt = "2026-09-23T09:00:00.000Z";
    const endAt = "2026-09-23T12:00:00.000Z";

    const created = await ctx.helperCreateAndConfirm(startAt, endAt);
    const reservationId = created.id;

    // Check in the reservation
    const checkInResult = await ctx.staffOperationsService.checkInReservation({
      reservationId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
    });
    assert.equal(checkInResult.checkInState, "CHECKED_IN");
    assert.equal(checkInResult.reservationStatus, "CHECKED_IN");

    // Advance time within booking window
    ctx.setTime(new Date("2026-09-23T10:30:00.000Z"));

    // Admin checks out the reservation
    const checkOutResult = await ctx.staffOperationsService.checkOutReservation({
      reservationId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
    });

    assert.equal(checkOutResult.checkInState, "CHECKED_OUT");
    assert.equal(checkOutResult.reservationStatus, "COMPLETED");
    assert.ok(checkOutResult.checkedOutAt, "checkedOutAt should be populated");
    assert.equal(checkOutResult.checkedOutAt, "2026-09-23T10:30:00.000Z");

    // Verify detail reflects COMPLETED and checkedOutAt
    const detail = await ctx.adminReservationService.getReservationDetail(reservationId);
    assert.ok(detail);
    assert.equal(detail.reservationStatus, "COMPLETED");
    assert.equal(detail.checkedOutAt, "2026-09-23T10:30:00.000Z");
  });

  it("records operational activity log with actorRole ADMIN upon Admin check-out", async () => {
    const ctx = await createTestContext();
    const startAt = "2026-09-23T09:00:00.000Z";
    const endAt = "2026-09-23T12:00:00.000Z";

    const created = await ctx.helperCreateAndConfirm(startAt, endAt);
    const reservationId = created.id;

    await ctx.staffOperationsService.checkInReservation({
      reservationId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
    });

    ctx.setTime(new Date("2026-09-23T11:00:00.000Z"));

    await ctx.staffOperationsService.checkOutReservation({
      reservationId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
    });

    const logs = await ctx.reservationRepo.listOperationalActivity(10);
    const checkOutLog = logs.find(
      (l) => l.reservationId === reservationId && l.activityType === "CHECK_OUT"
    );

    assert.ok(checkOutLog, "Check-out operational log should exist");
    assert.equal(checkOutLog.actorRole, "ADMIN");
    assert.equal(checkOutLog.actorUserId, "admin-user-1");
  });

  it("prevents checkout on non-checked-in reservations and handles idempotency", async () => {
    const ctx = await createTestContext();
    const startAt = "2026-09-23T09:00:00.000Z";
    const endAt = "2026-09-23T12:00:00.000Z";

    const created = await ctx.helperCreateAndConfirm(startAt, endAt);
    const reservationId = created.id;

    // Attempt checkout before check-in -> should throw error
    await assert.rejects(
      async () => {
        await ctx.staffOperationsService.checkOutReservation({
          reservationId,
          actor: { userId: "admin-user-1", role: "ADMIN" },
        });
      },
      (err: any) => {
        return err instanceof StaffOperationsError || err instanceof StaffOperationsConflictError;
      }
    );

    // Check in then check out
    await ctx.staffOperationsService.checkInReservation({
      reservationId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
    });
    const firstCheckout = await ctx.staffOperationsService.checkOutReservation({
      reservationId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
    });
    assert.equal(firstCheckout.reservationStatus, "COMPLETED");

    // Attempt second checkout -> returns completed reservation idempotently
    const secondCheckout = await ctx.staffOperationsService.checkOutReservation({
      reservationId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
    });
    assert.equal(secondCheckout.reservationStatus, "COMPLETED");
  });

  it("verifies UI visibility logic for Check Out button in Admin Reservation Detail", () => {
    // Helper function that mirrors the UI visibility condition in ReservationDetail.tsx
    function shouldShowCheckOutButton(detail: {
      reservationStatus: string;
      checkInState?: string;
      checkedInAt?: string | null;
      checkedOutAt?: string | null;
    }): boolean {
      const isConfirmed = detail.reservationStatus === 'CONFIRMED' || detail.reservationStatus === 'CHECKED_IN';
      const isCheckedIn =
        detail.reservationStatus === 'CHECKED_IN' ||
        detail.checkInState === 'CHECKED_IN' ||
        Boolean(detail.checkedInAt && !detail.checkedOutAt && detail.reservationStatus !== 'COMPLETED' && detail.reservationStatus !== 'CANCELLED' && detail.reservationStatus !== 'EXPIRED');

      return isConfirmed && isCheckedIn;
    }

    // Checked in reservation -> Check Out button must be visible
    assert.equal(
      shouldShowCheckOutButton({
        reservationStatus: "CHECKED_IN",
        checkInState: "CHECKED_IN",
        checkedInAt: "2026-09-23T09:05:00.000Z",
        checkedOutAt: null,
      }),
      true
    );

    // Confirmed but not yet checked in -> Check Out button should NOT be visible
    assert.equal(
      shouldShowCheckOutButton({
        reservationStatus: "CONFIRMED",
        checkInState: "NOT_CHECKED_IN",
        checkedInAt: null,
        checkedOutAt: null,
      }),
      false
    );

    // Completed reservation -> Check Out button should NOT be visible
    assert.equal(
      shouldShowCheckOutButton({
        reservationStatus: "COMPLETED",
        checkInState: "CHECKED_OUT",
        checkedInAt: "2026-09-23T09:05:00.000Z",
        checkedOutAt: "2026-09-23T11:00:00.000Z",
      }),
      false
    );

    // Cancelled reservation -> Check Out button should NOT be visible
    assert.equal(
      shouldShowCheckOutButton({
        reservationStatus: "CANCELLED",
        checkInState: "NOT_CHECKED_IN",
        checkedInAt: null,
        checkedOutAt: null,
      }),
      false
    );

    // Expired reservation -> Check Out button should NOT be visible
    assert.equal(
      shouldShowCheckOutButton({
        reservationStatus: "EXPIRED",
        checkInState: "NOT_CHECKED_IN",
        checkedInAt: null,
        checkedOutAt: null,
      }),
      false
    );

    // Pending payment reservation -> Check Out button should NOT be visible
    assert.equal(
      shouldShowCheckOutButton({
        reservationStatus: "PENDING_PAYMENT",
        checkInState: "NOT_CHECKED_IN",
        checkedInAt: null,
        checkedOutAt: null,
      }),
      false
    );
  });
});
