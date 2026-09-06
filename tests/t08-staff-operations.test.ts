import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffOperationsService,
  createStaffManagementService,
  createStaffDashboardService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createBookingAccessService,
  StaffManagementMemoryRepository,
  StaffManagementAuthorizationError,
  StaffOperationsError,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("t08: Staff Operations, Dashboard & Team Management", () => {
  it("handles staff check-in and check-out actions (M12)", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let now = new Date("2026-08-27T09:00:00.000Z");
    const nowProvider = () => now;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
    const staffOperationsService = createStaffOperationsService(reservationRepo, nowProvider);

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
        customerFirstName: "Ana",
        customerLastName: "Lim",
        customerEmail: "ana@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: "2026-08-27T10:00:00.000Z",
            endAt: "2026-08-27T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    // Approve reservation
    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/ana.png",
    });
    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    const staffActor = { userId: "staff-1", role: "STAFF" as const };

    // 1. Check in
    now = new Date("2026-08-27T10:05:00.000Z");
    const checkInResult = await staffOperationsService.checkInReservation({
      reservationId: res.id,
      actor: staffActor,
    });
    assert.equal(checkInResult.reservationStatus, "CHECKED_IN");

    // 2. Check out
    now = new Date("2026-08-27T11:45:00.000Z");
    const checkOutResult = await staffOperationsService.checkOutReservation({
      reservationId: res.id,
      actor: staffActor,
    });
    assert.equal(checkOutResult.reservationStatus, "COMPLETED");
  });

  it("manages staff accounts and role authorization (MF08)", async () => {
    const fixedNow = new Date("2026-08-29T10:00:00.000Z");
    const nowProvider = () => fixedNow;
    const memoryRepo = new StaffManagementMemoryRepository([], nowProvider);
    const service = createStaffManagementService(memoryRepo, nowProvider);

    const adminActor = { userId: "admin-root", role: "ADMIN" as const };
    const staffActor = { userId: "staff-sub", role: "STAFF" as const };

    // Admin creates staff
    const staff = await service.createStaff({
      email: "jane.desk@deskatlas.com",
      displayName: "Jane Desk",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: adminActor.role,
    });
    assert.equal(staff.email, "jane.desk@deskatlas.com");

    // Non-admin rejected from creating staff
    await assert.rejects(
      () =>
        service.createStaff({
          email: "hacker@deskatlas.com",
          displayName: "Hacker",
          password: "Password123!",
          role: "STAFF",
          actorUserId: staffActor.userId,
          actorRole: staffActor.role,
        }),
      StaffManagementAuthorizationError
    );

    const list = await service.listStaff();
    assert.equal(list.length, 1);
  });

  it("serves staff dashboard snapshot with operational metrics (MF12)", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const dashboardService = createStaffDashboardService(
      reservationRepo,
      reservationRepo,
      workspaceRepo,
      () => new Date("2026-08-29T10:00:00.000Z")
    );

    const snapshot = await dashboardService.getDashboardSnapshot("today");
    assert.equal(snapshot.range, "today");
    assert.equal(snapshot.rangeLabel, "Today");
    assert.equal(snapshot.metrics.reservations.value, 0);
    assert.equal(snapshot.metrics.checkedIn.value, 0);
  });
});
