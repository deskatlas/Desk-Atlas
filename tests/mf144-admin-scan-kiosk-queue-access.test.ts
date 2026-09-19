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
import * as fs from "node:fs";
import * as path from "node:path";

describe("MF-144: Admin and Super Admin Access to QR Scanner and Kiosk Queue", () => {
  it("Admin Portal navigation layout includes QR Scanner and Kiosk Queue in sidebar", () => {
    const layoutPath = path.resolve(
      process.cwd(),
      "apps/admin-portal/src/app/manage/layout.tsx"
    );
    assert.ok(fs.existsSync(layoutPath), "apps/admin-portal layout.tsx should exist");
    const layoutContent = fs.readFileSync(layoutPath, "utf-8");

    // Must include /manage/scan and /manage/kiosk-confirm routes
    assert.ok(
      layoutContent.includes("id: '/manage/scan'"),
      "Admin layout must include /manage/scan route"
    );
    assert.ok(
      layoutContent.includes("label: 'QR Scanner'"),
      "Admin layout must include 'QR Scanner' label"
    );
    assert.ok(
      layoutContent.includes("id: '/manage/kiosk-confirm'"),
      "Admin layout must include /manage/kiosk-confirm route"
    );
    assert.ok(
      layoutContent.includes("label: 'Kiosk Queue'"),
      "Admin layout must include 'Kiosk Queue' label"
    );

    // Must include icon handling for 'scan' and 'kiosk'
    assert.ok(
      layoutContent.includes("case 'scan':"),
      "Admin layout must handle 'scan' icon type"
    );
    assert.ok(
      layoutContent.includes("case 'kiosk':"),
      "Admin layout must handle 'kiosk' icon type"
    );

    // Must fetch counter_queue badge count
    assert.ok(
      layoutContent.includes("filter=counter_queue"),
      "Admin layout must fetch counter_queue for kiosk badge count"
    );
  });

  it("Admin Portal page files exist for /manage/scan and /manage/kiosk-confirm", () => {
    const scanPagePath = path.resolve(
      process.cwd(),
      "apps/admin-portal/src/app/manage/scan/page.tsx"
    );
    const kioskPagePath = path.resolve(
      process.cwd(),
      "apps/admin-portal/src/app/manage/kiosk-confirm/page.tsx"
    );

    assert.ok(fs.existsSync(scanPagePath), "/manage/scan/page.tsx must exist");
    assert.ok(fs.existsSync(kioskPagePath), "/manage/kiosk-confirm/page.tsx must exist");
  });

  it("Admin Portal API routes exist for booking resolution, check-in, check-out, and counter payment confirmation", () => {
    const bookingApi = path.resolve(
      process.cwd(),
      "apps/admin-portal/src/app/api/booking/[token]/route.ts"
    );
    const checkInApi = path.resolve(
      process.cwd(),
      "apps/admin-portal/src/app/api/operations/reservations/[reservationId]/check-in/route.ts"
    );
    const checkOutApi = path.resolve(
      process.cwd(),
      "apps/admin-portal/src/app/api/operations/reservations/[reservationId]/check-out/route.ts"
    );
    const paymentApi = path.resolve(
      process.cwd(),
      "apps/admin-portal/src/app/api/payments/[paymentAttemptId]/route.ts"
    );
    const paymentConfirmApi = path.resolve(
      process.cwd(),
      "apps/admin-portal/src/app/api/payments/[paymentAttemptId]/confirm/route.ts"
    );

    assert.ok(fs.existsSync(bookingApi), "Admin booking API route must exist");
    assert.ok(fs.existsSync(checkInApi), "Admin check-in API route must exist");
    assert.ok(fs.existsSync(checkOutApi), "Admin check-out API route must exist");
    assert.ok(fs.existsSync(paymentApi), "Admin payment lookup API route must exist");
    assert.ok(fs.existsSync(paymentConfirmApi), "Admin payment confirm API route must exist");
  });

  it("Admin and Super Admin actor role is accepted for QR scanning and auto-check-in", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let currentTime = new Date("2026-09-19T09:00:00.000Z");
    const nowProvider = () => currentTime;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
    const bookingAccessService = createBookingAccessService(reservationRepo, nowProvider);

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

    const bookingStart = new Date("2026-09-19T10:00:00.000Z");
    const bookingEnd = new Date("2026-09-19T12:00:00.000Z");

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Admin",
        customerLastName: "Tester",
        customerEmail: "admintester@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: bookingStart.toISOString(),
            endAt: bookingEnd.toISOString(),
          },
        ],
      },
      { paymentLinkBaseUrl: "https://example.com/pay" }
    );

    // Pay and approve
    await paymentSessionService.submitPaymentProof({
      token: reservation.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/admintester.png",
    });

    await paymentReviewService.reviewPayment({
      paymentAttemptId: reservation.paymentSession!.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    const bookingAccess = await bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://example.com/api/booking"
    );
    assert.ok(bookingAccess, "Booking access should be issued");

    // Advance time to start of booking
    currentTime = new Date("2026-09-19T10:00:00.000Z");

    // Scan QR as ADMIN
    const scanResultAdmin = await bookingAccessService.resolveBookingAccess(
      bookingAccess.token,
      { userId: "admin-user-123", role: "ADMIN" }
    );

    assert.equal(scanResultAdmin.reservationStatus, "CHECKED_IN");
    assert.equal(scanResultAdmin.checkInState, "CHECKED_IN");
    assert.equal(scanResultAdmin.accessState, "ACTIVE");
    assert.equal(scanResultAdmin.reentry, false);

    // Scan again as SUPERADMIN (Re-entry)
    const scanResultSuperAdmin = await bookingAccessService.resolveBookingAccess(
      bookingAccess.token,
      { userId: "superadmin-user-456", role: "SUPERADMIN" as any }
    );

    assert.equal(scanResultSuperAdmin.reservationStatus, "CHECKED_IN");
    assert.equal(scanResultSuperAdmin.checkInState, "CHECKED_IN");
    assert.equal(scanResultSuperAdmin.accessState, "ACTIVE");
    assert.equal(scanResultSuperAdmin.reentry, true);
  });

  it("Admin and Super Admin actor role is accepted for manual operational check-in and check-out", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let currentTime = new Date("2026-09-19T09:00:00.000Z");
    const nowProvider = () => currentTime;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
    const staffOpsService = createStaffOperationsService(reservationRepo, nowProvider);

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

    const bookingStart = new Date("2026-09-19T10:00:00.000Z");
    const bookingEnd = new Date("2026-09-19T12:00:00.000Z");

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Manual",
        customerLastName: "ScanGuest",
        customerEmail: "manualguest@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: bookingStart.toISOString(),
            endAt: bookingEnd.toISOString(),
          },
        ],
      },
      { paymentLinkBaseUrl: "https://example.com/pay" }
    );

    // Pay and approve
    await paymentSessionService.submitPaymentProof({
      token: reservation.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/manual.png",
    });

    await paymentReviewService.reviewPayment({
      paymentAttemptId: reservation.paymentSession!.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    const bookingAccessService = createBookingAccessService(
      reservationRepo,
      nowProvider
    );
    const bookingAccess = await bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://example.com/api/booking"
    );

    currentTime = new Date("2026-09-19T10:00:00.000Z");

    // Check-in as SUPERADMIN actor
    const checkInResult = await staffOpsService.checkInReservation({
      reservationId: reservation.id,
      actor: {
        userId: "superadmin-1",
        role: "SUPERADMIN",
      },
    });

    assert.equal(checkInResult.reservationStatus, "CHECKED_IN");
    assert.equal(checkInResult.actorRole, "SUPERADMIN");

    // Check-out as ADMIN actor
    const checkOutResult = await staffOpsService.checkOutReservation({
      reservationId: reservation.id,
      actor: {
        userId: "admin-1",
        role: "ADMIN",
      },
    });

    assert.equal(checkOutResult.reservationStatus, "COMPLETED");
    assert.equal(checkOutResult.actorRole, "ADMIN");
  });

  it("Admin and Super Admin can confirm kiosk walk-in counter payments", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let currentTime = new Date("2026-09-19T11:00:00.000Z");
    const nowProvider = () => currentTime;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const counterPaymentService = createCounterPaymentService(
      reservationRepo,
      nowProvider
    );

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
      instanceCode: "DK-03",
      displayName: "Desk 3",
    });

    const bookingStart = new Date("2026-09-19T11:00:00.000Z");
    const bookingEnd = new Date("2026-09-19T13:00:00.000Z");

    const reservation = await reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Kiosk",
      customerLastName: "WalkIn",
      customerEmail: "kioskwalkin@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: instance.id,
          startAt: bookingStart.toISOString(),
          endAt: bookingEnd.toISOString(),
        },
      ],
    });

    // Look up counter payment record by code
    const record = await counterPaymentService.getCounterPaymentRecordByCode(
      reservation.referenceCode
    );
    assert.ok(record, "Counter payment record should exist");
    assert.equal(record.reservationReferenceCode, reservation.referenceCode);
    assert.equal(record.customerFirstName, "Kiosk");

    // Confirm kiosk payment as ADMIN
    const decision = await counterPaymentService.confirmPayment({
      code: reservation.referenceCode,
      actor: {
        userId: "admin-actor-1",
        role: "ADMIN",
      },
    });

    assert.equal(decision.paymentStatus, "APPROVED");
    assert.equal(decision.reservationStatus, "CHECKED_IN");
    assert.equal(decision.assignedCandidate?.workspaceInstanceId, instance.id);
  });
});
