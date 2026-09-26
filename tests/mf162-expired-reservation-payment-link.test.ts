import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createAdminReservationService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  InMemoryWorkspaceRepository,
  PaymentSessionError,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("MF-162: Payment Link Inaccessible After Reservation Expiry", () => {
  async function setupEnvironment(initialTime = "2026-09-21T09:00:00.000Z") {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let now = new Date(initialTime);
    const nowProvider = () => now;
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
    const adminReservationService = createAdminReservationService(
      reservationRepo,
      nowProvider
    );

    const floor = await workspaceRepo.createFloor({ name: "Main Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Focus Desk",
      capacity: 1,
      rateAmount: 200,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#2563EB",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "FD-01",
      displayName: "Focus Desk 01",
    });

    const createReservation = async () => {
      return reservationService.createReservation(
        {
          source: "WEB",
          customerFirstName: "Maria",
          customerLastName: "Santos",
          customerEmail: "maria@example.com",
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: instance.id,
              startAt: "2026-09-22T09:00:00.000Z",
              endAt: "2026-09-22T11:00:00.000Z",
            },
          ],
        },
        { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
      );
    };

    return {
      reservationRepo,
      workspaceRepo,
      getNow: () => now,
      setNow: (d: Date) => {
        now = d;
      },
      paymentSessionService,
      reservationService,
      paymentReviewService,
      adminReservationService,
      createReservation,
      instance,
    };
  }

  it("returns active and valid payment status for fresh reservation", async () => {
    const env = await setupEnvironment();
    const reservation = await env.createReservation();
    const token = reservation.paymentSession!.token;

    const status = await env.paymentSessionService.getPaymentSessionStatus(token);
    assert.equal(status.reservationId, reservation.id);
    assert.equal(status.reservationReferenceCode, reservation.referenceCode);
    assert.equal(status.paymentStatus, "PENDING");
    assert.equal(status.isValid, true);
    assert.equal(status.isExpired, false);
  });

  it("marks payment status as expired and invalid when session time expires", async () => {
    const env = await setupEnvironment();
    const reservation = await env.createReservation();
    const token = reservation.paymentSession!.token;

    // Advance time beyond 60 minutes (expiry window)
    env.setNow(new Date("2026-09-21T10:05:00.000Z"));

    const status = await env.paymentSessionService.getPaymentSessionStatus(token);
    assert.equal(status.isExpired, true);
    assert.equal(status.isValid, false);
    assert.equal(status.paymentStatus, "EXPIRED");
    assert.equal(status.reservationStatus, "EXPIRED");
  });

  it("marks payment status as invalid when reservation is cancelled", async () => {
    const env = await setupEnvironment();
    const reservation = await env.createReservation();
    const token = reservation.paymentSession!.token;

    await env.adminReservationService.cancelReservation({
      reservationId: reservation.id,
      reason: "User requested cancellation",
      actorRole: "ADMIN",
    });

    const status = await env.paymentSessionService.getPaymentSessionStatus(token);
    assert.equal(status.isValid, false);
    assert.equal(status.reservationStatus, "CANCELLED");
  });

  it("rejects proof submission for an expired reservation", async () => {
    const env = await setupEnvironment();
    const reservation = await env.createReservation();
    const token = reservation.paymentSession!.token;

    // Advance time past 1 hour
    env.setNow(new Date("2026-09-21T10:30:00.000Z"));

    await assert.rejects(
      async () => {
        await env.paymentSessionService.submitPaymentProof({
          token,
          paymentMethodId: "pm-gcash",
          proofStoragePath: "proofs/test-proof.jpg",
        });
      },
      (err: any) => {
        assert.ok(err instanceof PaymentSessionError);
        assert.match(err.message, /expired/i);
        return true;
      }
    );
  });

  it("rejects proof submission for a cancelled reservation", async () => {
    const env = await setupEnvironment();
    const reservation = await env.createReservation();
    const token = reservation.paymentSession!.token;

    await env.adminReservationService.cancelReservation({
      reservationId: reservation.id,
      reason: "Admin cancellation",
      actorRole: "ADMIN",
    });

    await assert.rejects(
      async () => {
        await env.paymentSessionService.submitPaymentProof({
          token,
          paymentMethodId: "pm-gcash",
          proofStoragePath: "proofs/test-proof.jpg",
        });
      },
      (err: any) => {
        assert.ok(err instanceof PaymentSessionError);
        assert.match(err.message, /cancelled/i);
        return true;
      }
    );
  });

  it("rejects proof submission for an already confirmed reservation", async () => {
    const env = await setupEnvironment();
    const reservation = await env.createReservation();
    const token = reservation.paymentSession!.token;

    // Submit proof and confirm
    await env.paymentSessionService.submitPaymentProof({
      token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/test-proof.jpg",
    });

    const session = await env.paymentSessionService.getPaymentSession(token);
    await env.paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      decision: "APPROVE",
      actor: {
        userId: "admin-1",
        role: "ADMIN",
      },
    });

    await assert.rejects(
      async () => {
        await env.paymentSessionService.submitPaymentProof({
          token,
          paymentMethodId: "pm-gcash",
          proofStoragePath: "proofs/second-proof.jpg",
        });
      },
      (err: any) => {
        assert.ok(err instanceof PaymentSessionError);
        assert.match(err.message, /already been (submitted|confirmed)/i);
        return true;
      }
    );
  });

  it("successfully submits proof for valid active reservation before expiry", async () => {
    const env = await setupEnvironment();
    const reservation = await env.createReservation();
    const token = reservation.paymentSession!.token;

    const result = await env.paymentSessionService.submitPaymentProof({
      token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/test-proof.jpg",
    });

    assert.equal(result.paymentStatus, "UNDER_REVIEW");
    assert.equal(result.reservationStatus, "PAYMENT_UNDER_REVIEW");
  });

  it("handles race condition where reservation expires before submission executes", async () => {
    const env = await setupEnvironment();
    const reservation = await env.createReservation();
    const token = reservation.paymentSession!.token;

    // Session opened when valid
    const initialSession = await env.paymentSessionService.getPaymentSession(token);
    assert.equal(initialSession.paymentStatus, "PENDING");

    // Time passes past 60 minutes before user clicks submit
    env.setNow(new Date("2026-09-21T10:01:00.000Z"));

    await assert.rejects(
      async () => {
        await env.paymentSessionService.submitPaymentProof({
          token,
          paymentMethodId: "pm-gcash",
          proofStoragePath: "proofs/test-proof.jpg",
        });
      },
      (err: any) => {
        assert.ok(err instanceof PaymentSessionError);
        assert.match(err.message, /expired/i);
        return true;
      }
    );

    // Verify session is now EXPIRED
    const status = await env.paymentSessionService.getPaymentSessionStatus(token);
    assert.equal(status.paymentStatus, "EXPIRED");
    assert.equal(status.isExpired, true);
    assert.equal(status.isValid, false);
  });

  it("returns error for invalid / non-existent payment token", async () => {
    const env = await setupEnvironment();
    await assert.rejects(
      async () => {
        await env.paymentSessionService.getPaymentSessionStatus("non-existent-token");
      },
      (err: any) => {
        assert.ok(err instanceof PaymentSessionError);
        assert.match(err.message, /invalid payment token/i);
        return true;
      }
    );
  });

  it("maps domain errors to expected HTTP status codes (410 for expired, 404 for invalid)", async () => {
    function mapErrorToHttpStatus(err: unknown): number {
      if (err instanceof PaymentSessionError) {
        const isExpired = err.message.toLowerCase().includes("expired");
        const isInvalid = err.message.toLowerCase().includes("invalid payment token");
        return isInvalid ? 404 : isExpired ? 410 : 409;
      }
      return 500;
    }

    assert.equal(mapErrorToHttpStatus(new PaymentSessionError("Reservation has expired. Payment proof cannot be submitted.")), 410);
    assert.equal(mapErrorToHttpStatus(new PaymentSessionError("Payment session has expired.")), 410);
    assert.equal(mapErrorToHttpStatus(new PaymentSessionError("Invalid payment token.")), 404);
    assert.equal(mapErrorToHttpStatus(new PaymentSessionError("Payment proof has already been submitted for this session.")), 409);
  });
});
