import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createAdminDashboardService,
  createBookingAccessService,
  createCounterPaymentService,
  createPaymentSessionService,
  createReservationService,
  createStaffDashboardService,
  createStaffOperationsService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("MF-178: Prevent Duplicate Check-In and Spurious Recheck-In Logs on Kiosk Confirmation", () => {
  async function setupTestContext() {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let currentTime = new Date("2026-09-23T10:00:00.000Z");
    const nowProvider = () => currentTime;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const counterPaymentService = createCounterPaymentService(reservationRepo, nowProvider);
    const bookingAccessService = createBookingAccessService(reservationRepo, nowProvider);
    const staffOpsService = createStaffOperationsService(reservationRepo, nowProvider);
    const staffDashboardService = createStaffDashboardService(
      reservationRepo,
      reservationRepo,
      workspaceRepo,
      nowProvider,
      "Asia/Manila"
    );
    const adminDashboardService = createAdminDashboardService(
      reservationRepo,
      reservationRepo,
      workspaceRepo,
      nowProvider,
      "Asia/Manila"
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

    return {
      reservationRepo,
      workspaceRepo,
      reservationService,
      counterPaymentService,
      bookingAccessService,
      staffOpsService,
      staffDashboardService,
      adminDashboardService,
      instance,
      setTime: (d: Date) => {
        currentTime = d;
      },
    };
  }

  it("logs exactly one CHECK_IN activity and no REENTRY on kiosk counter payment confirmation", async () => {
    const ctx = await setupTestContext();
    ctx.setTime(new Date("2026-09-23T10:00:00.000Z"));

    // 1. Walk-in guest books at kiosk
    const reservation = await ctx.reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Maurice",
      customerLastName: "Guest",
      customerEmail: "maurice.guest@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: ctx.instance.id,
          startAt: "2026-09-23T10:00:00.000Z",
          endAt: "2026-09-23T12:00:00.000Z",
        },
      ],
    });

    assert.equal(reservation.status, "PENDING_COUNTER_CONFIRMATION");
    assert.ok(reservation.counterPaymentAttemptId);

    // 2. Staff confirms counter payment
    const confirmResult = await ctx.counterPaymentService.confirmPayment({
      paymentAttemptId: reservation.counterPaymentAttemptId!,
      actor: { userId: "staff-maurice", role: "STAFF" },
    });

    assert.equal(confirmResult.reservationStatus, "CHECKED_IN");

    // 3. Booking token is issued (as done in counter confirmation route)
    const access = await ctx.bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://deskatlas.test/access"
    );
    assert.ok(access);

    // 4. Initial access pass resolution / lookup immediately after confirmation
    ctx.setTime(new Date("2026-09-23T10:00:05.000Z"));
    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(access.token, {
      userId: "staff-maurice",
      role: "STAFF",
    });

    assert.equal(scanResult.accessState, "ACTIVE");
    assert.equal(scanResult.checkInState, "CHECKED_IN");
    assert.equal(scanResult.reservationStatus, "CHECKED_IN");
    assert.equal(scanResult.reentry, false, "Initial scan/resolution after kiosk confirmation must NOT be marked as re-entry");

    // 5. Verify operational activity logs
    const activities = await ctx.staffOpsService.listOperationalActivity(20);
    const reservationActivities = activities.filter((a) => a.reservationId === reservation.id);

    const checkInEvents = reservationActivities.filter((a) => a.activityType === "CHECK_IN");
    const reentryEvents = reservationActivities.filter((a) => a.activityType === "REENTRY");

    assert.equal(checkInEvents.length, 1, "Must have exactly 1 CHECK_IN activity log");
    assert.equal(reentryEvents.length, 0, "Must have 0 REENTRY activity logs upon kiosk confirmation");
  });

  it("shows exactly one 'Checked In' entry in Staff Dashboard Today's Activity feed", async () => {
    const ctx = await setupTestContext();
    ctx.setTime(new Date("2026-09-23T10:00:00.000Z"));

    const reservation = await ctx.reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Maurice",
      customerLastName: "Guest",
      customerEmail: "maurice.guest@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: ctx.instance.id,
          startAt: "2026-09-23T10:00:00.000Z",
          endAt: "2026-09-23T12:00:00.000Z",
        },
      ],
    });

    await ctx.counterPaymentService.confirmPayment({
      paymentAttemptId: reservation.counterPaymentAttemptId!,
      actor: { userId: "staff-maurice", role: "STAFF" },
    });

    const access = await ctx.bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://deskatlas.test/access"
    );
    assert.ok(access);

    // Initial access lookup
    await ctx.bookingAccessService.resolveBookingAccess(access.token, {
      userId: "staff-maurice",
      role: "STAFF",
    });

    const staffDashboard = await ctx.staffDashboardService.getDashboardSnapshot("today");
    const guestActivityItems = staffDashboard.activity.filter((item) =>
      item.name.includes("Maurice Guest")
    );

    const checkedInItems = guestActivityItems.filter((item) => item.status === "Checked In");
    const reenteredItems = guestActivityItems.filter((item) => item.status === "Re-entered");

    assert.equal(checkedInItems.length, 1, "Staff Activity feed must show exactly 1 'Checked In' entry");
    assert.equal(reenteredItems.length, 0, "Staff Activity feed must not show any 'Re-entered' entry");
  });

  it("shows exactly one 'Checked In' entry in Admin Portal activity stream", async () => {
    const ctx = await setupTestContext();
    ctx.setTime(new Date("2026-09-23T10:00:00.000Z"));

    const reservation = await ctx.reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Maurice",
      customerLastName: "Guest",
      customerEmail: "maurice.guest@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: ctx.instance.id,
          startAt: "2026-09-23T10:00:00.000Z",
          endAt: "2026-09-23T12:00:00.000Z",
        },
      ],
    });

    await ctx.counterPaymentService.confirmPayment({
      paymentAttemptId: reservation.counterPaymentAttemptId!,
      actor: { userId: "staff-maurice", role: "STAFF" },
    });

    const access = await ctx.bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://deskatlas.test/access"
    );
    assert.ok(access);

    await ctx.bookingAccessService.resolveBookingAccess(access.token, {
      userId: "staff-maurice",
      role: "STAFF",
    });

    const adminDashboard = await ctx.adminDashboardService.getDashboardSnapshot("today");
    const guestActivityItems = adminDashboard.activity.filter((item) =>
      item.name.includes("Maurice Guest")
    );

    const checkedInItems = guestActivityItems.filter((item) => item.status === "Checked In");
    const reenteredItems = guestActivityItems.filter((item) => item.status === "Re-entered");

    assert.equal(checkedInItems.length, 1, "Admin Activity feed must show exactly 1 'Checked In' entry");
    assert.equal(reenteredItems.length, 0, "Admin Activity feed must not show any 'Re-entered' entry");
  });

  it("correctly logs REENTRY when a kiosk guest re-enters later during their session", async () => {
    const ctx = await setupTestContext();
    ctx.setTime(new Date("2026-09-23T10:00:00.000Z"));

    const reservation = await ctx.reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Maurice",
      customerLastName: "Guest",
      customerEmail: "maurice.guest@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: ctx.instance.id,
          startAt: "2026-09-23T10:00:00.000Z",
          endAt: "2026-09-23T12:00:00.000Z",
        },
      ],
    });

    await ctx.counterPaymentService.confirmPayment({
      paymentAttemptId: reservation.counterPaymentAttemptId!,
      actor: { userId: "staff-maurice", role: "STAFF" },
    });

    const access = await ctx.bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://deskatlas.test/access"
    );
    assert.ok(access);

    // Initial door scan at 10:01 AM
    ctx.setTime(new Date("2026-09-23T10:01:00.000Z"));
    const firstScan = await ctx.bookingAccessService.resolveBookingAccess(access.token, {
      userId: "scanner-door",
      role: "STAFF",
    });
    assert.equal(firstScan.reentry, false);

    // Guest steps out and returns at 10:45 AM
    ctx.setTime(new Date("2026-09-23T10:45:00.000Z"));
    const reentryScan = await ctx.bookingAccessService.resolveBookingAccess(access.token, {
      userId: "scanner-door",
      role: "STAFF",
    });

    assert.equal(reentryScan.accessState, "ACTIVE");
    assert.equal(reentryScan.checkInState, "CHECKED_IN");
    assert.equal(reentryScan.reentry, true, "Subsequent scan must be recognized as re-entry");

    const activities = await ctx.staffOpsService.listOperationalActivity(20);
    const reservationActivities = activities.filter((a) => a.reservationId === reservation.id);
    const reentryEvents = reservationActivities.filter((a) => a.activityType === "REENTRY");

    assert.equal(reentryEvents.length, 1, "Must have exactly 1 REENTRY activity log after returning");
  });

  it("deduplicates multiple check-in logs occurring within 60 seconds for the same reservation in activity feeds", async () => {
    const ctx = await setupTestContext();
    ctx.setTime(new Date("2026-09-23T10:00:00.000Z"));

    const reservation = await ctx.reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Duplicate",
      customerLastName: "Test",
      customerEmail: "dup.test@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: ctx.instance.id,
          startAt: "2026-09-23T10:00:00.000Z",
          endAt: "2026-09-23T12:00:00.000Z",
        },
      ],
    });

    await ctx.counterPaymentService.confirmPayment({
      paymentAttemptId: reservation.counterPaymentAttemptId!,
      actor: { userId: "staff-maurice", role: "STAFF" },
    });

    // Manually inject a second duplicate check-in 10 seconds later to simulate legacy duplicate entries
    ctx.reservationRepo.addOperationalActivity({
      reservationId: reservation.id,
      referenceCode: reservation.referenceCode,
      customerName: "Duplicate Test",
      workspaceDisplayName: "Focus Pod 101",
      workspaceInstanceCode: "FP-101",
      activityType: "CHECK_IN",
      occurredAt: "2026-09-23T10:00:10.000Z",
      actorUserId: "staff-maurice",
      actorRole: "STAFF",
      actorName: "Staff",
    });

    const staffDashboard = await ctx.staffDashboardService.getDashboardSnapshot("today");
    const checkedInItems = staffDashboard.activity.filter(
      (item) => item.name.includes("Duplicate Test") && item.status === "Checked In"
    );

    assert.equal(
      checkedInItems.length,
      1,
      "Deduplication guard must collapse multiple CHECK_IN items within 60s into 1 item"
    );
  });
});
