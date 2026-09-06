import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createCounterPaymentService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReportsService,
  createReservationService,
  createStaffOperationsService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  type CreateReservationRequest,
} from "@deskatlas/domain";

describe("t10: Reports & Analytics", () => {
  it("returns zero metrics and safe defaults on empty dataset (M14 / MF09)", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const reportsService = createReportsService(
      reservationRepo,
      () => new Date("2026-08-29T12:00:00.000Z")
    );

    const snapshot = await reportsService.getAdminReportsSnapshot("30days");
    assert.equal(snapshot.range, "30days");
    assert.equal(snapshot.rangeLabel, "Last 30 Days");
    assert.equal(snapshot.summaryMetrics[0]?.rawValue, 0);
    assert.equal(snapshot.revenueOverview.totalAmount, 0);
    assert.equal(snapshot.topWorkspaces.length, 0);
    assert.equal(snapshot.topUsers.length, 0);
    assert.equal(snapshot.reportCategories.length, 6);

    const exportData = await reportsService.exportAdminReport("operations-summary");
    assert.ok(exportData.content.includes("total_reservations,0"));
  });

  it("calculates accurate snapshot metrics with date filtering and exports (MF09)", async () => {
    let now = new Date("2026-08-29T12:00:00.000Z");
    const nowProvider = () => now;

    const reservationRepo = new ReservationMemoryRepository(nowProvider);
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
    const reportsService = createReportsService(reservationRepo, nowProvider);
    const adminActor = { userId: "admin-user-1", role: "ADMIN" as const };

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
        customerFirstName: "Reports",
        customerLastName: "Tester",
        customerEmail: "reports@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-08-29T14:00:00.000Z",
            endAt: "2026-08-29T16:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Pay and confirm
    await paymentSessionService.submitPaymentProof({
      token: reservation.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/report-proof.png",
    });
    const session = await paymentSessionService.getPaymentSession(reservation.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: adminActor,
      decision: "APPROVE",
    });

    const snapshot = await reportsService.getAdminReportsSnapshot("today");
    assert.equal(snapshot.range, "today");
    assert.ok(snapshot.summaryMetrics[0]?.rawValue >= 1);

    // CSV export sanity check
    const csvExport = await reportsService.exportAdminReport("operations-summary", "today");
    assert.ok(csvExport.content.includes("total_reservations"));
    // Ensure sensitive internal payment proof storage paths and tokens are never leaked in reports export
    assert.ok(!csvExport.content.includes("proofs/report-proof.png"));
    assert.ok(!csvExport.content.includes(reservation.paymentSession!.token));
  });
});
