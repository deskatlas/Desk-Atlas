import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  InMemoryWorkspaceRepository,
  PaymentReviewConflictError,
  PaymentReviewError,
  PaymentSessionError,
  ReservationMemoryRepository,
  type CreateReservationRequest,
} from "@deskatlas/domain";

describe("t05: Payment Session, Proof & Review", () => {
  it("manages payment session lifecycle and 1-hour expiration countdown (M08)", async () => {
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

    const floor = await workspaceRepo.createFloor({ name: "Test Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Test Template",
      capacity: 1,
      rateAmount: 150,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#000000",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "A1",
      displayName: "Test Instance 1",
    });

    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Maria",
        customerLastName: "Santos",
        customerEmail: "maria@example.com",
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

    const token = res.paymentSession!.token;
    assert.ok(token);

    // Initial session check
    const session = await paymentSessionService.getPaymentSession(token);
    assert.equal(session.reservationId, res.id);
    assert.equal(session.paymentStatus, "PENDING");
    assert.equal(session.reservationStatus, "PENDING_PAYMENT");

    // Upload proof of payment before expiry
    const submission = await paymentSessionService.submitPaymentProof({
      token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/maria-receipt.png",
    });

    assert.equal(submission.paymentStatus, "UNDER_REVIEW");
    assert.equal(submission.reservationStatus, "PAYMENT_UNDER_REVIEW");

    // Advance time by 2 hours; proof is already under review so it should not be marked EXPIRED
    now = new Date("2026-08-26T12:00:00.000Z");
    const underReviewSession = await paymentSessionService.getPaymentSession(token);
    assert.equal(underReviewSession.paymentStatus, "UNDER_REVIEW");
  });

  it("handles admin payment review and atomic candidate allocation (M09)", async () => {
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

    const actor = { userId: "admin-user-1", role: "ADMIN" as const };

    const floor = await workspaceRepo.createFloor({ name: "Main Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Skypod",
      capacity: 1,
      rateAmount: 200,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#0f172a",
      isActive: true,
    });

    const instanceA = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "SP-01",
      displayName: "Skypod 1",
    });
    const instanceB = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "SP-02",
      displayName: "Skypod 2",
    });

    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Carlos",
        customerLastName: "Reyes",
        customerEmail: "carlos@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instanceA.id,
            startAt: "2026-09-01T09:00:00.000Z",
            endAt: "2026-09-01T11:00:00.000Z",
          },
          {
            rank: 1,
            workspaceInstanceId: instanceB.id,
            startAt: "2026-09-01T09:00:00.000Z",
            endAt: "2026-09-01T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Submit proof
    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/carlos.png",
    });

    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);

    // Admin approves payment -> atomic allocation selects Main (rank 0, instanceA)
    const reviewResult = await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor,
      decision: "APPROVE",
    });

    assert.equal(reviewResult.reservationStatus, "CONFIRMED");
    assert.equal(reviewResult.paymentStatus, "APPROVED");
    assert.equal(reviewResult.assignedCandidateRank, 0);
    assert.equal(reviewResult.assignedCandidate?.workspaceInstanceId, instanceA.id);
  });
});
