import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createBookingAccessService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  TransactionalEmailService,
} from "@deskatlas/domain";

describe("MF-119: Admin Payment Rejection Email Delivery, Proof Retention with MF-114, and Reconsideration Recovery", () => {
  it("rejecting payment proof dispatches rejection email with diagnostics and retains proof storage path", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-17T09:00:00.000Z");
    const nowProvider = () => now;
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Main Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Private Pod",
      capacity: 1,
      rateAmount: 150,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#10B981",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "P1",
      displayName: "Pod 1",
    });

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Maria",
        customerLastName: "Santos",
        customerEmail: "maria@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-09-18T10:00:00.000Z",
            endAt: "2026-09-18T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const token = reservation.paymentSession!.token;
    await paymentSessionService.submitPaymentProof({
      token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/maria-receipt.png",
    });

    const session = await paymentSessionService.getPaymentSession(token);
    assert.equal(session.paymentStatus, "UNDER_REVIEW");

    // Rejection requires non-empty reason
    await assert.rejects(
      async () => {
        await paymentReviewService.reviewPayment({
          paymentAttemptId: session.paymentAttemptId,
          actor: { userId: "admin-user-1", role: "ADMIN" },
          decision: "REJECT",
          rejectionReason: "   ",
        });
      },
      /Rejection reason is required/
    );

    // Reject payment proof
    const rejectionReason = "Transaction reference number is obscured and timestamp is illegible.";
    const result = await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "REJECT",
      rejectionReason,
    });

    assert.equal(result.paymentStatus, "REJECTED");
    assert.equal(result.reservationStatus, "CANCELLED");
    assert.equal(result.rejectionReason, rejectionReason);

    // Proof retention: detail retains proofStoragePath even after rejection
    const rejectedDetail = await paymentReviewService.getPaymentReviewDetail(session.paymentAttemptId);
    assert.equal(rejectedDetail.paymentStatus, "REJECTED");
    assert.equal(rejectedDetail.proofStoragePath, "proofs/maria-receipt.png");
    assert.equal(rejectedDetail.rejectionReason, rejectionReason);

    // Email dispatch verification
    let sentPayload: any = null;
    const mockFetcher = async (_url: string, init: any) => {
      sentPayload = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "email-resend-reject-123" }),
        text: async () => JSON.stringify({ id: "email-resend-reject-123" }),
      } as any;
    };

    const emailService = new TransactionalEmailService({
      apiKey: "re_test_123456",
      fetcher: mockFetcher,
    });

    const emailResult = await emailService.sendPaymentProofRejectedEmail({
      to: rejectedDetail.customerEmail,
      customerFirstName: rejectedDetail.customerFirstName,
      customerLastName: rejectedDetail.customerLastName,
      referenceCode: result.reservationReferenceCode,
      rejectionReason,
      businessName: "DeskAtlas Coworking",
      businessEmail: "help@deskatlas.test",
      businessPhone: "+63 917 123 4567",
      trackingUrl: `https://deskatlas.test/track?ref=${result.reservationReferenceCode}`,
    });

    assert.equal(emailResult.success, true);
    assert.equal(emailResult.id, "email-resend-reject-123");
    assert.ok(sentPayload);
    assert.equal(sentPayload.to[0], "maria@example.com");
    assert.ok(sentPayload.subject.includes(result.reservationReferenceCode));
    assert.ok(sentPayload.html.includes(rejectionReason));
    assert.ok(sentPayload.html.includes("help@deskatlas.test"));
  });

  it("listRejectedPayments returns rejected payment records in descending order of processing", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let currentTime = new Date("2026-09-17T09:00:00.000Z").getTime();
    const nowProvider = () => new Date(currentTime);
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Floor A" });
    const template = await workspaceRepo.createTemplate({
      name: "Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#10B981",
      isActive: true,
    });
    const instance1 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "D1",
      displayName: "Desk 1",
    });

    // Create 2 reservations
    const res1 = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "Brown",
        customerEmail: "alice@example.com",
        candidates: [{ rank: 0, workspaceInstanceId: instance1.id, startAt: "2026-09-18T08:00:00.000Z", endAt: "2026-09-18T10:00:00.000Z" }],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );
    await paymentSessionService.submitPaymentProof({
      token: res1.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/alice.jpg",
    });

    const res2 = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Bob",
        customerLastName: "Green",
        customerEmail: "bob@example.com",
        candidates: [{ rank: 0, workspaceInstanceId: instance1.id, startAt: "2026-09-18T11:00:00.000Z", endAt: "2026-09-18T13:00:00.000Z" }],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );
    await paymentSessionService.submitPaymentProof({
      token: res2.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/bob.jpg",
    });

    // Reject Alice first
    await paymentReviewService.reviewPayment({
      paymentAttemptId: res1.paymentSession!.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "REJECT",
      rejectionReason: "Incomplete proof",
    });

    // Advance time so Bob's rejection has a later processedAt timestamp
    currentTime += 60000;

    // Reject Bob second
    await paymentReviewService.reviewPayment({
      paymentAttemptId: res2.paymentSession!.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "REJECT",
      rejectionReason: "Incorrect amount",
    });

    const rejectedList = await paymentReviewService.listRejectedPayments();
    assert.equal(rejectedList.length, 2);
    // Bob should be first because Bob was processed second (most recent first)
    assert.equal(rejectedList[0].customerFirstName, "Bob");
    assert.equal(rejectedList[0].paymentStatus, "REJECTED");
    assert.equal(rejectedList[0].rejectionReason, "Incorrect amount");
    assert.equal(rejectedList[1].customerFirstName, "Alice");
    assert.equal(rejectedList[1].paymentStatus, "REJECTED");
    assert.equal(rejectedList[1].rejectionReason, "Incomplete proof");
  });

  it("Reconsider & Approve successfully un-cancels reservation, allocates available candidate, and sets CONFIRMED", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-17T09:00:00.000Z");
    const nowProvider = () => now;
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Main Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Focus Room",
      capacity: 1,
      rateAmount: 200,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#10B981",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "FR-1",
      displayName: "Focus Room 1",
    });

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Carlos",
        customerLastName: "Reyes",
        customerEmail: "carlos@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-09-18T14:00:00.000Z",
            endAt: "2026-09-18T16:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const token = reservation.paymentSession!.token;
    await paymentSessionService.submitPaymentProof({
      token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/carlos-maya.png",
    });

    const session = await paymentSessionService.getPaymentSession(token);

    // Step 1: Admin mistakenly rejects
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "REJECT",
      rejectionReason: "Mistakenly thought amount was wrong",
    });

    let checkRes = reservationRepo.requireReservation(reservation.id);
    assert.equal(checkRes.status, "CANCELLED");
    assert.ok((checkRes as any).cancelledAt);
    assert.ok((checkRes as any).cancellationReason);

    // Step 2: Admin clicks 'Reconsider & Approve'
    const reconsiderResult = await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "RECONSIDER_APPROVE",
    });

    assert.equal(reconsiderResult.paymentStatus, "APPROVED");
    assert.equal(reconsiderResult.reservationStatus, "CONFIRMED");
    assert.ok(reconsiderResult.assignedCandidate);
    assert.equal(reconsiderResult.assignedCandidateRank, 0);

    // Verify repository internal state: cancellation fields cleared
    checkRes = reservationRepo.requireReservation(reservation.id);
    assert.equal(checkRes.status, "CONFIRMED");
    assert.equal((checkRes as any).cancelledAt, null);
    assert.equal((checkRes as any).cancellationReason, null);
    assert.equal((checkRes as any).cancelledByUserId, null);
    assert.ok(checkRes.confirmedAt);

    // Verify candidate is assigned
    assert.equal(checkRes.candidates?.[0].isAssigned, true);

    // Step 3: Booking QR pass issue and confirmation email
    const bookingAccessService = createBookingAccessService(reservationRepo);
    const bookingAccess = await bookingAccessService.issueBookingAccess(
      reconsiderResult.reservationId,
      reconsiderResult.reservationReferenceCode,
      "https://deskatlas.test/api/booking"
    );
    assert.ok(bookingAccess);
    assert.ok(bookingAccess.token);

    let confirmationEmailSent = false;
    const emailService = new TransactionalEmailService({
      apiKey: "re_test_123456",
      fetcher: async (_url: string, init: any) => {
        const payload = JSON.parse(init.body);
        if (payload.to.includes("carlos@example.com")) {
          confirmationEmailSent = true;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "email-confirm-123" }),
          text: async () => JSON.stringify({ id: "email-confirm-123" }),
        } as any;
      },
    });

    const sendRes = await emailService.sendBookingConfirmationEmail({
      to: "carlos@example.com",
      customerFirstName: "Carlos",
      customerLastName: "Reyes",
      referenceCode: reconsiderResult.reservationReferenceCode,
      workspaceDisplayName: "Focus Room 1",
      workspaceTemplateName: "Focus Room",
      floorName: "Main Floor",
      bookingStartAt: "2026-09-18T14:00:00.000Z",
      bookingEndAt: "2026-09-18T16:00:00.000Z",
      bookingAccessUrl: bookingAccess.accessUrl,
      bookingToken: bookingAccess.token,
      qrIssuedAt: bookingAccess.issuedAt,
      trackingUrl: `https://deskatlas.test/track?ref=${reconsiderResult.reservationReferenceCode}`,
    });

    assert.equal(sendRes.success, true);
    assert.equal(confirmationEmailSent, true);
  });

  it("Reconsider & Approve falls back to NEEDS_MANUAL_RESOLUTION if all candidates are occupied", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-17T09:00:00.000Z");
    const nowProvider = () => now;
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Floor B" });
    const template = await workspaceRepo.createTemplate({
      name: "Desk",
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
      instanceCode: "D2",
      displayName: "Desk 2",
    });

    // Reservation 1: will be rejected, then reconsidered
    const res1 = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Dan",
        customerLastName: "Miller",
        customerEmail: "dan@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-09-18T10:00:00.000Z",
            endAt: "2026-09-18T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );
    await paymentSessionService.submitPaymentProof({
      token: res1.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/dan.png",
    });

    // Reject Dan
    await paymentReviewService.reviewPayment({
      paymentAttemptId: res1.paymentSession!.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "REJECT",
      rejectionReason: "Suspected invalid payment",
    });

    // In the meantime, Reservation 2 is booked and approved for the same instance and slot
    const res2 = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Eve",
        customerLastName: "Taylor",
        customerEmail: "eve@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-09-18T10:00:00.000Z",
            endAt: "2026-09-18T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );
    await paymentSessionService.submitPaymentProof({
      token: res2.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/eve.png",
    });
    await paymentReviewService.reviewPayment({
      paymentAttemptId: res2.paymentSession!.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    // Now admin reconsiders Dan's rejection, but slot is taken by Eve!
    const reconsiderDan = await paymentReviewService.reviewPayment({
      paymentAttemptId: res1.paymentSession!.paymentAttemptId,
      actor: { userId: "admin-user-1", role: "ADMIN" },
      decision: "RECONSIDER_APPROVE",
    });

    assert.equal(reconsiderDan.paymentStatus, "APPROVED");
    assert.equal(reconsiderDan.reservationStatus, "NEEDS_MANUAL_RESOLUTION");
    assert.equal(reconsiderDan.assignedCandidate, null);

    const danRes = reservationRepo.requireReservation(res1.id);
    assert.equal(danRes.status, "NEEDS_MANUAL_RESOLUTION");
    assert.equal((danRes as any).cancelledAt, null);
    assert.equal((danRes as any).cancellationReason, null);
  });
});
