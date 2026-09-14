import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createAdminReservationService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  filterReservations,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("Admin Reservations: Rejected Payment Status, Red Badge & Filter", () => {
  async function setupRejectedReservation() {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-14T10:00:00.000Z");
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
      name: "Hot Desk",
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
      instanceCode: "HD-1",
      displayName: "Hot Desk 1",
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
            startAt: "2026-09-15T09:00:00.000Z",
            endAt: "2026-09-15T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const token = reservation.paymentSession!.token;
    await paymentSessionService.submitPaymentProof({
      token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/maria.jpg",
    });

    const session = await paymentSessionService.getPaymentSession(token);
    const rejectReason = "Receipt fake or illegible";
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" },
      decision: "REJECT",
      rejectionReason: rejectReason,
    });

    return {
      reservationRepo,
      workspaceRepo,
      adminReservationService,
      reservationId: reservation.id,
      referenceCode: reservation.referenceCode,
      rejectReason,
    };
  }

  it("sets payment status to Rejected (red) and status to Rejected (red badge) in list", async () => {
    const { adminReservationService, reservationId } = await setupRejectedReservation();

    const result = await adminReservationService.listReservations("all");
    const found = result.reservations.find((r) => r.id === reservationId);

    assert.ok(found, "Reservation should be found in all reservations");
    assert.equal(found.paymentStatus, "Rejected");
    assert.equal(found.paymentColor, "var(--da-danger)");
    assert.equal(found.status, "Rejected");
    assert.equal(found.mark, "✕");
    assert.deepEqual(found.statusStyle, { background: "#FEE2E2", color: "#991B1B" });
    assert.equal(found.reservationStatus, "CANCELLED");
  });

  it("filters rejected reservations via 'rejected' filter tab", async () => {
    const { adminReservationService, reservationId } = await setupRejectedReservation();

    // 'rejected' filter should return the rejected reservation
    const rejectedList = await adminReservationService.listReservations("rejected");
    assert.equal(rejectedList.total, 1);
    assert.equal(rejectedList.reservations[0].id, reservationId);
    assert.equal(rejectedList.reservations[0].status, "Rejected");
    assert.equal(rejectedList.reservations[0].paymentStatus, "Rejected");

    // 'active' filter should NOT return the rejected reservation
    const activeList = await adminReservationService.listReservations("active");
    assert.equal(activeList.reservations.some((r) => r.id === reservationId), false);
  });

  it("filters rejected reservations via advanced filter modal (paymentStatus: 'rejected')", async () => {
    const { adminReservationService, reservationId } = await setupRejectedReservation();

    const all = await adminReservationService.listReservations("all");
    const filtered = filterReservations(all.reservations, { paymentStatus: "rejected" });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, reservationId);

    // Other paymentStatus filters should not match
    const paidFiltered = filterReservations(all.reservations, { paymentStatus: "paid" });
    assert.equal(paidFiltered.length, 0);

    const pendingFiltered = filterReservations(all.reservations, { paymentStatus: "pending" });
    assert.equal(pendingFiltered.length, 0);
  });

  it("displays Rejected payment status and status in getReservationDetail", async () => {
    const { adminReservationService, reservationId, rejectReason } = await setupRejectedReservation();

    const detail = await adminReservationService.getReservationDetail(reservationId);
    assert.ok(detail, "Detail should exist");
    assert.equal(detail.status, "Rejected");
    assert.ok(detail.paymentStatus.startsWith("Rejected"));
    assert.equal(detail.paymentColor, "var(--da-danger)");
    assert.deepEqual(detail.statusStyle, { background: "#FEE2E2", color: "#991B1B" });

    // Payment attempt history shows REJECTED and rejection reason
    assert.ok(detail.paymentAttempts && detail.paymentAttempts.length > 0);
    const attempt = detail.paymentAttempts[0];
    assert.equal(attempt.status, "REJECTED");
    assert.equal(attempt.rejectionReason, rejectReason);
  });
});
