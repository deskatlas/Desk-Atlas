import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createAdminDashboardService,
  createAdminReservationService,
  createBookingAccessService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  createStaffOperationsService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("MF-59: Re-Check-In Audit Logging", () => {
  async function setupActiveCheckedInReservation() {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let currentTime = new Date("2026-08-26T09:00:00.000Z");
    const nowProvider = () => currentTime;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
    const bookingAccessService = createBookingAccessService(reservationRepo, nowProvider);
    const staffOperationsService = createStaffOperationsService(reservationRepo, nowProvider);
    const adminReservationService = createAdminReservationService(reservationRepo, nowProvider);
    const adminDashboardService = createAdminDashboardService(
      reservationRepo,
      reservationRepo,
      workspaceRepo,
      nowProvider
    );

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Focus Pod",
      capacity: 1,
      rateAmount: 150,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#1E3A8A",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "FP-101",
      displayName: "Focus Pod 101",
    });

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Jordan",
        customerLastName: "Lee",
        customerEmail: "jordan.lee@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-08-26T10:00:00.000Z",
            endAt: "2026-08-26T14:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Pay and approve
    await paymentSessionService.submitPaymentProof({
      token: reservation.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/jordan.png",
    });
    const session = await paymentSessionService.getPaymentSession(reservation.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    // Issue booking access QR
    const issue = await bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://deskatlas.test/booking"
    );

    // Initial check in at 10:05 AM
    currentTime = new Date("2026-08-26T10:05:00.000Z");
    const checkInResult = await staffOperationsService.checkInReservation({
      reservationId: reservation.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });
    assert.equal(checkInResult.reservationStatus, "CHECKED_IN");
    assert.equal(checkInResult.reentry, false);

    return {
      reservationRepo,
      workspaceRepo,
      bookingAccessService,
      staffOperationsService,
      adminReservationService,
      adminDashboardService,
      reservation,
      token: issue!.token,
      setCurrentTime: (d: Date) => {
        currentTime = d;
      },
    };
  }

  it("creates a distinct REENTRY audit log when scanning an already checked-in booking QR", async () => {
    const ctx = await setupActiveCheckedInReservation();
    const staffActor = { userId: "staff-gate-1", role: "STAFF" as const };

    // Guest steps out and returns at 11:15 AM
    ctx.setCurrentTime(new Date("2026-08-26T11:15:00.000Z"));
    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(ctx.token, staffActor);

    assert.equal(scanResult.accessState, "ACTIVE");
    assert.equal(scanResult.checkInState, "CHECKED_IN");

    // Check operational activity / audit logs
    const activities = await ctx.staffOperationsService.listOperationalActivity(10);
    const reentryActivity = activities.find(
      (a) => a.reservationId === ctx.reservation.id && a.activityType === "REENTRY"
    );

    assert.ok(reentryActivity, "Expected a REENTRY activity log entry to be created");
    assert.equal(reentryActivity.reservationId, ctx.reservation.id);
    assert.equal(reentryActivity.customerName, "Jordan Lee");
    assert.equal(reentryActivity.occurredAt, "2026-08-26T11:15:00.000Z");
    assert.equal(reentryActivity.actorUserId, staffActor.userId);
    assert.equal(reentryActivity.actorRole, "STAFF");
  });

  it("logs multiple re-entries individually for the same booking", async () => {
    const ctx = await setupActiveCheckedInReservation();
    const staffActor1 = { userId: "staff-1", role: "STAFF" as const };
    const staffActor2 = { userId: "staff-2", role: "STAFF" as const };

    // Re-entry 1 at 11:00 AM
    ctx.setCurrentTime(new Date("2026-08-26T11:00:00.000Z"));
    await ctx.bookingAccessService.resolveBookingAccess(ctx.token, staffActor1);

    // Re-entry 2 at 12:30 PM
    ctx.setCurrentTime(new Date("2026-08-26T12:30:00.000Z"));
    await ctx.bookingAccessService.resolveBookingAccess(ctx.token, staffActor2);

    // Verify multiple individual audit entries exist
    const activities = await ctx.staffOperationsService.listOperationalActivity(10);
    const reentries = activities.filter(
      (a) => a.reservationId === ctx.reservation.id && a.activityType === "REENTRY"
    );

    assert.equal(reentries.length, 2, "Expected 2 distinct REENTRY audit log entries");
    assert.equal(reentries[0].occurredAt, "2026-08-26T12:30:00.000Z");
    assert.equal(reentries[0].actorUserId, "staff-2");
    assert.equal(reentries[1].occurredAt, "2026-08-26T11:00:00.000Z");
    assert.equal(reentries[1].actorUserId, "staff-1");
  });

  it("includes re-entry events in the Admin reservation detail activity timeline, distinguishable from initial check-in", async () => {
    const ctx = await setupActiveCheckedInReservation();

    // Re-entry at 11:20 AM
    ctx.setCurrentTime(new Date("2026-08-26T11:20:00.000Z"));
    await ctx.bookingAccessService.resolveBookingAccess(ctx.token, {
      userId: "staff-scanner",
      role: "STAFF",
    });

    // Final checkout at 13:50 PM
    ctx.setCurrentTime(new Date("2026-08-26T13:50:00.000Z"));
    await ctx.staffOperationsService.checkOutReservation({
      reservationId: ctx.reservation.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    const detail = await ctx.adminReservationService.getReservationDetail(ctx.reservation.id);
    assert.ok(detail);
    assert.ok(detail.timeline && detail.timeline.length > 0);

    // Find initial check-in and re-entry
    const checkInEntry = detail.timeline.find((t) => t.includes("Customer checked in"));
    const reEntryEntry = detail.timeline.find(
      (t) => t.includes("Customer re-entered") || t.includes("Re-entry")
    );
    const checkOutEntry = detail.timeline.find((t) => t.includes("Customer checked out"));

    assert.ok(checkInEntry, "Expected 'Customer checked in' in timeline");
    assert.ok(reEntryEntry, "Expected 'Customer re-entered (Re-entry)' in timeline");
    assert.ok(checkOutEntry, "Expected 'Customer checked out' in timeline");

    // Must be distinguishable
    assert.notEqual(checkInEntry, reEntryEntry);
    assert.ok(
      reEntryEntry.includes("re-entered") || reEntryEntry.includes("Re-entry"),
      "Re-entry must have distinct text"
    );

    // Chronological order: check-in -> re-entry -> checkout
    const checkInIdx = detail.timeline.indexOf(checkInEntry);
    const reEntryIdx = detail.timeline.indexOf(reEntryEntry);
    const checkOutIdx = detail.timeline.indexOf(checkOutEntry);

    assert.ok(checkInIdx < reEntryIdx, "Check-in should come before re-entry in timeline");
    assert.ok(reEntryIdx < checkOutIdx, "Re-entry should come before checkout in timeline");
  });

  it("surfaces re-entry events in the Admin dashboard activity feed with distinct badge and status", async () => {
    const ctx = await setupActiveCheckedInReservation();

    // Re-entry at 11:30 AM
    ctx.setCurrentTime(new Date("2026-08-26T11:30:00.000Z"));
    await ctx.bookingAccessService.resolveBookingAccess(ctx.token, {
      userId: "staff-1",
      role: "STAFF",
    });

    const dashboard = await ctx.adminDashboardService.getDashboardSnapshot("today");
    const activityItems = dashboard.activity;

    const checkInItem = activityItems.find(
      (a) => a.name === "Jordan Lee" && a.status === "Checked In"
    );
    const reentryItem = activityItems.find(
      (a) => a.name === "Jordan Lee" && a.status === "Re-entered"
    );

    assert.ok(checkInItem, "Expected 'Checked In' activity item");
    assert.ok(reentryItem, "Expected 'Re-entered' activity item");

    assert.equal(reentryItem.mark, "↺");
    assert.equal(reentryItem.status, "Re-entered");
    assert.deepEqual(reentryItem.style, { background: "#E0F2FE", color: "#0369A1" });
    assert.notEqual(reentryItem.mark, checkInItem.mark);
    assert.notEqual(reentryItem.status, checkInItem.status);
  });

  it("maintains checkInReservation operational action idempotency and creates re-entry audit", async () => {
    const ctx = await setupActiveCheckedInReservation();

    // Re-check-in directly via checkInReservation endpoint
    ctx.setCurrentTime(new Date("2026-08-26T11:45:00.000Z"));
    const recheckResult = await ctx.staffOperationsService.checkInReservation({
      reservationId: ctx.reservation.id,
      actor: { userId: "staff-frontdesk", role: "STAFF" },
    });

    assert.equal(recheckResult.reentry, true);
    assert.equal(recheckResult.reservationStatus, "CHECKED_IN");

    const detail = await ctx.adminReservationService.getReservationDetail(ctx.reservation.id);
    const reentriesInTimeline = detail!.timeline.filter(
      (t) => t.includes("re-entered") || t.includes("Re-entry")
    );
    assert.ok(reentriesInTimeline.length >= 1);
  });
});
