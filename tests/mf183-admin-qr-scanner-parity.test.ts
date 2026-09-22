import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createBookingAccessService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  createStaffOperationsService,
  extractBookingToken,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

async function createTestContext() {
  const reservationRepo = new ReservationMemoryRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  let currentTime = new Date("2026-09-23T09:00:00.000Z");
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
    displayName: "Admin Test Desk 1",
  });

  const createAndConfirmReservation = async (startAt: string, endAt: string) => {
    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "AdminGuest",
        customerEmail: "alice.adminguest@example.com",
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
      proofStoragePath: "proofs/test-proof.png",
    });

    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-actor-uuid-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    const issue = await bookingAccessService.issueBookingAccess(
      res.id,
      res.referenceCode,
      "https://deskatlas.test/access"
    );

    return {
      reservationId: res.id,
      referenceCode: res.referenceCode,
      bookingToken: issue!.token,
    };
  };

  return {
    reservationRepo,
    workspaceRepo,
    bookingAccessService,
    staffOperationsService,
    createAndConfirmReservation,
    setCurrentTime: (d: Date) => {
      currentTime = d;
    },
  };
}

describe("MF-183: Admin Portal QR Scanner Parity with Staff Dashboard", () => {
  it("resolves valid booking QR token with actor role ADMIN and attributes scan to the admin", async () => {
    const ctx = await createTestContext();
    const { bookingToken, reservationId, referenceCode } = await ctx.createAndConfirmReservation(
      "2026-09-23T09:00:00.000Z",
      "2026-09-23T11:00:00.000Z"
    );

    // Initial scan by admin
    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(
      bookingToken,
      {
        userId: "admin-user-id-123",
        role: "ADMIN",
      }
    );

    assert.equal(scanResult.reservationId, reservationId);
    assert.equal(scanResult.referenceCode, referenceCode);
    assert.equal(scanResult.accessState, "ACTIVE");
    assert.equal(scanResult.checkInState, "CHECKED_IN");
    assert.equal(scanResult.customerName, "Alice AdminGuest");
    assert.equal(scanResult.reentry, false);

    // Verify operational audit event was recorded with admin actor
    const auditEvents = ctx.reservationRepo.operationalAuditEvents || [];
    const recordedAudit = auditEvents.find((l: any) => l.reservationId === reservationId);
    assert(recordedAudit, "Operational audit must be recorded");
    assert.equal(recordedAudit.actorUserId, "admin-user-id-123");
    assert.equal(recordedAudit.actorRole, "ADMIN");
    assert.equal(recordedAudit.activityType, "CHECK_IN");
  });

  it("handles second scan by Admin as re-entry with ADMIN actor attribution", async () => {
    const ctx = await createTestContext();
    const { bookingToken, reservationId } = await ctx.createAndConfirmReservation(
      "2026-09-23T09:00:00.000Z",
      "2026-09-23T11:00:00.000Z"
    );

    // First scan checks in
    await ctx.bookingAccessService.resolveBookingAccess(
      bookingToken,
      { userId: "admin-user-1", role: "ADMIN" }
    );

    // Advance time within active window
    ctx.setCurrentTime(new Date("2026-09-23T09:30:00.000Z"));

    // Second scan (re-entry)
    const secondScanResult = await ctx.bookingAccessService.resolveBookingAccess(
      bookingToken,
      { userId: "admin-user-2", role: "ADMIN" }
    );

    assert.equal(secondScanResult.accessState, "ACTIVE");
    assert.equal(secondScanResult.checkInState, "CHECKED_IN");
    assert.equal(secondScanResult.reentry, true);

    const auditEvents = ctx.reservationRepo.operationalAuditEvents || [];
    assert.equal(auditEvents.length, 2);
    // Unshifted so first element is newest
    assert.equal(auditEvents[0].actorUserId, "admin-user-2");
    assert.equal(auditEvents[0].actorRole, "ADMIN");
    assert.equal(auditEvents[0].activityType, "REENTRY");
  });

  it("supports manual reference code entry for admin scanner", async () => {
    const ctx = await createTestContext();
    const { referenceCode, reservationId } = await ctx.createAndConfirmReservation(
      "2026-09-23T09:00:00.000Z",
      "2026-09-23T11:00:00.000Z"
    );

    const result = await ctx.bookingAccessService.resolveBookingAccess(
      referenceCode,
      { userId: "admin-user-1", role: "ADMIN" }
    );

    assert.equal(result.reservationId, reservationId);
    assert.equal(result.referenceCode, referenceCode);
    assert.equal(result.accessState, "ACTIVE");
  });

  it("allows Admin to perform manual check-in and check-out via StaffOperationsService", async () => {
    const ctx = await createTestContext();
    const { reservationId } = await ctx.createAndConfirmReservation(
      "2026-09-23T09:00:00.000Z",
      "2026-09-23T11:00:00.000Z"
    );

    // Admin manual check-in
    const checkInResult = await ctx.staffOperationsService.checkInReservation({
      reservationId,
      actor: {
        userId: "admin-user-1",
        role: "ADMIN",
      },
    });

    assert.equal(checkInResult.reservationId, reservationId);
    assert.equal(checkInResult.reservationStatus, "CHECKED_IN");
    assert(checkInResult.checkedInAt);

    // Admin manual check-out
    const checkOutResult = await ctx.staffOperationsService.checkOutReservation({
      reservationId,
      actor: {
        userId: "admin-user-1",
        role: "ADMIN",
      },
    });

    assert.equal(checkOutResult.reservationId, reservationId);
    assert.equal(checkOutResult.reservationStatus, "COMPLETED");
    assert(checkOutResult.checkedOutAt);
  });

  it("verifies extractBookingToken handles raw tokens, reference codes, UUIDs, and URLs", () => {
    assert.equal(extractBookingToken("DA-2026-00123"), "DA-2026-00123");
    assert.equal(extractBookingToken("bk_tok_abcdef123456"), "bk_tok_abcdef123456");
    assert.equal(
      extractBookingToken("https://deskatlas.test/access/bk_tok_998877"),
      "bk_tok_998877"
    );
    assert.equal(
      extractBookingToken("https://deskatlas.test/track/DA-2026-00123"),
      "DA-2026-00123"
    );
    assert.equal(extractBookingToken(""), "");
  });

  it("maintains parity with Staff scanner operations", async () => {
    const ctx = await createTestContext();
    const { bookingToken, reservationId } = await ctx.createAndConfirmReservation(
      "2026-09-23T09:00:00.000Z",
      "2026-09-23T11:00:00.000Z"
    );

    // Staff scan
    const staffScanResult = await ctx.bookingAccessService.resolveBookingAccess(
      bookingToken,
      {
        userId: "staff-user-id-456",
        role: "STAFF",
      }
    );

    assert.equal(staffScanResult.reservationId, reservationId);
    assert.equal(staffScanResult.accessState, "ACTIVE");
    assert.equal(staffScanResult.checkInState, "CHECKED_IN");

    const auditEvents = ctx.reservationRepo.operationalAuditEvents || [];
    const staffAudit = auditEvents.find((l: any) => l.actorUserId === "staff-user-id-456");
    assert(staffAudit);
    assert.equal(staffAudit.actorRole, "STAFF");
  });
});
