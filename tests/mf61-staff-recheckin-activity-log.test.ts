import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createBookingAccessService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  createStaffDashboardService,
  createStaffOperationsService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("MF-61: Staff Re-Check-In Activity Log", () => {
  async function setupTestEnvironment() {
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
    const staffDashboardService = createStaffDashboardService(
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

    async function createAndApproveReservation(customer: {
      firstName: string;
      lastName: string;
      email: string;
      instanceCode: string;
      displayName: string;
    }) {
      const instance = await workspaceRepo.createInstance({
        templateId: template.id,
        floorId: floor.id,
        instanceCode: customer.instanceCode,
        displayName: customer.displayName,
      });

      const res = await reservationService.createReservation(
        {
          source: "WEB",
          customerFirstName: customer.firstName,
          customerLastName: customer.lastName,
          customerEmail: customer.email,
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

      await paymentSessionService.submitPaymentProof({
        token: res.paymentSession!.token,
        paymentMethodId: "pm-gcash",
        proofStoragePath: `proofs/${customer.firstName.toLowerCase()}.png`,
      });
      const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);
      await paymentReviewService.reviewPayment({
        paymentAttemptId: session.paymentAttemptId,
        actor: { userId: "admin-1", role: "ADMIN" },
        decision: "APPROVE",
      });

      const issue = await bookingAccessService.issueBookingAccess(
        res.id,
        res.referenceCode,
        "https://deskatlas.test/booking"
      );

      return { reservation: res, token: issue!.token, instance };
    }

    return {
      reservationRepo,
      workspaceRepo,
      reservationService,
      paymentSessionService,
      paymentReviewService,
      bookingAccessService,
      staffOperationsService,
      staffDashboardService,
      createAndApproveReservation,
      setCurrentTime: (d: Date) => {
        currentTime = d;
      },
    };
  }

  it("includes re-entry events in the Staff operational activity list with customer name, workspace, timestamp, and actor", async () => {
    const env = await setupTestEnvironment();
    const { reservation, token } = await env.createAndApproveReservation({
      firstName: "Alex",
      lastName: "Reyes",
      email: "alex@example.com",
      instanceCode: "FP-101",
      displayName: "Focus Pod 101",
    });

    // 1. Initial Check-in at 10:02 AM by Staff 1
    env.setCurrentTime(new Date("2026-08-26T10:02:00.000Z"));
    await env.staffOperationsService.checkInReservation({
      reservationId: reservation.id,
      actor: { userId: "staff-gate-1", role: "STAFF" },
    });

    // 2. Re-entry at 11:15 AM by Staff 2
    env.setCurrentTime(new Date("2026-08-26T11:15:00.000Z"));
    await env.bookingAccessService.resolveBookingAccess(token, {
      userId: "staff-gate-2",
      role: "STAFF",
    });

    // List operational activity
    const activities = await env.staffOperationsService.listOperationalActivity(10);
    const reentryEvent = activities.find(
      (a) => a.reservationId === reservation.id && a.activityType === "REENTRY"
    );

    assert.ok(reentryEvent, "Expected REENTRY activity log to be found in staff operational activity");
    assert.equal(reentryEvent.activityType, "REENTRY");
    assert.equal(reentryEvent.customerName, "Alex Reyes");
    assert.equal(reentryEvent.occurredAt, "2026-08-26T11:15:00.000Z");
    assert.equal(reentryEvent.actorUserId, "staff-gate-2");
    assert.equal(reentryEvent.actorRole, "STAFF");
    assert.ok(reentryEvent.actorName, "Expected actorName to be populated");
  });

  it("supports filtering operational activity by activityType in staffOperationsService", async () => {
    const env = await setupTestEnvironment();
    const { reservation, token } = await env.createAndApproveReservation({
      firstName: "Taylor",
      lastName: "Swift",
      email: "taylor@example.com",
      instanceCode: "FP-102",
      displayName: "Focus Pod 102",
    });

    // Check-in
    env.setCurrentTime(new Date("2026-08-26T10:05:00.000Z"));
    await env.staffOperationsService.checkInReservation({
      reservationId: reservation.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // Re-entry
    env.setCurrentTime(new Date("2026-08-26T11:30:00.000Z"));
    await env.bookingAccessService.resolveBookingAccess(token, {
      userId: "staff-2",
      role: "STAFF",
    });

    // Filter by REENTRY only
    const reentriesOnly = await env.staffOperationsService.listOperationalActivity(10, {
      activityType: "REENTRY",
    });
    assert.ok(reentriesOnly.length >= 1);
    assert.ok(reentriesOnly.every((a) => a.activityType === "REENTRY"));
  });

  it("displays re-entry events in the Staff dashboard activity feed with a distinguishable label, icon, styling, and actor details", async () => {
    const env = await setupTestEnvironment();
    const { reservation, token } = await env.createAndApproveReservation({
      firstName: "Beatrix",
      lastName: "Kiddo",
      email: "beatrix@example.com",
      instanceCode: "FP-103",
      displayName: "Focus Pod 103",
    });

    // Initial check in
    env.setCurrentTime(new Date("2026-08-26T10:00:00.000Z"));
    await env.staffOperationsService.checkInReservation({
      reservationId: reservation.id,
      actor: { userId: "staff-desk-1", role: "STAFF" },
    });

    // Guest re-enters at 11:45 AM
    env.setCurrentTime(new Date("2026-08-26T11:45:00.000Z"));
    await env.bookingAccessService.resolveBookingAccess(token, {
      userId: "staff-desk-2",
      role: "STAFF",
    });

    const snapshot = await env.staffDashboardService.getDashboardSnapshot("today");
    const checkInItem = snapshot.activity.find(
      (a) => a.name === "Beatrix Kiddo" && a.status === "Checked In"
    );
    const reEntryItem = snapshot.activity.find(
      (a) => a.name === "Beatrix Kiddo" && (a.status === "Re-entered" || a.status === "Re-entry")
    );

    assert.ok(checkInItem, "Expected 'Checked In' event in Staff dashboard activity");
    assert.ok(reEntryItem, "Expected 'Re-entered' event in Staff dashboard activity");

    // Distinguishable label
    assert.notEqual(reEntryItem.status, checkInItem.status);
    assert.ok(reEntryItem.status.toLowerCase().includes("re-enter") || reEntryItem.status.toLowerCase().includes("re-entry"));

    // Distinguishable mark (↺ vs ✓)
    assert.equal(reEntryItem.mark, "↺");
    assert.notEqual(reEntryItem.mark, checkInItem.mark);

    // Distinguishable style
    assert.deepEqual(reEntryItem.style, { background: "#E0F2FE", color: "#0369A1" });
    assert.notDeepEqual(reEntryItem.style, checkInItem.style);

    // Actor details present
    assert.equal(reEntryItem.actorUserId, "staff-desk-2");
    assert.equal(reEntryItem.actorRole, "STAFF");
    assert.ok(reEntryItem.actorName);
  });

  it("maintains strict chronological ordering with re-entry events interleaved among other events", async () => {
    const env = await setupTestEnvironment();
    const { reservation, token } = await env.createAndApproveReservation({
      firstName: "Marcus",
      lastName: "Vance",
      email: "marcus@example.com",
      instanceCode: "FP-104",
      displayName: "Focus Pod 104",
    });

    // Event 1: Check in at 10:00 AM
    env.setCurrentTime(new Date("2026-08-26T10:00:00.000Z"));
    await env.staffOperationsService.checkInReservation({
      reservationId: reservation.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // Event 2: Re-entry 1 at 10:45 AM
    env.setCurrentTime(new Date("2026-08-26T10:45:00.000Z"));
    await env.bookingAccessService.resolveBookingAccess(token, {
      userId: "staff-1",
      role: "STAFF",
    });

    // Event 3: Re-entry 2 at 12:15 PM
    env.setCurrentTime(new Date("2026-08-26T12:15:00.000Z"));
    await env.bookingAccessService.resolveBookingAccess(token, {
      userId: "staff-2",
      role: "STAFF",
    });

    // Event 4: Check out at 13:30 PM
    env.setCurrentTime(new Date("2026-08-26T13:30:00.000Z"));
    await env.staffOperationsService.checkOutReservation({
      reservationId: reservation.id,
      actor: { userId: "staff-2", role: "STAFF" },
    });

    const snapshot = await env.staffDashboardService.getDashboardSnapshot("today");
    const activity = snapshot.activity;

    // Verify ordering: newest occurredAt first
    for (let i = 0; i < activity.length - 1; i++) {
      assert.ok(
        activity[i].occurredAt >= activity[i + 1].occurredAt,
        `Expected activity[${i}] (${activity[i].occurredAt}) to be >= activity[${i + 1}] (${activity[i + 1].occurredAt})`
      );
    }

    const checkOutIndex = activity.findIndex((a) => a.status === "Checked Out");
    const reEntry2Index = activity.findIndex(
      (a) => a.occurredAt === "2026-08-26T12:15:00.000Z"
    );
    const reEntry1Index = activity.findIndex(
      (a) => a.occurredAt === "2026-08-26T10:45:00.000Z"
    );
    const checkInIndex = activity.findIndex((a) => a.status === "Checked In");

    assert.ok(checkOutIndex < reEntry2Index, "Check out should appear before Re-entry 2");
    assert.ok(reEntry2Index < reEntry1Index, "Re-entry 2 should appear before Re-entry 1");
    assert.ok(reEntry1Index < checkInIndex, "Re-entry 1 should appear before Check in");
  });

  it("allows Staff to see re-entry events for all bookings across the venue, not just their own scans", async () => {
    const env = await setupTestEnvironment();

    // Booking 1 scanned by staff-alpha
    const guest1 = await env.createAndApproveReservation({
      firstName: "Charlie",
      lastName: "Brown",
      email: "charlie@example.com",
      instanceCode: "FP-105",
      displayName: "Focus Pod 105",
    });
    env.setCurrentTime(new Date("2026-08-26T10:00:00.000Z"));
    await env.staffOperationsService.checkInReservation({
      reservationId: guest1.reservation.id,
      actor: { userId: "staff-alpha", role: "STAFF" },
    });
    env.setCurrentTime(new Date("2026-08-26T11:00:00.000Z"));
    await env.bookingAccessService.resolveBookingAccess(guest1.token, {
      userId: "staff-alpha",
      role: "STAFF",
    });

    // Booking 2 scanned by staff-beta
    const guest2 = await env.createAndApproveReservation({
      firstName: "Diana",
      lastName: "Prince",
      email: "diana@example.com",
      instanceCode: "FP-106",
      displayName: "Focus Pod 106",
    });
    env.setCurrentTime(new Date("2026-08-26T10:10:00.000Z"));
    await env.staffOperationsService.checkInReservation({
      reservationId: guest2.reservation.id,
      actor: { userId: "staff-beta", role: "STAFF" },
    });
    env.setCurrentTime(new Date("2026-08-26T11:20:00.000Z"));
    await env.bookingAccessService.resolveBookingAccess(guest2.token, {
      userId: "staff-beta",
      role: "STAFF",
    });

    // Booking 3 scanned by admin-omega
    const guest3 = await env.createAndApproveReservation({
      firstName: "Evan",
      lastName: "Wright",
      email: "evan@example.com",
      instanceCode: "FP-107",
      displayName: "Focus Pod 107",
    });
    env.setCurrentTime(new Date("2026-08-26T10:20:00.000Z"));
    await env.staffOperationsService.checkInReservation({
      reservationId: guest3.reservation.id,
      actor: { userId: "admin-omega", role: "ADMIN" },
    });
    env.setCurrentTime(new Date("2026-08-26T11:40:00.000Z"));
    await env.bookingAccessService.resolveBookingAccess(guest3.token, {
      userId: "admin-omega",
      role: "ADMIN",
    });

    // All re-entries are visible to Staff in listOperationalActivity
    const activities = await env.staffOperationsService.listOperationalActivity(20);
    const reentries = activities.filter((a) => a.activityType === "REENTRY");

    assert.equal(reentries.length, 3, "All 3 re-entry events should be listed for Staff");
    const scannedActors = new Set(reentries.map((r) => r.actorUserId));
    assert.ok(scannedActors.has("staff-alpha"));
    assert.ok(scannedActors.has("staff-beta"));
    assert.ok(scannedActors.has("admin-omega"));

    // And in the Staff dashboard activity feed
    const snapshot = await env.staffDashboardService.getDashboardSnapshot("today");
    const dashboardReentries = snapshot.activity.filter((a) => a.status === "Re-entered");
    assert.equal(dashboardReentries.length, 3, "All 3 re-entry items should appear in Staff dashboard feed");
  });

  it("does not regress on existing activity feed events (initial check-ins, check-outs, confirmations)", async () => {
    const env = await setupTestEnvironment();
    const { reservation } = await env.createAndApproveReservation({
      firstName: "Fiona",
      lastName: "Gallagher",
      email: "fiona@example.com",
      instanceCode: "FP-108",
      displayName: "Focus Pod 108",
    });

    // Initial check in
    env.setCurrentTime(new Date("2026-08-26T10:05:00.000Z"));
    await env.staffOperationsService.checkInReservation({
      reservationId: reservation.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // Check out
    env.setCurrentTime(new Date("2026-08-26T12:00:00.000Z"));
    await env.staffOperationsService.checkOutReservation({
      reservationId: reservation.id,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    const snapshot = await env.staffDashboardService.getDashboardSnapshot("today");
    const checkIn = snapshot.activity.find((a) => a.name === "Fiona Gallagher" && a.status === "Checked In");
    const checkOut = snapshot.activity.find((a) => a.name === "Fiona Gallagher" && a.status === "Checked Out");

    assert.ok(checkIn, "Initial check-in event present");
    assert.equal(checkIn.mark, "✓");
    assert.deepEqual(checkIn.style, { background: "var(--da-info)", color: "var(--da-brand-dark)" });

    assert.ok(checkOut, "Check-out event present");
    assert.equal(checkOut.mark, "→");
    assert.deepEqual(checkOut.style, { background: "var(--da-canvas)", color: "var(--da-text-secondary)" });
  });
});
