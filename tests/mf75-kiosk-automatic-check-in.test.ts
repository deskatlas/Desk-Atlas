import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ReservationMemoryRepository,
  createBookingAccessService,
  createCounterPaymentService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  createStaffOperationsService,
  InMemoryWorkspaceRepository,
} from "@deskatlas/domain";

describe("MF-75: Kiosk Automatic Check-In on Payment Confirmation", () => {
  it("automatically transitions a kiosk reservation to CHECKED_IN upon counter payment confirmation", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-12T10:00:00.000Z");
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo
    );
    const counterPaymentService = createCounterPaymentService(reservationRepo, () => now);

    const floor = await workspaceRepo.createFloor({ name: "Ground Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#1e293b",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DK-01",
      displayName: "Desk 1",
    });

    // Create Kiosk walk-in reservation (start time has a 5-minute gap)
    const bookingStart = new Date("2026-09-12T10:05:00.000Z");
    const bookingEnd = new Date("2026-09-12T12:05:00.000Z");

    const reservation = await reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Kiosk",
      customerLastName: "Customer",
      customerEmail: "kiosk@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: instance.id,
          startAt: bookingStart.toISOString(),
          endAt: bookingEnd.toISOString(),
        },
      ],
    });

    assert.equal(reservation.status, "PENDING_COUNTER_CONFIRMATION");
    assert.equal(reservation.checkedInAt, null);

    // Staff confirms counter payment at 10:00 (5 minutes before startAt)
    const staffActor = { userId: "staff-1", role: "STAFF" as const };
    const decision = await counterPaymentService.confirmPayment({
      paymentAttemptId: reservation.counterPaymentAttemptId!,
      actor: staffActor,
    });

    // Guaranteed CHECKED_IN upon confirmation
    assert.equal(decision.paymentStatus, "APPROVED");
    assert.equal(decision.reservationStatus, "CHECKED_IN");
    assert.equal(decision.assignedCandidateRank, 0);

    // Verify stored reservation in repo
    const stored = await reservationRepo.getOperationalReservation(reservation.id);
    assert.ok(stored);
    assert.equal(stored.reservationStatus, "CHECKED_IN");
    assert.equal(stored.checkedInAt, now.toISOString());
    assert.equal(stored.confirmedAt, now.toISOString());

    // Verify operational activity log receives a CHECK_IN event
    const activities = await reservationRepo.listOperationalActivity(10);
    const checkInEvent = activities.find(
      (a) => a.reservationId === reservation.id && a.activityType === "CHECK_IN"
    );
    assert.ok(checkInEvent, "Operational activity log must include CHECK_IN record");
    assert.equal(checkInEvent.referenceCode, reservation.referenceCode);
  });

  it("treats checked-in kiosk booking as ACTIVE and OCCUPIED even during the 5-minute gap", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let currentTime = new Date("2026-09-12T10:01:00.000Z");
    const nowProvider = () => currentTime;

    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo
    );
    const counterPaymentService = createCounterPaymentService(reservationRepo, nowProvider);
    const bookingAccessService = createBookingAccessService(reservationRepo, nowProvider);
    const staffOpsService = createStaffOperationsService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "1st Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Focus Pod",
      capacity: 1,
      rateAmount: 150,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#1e293b",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "FP-01",
      displayName: "Focus Pod 1",
    });

    // Kiosk booking scheduled from 10:05 to 12:05 (5-minute gap from 10:00 booking)
    const bookingStart = new Date("2026-09-12T10:05:00.000Z");
    const bookingEnd = new Date("2026-09-12T12:05:00.000Z");

    const reservation = await reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Juan",
      customerLastName: "Luna",
      customerEmail: "juan.luna@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: instance.id,
          startAt: bookingStart.toISOString(),
          endAt: bookingEnd.toISOString(),
        },
      ],
    });

    // Staff confirms counter payment at 10:01
    await counterPaymentService.confirmPayment({
      paymentAttemptId: reservation.counterPaymentAttemptId!,
      actor: { userId: "staff-1", role: "STAFF" },
    });

    // Issue booking QR access pass
    const access = await bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://deskatlas.test/access"
    );
    assert.ok(access);

    // Test at 10:02:00 (3 minutes before startAt!)
    currentTime = new Date("2026-09-12T10:02:00.000Z");

    // Scan booking QR token via resolveBookingAccess - must be ACTIVE, NOT "NOT_ACTIVE"
    const scanResult = await bookingAccessService.resolveBookingAccess(
      access.token,
      { userId: "staff-1", role: "STAFF" }
    );

    assert.equal(scanResult.accessState, "ACTIVE", "Access pass must be ACTIVE during leeway window");
    assert.equal(scanResult.checkInState, "CHECKED_IN");
    assert.equal(scanResult.reservationStatus, "CHECKED_IN");

    // Check occupancy list at 10:02:00 (during 5-min gap) - must show OCCUPIED
    const occupancy = await staffOpsService.listOccupancy();
    const podOccupancy = occupancy.find((o) => o.workspaceInstanceId === instance.id);
    assert.ok(podOccupancy, "Pod must appear in occupancy list during leeway window");
    assert.equal(podOccupancy.occupancyState, "OCCUPIED");
  });

  it("does NOT automatically check in online web reservations upon payment approval", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let now = new Date("2026-09-12T09:00:00.000Z");
    const nowProvider = () => now;
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Ground Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#1e293b",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DK-02",
      displayName: "Desk 2",
    });

    // Create online WEB reservation
    const bookingStart = new Date("2026-09-12T14:00:00.000Z");
    const bookingEnd = new Date("2026-09-12T16:00:00.000Z");

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Web",
        customerLastName: "Customer",
        customerEmail: "web@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: bookingStart.toISOString(),
            endAt: bookingEnd.toISOString(),
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    assert.equal(reservation.status, "PENDING_PAYMENT");
    assert.ok(reservation.paymentSession?.token);

    // Submit payment proof
    await paymentSessionService.submitPaymentProof({
      token: reservation.paymentSession.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/sample.png",
    });

    // Admin approves online web payment
    const decision = await paymentReviewService.reviewPayment({
      paymentAttemptId: reservation.paymentSession.paymentAttemptId,
      decision: "APPROVE",
      actor: { userId: "admin-1", role: "ADMIN" },
    });

    // Web reservation MUST remain CONFIRMED, not CHECKED_IN
    assert.equal(decision.reservationStatus, "CONFIRMED");
    const stored = await reservationRepo.getOperationalReservation(reservation.id);
    assert.ok(stored);
    assert.equal(stored.reservationStatus, "CONFIRMED");
    assert.equal(stored.checkedInAt, null);
  });
});
