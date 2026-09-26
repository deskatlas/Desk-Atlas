import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ReservationMemoryRepository,
  createAdminReservationService,
  createStaffOperationsService,
  createAdminSettingsService,
  InMemorySettingsRepository,
  createTransactionalEmailService,
  filterAdminReservationsByTab,
  filterStaffReservationsByTab,
  type ReservationResponseDTO,
} from "@deskatlas/domain";

describe("MS-09: Business Closure Reservation Collision Lifecycle & Resolution", () => {
  let reservationRepo: ReservationMemoryRepository;
  let settingsRepo: InMemorySettingsRepository;
  let emailService: ReturnType<typeof createTransactionalEmailService>;
  let adminReservationService: ReturnType<typeof createAdminReservationService>;
  let staffOperationsService: ReturnType<typeof createStaffOperationsService>;
  let adminSettingsService: ReturnType<typeof createAdminSettingsService>;
  const mockNow = new Date("2026-10-01T08:00:00.000Z");

  beforeEach(() => {
    reservationRepo = new ReservationMemoryRepository(() => mockNow);
    settingsRepo = new InMemorySettingsRepository();
    const sentEmails: any[] = [];
    emailService = createTransactionalEmailService({
      provider: "postmark",
      apiToken: "test-token",
      senderEmail: "test@deskatlas.com",
      customSendEmail: async (payload) => {
        sentEmails.push(payload);
        return { success: true, messageId: "msg-123" };
      },
    });

    adminReservationService = createAdminReservationService(
      reservationRepo,
      () => mockNow,
      emailService
    );
    staffOperationsService = createStaffOperationsService(
      reservationRepo,
      () => mockNow,
      emailService
    );
    adminSettingsService = createAdminSettingsService(
      settingsRepo,
      reservationRepo,
      emailService
    );
  });

  it("QAD-TC9.1 & QAD-TC9.2: previews colliding reservations when scheduling full-day closure", async () => {
    // Seed a confirmed reservation on 2026-10-05 from 09:00 to 12:00
    const startAt = "2026-10-05T01:00:00.000Z"; // 09:00 Manila (UTC+8)
    const endAt = "2026-10-05T04:00:00.000Z"; // 12:00 Manila
    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Guo",
      customerEmail: "alice@example.com",
      customerContactNumber: "09171234567",
      rateSnapshot: 150,
      amountDue: 450,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-01",
          rank: 1,
          isAssigned: true,
          startAt,
          endAt,
        },
      ],
    });

    await reservationRepo.confirmReservation(res.id, {
      confirmedAt: "2026-10-01T08:05:00.000Z",
      assignedCandidateId: "desk-01",
      amountPaid: 450,
      paymentMethodId: "gcash-01",
      paymentMethodType: "GCASH",
    });

    // Preview collision on 2026-10-05
    const preview = await adminSettingsService.previewClosureImpact({
      date: "2026-10-05",
      closureType: "FULL_DAY",
      reason: "National Holiday",
    });

    expect(preview.impactedCount).toBe(1);
    expect(preview.reservations[0].referenceCode).toBe(res.referenceCode);
    expect(preview.reservations[0].customerEmail).toBe("alice@example.com");
  });

  it("QAD-TC9.3: creating closure automatically marks impacted reservations and dispatches email notices", async () => {
    const sentEmails: Array<{ to: string | string[]; subject: string; html: string; text?: string }> = [];
    const customEmailService = createTransactionalEmailService({
      apiKey: "re_test_123",
      fromEmail: "DeskAtlas <noreply@deskatlas.com>",
      fetcher: async (_url: unknown, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        sentEmails.push(body);
        return new Response(JSON.stringify({ id: "msg-123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const serviceWithCustomEmail = createAdminSettingsService(
      settingsRepo,
      reservationRepo,
      customEmailService
    );

    const startAt = "2026-10-10T02:00:00.000Z"; // 10:00 Manila
    const endAt = "2026-10-10T05:00:00.000Z"; // 13:00 Manila
    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Juan",
      customerLastName: "Dela Cruz",
      customerEmail: "juan@example.com",
      rateSnapshot: 150,
      amountDue: 450,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-02",
          rank: 1,
          isAssigned: true,
          startAt,
          endAt,
        },
      ],
    });

    await reservationRepo.confirmReservation(res.id, {
      confirmedAt: "2026-10-01T08:05:00.000Z",
      assignedCandidateId: "desk-02",
      amountPaid: 450,
      paymentMethodId: "gcash-01",
      paymentMethodType: "GCASH",
    });

    // Create full-day closure on 2026-10-10
    const closure = await serviceWithCustomEmail.createClosure({
      date: "2026-10-10",
      closureType: "FULL_DAY",
      reason: "Scheduled Electrical Maintenance",
    });

    expect(closure.id).toBeDefined();

    // Verify reservation was marked
    const updated = await reservationRepo.findGuestReservationTrackingRecord(res.referenceCode);
    expect(updated?.isClosureImpacted).toBe(true);
    expect(updated?.closureImpactStatus).toBe("AFFECTED_PENDING_ACTION");

    // Verify email was sent
    expect(sentEmails.length).toBeGreaterThan(0);
    const notice = sentEmails.find(
      (e) => e.to === "juan@example.com" || (Array.isArray(e.to) && e.to.includes("juan@example.com"))
    );
    expect(notice).toBeDefined();
    expect(notice?.subject).toContain("Closure");
  });

  it("QAD-TC9.4: waives advance reschedule cutoff hours and reschedule limits for closure-impacted bookings", async () => {
    // Create reservation for today in 2 hours (less than standard 12-hour cutoff)
    const bookingStart = new Date(mockNow.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const bookingEnd = new Date(mockNow.getTime() + 5 * 60 * 60 * 1000).toISOString();

    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Maria",
      customerLastName: "Santos",
      customerEmail: "maria@example.com",
      rateSnapshot: 150,
      amountDue: 450,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-03",
          rank: 1,
          isAssigned: true,
          startAt: bookingStart,
          endAt: bookingEnd,
        },
      ],
    });

    await reservationRepo.confirmReservation(res.id, {
      confirmedAt: mockNow.toISOString(),
      assignedCandidateId: "desk-03",
      amountPaid: 450,
      paymentMethodId: "gcash-01",
      paymentMethodType: "GCASH",
    });

    // Mark closure impacted
    await reservationRepo.markReservationsClosureImpacted([res.id], "exc-01", "Emergency Maintenance");

    // New reschedule date 3 days later
    const newStart = "2026-10-04T02:00:00.000Z";
    const newEnd = "2026-10-04T05:00:00.000Z";

    // Attempt reschedule as customer (which would normally fail due to < 12h cutoff)
    const rescheduleResult = await reservationRepo.rescheduleReservation({
      reservationId: res.id,
      startAt: newStart,
      endAt: newEnd,
      cutoffHours: 12,
      actorRole: "CUSTOMER",
    });

    expect(rescheduleResult.success).toBe(true);
    expect(rescheduleResult.reservation.closureImpactStatus).toBe("CUSTOMER_RESOLVED");
  });

  it("QAD-TC9.5: filters closure-impacted reservations on admin and staff reservation queues", async () => {
    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Pedro",
      customerLastName: "Penduko",
      customerEmail: "pedro@example.com",
      rateSnapshot: 150,
      amountDue: 450,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-04",
          rank: 1,
          isAssigned: true,
          startAt: "2026-10-06T02:00:00.000Z",
          endAt: "2026-10-06T05:00:00.000Z",
        },
      ],
    });

    await reservationRepo.confirmReservation(res.id, {
      confirmedAt: mockNow.toISOString(),
      assignedCandidateId: "desk-04",
      amountPaid: 450,
      paymentMethodId: "gcash-01",
      paymentMethodType: "GCASH",
    });

    await reservationRepo.markReservationsClosureImpacted([res.id], "exc-02", "Typhoon Closure");

    const adminList = await reservationRepo.listAdminReservations();
    const staffList = await staffOperationsService.listOperationalReservations();

    const adminClosureImpacted = filterAdminReservationsByTab(adminList, "reservations", "closure_impacted", mockNow.getTime());
    expect(adminClosureImpacted.length).toBe(1);
    expect(adminClosureImpacted[0].referenceCode).toBe(res.referenceCode);

    const staffClosureImpacted = filterStaffReservationsByTab(staffList, "reservations", "closure_impacted", mockNow.getTime());
    expect(staffClosureImpacted.length).toBe(1);
    expect(staffClosureImpacted[0].referenceCode).toBe(res.referenceCode);
  });

  it("QAD-TC9.6: staff can log customer phone outreach and flag for manual resolution", async () => {
    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Carlos",
      customerLastName: "Yulo",
      customerEmail: "carlos@example.com",
      customerContactNumber: "09181112222",
      rateSnapshot: 150,
      amountDue: 450,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-05",
          rank: 1,
          isAssigned: true,
          startAt: "2026-10-07T02:00:00.000Z",
          endAt: "2026-10-07T05:00:00.000Z",
        },
      ],
    });

    await reservationRepo.confirmReservation(res.id, {
      confirmedAt: mockNow.toISOString(),
      assignedCandidateId: "desk-05",
      amountPaid: 450,
      paymentMethodId: "gcash-01",
      paymentMethodType: "GCASH",
    });

    await reservationRepo.markReservationsClosureImpacted([res.id], "exc-03", "Air Conditioning Repair");

    // Staff logs phone call
    const callRes = await staffOperationsService.logClosurePhoneCall({
      reservationId: res.id,
      staffUserId: "staff-001",
      staffName: "Staff Jane",
      outreachStatus: "LEFT_VOICEMAIL",
      notes: "Customer did not answer, sent follow-up SMS.",
    });

    expect(callRes.success).toBe(true);
    expect(callRes.reservation.manualResolutionNotes).toContain("LEFT_VOICEMAIL");
    expect(callRes.reservation.manualResolutionNotes).toContain("Staff Jane");

    // Staff flags for manual resolution
    const flagRes = await staffOperationsService.flagClosureManualResolution({
      reservationId: res.id,
      actorUserId: "staff-001",
      actorRole: "STAFF",
      notes: "Customer unreachable after 3 attempts, manual refund processing requested.",
    });

    expect(flagRes.success).toBe(true);
    expect(flagRes.reservation.closureImpactStatus).toBe("MANUAL_RESOLUTION_REQUIRED");
    expect(flagRes.reservation.manualResolutionNotes).toContain("Manual Resolution");
  });
});
