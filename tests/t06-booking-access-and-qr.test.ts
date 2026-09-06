import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  BookingAccessError,
  createBookingAccessService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  extractBookingToken,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  type CreateReservationRequest,
} from "@deskatlas/domain";

describe("t06: Booking Access & QR Scanner", () => {
  it("extracts booking tokens from raw values and QR URL payloads (MF15)", () => {
    assert.equal(extractBookingToken("abc-123-token"), "abc-123-token");
    assert.equal(extractBookingToken("  abc-123-token  "), "abc-123-token");
    assert.equal(
      extractBookingToken("https://deskatlas.com/booking/opaque-token-xyz"),
      "opaque-token-xyz"
    );
    assert.equal(
      extractBookingToken("http://localhost:3000/booking/opaque-token-xyz/"),
      "opaque-token-xyz"
    );
    assert.equal(
      extractBookingToken("https://deskatlas.com/booking/opaque-token-xyz?ref=RES-101"),
      "opaque-token-xyz"
    );
    assert.equal(extractBookingToken(""), "");
    assert.equal(extractBookingToken("   "), "");
  });

  it("manages booking QR access lifecycle and scanning windows (M10)", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let now = new Date("2026-08-26T09:00:00.000Z");
    const nowProvider = () => now;
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
    const bookingAccessService = createBookingAccessService(reservationRepo, nowProvider);
    const actor = { userId: "admin-1", role: "ADMIN" as const };

    const floor = await workspaceRepo.createFloor({ name: "Ground Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Skypod",
      capacity: 1,
      rateAmount: 200,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#0f172a",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "SP-01",
      displayName: "Skypod 1",
    });

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Test",
        customerLastName: "Customer",
        customerEmail: "test@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-08-26T10:00:00.000Z",
            endAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Pay and approve
    await paymentSessionService.submitPaymentProof({
      token: reservation.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/booking-access.png",
    });
    const session = await paymentSessionService.getPaymentSession(reservation.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor,
      decision: "APPROVE",
    });

    // 1. Issue booking access token
    const issue = await bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://deskatlas.test/booking"
    );
    assert.ok(issue?.token);

    // 2. Scan before window (too early: 09:00 vs 10:00)
    now = new Date("2026-08-26T09:00:00.000Z");
    const scanTooEarly = await bookingAccessService.resolveBookingAccess(issue!.token);
    assert.equal(scanTooEarly.accessState, "NOT_ACTIVE");

    // 3. Scan inside window (10:15) -> active
    now = new Date("2026-08-26T10:15:00.000Z");
    const scanValid = await bookingAccessService.resolveBookingAccess(issue!.token);
    assert.equal(scanValid.accessState, "ACTIVE");

    // 4. Scan after window expired (12:30) -> expired
    now = new Date("2026-08-26T12:30:00.000Z");
    const scanExpired = await bookingAccessService.resolveBookingAccess(issue!.token);
    assert.equal(scanExpired.accessState, "EXPIRED");
  });
});
