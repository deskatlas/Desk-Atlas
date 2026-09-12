import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ReservationMemoryRepository,
  createBookingAccessService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  createStaffOperationsService,
  InMemoryWorkspaceRepository,
} from "@deskatlas/domain";

describe("MF-80: Automatic Check-In on First On-Time Booking QR Scan", () => {
  async function setupWebReservation() {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let currentTime = new Date("2026-09-12T09:00:00.000Z");
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
    const staffOpsService = createStaffOperationsService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Ground Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#1e293b",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DK-01",
      displayName: "Desk 1",
    });

    // Booking scheduled for 2:00 PM to 4:00 PM (14:00 to 16:00 UTC)
    const bookingStart = new Date("2026-09-12T14:00:00.000Z");
    const bookingEnd = new Date("2026-09-12T16:00:00.000Z");

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alex",
        customerLastName: "Reyes",
        customerEmail: "alex.reyes@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: bookingStart.toISOString(),
            endAt: bookingEnd.toISOString(),
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Pay and approve
    await paymentSessionService.submitPaymentProof({
      token: reservation.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/alex.png",
    });

    const approval = await paymentReviewService.reviewPayment({
      paymentAttemptId: reservation.paymentSession!.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    assert.equal(approval.reservationStatus, "CONFIRMED");

    // Issue booking access QR token
    const access = await bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://deskatlas.test/booking"
    );
    assert.ok(access?.token);

    return {
      reservationRepo,
      workspaceRepo,
      bookingAccessService,
      staffOpsService,
      reservationId: reservation.id,
      token: access.token,
      instanceId: instance.id,
      setCurrentTime: (d: Date) => {
        currentTime = d;
      },
    };
  }

  it("checks the guest in on first scan when on time (e.g. 2:00 PM for 2:00 PM booking), not reenter", async () => {
    const ctx = await setupWebReservation();

    // Guest arrives right on time at 2:00 PM (14:00 UTC)
    ctx.setCurrentTime(new Date("2026-09-12T14:00:00.000Z"));

    // First scan via staff scanner
    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(ctx.token, {
      userId: "staff-gate-1",
      role: "STAFF",
    });

    // Verify scan result reflects initial check-in (NOT re-entry)
    assert.equal(scanResult.accessState, "ACTIVE");
    assert.equal(scanResult.checkInState, "CHECKED_IN");
    assert.equal(scanResult.reservationStatus, "CHECKED_IN");
    assert.equal(scanResult.checkedInAt, "2026-09-12T14:00:00.000Z");
    assert.equal(scanResult.reentry, false, "First scan must NOT be marked as re-entry");

    // Verify persistence in repository
    const stored = await ctx.reservationRepo.getOperationalReservation(ctx.reservationId);
    assert.ok(stored);
    assert.equal(stored.reservationStatus, "CHECKED_IN");
    assert.equal(stored.checkedInAt, "2026-09-12T14:00:00.000Z");

    // Verify audit log
    const activities = await ctx.staffOpsService.listOperationalActivity(10);
    const checkInActivity = activities.find(
      (a) => a.reservationId === ctx.reservationId && a.activityType === "CHECK_IN"
    );
    assert.ok(checkInActivity, "Operational CHECK_IN activity log must exist");
    assert.equal(checkInActivity.occurredAt, "2026-09-12T14:00:00.000Z");

    // Spot must show as OCCUPIED in occupancy list
    const occupancy = await ctx.staffOpsService.listOccupancy();
    const spot = occupancy.find((o) => o.workspaceInstanceId === ctx.instanceId);
    assert.ok(spot);
    assert.equal(spot.occupancyState, "OCCUPIED");
  });

  it("treats subsequent scan after check-in during active window as re-entry", async () => {
    const ctx = await setupWebReservation();

    // 1. Initial scan at 2:00 PM -> check-in
    ctx.setCurrentTime(new Date("2026-09-12T14:00:00.000Z"));
    const firstScan = await ctx.bookingAccessService.resolveBookingAccess(ctx.token, {
      userId: "staff-gate-1",
      role: "STAFF",
    });
    assert.equal(firstScan.reentry, false);
    assert.equal(firstScan.checkInState, "CHECKED_IN");

    // 2. Guest steps out and returns at 2:15 PM -> re-entry
    ctx.setCurrentTime(new Date("2026-09-12T14:15:00.000Z"));
    const secondScan = await ctx.bookingAccessService.resolveBookingAccess(ctx.token, {
      userId: "staff-gate-1",
      role: "STAFF",
    });

    assert.equal(secondScan.accessState, "ACTIVE");
    assert.equal(secondScan.checkInState, "CHECKED_IN");
    assert.equal(secondScan.reservationStatus, "CHECKED_IN");
    assert.equal(secondScan.checkedInAt, "2026-09-12T14:00:00.000Z", "Must preserve original check-in time");
    assert.equal(secondScan.reentry, true, "Subsequent scan must be marked as re-entry");

    // Verify REENTRY audit activity exists
    const activities = await ctx.staffOpsService.listOperationalActivity(10);
    const reentryActivity = activities.find(
      (a) => a.reservationId === ctx.reservationId && a.activityType === "REENTRY"
    );
    assert.ok(reentryActivity, "Operational REENTRY activity log must exist");
    assert.equal(reentryActivity.occurredAt, "2026-09-12T14:15:00.000Z");
  });

  it("does NOT check in when scanned early before scheduled window (e.g. 1:30 PM for 2:00 PM booking)", async () => {
    const ctx = await setupWebReservation();

    // Guest arrives 30 minutes early at 1:30 PM (13:30 UTC)
    ctx.setCurrentTime(new Date("2026-09-12T13:30:00.000Z"));

    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(ctx.token, {
      userId: "staff-gate-1",
      role: "STAFF",
    });

    assert.equal(scanResult.accessState, "NOT_ACTIVE");
    assert.equal(scanResult.checkInState, "NOT_CHECKED_IN");
    assert.equal(scanResult.reservationStatus, "CONFIRMED");
    assert.equal(scanResult.checkedInAt, null);
    assert.equal(scanResult.reentry, false);

    // Reservation must remain CONFIRMED
    const stored = await ctx.reservationRepo.getOperationalReservation(ctx.reservationId);
    assert.ok(stored);
    assert.equal(stored.reservationStatus, "CONFIRMED");
    assert.equal(stored.checkedInAt, null);
  });

  it("does NOT check in when scanned after scheduled window has expired (e.g. 4:30 PM for 2:00-4:00 PM)", async () => {
    const ctx = await setupWebReservation();

    // Scan after booking window expired
    ctx.setCurrentTime(new Date("2026-09-12T16:30:00.000Z"));

    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(ctx.token);

    assert.equal(scanResult.accessState, "EXPIRED");
    assert.equal(scanResult.checkInState, "NOT_CHECKED_IN");
    assert.equal(scanResult.reservationStatus, "CONFIRMED");
    assert.equal(scanResult.checkedInAt, null);
  });

  it("performs first-scan check-in identically for Kiosk scanner actor", async () => {
    const ctx = await setupWebReservation();

    // Guest scans at Kiosk at 2:00 PM (14:00 UTC) with Kiosk/System actor
    ctx.setCurrentTime(new Date("2026-09-12T14:00:00.000Z"));

    const kioskScan = await ctx.bookingAccessService.resolveBookingAccess(ctx.token, {
      role: "SYSTEM",
    });

    assert.equal(kioskScan.accessState, "ACTIVE");
    assert.equal(kioskScan.checkInState, "CHECKED_IN");
    assert.equal(kioskScan.reservationStatus, "CHECKED_IN");
    assert.equal(kioskScan.checkedInAt, "2026-09-12T14:00:00.000Z");
    assert.equal(kioskScan.reentry, false);

    // Spot shows OCCUPIED
    const occupancy = await ctx.staffOpsService.listOccupancy();
    const spot = occupancy.find((o) => o.workspaceInstanceId === ctx.instanceId);
    assert.equal(spot?.occupancyState, "OCCUPIED");
  });

  it("keeps getBookingAccess read-only without checking in or recording scans", async () => {
    const ctx = await setupWebReservation();

    // Customer opens booking confirmation link on phone at 2:00 PM
    ctx.setCurrentTime(new Date("2026-09-12T14:00:00.000Z"));

    const passView = await ctx.bookingAccessService.getBookingAccess(ctx.token);

    assert.equal(passView.accessState, "ACTIVE");
    assert.equal(passView.checkInState, "NOT_CHECKED_IN");
    assert.equal(passView.reservationStatus, "CONFIRMED");
    assert.equal(passView.checkedInAt, null);

    // Reservation in repository must still be CONFIRMED
    const stored = await ctx.reservationRepo.getOperationalReservation(ctx.reservationId);
    assert.ok(stored);
    assert.equal(stored.reservationStatus, "CONFIRMED");
    assert.equal(stored.checkedInAt, null);

    // No scan events or audit logs should have been recorded
    const scanEvents = ctx.reservationRepo.getBookingScanEvents();
    assert.equal(scanEvents.length, 0, "Read-only pass view must not create booking scan events");
  });
});
