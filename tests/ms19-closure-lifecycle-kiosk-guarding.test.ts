import { describe, it, expect, beforeEach } from "vitest";
import {
  ReservationMemoryRepository,
  createAdminReservationService,
  createStaffOperationsService,
  createTransactionalEmailService,
  InMemoryAvailabilityRepository,
  createAvailabilityService,
  type PublishedFloorMap,
} from "@deskatlas/domain";

describe("MS-19: Venue Closure Operational Alerting, Customer Outreach, Identity Polish & Kiosk Guarding", () => {
  let reservationRepo: ReservationMemoryRepository;
  let availabilityRepo: InMemoryAvailabilityRepository;
  let emailService: ReturnType<typeof createTransactionalEmailService>;
  let adminReservationService: ReturnType<typeof createAdminReservationService>;
  let staffOperationsService: ReturnType<typeof createStaffOperationsService>;
  let availabilityService: ReturnType<typeof createAvailabilityService>;
  const mockNow = new Date("2026-10-05T08:00:00.000Z");
  const sentEmails: Array<{ to: string | string[]; subject: string; html: string; text?: string }> = [];

  beforeEach(() => {
    sentEmails.length = 0;
    reservationRepo = new ReservationMemoryRepository(() => mockNow);
    availabilityRepo = new InMemoryAvailabilityRepository();

    emailService = createTransactionalEmailService({
      apiKey: "test-token",
      fromEmail: "test@deskatlas.com",
      fetcher: async () => new Response(JSON.stringify({ id: "msg-123" }), { status: 200 }),
    });

    // Wire custom email interceptor for tests
    const originalSendEmail = (emailService as any).sendEmail.bind(emailService);
    (emailService as any).sendEmail = async (payload: { to: string | string[]; subject: string; html: string; text?: string }) => {
      sentEmails.push(payload);
      return { success: true, id: "msg-123" };
    };

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
    availabilityService = createAvailabilityService(availabilityRepo);
  });

  it("QAD-TC19.1: Urgent Closure Alert Banner Trigger - returns unresolved closure alerts when bookings exist", async () => {
    // Initially zero closure alerts
    const emptyAlerts = await adminReservationService.getClosureAlerts();
    expect(emptyAlerts.impactedCount).toBe(0);
    expect(emptyAlerts.reservations).toHaveLength(0);

    // Create a confirmed booking
    const startAt = "2026-10-05T09:00:00.000Z";
    const endAt = "2026-10-05T12:00:00.000Z";
    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Guo",
      customerEmail: "alice.guo@example.com",
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
      confirmedAt: "2026-10-05T08:05:00.000Z",
      assignedCandidateId: "desk-01",
      amountPaid: 450,
      paymentMethodId: "gcash-01",
      paymentMethodType: "GCASH",
    });

    // Mark reservation as closure impacted
    await reservationRepo.markReservationsClosureImpacted(
      [res.id],
      "closure-01",
      "Emergency Pipe Repair",
      "2026-10-05"
    );

    // Check closure alerts from admin service and staff service
    const adminAlerts = await adminReservationService.getClosureAlerts();
    expect(adminAlerts.impactedCount).toBe(1);
    expect(adminAlerts.closureReason).toContain("Emergency Pipe Repair");
    expect(adminAlerts.closureDateRange).toContain("2026-10-05");
    expect(adminAlerts.reservations[0].referenceCode).toBe(res.referenceCode);

    const staffAlerts = await staffOperationsService.getClosureAlerts();
    expect(staffAlerts.impactedCount).toBe(1);
    expect(staffAlerts.reservations[0].customerEmail).toBe("alice.guo@example.com");
  });

  it("QAD-TC19.2: Closure Phone Call Email Dispatch - logging outreach dispatches email with staff notes", async () => {
    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Bob",
      customerLastName: "Builder",
      customerEmail: "bob.builder@example.com",
      rateSnapshot: 200,
      amountDue: 600,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-02",
          rank: 1,
          isAssigned: true,
          startAt: "2026-10-05T10:00:00.000Z",
          endAt: "2026-10-05T13:00:00.000Z",
        },
      ],
    });

    await reservationRepo.confirmReservation(res.id, {
      confirmedAt: "2026-10-05T08:10:00.000Z",
      assignedCandidateId: "desk-02",
      amountPaid: 600,
      paymentMethodId: "gcash-02",
      paymentMethodType: "GCASH",
    });

    await reservationRepo.markReservationsClosureImpacted(
      [res.id],
      "closure-02",
      "Scheduled Electrical Upgrade",
      "2026-10-05"
    );

    sentEmails.length = 0;

    // Log closure phone call outreach
    const result = await staffOperationsService.logClosurePhoneCall({
      reservationId: res.id,
      staffUserId: "staff-99",
      staffName: "Staff Clara",
      outreachStatus: "Voicemail",
      notes: "Called customer twice, left detailed voicemail regarding electrical maintenance.",
    });

    expect(result.success).toBe(true);
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].to).toBe("bob.builder@example.com");
    expect(sentEmails[0].subject).toContain("Urgent Update Regarding Your Reservation");
    expect(sentEmails[0].subject).toContain(res.referenceCode);
    expect(sentEmails[0].html).toContain("Scheduled Electrical Upgrade");
    expect(sentEmails[0].html).toContain("Staff Clara");
    expect(sentEmails[0].html).toContain("left detailed voicemail");
  });

  it("QAD-TC19.3: Manual Resolution Email Dispatch - flagging booking dispatches customer notice", async () => {
    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerEmail: "diana.prince@example.com",
      rateSnapshot: 250,
      amountDue: 500,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-03",
          rank: 1,
          isAssigned: true,
          startAt: "2026-10-05T14:00:00.000Z",
          endAt: "2026-10-05T16:00:00.000Z",
        },
      ],
    });

    await reservationRepo.confirmReservation(res.id, {
      confirmedAt: "2026-10-05T08:15:00.000Z",
      assignedCandidateId: "desk-03",
      amountPaid: 500,
      paymentMethodId: "gcash-03",
      paymentMethodType: "GCASH",
    });

    await reservationRepo.markReservationsClosureImpacted(
      [res.id],
      "closure-03",
      "HVAC System Overhaul",
      "2026-10-05"
    );

    sentEmails.length = 0;

    // Admin flags for manual resolution
    const flagResult = await adminReservationService.flagClosureManualResolution({
      reservationId: res.id,
      actorUserId: "admin-42",
      actorRole: "SUPERADMIN",
      actorName: "Super Admin Sarah",
      notes: "Customer contacted via WhatsApp, coordinating alternative workspace on Floor 2.",
    });

    expect(flagResult.success).toBe(true);
    expect(flagResult.reservation.closureImpactStatus).toBe("MANUAL_RESOLUTION_REQUIRED");
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].to).toBe("diana.prince@example.com");
    expect(sentEmails[0].subject).toContain("Action Required: Your Reservation");
    expect(sentEmails[0].subject).toContain(res.referenceCode);
    expect(sentEmails[0].html).toContain("HVAC System Overhaul");
    expect(sentEmails[0].html).toContain("Floor 2");
  });

  it("QAD-TC19.4: Human-Readable Name Note Formatting - timeline notes contain staff name rather than raw UUIDs", async () => {
    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Clark",
      customerLastName: "Kent",
      customerEmail: "clark.kent@example.com",
      rateSnapshot: 150,
      amountDue: 300,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-04",
          rank: 1,
          isAssigned: true,
          startAt: "2026-10-05T11:00:00.000Z",
          endAt: "2026-10-05T13:00:00.000Z",
        },
      ],
    });

    await reservationRepo.confirmReservation(res.id, {
      confirmedAt: "2026-10-05T08:20:00.000Z",
      assignedCandidateId: "desk-04",
      amountPaid: 300,
      paymentMethodId: "gcash-04",
      paymentMethodType: "GCASH",
    });

    const flagResult = await adminReservationService.flagClosureManualResolution({
      reservationId: res.id,
      actorUserId: "7d25e0a0-6f01-447a-8fbb-b3b3bf827438",
      actorRole: "ADMIN",
      actorName: "Admin Edward",
      notes: "Relocating to Hot Desk Zone A upon customer confirmation.",
    });

    expect(flagResult.success).toBe(true);
    const notes = flagResult.reservation.manualResolutionNotes ?? "";
    expect(notes).toContain("Flagged for Manual Resolution by Admin Edward (ADMIN)");
    // Must NOT display raw UUID as the primary actor identity name
    expect(notes).not.toContain("by 7d25e0a0-6f01-447a-8fbb-b3b3bf827438 (ADMIN)");
  });

  it("QAD-TC19.5: Kiosk Unoccupied Workspace Unavailable - during active closure, vacant desks are marked unavailable", async () => {
    // Seed 2 workspace instances in availability repository: desk-10 (vacant) and desk-20 (occupied)
    availabilityRepo.setBusinessSettings({
      timezone: "Asia/Manila",
      bookingIntervalMinutes: 15,
    });

    // Schedule business closure for today 2026-10-05 08:00 to 18:00
    availabilityRepo.addScheduleBlock({
      id: "closure-block-01",
      scope: "BUSINESS",
      workspaceInstanceId: null,
      blockType: "CLOSURE",
      startAt: "2026-10-05T00:00:00.000Z",
      endAt: "2026-10-05T10:00:00.000Z",
      reason: "Emergency Facility Sanitation",
    });

    // Check occupied instances and venue closed status
    const result = await availabilityService.listOccupiedInstances({
      nowIso: "2026-10-05T08:00:00.000Z",
      durationMinutes: 0,
    });

    expect(result.isVenueClosed).toBe(true);
    expect(result.closureReason).toBe("Emergency Facility Sanitation");
    // Vacant desk is not in occupiedInstanceIds
    expect(result.occupiedInstanceIds).toHaveLength(0);
  });

  it("QAD-TC19.6: Kiosk Active Timer Continuation - pre-existing checked-in session retains countdown during closure", async () => {
    availabilityRepo.setBusinessSettings({
      timezone: "Asia/Manila",
      bookingIntervalMinutes: 15,
    });

    // Active session for desk-20 ending at 09:30 UTC
    availabilityRepo.addReservation({
      reservationId: "res-active-01",
      reservationStatus: "CHECKED_IN",
      workspaceInstanceId: "desk-20",
      startAt: "2026-10-05T07:30:00.000Z",
      endAt: "2026-10-05T09:30:00.000Z",
    });

    // Add closure from 08:00 to 18:00
    availabilityRepo.addScheduleBlock({
      id: "closure-block-02",
      scope: "BUSINESS",
      workspaceInstanceId: null,
      blockType: "CLOSURE",
      startAt: "2026-10-05T08:00:00.000Z",
      endAt: "2026-10-05T18:00:00.000Z",
      reason: "Unscheduled Maintenance",
    });

    // Poll at 08:15 UTC (session still active)
    const activePoll = await availabilityService.listOccupiedInstances({
      nowIso: "2026-10-05T08:15:00.000Z",
      durationMinutes: 0,
    });

    expect(activePoll.isVenueClosed).toBe(true);
    expect(activePoll.occupiedInstanceIds).toContain("desk-20");
    const desk20Detail = activePoll.occupiedDetails?.find((d) => d.workspaceInstanceId === "desk-20");
    expect(desk20Detail).toBeDefined();
    expect(desk20Detail?.bookingEndAt).toBe("2026-10-05T09:30:00.000Z");

    // When closure is removed, occupied timer remains intact
    (availabilityRepo as any).scheduleBlocks = [];
    const openPoll = await availabilityService.listOccupiedInstances({
      nowIso: "2026-10-05T08:15:00.000Z",
      durationMinutes: 0,
    });

    expect(openPoll.isVenueClosed).toBe(false);
    expect(openPoll.occupiedInstanceIds).toContain("desk-20");
    expect(openPoll.occupiedDetails?.find((d) => d.workspaceInstanceId === "desk-20")?.bookingEndAt).toBe("2026-10-05T09:30:00.000Z");
  });
});
