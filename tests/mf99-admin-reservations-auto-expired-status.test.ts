import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  AdminReservationService,
  createPaymentSessionService,
  createReservationService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  createCounterPaymentService,
  createStaffOperationsService,
} from "@deskatlas/domain";

describe("MF-99: Admin Reservations Auto-Expired Status Upon End Time", () => {
  async function setupFixture() {
    let currentTime = new Date("2026-09-09T08:00:00.000Z");
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
    const counterPaymentService = createCounterPaymentService(reservationRepo);
    const staffOperationsService = createStaffOperationsService(reservationRepo, () => currentTime);
    const adminReservationService = new AdminReservationService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Dedicated Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#10b981",
      isActive: true,
    });
    const instanceA = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "D-01",
      displayName: "Desk 01",
    });
    const instanceB = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "D-02",
      displayName: "Desk 02",
    });

    return {
      reservationRepo,
      workspaceRepo,
      instanceA,
      instanceB,
      getTime: () => currentTime,
      setTime: (d: Date) => {
        currentTime = d;
      },
      reservationService,
      counterPaymentService,
      staffOperationsService,
      adminReservationService,
    };
  }

  it("marks confirmed reservation as EXPIRED in list and detail once end time passes", async () => {
    const ctx = await setupFixture();

    // Create a web reservation for 09:00 - 12:00
    const created = await ctx.reservationService.createReservation({
      source: "WEB",
      customerFirstName: "Maria",
      customerLastName: "Santos",
      customerEmail: "maria@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: ctx.instanceA.id,
          startAt: "2026-09-09T09:00:00.000Z",
          endAt: "2026-09-09T12:00:00.000Z",
        },
      ],
    },
    { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Mark as CONFIRMED (e.g. online payment approved, spot allocated)
    const stored = ctx.reservationRepo.getStoredReservation(created.id)!;
    stored.status = "CONFIRMED";
    stored.confirmedAt = "2026-09-09T08:30:00.000Z";
    stored.candidates![0].isAssigned = true;

    // At 10:00 (during booking period, before end time)
    ctx.setTime(new Date("2026-09-09T10:00:00.000Z"));

    const activeBefore = await ctx.adminReservationService.listReservations("active");
    assert.equal(activeBefore.total, 1);
    assert.equal(activeBefore.reservations[0].reservationStatus, "CONFIRMED");
    assert.equal(activeBefore.reservations[0].status, "Confirmed");

    const upcomingBefore = await ctx.adminReservationService.listReservations("upcoming");
    assert.equal(upcomingBefore.total, 1);

    const expiredBefore = await ctx.adminReservationService.listReservations("expired");
    assert.equal(expiredBefore.total, 0);

    // Advance time past end time (12:05)
    ctx.setTime(new Date("2026-09-09T12:05:00.000Z"));

    // Active filter must exclude it
    const activeAfter = await ctx.adminReservationService.listReservations("active");
    assert.equal(activeAfter.total, 0);

    // Upcoming filter must exclude it
    const upcomingAfter = await ctx.adminReservationService.listReservations("upcoming");
    assert.equal(upcomingAfter.total, 0);

    // Expired filter must include it
    const expiredAfter = await ctx.adminReservationService.listReservations("expired");
    assert.equal(expiredAfter.total, 1);
    assert.equal(expiredAfter.reservations[0].referenceCode, created.referenceCode);
    assert.equal(expiredAfter.reservations[0].reservationStatus, "EXPIRED");
    assert.equal(expiredAfter.reservations[0].status, "Expired");
    assert.equal(expiredAfter.reservations[0].mark, "✕");

    // All filter retains it with Expired status badge
    const allList = await ctx.adminReservationService.listReservations("all");
    assert.equal(allList.total, 1);
    assert.equal(allList.reservations[0].reservationStatus, "EXPIRED");
    assert.equal(allList.reservations[0].status, "Expired");

    // Detail view reflects EXPIRED with timeline and expiry reason
    const detail = await ctx.adminReservationService.getReservationDetail(created.referenceCode);
    assert.ok(detail);
    assert.equal(detail.reservationStatus, "EXPIRED");
    assert.equal(detail.status, "Expired");
    assert.equal(detail.mark, "✕");
    assert.equal(detail.expiryReason, "Booking period ended");
    assert.ok(detail.timeline.some((t) => t.includes("Booking period ended (Expired)")));
  });

  it("marks checked-in reservation as EXPIRED once end time passes (autocheckout)", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Jose",
      customerLastName: "Rizal",
      customerEmail: "jose@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: ctx.instanceB.id,
          startAt: "2026-09-09T09:00:00.000Z",
          endAt: "2026-09-09T11:00:00.000Z",
        },
      ],
    });

    await ctx.counterPaymentService.confirmPayment({
      code: created.referenceCode,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // While checked in (10:00)
    ctx.setTime(new Date("2026-09-09T10:00:00.000Z"));
    const checkedInList = await ctx.adminReservationService.listReservations("checked_in");
    assert.equal(checkedInList.total, 1);
    assert.equal(checkedInList.reservations[0].reservationStatus, "CHECKED_IN");
    assert.equal(checkedInList.reservations[0].status, "Checked In");

    const activeList = await ctx.adminReservationService.listReservations("active");
    assert.equal(activeList.total, 1);

    // Advance time past end time (11:01) without manual checkout
    ctx.setTime(new Date("2026-09-09T11:01:00.000Z"));

    // Active filter excludes it
    const activeAfter = await ctx.adminReservationService.listReservations("active");
    assert.equal(activeAfter.total, 0);

    // Checked-in filter excludes it (no longer actively in session)
    const checkedInAfter = await ctx.adminReservationService.listReservations("checked_in");
    assert.equal(checkedInAfter.total, 0);

    // Expired filter includes it
    const expiredAfter = await ctx.adminReservationService.listReservations("expired");
    assert.equal(expiredAfter.total, 1);
    assert.equal(expiredAfter.reservations[0].referenceCode, created.referenceCode);
    assert.equal(expiredAfter.reservations[0].reservationStatus, "EXPIRED");
    assert.equal(expiredAfter.reservations[0].status, "Expired");

    // Detail view reflects EXPIRED
    const detail = await ctx.adminReservationService.getReservationDetail(created.id);
    assert.ok(detail);
    assert.equal(detail.reservationStatus, "EXPIRED");
    assert.equal(detail.status, "Expired");
    assert.equal(detail.expiryReason, "Booking period ended");
    assert.ok(detail.timeline.some((t) => t.includes("Booking period ended (Expired)")));
  });

  it("does not expire reservations whose end time is in the future", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation({
      source: "WEB",
      customerFirstName: "Future",
      customerLastName: "Guest",
      customerEmail: "future@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: ctx.instanceA.id,
          startAt: "2026-09-09T14:00:00.000Z",
          endAt: "2026-09-09T17:00:00.000Z",
        },
      ],
    },
    { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const stored = ctx.reservationRepo.getStoredReservation(created.id)!;
    stored.status = "CONFIRMED";
    stored.confirmedAt = "2026-09-09T08:30:00.000Z";
    stored.candidates![0].isAssigned = true;

    // Time is 09:00, booking is at 14:00 - 17:00
    ctx.setTime(new Date("2026-09-09T09:00:00.000Z"));

    const activeList = await ctx.adminReservationService.listReservations("active");
    assert.equal(activeList.total, 1);
    assert.equal(activeList.reservations[0].reservationStatus, "CONFIRMED");

    const expiredList = await ctx.adminReservationService.listReservations("expired");
    assert.equal(expiredList.total, 0);

    const detail = await ctx.adminReservationService.getReservationDetail(created.referenceCode);
    assert.ok(detail);
    assert.equal(detail.reservationStatus, "CONFIRMED");
    assert.equal(detail.status, "Confirmed");
  });

  it("preserves CANCELLED status even if booking end time has passed", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Cancelled",
      customerLastName: "User",
      customerEmail: "cancelled@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: ctx.instanceA.id,
          startAt: "2026-09-09T09:00:00.000Z",
          endAt: "2026-09-09T11:00:00.000Z",
        },
      ],
    });

    await ctx.counterPaymentService.confirmPayment({
      code: created.referenceCode,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // Cancel reservation
    await ctx.adminReservationService.cancelReservation({
      reservationId: created.id,
      reason: "Customer Request",
      notes: "Guest requested cancellation",
    });

    // Advance time past end time
    ctx.setTime(new Date("2026-09-09T12:00:00.000Z"));

    const allList = await ctx.adminReservationService.listReservations("all");
    assert.equal(allList.total, 1);
    assert.equal(allList.reservations[0].reservationStatus, "CANCELLED");
    assert.equal(allList.reservations[0].status, "Cancelled");

    const expiredList = await ctx.adminReservationService.listReservations("expired");
    assert.equal(expiredList.total, 0);

    const detail = await ctx.adminReservationService.getReservationDetail(created.id);
    assert.ok(detail);
    assert.equal(detail.reservationStatus, "CANCELLED");
    assert.equal(detail.status, "Cancelled");
  });

  it("marks pending payment reservation as EXPIRED once booking end time passes even before 1h proof window", async () => {
    const ctx = await setupFixture();

    // Booking created at 09:30 for 09:00 - 10:00 slot
    ctx.setTime(new Date("2026-09-09T09:30:00.000Z"));

    const created = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Late",
        customerLastName: "Booker",
        customerEmail: "late@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceA.id,
            startAt: "2026-09-09T09:00:00.000Z",
            endAt: "2026-09-09T10:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // At 09:45 (before 10:00 end time, within 1h proof window)
    ctx.setTime(new Date("2026-09-09T09:45:00.000Z"));
    const awaitingBefore = await ctx.adminReservationService.listReservations("awaiting_proof");
    assert.equal(awaitingBefore.total, 1);

    const expiredBefore = await ctx.adminReservationService.listReservations("expired");
    assert.equal(expiredBefore.total, 0);

    // At 10:01 (booking end time passed, although 1h from 09:30 is 10:30)
    ctx.setTime(new Date("2026-09-09T10:01:00.000Z"));

    const awaitingAfter = await ctx.adminReservationService.listReservations("awaiting_proof");
    assert.equal(awaitingAfter.total, 0);

    const expiredAfter = await ctx.adminReservationService.listReservations("expired");
    assert.equal(expiredAfter.total, 1);
    assert.equal(expiredAfter.reservations[0].reservationStatus, "EXPIRED");
    assert.equal(expiredAfter.reservations[0].status, "Expired");
  });

  it("preserves Rejected status when payment was rejected even after end time passes", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Rejected",
        customerLastName: "Payer",
        customerEmail: "rejected@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceA.id,
            startAt: "2026-09-09T09:00:00.000Z",
            endAt: "2026-09-09T10:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const stored = ctx.reservationRepo.getStoredReservation(created.id)!;
    stored.status = "CANCELLED";
    const attempts = ctx.reservationRepo.getStoredPaymentAttempts();
    const attempt = attempts.find((a) => a.reservationId === created.id);
    if (attempt) {
      attempt.status = "REJECTED";
      attempt.rejectionReason = "Invalid reference number";
    }

    // Advance time past end time
    ctx.setTime(new Date("2026-09-09T11:00:00.000Z"));

    const rejectedList = await ctx.adminReservationService.listReservations("rejected");
    assert.equal(rejectedList.total, 1);
    assert.equal(rejectedList.reservations[0].status, "Rejected");

    const expiredList = await ctx.adminReservationService.listReservations("expired");
    assert.equal(expiredList.total, 0);
  });
});
