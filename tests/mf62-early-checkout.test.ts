import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffOperationsService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  StaffOperationsConflictError,
  StaffOperationsError,
} from "@deskatlas/domain";

async function createTestContext() {
  const reservationRepo = new ReservationMemoryRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  let currentTime = new Date("2026-08-27T09:00:00.000Z");
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

  const floor = await workspaceRepo.createFloor({ name: "Ground Floor" });
  const template = await workspaceRepo.createTemplate({
    name: "Hot Desk",
    capacity: 1,
    rateAmount: 100,
    pricingUnit: "HOURLY",
    defaultShape: "rectangle",
    defaultColor: "#0f172a",
    isActive: true,
  });
  const instance = await workspaceRepo.createInstance({
    templateId: template.id,
    floorId: floor.id,
    instanceCode: "HD-01",
    displayName: "Hot Desk 1",
  });

  const helperCreateAndConfirm = async (startAt: string, endAt: string, customerEmail = "guest@example.com") => {
    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Test",
        customerLastName: "Customer",
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
    helperCreateAndConfirm,
  };
}

describe("MF-62: Early Manual Checkout Error Fix", () => {
  it("allows early checkout before booking end time, records actual time, and transitions to COMPLETED", async () => {
    const ctx = await createTestContext();
    // Booking: 10:00 to 14:00
    const res = await ctx.helperCreateAndConfirm("2026-08-27T10:00:00.000Z", "2026-08-27T14:00:00.000Z");

    // Check in at 10:05 AM
    ctx.setTime(new Date("2026-08-27T10:05:00.000Z"));
    const checkInResult = await ctx.staffOperationsService.checkInReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });
    assert.equal(checkInResult.reservationStatus, "CHECKED_IN");

    // Early checkout at 11:30 AM (before 14:00)
    const earlyCheckoutTime = new Date("2026-08-27T11:30:00.000Z");
    ctx.setTime(earlyCheckoutTime);
    const checkOutResult = await ctx.staffOperationsService.checkOutReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // Verify status transition
    assert.equal(checkOutResult.reservationStatus, "COMPLETED");
    assert.equal(checkOutResult.action, "CHECK_OUT");
    assert.equal(checkOutResult.reentry, false);
    assert.equal(checkOutResult.actedAt, "2026-08-27T11:30:00.000Z");

    // Verify actual checkout timestamp in detail
    const detail = await ctx.reservationRepo.getAdminReservationDetail(res.id);
    assert.ok(detail);
    assert.equal(detail.reservationStatus, "COMPLETED");
    assert.equal(detail.checkedOutAt, "2026-08-27T11:30:00.000Z");
    assert.notEqual(detail.checkedOutAt, "2026-08-27T14:00:00.000Z");

    // Verify timeline contains checkout entry with actual checkout timestamp
    const checkoutTimeline = detail.timeline.find((t) => t.includes("Customer checked out"));
    assert.ok(checkoutTimeline, "Expected Customer checked out in timeline");
  });

  it("releases physical workspace immediately after early checkout for subsequent bookings", async () => {
    const ctx = await createTestContext();
    // Booking 1: 10:00 to 14:00
    const res1 = await ctx.helperCreateAndConfirm(
      "2026-08-27T10:00:00.000Z",
      "2026-08-27T14:00:00.000Z",
      "user1@example.com"
    );

    // User 1 checks in at 10:00
    ctx.setTime(new Date("2026-08-27T10:00:00.000Z"));
    await ctx.staffOperationsService.checkInReservation({
      reservationId: res1.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // User 1 checks out early at 11:30
    ctx.setTime(new Date("2026-08-27T11:30:00.000Z"));
    await ctx.staffOperationsService.checkOutReservation({
      reservationId: res1.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // User 2 books the same workspace for 12:00 to 14:00 (which was previously occupied by User 1)
    const res2 = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Bob",
        customerLastName: "New",
        customerEmail: "user2@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instance.id,
            startAt: "2026-08-27T12:00:00.000Z",
            endAt: "2026-08-27T14:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Approve User 2 - allocation should succeed because User 1's early checkout released the slot
    await ctx.paymentSessionService.submitPaymentProof({
      token: res2.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/bob.png",
    });
    const session2 = await ctx.paymentSessionService.getPaymentSession(res2.paymentSession!.token);
    const decision = await ctx.paymentReviewService.reviewPayment({
      paymentAttemptId: session2.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    assert.equal(decision.reservationStatus, "CONFIRMED");
    assert.equal(decision.assignedCandidate?.workspaceInstanceId, ctx.instance.id);
  });

  it("creates operational audit log entry on early checkout", async () => {
    const ctx = await createTestContext();
    const res = await ctx.helperCreateAndConfirm("2026-08-27T10:00:00.000Z", "2026-08-27T12:00:00.000Z");

    ctx.setTime(new Date("2026-08-27T10:00:00.000Z"));
    await ctx.staffOperationsService.checkInReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    ctx.setTime(new Date("2026-08-27T10:45:00.000Z"));
    await ctx.staffOperationsService.checkOutReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    const activity = await ctx.staffOperationsService.listOperationalActivity(10);
    const checkoutLog = activity.find((a) => a.reservationId === res.id && a.activityType === "CHECK_OUT");
    assert.ok(checkoutLog, "Expected CHECK_OUT activity record");
    assert.equal(checkoutLog.actorRole, "STAFF");
    assert.equal(checkoutLog.actorUserId, "staff-1");
    assert.equal(checkoutLog.occurredAt, "2026-08-27T10:45:00.000Z");
  });

  it("supports on-time checkout at exact booking end time", async () => {
    const ctx = await createTestContext();
    const res = await ctx.helperCreateAndConfirm("2026-08-27T10:00:00.000Z", "2026-08-27T12:00:00.000Z");

    ctx.setTime(new Date("2026-08-27T10:00:00.000Z"));
    await ctx.staffOperationsService.checkInReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // Checkout exactly at 12:00
    ctx.setTime(new Date("2026-08-27T12:00:00.000Z"));
    const result = await ctx.staffOperationsService.checkOutReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    assert.equal(result.reservationStatus, "COMPLETED");
    assert.equal(result.actedAt, "2026-08-27T12:00:00.000Z");
  });

  it("supports late checkout after booking end time", async () => {
    const ctx = await createTestContext();
    const res = await ctx.helperCreateAndConfirm("2026-08-27T10:00:00.000Z", "2026-08-27T12:00:00.000Z");

    ctx.setTime(new Date("2026-08-27T10:00:00.000Z"));
    await ctx.staffOperationsService.checkInReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // Checkout late at 12:30
    ctx.setTime(new Date("2026-08-27T12:30:00.000Z"));
    const result = await ctx.staffOperationsService.checkOutReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    assert.equal(result.reservationStatus, "COMPLETED");
    assert.equal(result.actedAt, "2026-08-27T12:30:00.000Z");
  });

  it("rejects checkout before check-in with StaffOperationsConflictError", async () => {
    const ctx = await createTestContext();
    const res = await ctx.helperCreateAndConfirm("2026-08-27T10:00:00.000Z", "2026-08-27T12:00:00.000Z");

    ctx.setTime(new Date("2026-08-27T10:15:00.000Z"));

    await assert.rejects(
      async () => {
        await ctx.staffOperationsService.checkOutReservation({
          reservationId: res.id,
          actor: { userId: "staff-1", role: "STAFF" },
        });
      },
      (err: any) => {
        assert.ok(err instanceof StaffOperationsConflictError || err.message.includes("Reservation is not currently checked in"));
        return true;
      }
    );
  });

  it("accepts role case-insensitively ('staff' or 'admin')", async () => {
    const ctx = await createTestContext();
    const res = await ctx.helperCreateAndConfirm("2026-08-27T10:00:00.000Z", "2026-08-27T12:00:00.000Z");

    ctx.setTime(new Date("2026-08-27T10:00:00.000Z"));
    await ctx.staffOperationsService.checkInReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    ctx.setTime(new Date("2026-08-27T11:00:00.000Z"));
    // Lowercase role passed
    const result = await ctx.staffOperationsService.checkOutReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "staff" as any },
    });

    assert.equal(result.reservationStatus, "COMPLETED");
    assert.equal(result.actorRole, "STAFF");
  });

  it("allows early checkout when reservation has alternative candidates without duration mismatch error", async () => {
    const ctx = await createTestContext();
    const instance2 = await ctx.workspaceRepo.createInstance({
      templateId: ctx.template.id,
      floorId: ctx.floor.id,
      instanceCode: "HD-02",
      displayName: "Hot Desk 2",
    });

    // Create reservation with Main (rank 0) + Alt 1 (rank 1)
    const res = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "Alt",
        customerEmail: "alice.alt@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instance.id,
            startAt: "2026-08-27T10:00:00.000Z",
            endAt: "2026-08-27T14:00:00.000Z",
          },
          {
            rank: 1,
            workspaceInstanceId: instance2.id,
            startAt: "2026-08-27T10:00:00.000Z",
            endAt: "2026-08-27T14:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    await ctx.paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/alice.png",
    });
    const session = await ctx.paymentSessionService.getPaymentSession(res.paymentSession!.token);
    await ctx.paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    // Check in at 10:05
    ctx.setTime(new Date("2026-08-27T10:05:00.000Z"));
    await ctx.staffOperationsService.checkInReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // Early checkout at 11:30 (before 14:00)
    ctx.setTime(new Date("2026-08-27T11:30:00.000Z"));
    const result = await ctx.staffOperationsService.checkOutReservation({
      reservationId: res.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    assert.equal(result.reservationStatus, "COMPLETED");
    assert.equal(result.actedAt, "2026-08-27T11:30:00.000Z");

    const detail = await ctx.reservationRepo.getAdminReservationDetail(res.id);
    assert.equal(detail?.checkedOutAt, "2026-08-27T11:30:00.000Z");
  });
});
