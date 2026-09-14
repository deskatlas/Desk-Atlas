import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import {
  createBookingAccessService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  extractBookingToken,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  BookingAccessError,
} from "@deskatlas/domain";

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
  const bookingAccessService = createBookingAccessService(reservationRepo, nowProvider);

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
        customerFirstName: "Jane",
        customerLastName: "Doe",
        customerEmail: "jane@example.com",
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

    const issue = await bookingAccessService.issueBookingAccess(
      res.id,
      res.referenceCode,
      "https://deskatlas.test/access"
    );

    return { reservation: res, issue };
  };

  return {
    reservationRepo,
    workspaceRepo,
    bookingAccessService,
    setTime: (d: Date) => {
      currentTime = d;
    },
    helperCreateAndConfirm,
  };
}

describe("MF-96: Staff QR Scanner Manual Reference Code / ID Check-In", () => {
  it("extractBookingToken parses plain token, reference code, UUID, and URLs with parameters", () => {
    assert.equal(extractBookingToken("DA-2026-00042"), "DA-2026-00042");
    assert.equal(extractBookingToken("  DA-2026-00042  "), "DA-2026-00042");
    assert.equal(extractBookingToken("3f6a2b8e-1234-5678-9abc-def012345678"), "3f6a2b8e-1234-5678-9abc-def012345678");
    assert.equal(extractBookingToken("https://deskatlas.test/track/DA-2026-00042"), "DA-2026-00042");
    assert.equal(extractBookingToken("https://deskatlas.test/track?code=DA-2026-00042"), "DA-2026-00042");
    assert.equal(extractBookingToken("https://deskatlas.test/track?reference=DA-2026-00042"), "DA-2026-00042");
    assert.equal(extractBookingToken("https://deskatlas.test/access/my-opaque-token"), "my-opaque-token");
    assert.equal(extractBookingToken(JSON.stringify({ referenceCode: "DA-2026-00042" })), "DA-2026-00042");
  });

  it("resolves booking and auto-checks in when entered by exact reference code on-time", async () => {
    const ctx = await createTestContext();
    // Booking from 09:00 to 11:00
    const { reservation } = await ctx.helperCreateAndConfirm(
      "2026-09-14T09:00:00.000Z",
      "2026-09-14T11:00:00.000Z"
    );

    // Current time is 09:15 (active window)
    ctx.setTime(new Date("2026-09-14T09:15:00.000Z"));

    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(
      reservation.referenceCode,
      { userId: "staff-1", role: "STAFF" }
    );

    assert.equal(scanResult.accessState, "ACTIVE");
    assert.equal(scanResult.reservationStatus, "CHECKED_IN");
    assert.equal(scanResult.checkInState, "CHECKED_IN");
    assert.equal(scanResult.reentry, false);
    assert.equal(scanResult.referenceCode, reservation.referenceCode);
    assert.equal(scanResult.customerName, "Jane Doe");
  });

  it("resolves booking case-insensitively when entered by lowercase reference code", async () => {
    const ctx = await createTestContext();
    const { reservation } = await ctx.helperCreateAndConfirm(
      "2026-09-14T09:00:00.000Z",
      "2026-09-14T11:00:00.000Z"
    );

    ctx.setTime(new Date("2026-09-14T09:15:00.000Z"));

    const lowerRef = reservation.referenceCode.toLowerCase();
    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(
      lowerRef,
      { userId: "staff-1", role: "STAFF" }
    );

    assert.equal(scanResult.accessState, "ACTIVE");
    assert.equal(scanResult.referenceCode, reservation.referenceCode);
    assert.equal(scanResult.reservationStatus, "CHECKED_IN");
  });

  it("resolves booking when entered by reservation ID (UUID)", async () => {
    const ctx = await createTestContext();
    const { reservation } = await ctx.helperCreateAndConfirm(
      "2026-09-14T09:00:00.000Z",
      "2026-09-14T11:00:00.000Z"
    );

    ctx.setTime(new Date("2026-09-14T09:15:00.000Z"));

    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(
      reservation.id,
      { userId: "staff-1", role: "STAFF" }
    );

    assert.equal(scanResult.accessState, "ACTIVE");
    assert.equal(scanResult.reservationId, reservation.id);
    assert.equal(scanResult.referenceCode, reservation.referenceCode);
  });

  it("returns NOT_ACTIVE when reference code is entered too early (before start time)", async () => {
    const ctx = await createTestContext();
    // Booking from 10:00 to 12:00
    const { reservation } = await ctx.helperCreateAndConfirm(
      "2026-09-14T10:00:00.000Z",
      "2026-09-14T12:00:00.000Z"
    );

    // Current time is 08:30 (too early)
    ctx.setTime(new Date("2026-09-14T08:30:00.000Z"));

    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(
      reservation.referenceCode,
      { userId: "staff-1", role: "STAFF" }
    );

    assert.equal(scanResult.accessState, "NOT_ACTIVE");
    assert.equal(scanResult.checkInState, "NOT_CHECKED_IN");
    assert.equal(scanResult.reservationStatus, "CONFIRMED");
  });

  it("marks reentry as true on second lookup after guest is checked in", async () => {
    const ctx = await createTestContext();
    const { reservation } = await ctx.helperCreateAndConfirm(
      "2026-09-14T09:00:00.000Z",
      "2026-09-14T11:00:00.000Z"
    );

    ctx.setTime(new Date("2026-09-14T09:15:00.000Z"));

    // First lookup: initial check in
    const first = await ctx.bookingAccessService.resolveBookingAccess(
      reservation.referenceCode,
      { userId: "staff-1", role: "STAFF" }
    );
    assert.equal(first.reentry, false);
    assert.equal(first.checkInState, "CHECKED_IN");

    // Second lookup: re-entry
    ctx.setTime(new Date("2026-09-14T09:45:00.000Z"));
    const second = await ctx.bookingAccessService.resolveBookingAccess(
      reservation.referenceCode,
      { userId: "staff-1", role: "STAFF" }
    );
    assert.equal(second.reentry, true);
    assert.equal(second.checkInState, "CHECKED_IN");
  });

  it("throws BookingAccessError on unknown reference code or ID", async () => {
    const ctx = await createTestContext();
    await assert.rejects(
      async () => {
        await ctx.bookingAccessService.resolveBookingAccess("DA-2026-99999");
      },
      (err: any) => {
        assert(err instanceof BookingAccessError);
        assert.equal(err.message, "Invalid booking token or reference code.");
        return true;
      }
    );
  });

  it("preserves backward compatibility with opaque QR tokens", async () => {
    const ctx = await createTestContext();
    const { issue } = await ctx.helperCreateAndConfirm(
      "2026-09-14T09:00:00.000Z",
      "2026-09-14T11:00:00.000Z"
    );

    ctx.setTime(new Date("2026-09-14T09:15:00.000Z"));

    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(
      issue!.token,
      { userId: "staff-1", role: "STAFF" }
    );

    assert.equal(scanResult.accessState, "ACTIVE");
    assert.equal(scanResult.reservationStatus, "CHECKED_IN");
  });
});
