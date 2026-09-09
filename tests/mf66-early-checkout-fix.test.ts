import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import {
  createStaffOperationsService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("MF-66: Fix Early Checkout Ambiguous Column Reference", () => {
  it("verifies SQL migration and functions files contain #variable_conflict and qualified column references", () => {
    const candidateFiles = [
      path.resolve(__dirname, "../supabase/018_fix_early_checkout_ambiguous_column.sql"),
      path.resolve(__dirname, "../supabase/016_early_checkout_workspace_release.sql"),
      path.resolve(__dirname, "../supabase/002_functions.sql"),
    ];
    const filesToCheck = candidateFiles.filter((f) => fs.existsSync(f));
    assert.ok(filesToCheck.length > 0, "Expected at least 002_functions.sql to exist");

    for (const filePath of filesToCheck) {
      assert.ok(fs.existsSync(filePath), `Expected ${filePath} to exist`);
      const content = fs.readFileSync(filePath, "utf-8");

      // Check check_out_reservation:
      assert.ok(
        content.includes("#variable_conflict use_column"),
        `Expected ${path.basename(filePath)} to contain '#variable_conflict use_column'`
      );

      // Must NOT contain ambiguous unqualified COALESCE(checked_out_at, ...):
      assert.ok(
        !content.includes("checked_out_at = COALESCE(checked_out_at,"),
        `Found ambiguous 'checked_out_at = COALESCE(checked_out_at,' in ${path.basename(filePath)}`
      );

      // Must use qualified record access:
      assert.ok(
        content.includes("checked_out_at = COALESCE(v_reservation.checked_out_at, p_acted_at)"),
        `Expected qualified v_reservation.checked_out_at in ${path.basename(filePath)}`
      );

      // Must qualify SELECT columns with table alias r.:
      assert.ok(
        content.includes("SELECT r.id, r.status, r.checked_in_at, r.checked_out_at"),
        `Expected qualified SELECT with alias r in ${path.basename(filePath)}`
      );

      if (content.includes("check_in_reservation")) {
        // Must NOT contain ambiguous unqualified COALESCE(checked_in_at, ...):
        assert.ok(
          !content.includes("checked_in_at = COALESCE(checked_in_at,"),
          `Found ambiguous 'checked_in_at = COALESCE(checked_in_at,' in ${path.basename(filePath)}`
        );

        // Must use qualified record access for check-in:
        assert.ok(
          content.includes("checked_in_at = COALESCE(v_reservation.checked_in_at, p_acted_at)"),
          `Expected qualified v_reservation.checked_in_at in ${path.basename(filePath)}`
        );
      }
    }
  });

  it("verifies early checkout operational action executes and records actual checkout time", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let currentTime = new Date("2026-08-27T09:00:00.000Z");
    const nowProvider = () => currentTime;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
    const staffOperationsService = createStaffOperationsService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "1st Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Desk",
      capacity: 1,
      rateAmount: 80,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#0f172a",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DK-01",
      displayName: "Desk 1",
    });

    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Early",
        customerLastName: "Checker",
        customerEmail: "early@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-08-27T10:00:00.000Z",
            endAt: "2026-08-27T14:00:00.000Z",
          },
        ],
      },
      {
        paymentLinkBaseUrl: "https://deskatlas.com/pay",
      }
    );

    // Submit payment proof and approve to confirm reservation
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

    // Check in at 10:05
    currentTime = new Date("2026-08-27T10:05:00.000Z");
    await staffOperationsService.checkInReservation({
      reservationId: res.id,
      actor: { userId: "staff-uuid-1", role: "STAFF" },
    });

    // Check out early at 11:15 (well before 14:00)
    const earlyTime = "2026-08-27T11:15:00.000Z";
    currentTime = new Date(earlyTime);

    const result = await staffOperationsService.checkOutReservation({
      reservationId: res.id,
      actor: { userId: "staff-uuid-1", role: "STAFF" },
    });

    assert.equal(result.reservationStatus, "COMPLETED");
    assert.equal(result.action, "CHECK_OUT");
    assert.equal(result.actedAt, earlyTime);
    assert.equal(result.actorUserId, "staff-uuid-1");
    assert.equal(result.actorRole, "STAFF");

    const detail = await reservationRepo.getAdminReservationDetail(res.id);
    assert.ok(detail);
    assert.equal(detail.checkedOutAt, earlyTime);
    assert.equal(detail.reservationStatus, "COMPLETED");
  });

  it("rejects early checkout if reservation is not found", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const staffOperationsService = createStaffOperationsService(reservationRepo);

    await assert.rejects(
      async () => {
        await staffOperationsService.checkOutReservation({
          reservationId: "non-existent-id",
          actor: { userId: "staff-uuid-1", role: "STAFF" },
        });
      },
      /Reservation was not found/
    );
  });
});
