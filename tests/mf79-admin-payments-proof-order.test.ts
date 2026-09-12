import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  ReservationMemoryRepository,
  createPaymentSessionService,
  createReservationService,
  createPaymentReviewService,
  InMemoryWorkspaceRepository,
  PaymentReviewQueueItem,
  PaymentReviewRepository,
  PaymentReviewDetail,
  PaymentReviewDecisionResult,
} from "@deskatlas/domain";
import fs from "node:fs";
import path from "node:path";

describe("MF-79: Admin Payments Proof Upload Sort Order & Admin Notice", () => {
  it("orders payments strictly by proof upload timestamp ascending (earliest upload first)", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let now = new Date("2026-09-01T08:00:00.000Z");
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
      defaultShape: "rectangle",
      defaultColor: "#111827",
      isActive: true,
    });

    const inst1 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "D-01",
      displayName: "Desk 1",
    });

    // Reservation 1 created at 08:00 by Alice
    const resAlice = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "Alvarez",
        customerEmail: "alice@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: inst1.id,
            startAt: "2026-09-02T09:00:00.000Z",
            endAt: "2026-09-02T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Reservation 2 created at 08:05 by Bob
    now = new Date("2026-09-01T08:05:00.000Z");
    const resBob = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Bob",
        customerLastName: "Bernardo",
        customerEmail: "bob@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: inst1.id,
            startAt: "2026-09-02T13:00:00.000Z",
            endAt: "2026-09-02T15:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Reservation 3 created at 08:10 by Charlie
    now = new Date("2026-09-01T08:10:00.000Z");
    const resCharlie = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Charlie",
        customerLastName: "Cruz",
        customerEmail: "charlie@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: inst1.id,
            startAt: "2026-09-02T16:00:00.000Z",
            endAt: "2026-09-02T18:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Upload order is different from reservation creation order:
    // 1st proof upload: Bob at 08:15:00
    now = new Date("2026-09-01T08:15:00.000Z");
    await paymentSessionService.submitPaymentProof({
      token: resBob.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/bob.png",
    });

    // 2nd proof upload: Charlie at 08:20:00
    now = new Date("2026-09-01T08:20:00.000Z");
    await paymentSessionService.submitPaymentProof({
      token: resCharlie.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/charlie.png",
    });

    // 3rd proof upload: Alice at 08:30:00
    now = new Date("2026-09-01T08:30:00.000Z");
    await paymentSessionService.submitPaymentProof({
      token: resAlice.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/alice.png",
    });

    // Query queue from PaymentReviewService
    const queue = await paymentReviewService.listPaymentReviewQueue();

    assert.equal(queue.length, 3, "All 3 submitted proofs should be in queue");
    // Order MUST be: Bob (08:15) -> Charlie (08:20) -> Alice (08:30)
    assert.equal(queue[0].customerFirstName, "Bob");
    assert.equal(queue[0].proofSubmittedAt, "2026-09-01T08:15:00.000Z");

    assert.equal(queue[1].customerFirstName, "Charlie");
    assert.equal(queue[1].proofSubmittedAt, "2026-09-01T08:20:00.000Z");

    assert.equal(queue[2].customerFirstName, "Alice");
    assert.equal(queue[2].proofSubmittedAt, "2026-09-01T08:30:00.000Z");
  });

  it("PaymentReviewService sorts defensively even if repository returns arbitrary order", async () => {
    const mockRepo: PaymentReviewRepository = {
      listPaymentReviewQueue: async (): Promise<PaymentReviewQueueItem[]> => {
        return [
          {
            paymentAttemptId: "pay-3",
            reservationId: "res-3",
            reservationReferenceCode: "DA-003",
            customerFirstName: "Late",
            customerLastName: "Uploader",
            amountDue: 500,
            channel: "WEB",
            paymentStatus: "UNDER_REVIEW",
            proofSubmittedAt: "2026-09-01T12:00:00.000Z",
          },
          {
            paymentAttemptId: "pay-1",
            reservationId: "res-1",
            reservationReferenceCode: "DA-001",
            customerFirstName: "Early",
            customerLastName: "Uploader",
            amountDue: 200,
            channel: "WEB",
            paymentStatus: "UNDER_REVIEW",
            proofSubmittedAt: "2026-09-01T08:00:00.000Z",
          },
          {
            paymentAttemptId: "pay-2",
            reservationId: "res-2",
            reservationReferenceCode: "DA-002",
            customerFirstName: "Middle",
            customerLastName: "Uploader",
            amountDue: 350,
            channel: "WEB",
            paymentStatus: "UNDER_REVIEW",
            proofSubmittedAt: "2026-09-01T10:00:00.000Z",
          },
        ];
      },
      getPaymentReviewDetail: async function (_id: string): Promise<PaymentReviewDetail | null> {
        return null;
      },
      approvePaymentAndAllocate: async function (_input: any): Promise<PaymentReviewDecisionResult> {
        throw new Error("Not implemented");
      },
      rejectPaymentAttempt: async function (_input: any): Promise<PaymentReviewDecisionResult> {
        throw new Error("Not implemented");
      },
    };

    const service = createPaymentReviewService(mockRepo);
    const sorted = await service.listPaymentReviewQueue();

    assert.equal(sorted[0].paymentAttemptId, "pay-1");
    assert.equal(sorted[1].paymentAttemptId, "pay-2");
    assert.equal(sorted[2].paymentAttemptId, "pay-3");
  });

  it("PaymentQueue component source contains the sorting notice webcopy and client-side sort logic", () => {
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentQueue.tsx"
    );
    const fileContent = fs.readFileSync(componentPath, "utf-8");

    // Verify small notice is present in webcopy
    assert.ok(
      fileContent.includes("Payments are sorted by proof upload time (earliest first)"),
      "PaymentQueue must contain the notice explaining that payments are sorted by proof upload time"
    );
    assert.ok(
      fileContent.includes("admin-payments-proof-sort-notice"),
      "PaymentQueue must render the notice test id"
    );

    // Verify defensive sorting is in client state handler
    assert.ok(
      fileContent.includes("a.proofSubmittedAt ? new Date(a.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY"),
      "PaymentQueue must defensively sort items by proofSubmittedAt ascending"
    );

    // Verify queue numbering replaces placeholder logo
    assert.ok(
      fileContent.includes("data-testid=\"payment-queue-number\""),
      "PaymentQueue must render payment-queue-number test id"
    );
    assert.ok(
      fileContent.includes("#{queueNumber}"),
      "PaymentQueue must render queue position number signaling their queue order"
    );
  });
});
