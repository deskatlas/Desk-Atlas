import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createAdminReservationService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  InMemoryWorkspaceRepository,
  renderPaymentProofRejectedEmail,
  ReservationMemoryRepository,
  TransactionalEmailService,
} from "@deskatlas/domain";

describe("MF-93: Payment Proof Rejection Reservation Cancellation and Rejection Email", () => {
  it("rejecting payment proof transitions reservation to CANCELLED and marks payment attempt REJECTED", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-14T09:00:00.000Z");
    const nowProvider = () => now;
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Dedicated Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#10B981",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "D1",
      displayName: "Desk 1",
    });

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Juan",
        customerLastName: "Dela Cruz",
        customerEmail: "juan@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-09-15T09:00:00.000Z",
            endAt: "2026-09-15T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const token = reservation.paymentSession!.token;
    await paymentSessionService.submitPaymentProof({
      token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/juan.jpg",
    });

    const session = await paymentSessionService.getPaymentSession(token);
    assert.equal(session.paymentStatus, "UNDER_REVIEW");
    assert.equal(session.reservationStatus, "PAYMENT_UNDER_REVIEW");

    // Admin rejects payment proof
    const rejectReason = "Receipt is unreadable and amount is cropped.";
    const result = await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "REJECT",
      rejectionReason: rejectReason,
    });

    assert.equal(result.paymentStatus, "REJECTED");
    assert.equal(result.reservationStatus, "CANCELLED");
    assert.equal(result.rejectionReason, rejectReason);

    // Verify repository internal state
    const updatedReservation = reservationRepo.requireReservation(reservation.id);
    assert.equal(updatedReservation.status, "CANCELLED");
    assert.ok(updatedReservation.cancellationReason, "cancellationReason must be populated");
    assert.ok(updatedReservation.cancellationReason.includes(rejectReason));
    assert.ok(updatedReservation.cancelledAt, "cancelledAt must be populated");
  });

  it("rejected reservation does not show under Active reservations filter in Admin Reservations", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-14T09:00:00.000Z");
    const nowProvider = () => now;
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
    const adminReservationService = createAdminReservationService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Focus Pod",
      capacity: 1,
      rateAmount: 150,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#3B82F6",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "FP-1",
      displayName: "Focus Pod 1",
    });

    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Ana",
        customerLastName: "Reyes",
        customerEmail: "ana@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-09-15T14:00:00.000Z",
            endAt: "2026-09-15T16:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/ana.jpg",
    });

    // Before rejection: appears in Active reservations
    const activeBefore = await adminReservationService.listReservations("active");
    assert.ok(activeBefore.reservations.some((r) => r.id === res.id));

    // Admin rejects payment
    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "REJECT",
      rejectionReason: "Invalid reference number on receipt",
    });

    // After rejection: MUST NOT appear in Active reservations
    const activeAfter = await adminReservationService.listReservations("active");
    const activeFound = activeAfter.reservations.some((r) => r.id === res.id);
    assert.equal(activeFound, false, "Rejected reservation should not be present in active reservations list");

    // Must still be accessible under All reservations with CANCELLED status
    const allReservations = await adminReservationService.listReservations("all");
    const allFound = allReservations.reservations.find((r) => r.id === res.id);
    assert.ok(allFound, "Rejected reservation should appear in 'all' reservations");
    assert.equal(allFound?.reservationStatus, "CANCELLED");
  });

  it("renderPaymentProofRejectedEmail renders admin reason, business email, and call/text phone number", () => {
    const rendered = renderPaymentProofRejectedEmail({
      to: "customer@example.com",
      customerFirstName: "Carlos",
      customerLastName: "Mendoza",
      referenceCode: "DA-20260914-REJ1",
      rejectionReason: "Transfer slip is blurred and transaction reference is cut off.",
      businessName: "DeskAtlas Coworking",
      businessEmail: "hello@deskatlas.com",
      businessPhone: "+63 917 123 4567",
      trackingUrl: "https://deskatlas.ph/track?code=DA-20260914-REJ1",
    });

    assert.ok(rendered.subject.includes("DA-20260914-REJ1"));
    assert.ok(rendered.subject.toLowerCase().includes("rejected"));

    // Check HTML contents
    assert.ok(rendered.html.includes("Carlos Mendoza"));
    assert.ok(rendered.html.includes("DA-20260914-REJ1"));
    assert.ok(rendered.html.includes("Transfer slip is blurred and transaction reference is cut off."));
    assert.ok(rendered.html.includes("hello@deskatlas.com"));
    assert.ok(rendered.html.includes("+63 917 123 4567"));
    assert.ok(rendered.html.includes("Call / Text:"));
    assert.ok(rendered.html.includes("Have Inquiries?"));
    assert.ok(rendered.html.includes("https://deskatlas.ph/track?code=DA-20260914-REJ1"));

    // Check plain-text contents
    assert.ok(rendered.text.includes("DA-20260914-REJ1"));
    assert.ok(rendered.text.includes("Transfer slip is blurred and transaction reference is cut off."));
    assert.ok(rendered.text.includes("Email: hello@deskatlas.com"));
    assert.ok(rendered.text.includes("Call / Text: +63 917 123 4567"));
    assert.ok(rendered.text.includes("Track Reservation: https://deskatlas.ph/track?code=DA-20260914-REJ1"));
  });

  it("sendPaymentProofRejectedEmail successfully dispatches email with mock fetcher", async () => {
    let sentPayload: any = null;
    const mockFetcher = async (_url: any, init: any) => {
      sentPayload = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ id: "msg_rejection_123" }),
      } as any;
    };

    const emailService = new TransactionalEmailService({
      apiKey: "re_test_key",
      fromEmail: "DeskAtlas <noreply@deskatlas.com>",
      fetcher: mockFetcher as any,
    });

    const result = await emailService.sendPaymentProofRejectedEmail({
      to: "customer@example.com",
      customerFirstName: "Maria",
      customerLastName: "Santos",
      referenceCode: "DA-REJ-999",
      rejectionReason: "Amount paid does not match reservation rate.",
      businessName: "DeskAtlas Manila",
      businessEmail: "manila@deskatlas.com",
      businessPhone: "+63 918 765 4321",
    });

    assert.equal(result.success, true);
    assert.equal(result.id, "msg_rejection_123");
    assert.ok(sentPayload);
    assert.deepEqual(sentPayload.to, ["customer@example.com"]);
    assert.ok(sentPayload.subject.includes("DA-REJ-999"));
    assert.ok(sentPayload.html.includes("Amount paid does not match reservation rate."));
    assert.ok(sentPayload.html.includes("manila@deskatlas.com"));
    assert.ok(sentPayload.html.includes("+63 918 765 4321"));
  });

  it("requires mandatory rejection reason when rejecting payment proof", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-14T09:00:00.000Z");
    const nowProvider = () => now;
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "D2",
      displayName: "Desk 2",
    });

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Pedro",
        customerLastName: "Penduko",
        customerEmail: "pedro@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-09-15T09:00:00.000Z",
            endAt: "2026-09-15T10:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    await paymentSessionService.submitPaymentProof({
      token: reservation.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/pedro.jpg",
    });

    const session = await paymentSessionService.getPaymentSession(reservation.paymentSession!.token);

    await assert.rejects(
      async () => {
        await paymentReviewService.reviewPayment({
          paymentAttemptId: session.paymentAttemptId,
          actor: { userId: "admin-user-1", role: "ADMIN" },
          decision: "REJECT",
          rejectionReason: "   ",
        });
      },
      {
        name: "PaymentReviewError",
        message: "Rejection reason is required.",
      }
    );
  });

  it("renderPaymentProofRejectedEmail handles missing business contact information gracefully", () => {
    const rendered = renderPaymentProofRejectedEmail({
      to: "customer@example.com",
      referenceCode: "DA-REJ-MINIMAL",
      rejectionReason: "Payment proof unreadable.",
    });

    assert.ok(rendered.subject.includes("DA-REJ-MINIMAL"));
    assert.ok(rendered.html.includes("Payment proof unreadable."));
    // Should NOT render an empty inquiries box
    assert.equal(rendered.html.includes("Have Inquiries?"), false);
    assert.equal(rendered.text.includes("If you have inquiries, please contact us:"), false);
  });

  it("guest tracking returns REJECTED status and tracking view displays 'Rejected' for Confirmed at, Final workspace, and Booking time", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-14T09:00:00.000Z");
    const nowProvider = () => now;
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
    const { createGuestReservationTrackingService } = await import("@deskatlas/domain");
    const trackingService = createGuestReservationTrackingService(reservationRepo);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "D-TRACK",
      displayName: "Desk Track",
    });

    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Elena",
        customerLastName: "Gilbert",
        customerEmail: "elena@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-09-16T10:00:00.000Z",
            endAt: "2026-09-16T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/elena.jpg",
    });

    // Before rejection: Tracking status is PAYMENT_UNDER_REVIEW
    const trackingBefore = await trackingService.getReservationTracking({
      referenceCode: res.referenceCode,
      customerEmail: "elena@example.com",
    });
    assert.equal(trackingBefore.status, "PAYMENT_UNDER_REVIEW");
    assert.equal(trackingBefore.confirmedAt, null);
    assert.equal(trackingBefore.finalAssignment, null);

    // Admin rejects payment
    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "REJECT",
      rejectionReason: "Invalid account number",
    });

    // After rejection: Tracking status is REJECTED and paymentStatus is REJECTED
    const trackingAfter = await trackingService.getReservationTracking({
      referenceCode: res.referenceCode,
      customerEmail: "elena@example.com",
    });
    assert.equal(trackingAfter.status, "REJECTED");
    assert.equal(trackingAfter.paymentStatus, "REJECTED");
    assert.equal(trackingAfter.confirmedAt, null);
    assert.equal(trackingAfter.finalAssignment, null);

    // Verify TrackingPage field values under rejected state
    const isRejected =
      trackingAfter.status === "REJECTED" ||
      trackingAfter.paymentStatus === "REJECTED" ||
      (trackingAfter.status === "CANCELLED" && (!trackingAfter.confirmedAt || trackingAfter.paymentStatus === "REJECTED"));

    assert.equal(isRejected, true);

    const confirmedAtValue = trackingAfter.confirmedAt
      ? trackingAfter.confirmedAt
      : isRejected
      ? "Rejected"
      : "Pending";

    const finalWorkspaceValue =
      trackingAfter.finalAssignment?.workspaceDisplayName ??
      (isRejected ? "Rejected" : "Not assigned yet");

    const bookingTimeValue = trackingAfter.finalAssignment
      ? "Allocated"
      : isRejected
      ? "Rejected"
      : "Not assigned yet";

    assert.equal(confirmedAtValue, "Rejected", "Confirmed at must display 'Rejected' instead of 'Pending'");
    assert.equal(finalWorkspaceValue, "Rejected", "Final workspace must display 'Rejected' instead of 'Not assigned yet'");
    assert.equal(bookingTimeValue, "Rejected", "Booking time must display 'Rejected' instead of 'Not assigned yet'");
  });
});
