import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  AdminReservationService,
  createPaymentSessionService,
  createReservationService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  type CreateReservationRequest,
} from "@deskatlas/domain";

describe("MF-60: Reservation Record Persistence After Payment Expiry", () => {
  async function setupFixture() {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let currentTime = new Date("2026-09-08T09:00:00.000Z");
    const nowProvider = () => currentTime;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
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
      paymentSessionService,
      reservationService,
      adminReservationService,
    };
  }

  it("updates status to EXPIRED on payment session expiry without deleting records or candidates", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Juan",
        customerLastName: "Dela Cruz",
        customerEmail: "juan@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceA.id,
            startAt: "2026-09-09T09:00:00.000Z",
            endAt: "2026-09-09T12:00:00.000Z",
          },
          {
            rank: 1,
            workspaceInstanceId: ctx.instanceB.id,
            startAt: "2026-09-09T09:00:00.000Z",
            endAt: "2026-09-09T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    assert.ok(created.id);
    assert.equal(created.status, "PENDING_PAYMENT");

    // Check that reservation exists in repository
    const storedBefore = ctx.reservationRepo.getStoredReservation(created.id);
    assert.ok(storedBefore);
    assert.equal(storedBefore.candidates?.length, 2);

    // Advance time past the 1-hour expiration window
    ctx.setTime(new Date("2026-09-08T10:30:00.000Z"));

    // Query session through paymentSessionService which triggers expirePaymentSession
    const session = await ctx.paymentSessionService.getPaymentSession(created.paymentSession!.token);
    assert.equal(session.paymentStatus, "EXPIRED");
    assert.equal(session.reservationStatus, "EXPIRED");

    // Verify reservation was NOT deleted from repository
    const storedAfter = ctx.reservationRepo.getStoredReservation(created.id);
    assert.ok(storedAfter, "Reservation record must NOT be deleted after expiry");
    assert.equal(storedAfter.status, "EXPIRED");
    assert.equal(storedAfter.customerFirstName, "Juan");
    assert.equal(storedAfter.customerLastName, "Dela Cruz");
    assert.equal(storedAfter.customerEmail, "juan@example.com");

    // Verify candidates were NOT removed
    assert.equal(storedAfter.candidates?.length, 2, "Candidate rows must NOT be deleted");

    // Verify payment attempts were NOT deleted
    const attempts = ctx.reservationRepo
      .getStoredPaymentAttempts()
      .filter((a) => a.reservationId === created.id);
    assert.equal(attempts.length, 1, "Payment attempt must be preserved");
    assert.equal(attempts[0].status, "EXPIRED");
  });

  it("filters reservations correctly between active (default), expired, and all views", async () => {
    const ctx = await setupFixture();

    // 1. Create a reservation that will expire
    const expiredRes = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Expired",
        customerLastName: "Customer",
        customerEmail: "expired@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceB.id,
            startAt: "2026-09-09T10:00:00.000Z",
            endAt: "2026-09-09T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Advance time past expiry for expiredRes
    ctx.setTime(new Date("2026-09-08T10:30:00.000Z"));
    // Expire the expiredRes session
    await ctx.paymentSessionService.getPaymentSession(expiredRes.paymentSession!.token);

    // 2. Create a reservation that is active at current time (10:30)
    const activeRes = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Active",
        customerLastName: "Guest",
        customerEmail: "active@example.com",
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

    // A. Default / Active filter: Should show only the active reservation
    const defaultList = await ctx.adminReservationService.listReservations();
    assert.equal(defaultList.total, 1);
    assert.equal(defaultList.reservations[0].referenceCode, activeRes.referenceCode);

    const activeList = await ctx.adminReservationService.listReservations("active");
    assert.equal(activeList.total, 1);
    assert.equal(activeList.reservations[0].referenceCode, activeRes.referenceCode);

    // B. Expired filter: Should show only the expired reservation
    const expiredList = await ctx.adminReservationService.listReservations("expired");
    assert.equal(expiredList.total, 1);
    assert.equal(expiredList.reservations[0].referenceCode, expiredRes.referenceCode);
    assert.equal(expiredList.reservations[0].reservationStatus, "EXPIRED");
    assert.equal(expiredList.reservations[0].status, "Expired");
    assert.equal(expiredList.reservations[0].mark, "✕");
    assert.equal(expiredList.reservations[0].paymentStatus, "Expired");

    // C. All filter: Should show both active and expired reservations
    const allList = await ctx.adminReservationService.listReservations("all");
    assert.equal(allList.total, 2);
    const codes = allList.reservations.map((r) => r.referenceCode);
    assert.ok(codes.includes(activeRes.referenceCode));
    assert.ok(codes.includes(expiredRes.referenceCode));
  });

  it("provides full detail view for expired reservations including candidates, payment attempt, and expiry reason", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Ramon",
        customerLastName: "Bautista",
        customerEmail: "ramon@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceA.id,
            startAt: "2026-09-10T08:00:00.000Z",
            endAt: "2026-09-10T11:00:00.000Z",
          },
          {
            rank: 1,
            workspaceInstanceId: ctx.instanceB.id,
            startAt: "2026-09-10T08:00:00.000Z",
            endAt: "2026-09-10T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Advance time and expire
    ctx.setTime(new Date("2026-09-08T11:00:00.000Z"));
    await ctx.paymentSessionService.getPaymentSession(created.paymentSession!.token);

    // Fetch detail via referenceCode
    const detail = await ctx.adminReservationService.getReservationDetail(created.referenceCode);
    assert.ok(detail, "Expired reservation detail must be accessible");
    assert.equal(detail.reservationStatus, "EXPIRED");
    assert.equal(detail.status, "Expired");
    assert.equal(detail.customerFirstName, "Ramon");
    assert.equal(detail.customerLastName, "Bautista");
    assert.equal(detail.customerEmail, "ramon@example.com");

    // Verify candidates are present
    assert.equal(detail.candidates.length, 2);
    assert.equal(detail.candidates[0].rank, 0);
    assert.equal(detail.candidates[0].tier, "MAIN");
    assert.equal(detail.candidates[1].rank, 1);
    assert.equal(detail.candidates[1].tier, "ALTERNATIVE 1");

    // Verify payment attempts history
    assert.ok(detail.paymentAttempts);
    assert.equal(detail.paymentAttempts.length, 1);
    assert.equal(detail.paymentAttempts[0].status, "EXPIRED");
    assert.equal(detail.paymentAttempts[0].channel, "WEB");

    // Verify proof and expiry info
    assert.equal(detail.proofSubmittedAt, null, "No proof was submitted");
    assert.ok(detail.expiryReason, "Expiry reason should be populated");
    assert.match(detail.expiryReason, /expired/i);

    // Verify timeline includes expiry
    assert.ok(
      detail.timeline.some((t) => t.toLowerCase().includes("expired")),
      "Timeline must include payment session expired event"
    );
  });

  it("handles case where proof was uploaded late or customer attempted payment", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Liza",
        customerLastName: "Soberano",
        customerEmail: "liza@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceA.id,
            startAt: "2026-09-10T14:00:00.000Z",
            endAt: "2026-09-10T18:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Submit proof before expiry
    await ctx.paymentSessionService.submitPaymentProof({
      token: created.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/liza-receipt.png",
    });

    // Manually mark reservation as EXPIRED (e.g. admin rejected or disputed/expired window)
    const stored = ctx.reservationRepo.getStoredReservation(created.id);
    stored!.status = "EXPIRED";
    stored!.updatedAt = new Date("2026-09-08T10:15:00.000Z").toISOString();

    const detail = await ctx.adminReservationService.getReservationDetail(created.referenceCode);
    assert.ok(detail);
    assert.equal(detail.reservationStatus, "EXPIRED");
    assert.ok(detail.proofSubmittedAt, "Proof timestamp should be preserved");
    assert.ok(detail.paymentAttempts);
    assert.equal(detail.paymentAttempts[0].proofStoragePath, "proofs/liza-receipt.png");
    assert.ok(detail.timeline.some((t) => t.toLowerCase().includes("proof uploaded")));
  });

  it("dynamically recognizes expired status if reservation is PENDING_PAYMENT but payment window has elapsed", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Dynamic",
        customerLastName: "Check",
        customerEmail: "dynamic@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceA.id,
            startAt: "2026-09-11T09:00:00.000Z",
            endAt: "2026-09-11T10:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Keep reservation status in DB as PENDING_PAYMENT, but advance time past 1 hour
    ctx.setTime(new Date("2026-09-08T10:30:00.000Z"));

    // listReservations("expired") should catch it as expired
    const expiredList = await ctx.adminReservationService.listReservations("expired");
    assert.equal(expiredList.total, 1);
    assert.equal(expiredList.reservations[0].referenceCode, created.referenceCode);
    assert.equal(expiredList.reservations[0].reservationStatus, "EXPIRED");

    // listReservations("active") should NOT show it
    const activeList = await ctx.adminReservationService.listReservations("active");
    assert.equal(activeList.total, 0);

    // getReservationDetail should also present it as EXPIRED
    const detail = await ctx.adminReservationService.getReservationDetail(created.referenceCode);
    assert.ok(detail);
    assert.equal(detail.reservationStatus, "EXPIRED");
    assert.equal(detail.status, "Expired");
  });

  it("supports search within expired reservations", async () => {
    const ctx = await setupFixture();

    const res1 = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Carlos",
        customerLastName: "Yulo",
        customerEmail: "carlos@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceA.id,
            startAt: "2026-09-10T10:00:00.000Z",
            endAt: "2026-09-10T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const res2 = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Manny",
        customerLastName: "Pacquiao",
        customerEmail: "manny@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceB.id,
            startAt: "2026-09-10T10:00:00.000Z",
            endAt: "2026-09-10T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Advance time past expiry
    ctx.setTime(new Date("2026-09-08T11:00:00.000Z"));

    // Search by name within expired filter
    const searchCarlos = await ctx.adminReservationService.listReservations("expired", "Carlos");
    assert.equal(searchCarlos.total, 1);
    assert.equal(searchCarlos.reservations[0].referenceCode, res1.referenceCode);

    const searchManny = await ctx.adminReservationService.listReservations("expired", "Pacquiao");
    assert.equal(searchManny.total, 1);
    assert.equal(searchManny.reservations[0].referenceCode, res2.referenceCode);

    // Search by non-matching query
    const searchNone = await ctx.adminReservationService.listReservations("expired", "NonExistent");
    assert.equal(searchNone.total, 0);
  });
});
