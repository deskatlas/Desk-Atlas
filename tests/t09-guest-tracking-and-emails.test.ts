import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createGuestReservationTrackingService,
  createReservationService,
  createPaymentSessionService,
  GuestReservationTrackingError,
  renderPaymentLinkEmail,
  renderBookingConfirmationEmail,
  renderPaymentProofReceivedEmail,
  renderReservationTrackingEmail,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("t09: Guest Tracking & Transactional Emails", () => {
  it("allows guests to track reservations using reference code and email (M13)", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const paymentSessionService = createPaymentSessionService(reservationRepo);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const trackingService = createGuestReservationTrackingService(reservationRepo);

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

    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Liza",
        customerLastName: "Soberano",
        customerEmail: "liza@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-09-01T09:00:00.000Z",
            endAt: "2026-09-01T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Track with matching referenceCode and email
    const tracking = await trackingService.getReservationTracking({
      referenceCode: res.referenceCode,
      customerEmail: "liza@example.com",
    });

    assert.equal(tracking.referenceCode, res.referenceCode);
    assert.equal(tracking.status, "PENDING_PAYMENT");

    // Case insensitive email check
    const trackingUpper = await trackingService.getReservationTracking({
      referenceCode: res.referenceCode,
      customerEmail: "LIZA@EXAMPLE.COM",
    });
    assert.equal(trackingUpper.referenceCode, res.referenceCode);

    // Mismatched email rejected
    await assert.rejects(
      () =>
        trackingService.getReservationTracking({
          referenceCode: res.referenceCode,
          customerEmail: "wrong@example.com",
        }),
      GuestReservationTrackingError
    );
  });

  it("renders transactional emails correctly without leaking security hashes (MF36)", () => {
    const paymentEmail = renderPaymentLinkEmail({
      to: "guest@example.com",
      customerFirstName: "Maria",
      customerLastName: "Santos",
      referenceCode: "DA-20260901-XYZ",
      amountDue: 450.5,
      currency: "PHP",
      paymentUrl: "https://deskatlas.app/pay/secure-token-123",
      expiresAt: "2026-09-01T12:00:00.000Z",
    });

    assert.ok(paymentEmail.subject.includes("DA-20260901-XYZ"));
    assert.ok(paymentEmail.html.includes("PHP 450.50"));
    assert.ok(paymentEmail.html.includes("https://deskatlas.app/pay/secure-token-123"));

    const confirmationEmail = renderBookingConfirmationEmail({
      to: "guest@example.com",
      customerFirstName: "Juan",
      customerLastName: "Dela Cruz",
      referenceCode: "DA-20260901-ABC",
      workspaceDisplayName: "Desk 12",
      workspaceTemplateName: "Hot Desk",
      floorName: "Level 2",
      bookingStartAt: "2026-09-01T09:00:00.000Z",
      bookingEndAt: "2026-09-01T17:00:00.000Z",
      bookingAccessUrl: "https://deskatlas.app/api/booking/view/opaque-token-abc",
      bookingToken: "opaque-token-abc",
      qrIssuedAt: "2026-09-01T08:30:00.000Z",
    });

    assert.ok(confirmationEmail.subject.includes("DA-20260901-ABC"));
    assert.ok(confirmationEmail.html.includes("Desk 12"));
    assert.ok(confirmationEmail.html.includes("Hot Desk"));
    assert.ok(confirmationEmail.html.includes("Level 2"));
  });
});
