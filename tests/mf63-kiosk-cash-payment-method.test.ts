import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CounterPaymentConflictError,
  PaymentSessionError,
  ReservationError,
  ReservationMemoryRepository,
  createBookingAccessService,
  createCounterPaymentService,
  createPaymentSessionService,
  createReservationService,
  createReportsService,
  InMemoryWorkspaceRepository,
} from "@deskatlas/domain";

describe("MF-63: Cash Payment Method for Kiosk", () => {
  it("restricts Cash to Kiosk and strictly excludes it from Web payment methods", async () => {
    const reservationRepo = new ReservationMemoryRepository();

    const kioskMethods = await reservationRepo.listActiveKioskPaymentMethods();
    const webMethods = await reservationRepo.listActiveWebPaymentMethods();

    // Kiosk has Cash
    const cashKioskMethod = kioskMethods.find((m) => m.methodType === "CASH");
    assert.ok(cashKioskMethod, "Cash must be present in kiosk payment methods");
    assert.equal(cashKioskMethod.allowKiosk, true);
    assert.equal(cashKioskMethod.allowWeb, false);

    // Web does NOT have Cash
    const cashWebMethod = webMethods.find((m) => m.methodType === "CASH");
    assert.equal(cashWebMethod, undefined, "Cash must NOT be present in web payment methods");

    for (const m of webMethods) {
      assert.notEqual(m.methodType, "CASH", "No web method can have methodType CASH");
      assert.equal(m.allowWeb, true);
    }
  });

  it("creates a Kiosk reservation with CASH and creates a counter payment attempt with method CASH", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-08T10:00:00.000Z");
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo
    );

    const floor = await workspaceRepo.createFloor({ name: "1st Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Focus Pod",
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
      instanceCode: "FP-01",
      displayName: "Focus Pod 1",
    });

    // Create Kiosk reservation with Cash
    const reservation = await reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Maria",
      customerLastName: "Santos",
      customerEmail: "maria.santos@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: instance.id,
          startAt: "2026-09-08T10:00:00.000Z",
          endAt: "2026-09-08T12:00:00.000Z",
        },
      ],
    });

    assert.equal(reservation.status, "PENDING_COUNTER_CONFIRMATION");
    assert.equal(reservation.paymentSession, undefined);
    assert.ok(reservation.counterPaymentAttemptId);

    // Verify stored attempt
    const attempts = reservationRepo.getStoredPaymentAttempts();
    const attempt = attempts.find((a) => a.id === reservation.counterPaymentAttemptId);
    assert.ok(attempt);
    assert.equal(attempt.channel, "KIOSK");
    assert.equal(attempt.paymentMethodId, "pm-cash");
    assert.equal(attempt.status, "PENDING");
  });

  it("retrieves counter payment record with CASH payment method details by ID and by reference code", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-08T10:00:00.000Z");
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo
    );
    const counterPaymentService = createCounterPaymentService(reservationRepo, () => now);

    const floor = await workspaceRepo.createFloor({ name: "1st Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Focus Pod",
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
      instanceCode: "FP-02",
      displayName: "Focus Pod 2",
    });

    const reservation = await reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Juan",
      customerLastName: "Dela Cruz",
      customerEmail: "juan@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: instance.id,
          startAt: "2026-09-08T10:00:00.000Z",
          endAt: "2026-09-08T12:00:00.000Z",
        },
      ],
    });

    // Lookup by paymentAttemptId
    const recordById = await counterPaymentService.getCounterPaymentRecord(
      reservation.counterPaymentAttemptId!
    );
    assert.equal(recordById.reservationReferenceCode, reservation.referenceCode);
    assert.equal(recordById.paymentMethodType, "CASH");
    assert.equal(recordById.paymentMethodDisplayName, "Cash");
    assert.equal(recordById.amountDue, 200);

    // Lookup by reference code
    const recordByCode = await counterPaymentService.getCounterPaymentRecordByCode(
      reservation.referenceCode
    );
    assert.equal(recordByCode.paymentAttemptId, reservation.counterPaymentAttemptId);
    assert.equal(recordByCode.paymentMethodType, "CASH");
    assert.equal(recordByCode.paymentMethodDisplayName, "Cash");
  });

  it("confirms Cash counter payment, completes allocation, and issues booking QR access pass", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-08T10:00:00.000Z");
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo
    );
    const counterPaymentService = createCounterPaymentService(reservationRepo, () => now);
    const bookingAccessService = createBookingAccessService(reservationRepo, () => now);

    const floor = await workspaceRepo.createFloor({ name: "1st Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Focus Pod",
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
      instanceCode: "FP-03",
      displayName: "Focus Pod 3",
    });

    const reservation = await reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Ana",
      customerLastName: "Reyes",
      customerEmail: "ana.reyes@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: instance.id,
          startAt: "2026-09-08T10:00:00.000Z",
          endAt: "2026-09-08T12:00:00.000Z",
        },
      ],
    });

    // Staff confirms Cash payment
    const staffActor = { userId: "staff-member-1", role: "STAFF" as const };
    const decision = await counterPaymentService.confirmPayment({
      code: reservation.referenceCode,
      actor: staffActor,
    });

    assert.equal(decision.paymentStatus, "APPROVED");
    assert.equal(decision.assignedCandidateRank, 0);
    assert.ok(decision.reservationStatus === "CONFIRMED" || decision.reservationStatus === "CHECKED_IN");

    // Booking QR access can be issued for the confirmed reservation
    const access = await bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://deskatlas.test/access"
    );
    assert.ok(access);
    assert.ok(access.token);
    assert.equal(access.referenceCode, reservation.referenceCode);
  });

  it("rejects payment proof submission on web if a Cash payment method ID is attempted", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-08T10:00:00.000Z");
    const paymentSessionService = createPaymentSessionService(reservationRepo, () => now);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );

    const floor = await workspaceRepo.createFloor({ name: "1st Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Standard Desk",
      capacity: 1,
      rateAmount: 80,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#1e293b",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "SD-01",
      displayName: "Desk 1",
    });

    // Create web reservation
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
            startAt: "2026-09-08T10:00:00.000Z",
            endAt: "2026-09-08T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    assert.ok(reservation.paymentSession);
    const token = reservation.paymentSession.token;

    // Fetch payment session view: Cash is NOT in payment methods
    const sessionView = await paymentSessionService.getPaymentSession(token);
    const hasCash = sessionView.paymentMethods.some((m) => m.methodType === "CASH");
    assert.equal(hasCash, false);

    // Attempting to submit proof with Cash payment method ID should be rejected
    await assert.rejects(
      () =>
        paymentSessionService.submitPaymentProof({
          token,
          paymentMethodId: "pm-cash",
          proofStoragePath: "proofs/test.png",
        }),
      /Invalid payment method/
    );
  });

  it("records payment method CASH in reporting and admin reservation summaries", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-08T10:00:00.000Z");
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo
    );
    const counterPaymentService = createCounterPaymentService(reservationRepo, () => now);
    const reportsService = createReportsService(reservationRepo, () => now);

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
      instanceCode: "FP-05",
      displayName: "Focus Pod 5",
    });

    const reservation = await reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Carlos",
      customerLastName: "Mendoza",
      customerEmail: "carlos@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: instance.id,
          startAt: "2026-09-08T10:00:00.000Z",
          endAt: "2026-09-08T12:00:00.000Z",
        },
      ],
    });

    await counterPaymentService.confirmPayment({
      paymentAttemptId: reservation.counterPaymentAttemptId!,
      actor: { userId: "admin-1", role: "ADMIN" },
    });

    // Verify report payment attempt record
    const reportPayments = await reservationRepo.listReportPaymentAttempts();
    const cashPaymentReport = reportPayments.find(
      (p) => p.paymentAttemptId === reservation.counterPaymentAttemptId
    );
    assert.ok(cashPaymentReport);
    assert.equal(cashPaymentReport.channel, "KIOSK");
    assert.equal(cashPaymentReport.paymentMethodType, "CASH");
    assert.equal(cashPaymentReport.paymentMethodDisplayName, "Cash");
    assert.equal(cashPaymentReport.paymentStatus, "APPROVED");

    // Verify Admin reservations summary
    const adminReservations = await reservationRepo.listAdminReservations();
    const adminRes = adminReservations.find((r) => r.id === reservation.id);
    assert.ok(adminRes);
    assert.equal(adminRes.paymentMethodType, "CASH");
    assert.equal(adminRes.paymentMethodDisplayName, "Cash");
  });
});
