import { describe, it, expect, beforeEach } from "vitest";
import {
  ReservationMemoryRepository,
  createAdminReservationService,
  createStaffOperationsService,
  createAdminSettingsService,
  InMemorySettingsRepository,
  createTransactionalEmailService,
  renderManualResolutionEmail,
  filterAdminReservationsByTab,
  filterStaffReservationsByTab,
} from "@deskatlas/domain";

describe("MS-26: Facility Closure Removal Conflict Reconciliation, Filter Parity, and Email Schedule Details", () => {
  let reservationRepo: ReservationMemoryRepository;
  let settingsRepo: InMemorySettingsRepository;
  let emailService: ReturnType<typeof createTransactionalEmailService>;
  let adminReservationService: ReturnType<typeof createAdminSettingsService>;
  let staffOperationsService: ReturnType<typeof createStaffOperationsService>;
  let adminSettingsService: ReturnType<typeof createAdminSettingsService>;
  const mockNow = new Date("2026-10-01T08:00:00.000Z");

  beforeEach(() => {
    reservationRepo = new ReservationMemoryRepository(() => mockNow);
    settingsRepo = new InMemorySettingsRepository();
    emailService = createTransactionalEmailService({
      apiKey: "test-token",
      fromEmail: "test@deskatlas.com",
      fetcher: async () => new Response(JSON.stringify({ id: "msg-123" }), { status: 200, headers: { "Content-Type": "application/json" } }),
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

  it("QAD-TC26-01: Add closure overlapping reservation, verify manual resolution flag is set", async () => {
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

    const closure = await adminSettingsService.createClosure({
      date: "2026-10-05",
      closureType: "FULL_DAY",
      reason: "Emergency Maintenance",
    });

    expect(closure.id).toBeDefined();

    const updated = await reservationRepo.findGuestReservationTrackingRecord(res.referenceCode);
    expect(updated?.isClosureImpacted).toBe(true);
    expect(updated?.closureImpactStatus).toBe("AFFECTED_PENDING_ACTION");

    const adminList = await reservationRepo.listAdminReservations();
    const adminFiltered = filterAdminReservationsByTab(adminList, "reservations", "closure_impacted", mockNow.getTime());
    expect(adminFiltered.length).toBe(1);
    expect(adminFiltered[0].referenceCode).toBe(res.referenceCode);
  });

  it("QAD-TC26-02: Delete closure, verify manual resolution flag is cleared automatically", async () => {
    const startAt = "2026-10-05T01:00:00.000Z";
    const endAt = "2026-10-05T04:00:00.000Z";

    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Bob",
      customerLastName: "Smith",
      customerEmail: "bob@example.com",
      customerContactNumber: "09171234568",
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

    const closure = await adminSettingsService.createClosure({
      date: "2026-10-05",
      closureType: "FULL_DAY",
      reason: "Holiday Closure",
    });

    const flaggedRecord = await reservationRepo.findGuestReservationTrackingRecord(res.referenceCode);
    expect(flaggedRecord?.isClosureImpacted).toBe(true);

    // Delete closure exception
    await adminSettingsService.deleteClosure(closure.blockIds);

    const reconciledRecord = await reservationRepo.findGuestReservationTrackingRecord(res.referenceCode);
    expect(reconciledRecord?.isClosureImpacted).toBe(false);
    expect(reconciledRecord?.closureImpactStatus).toBeNull();

    // Verify it disappears from Admin and Staff closure impacted tab filters
    const adminList = await reservationRepo.listAdminReservations();
    const adminFiltered = filterAdminReservationsByTab(adminList, "reservations", "closure_impacted", mockNow.getTime());
    expect(adminFiltered.length).toBe(0);

    const staffList = await staffOperationsService.listOperationalReservations();
    const staffFiltered = filterStaffReservationsByTab(staffList, "reservations", "closure_impacted", mockNow.getTime());
    expect(staffFiltered.length).toBe(0);
  });

  it("QAD-TC26-03: Delete one closure while another overlapping closure remains, reservation remains flagged", async () => {
    const startAt = "2026-10-08T01:00:00.000Z";
    const endAt = "2026-10-08T04:00:00.000Z";

    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Charlie",
      customerLastName: "Brown",
      customerEmail: "charlie@example.com",
      rateSnapshot: 150,
      amountDue: 450,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-03",
          rank: 1,
          isAssigned: true,
          startAt,
          endAt,
        },
      ],
    });

    await reservationRepo.confirmReservation(res.id, {
      confirmedAt: "2026-10-01T08:05:00.000Z",
      assignedCandidateId: "desk-03",
      amountPaid: 450,
      paymentMethodId: "gcash-01",
      paymentMethodType: "GCASH",
    });

    // Create closure 1: Full day on Oct 8
    const closure1 = await settingsRepo.createScheduleBlock({
      scope: "BUSINESS",
      blockType: "CLOSURE",
      startAt: "2026-10-07T16:00:00.000Z", // Oct 8 00:00 Manila
      endAt: "2026-10-08T16:00:00.000Z", // Oct 9 00:00 Manila
      reason: "Renovation Part 1",
    });

    // Create closure 2: Multi-day spanning Oct 7-9
    const closure2 = await settingsRepo.createScheduleBlock({
      scope: "BUSINESS",
      blockType: "CLOSURE",
      startAt: "2026-10-06T16:00:00.000Z", // Oct 7 00:00 Manila
      endAt: "2026-10-09T16:00:00.000Z", // Oct 10 00:00 Manila
      reason: "Building Wide Electrical Maintenance",
    });

    await reservationRepo.markReservationsClosureImpacted([res.id], closure1.id, "Renovation Part 1");

    // Delete closure 1 only
    await adminSettingsService.deleteClosure([closure1.id]);

    // Reservation should remain flagged because closure 2 still covers Oct 8
    const record = await reservationRepo.findGuestReservationTrackingRecord(res.referenceCode);
    expect(record?.isClosureImpacted).toBe(true);
    expect(record?.closureImpactStatus).not.toBeNull();
  });

  it("QAD-TC26-04: Compare closure-impacted filter output between Admin and Staff repos (Parity Check)", async () => {
    const startAt = "2026-10-12T01:00:00.000Z";
    const endAt = "2026-10-12T04:00:00.000Z";

    const res1 = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerEmail: "diana@example.com",
      rateSnapshot: 150,
      amountDue: 450,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-04",
          rank: 1,
          isAssigned: true,
          startAt,
          endAt,
        },
      ],
    });

    const res2 = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Bruce",
      customerLastName: "Wayne",
      customerEmail: "bruce@example.com",
      rateSnapshot: 200,
      amountDue: 600,
      currency: "PHP",
      candidates: [
        {
          workspaceInstanceId: "desk-05",
          rank: 1,
          isAssigned: true,
          startAt,
          endAt,
        },
      ],
    });

    await reservationRepo.confirmReservation(res1.id, {
      confirmedAt: "2026-10-01T08:05:00.000Z",
      assignedCandidateId: "desk-04",
      amountPaid: 450,
      paymentMethodId: "gcash-01",
      paymentMethodType: "GCASH",
    });

    await reservationRepo.confirmReservation(res2.id, {
      confirmedAt: "2026-10-01T08:05:00.000Z",
      assignedCandidateId: "desk-05",
      amountPaid: 600,
      paymentMethodId: "gcash-01",
      paymentMethodType: "GCASH",
    });

    // Mark both as closure impacted
    await reservationRepo.markReservationsClosureImpacted([res1.id, res2.id], "exc-typhoon", "Super Typhoon Warning");

    const adminList = await reservationRepo.listAdminReservations();
    const staffList = await staffOperationsService.listOperationalReservations();

    const adminFiltered = filterAdminReservationsByTab(adminList, "reservations", "closure_impacted", mockNow.getTime());
    const staffFiltered = filterStaffReservationsByTab(staffList, "reservations", "closure_impacted", mockNow.getTime());

    expect(adminFiltered.length).toBe(2);
    expect(staffFiltered.length).toBe(2);

    const adminIds = adminFiltered.map((r) => r.id).sort();
    const staffIds = staffFiltered.map((r) => r.reservationId).sort();
    expect(adminIds).toEqual(staffIds);

    const adminRefs = adminFiltered.map((r) => r.referenceCode).sort();
    const staffRefs = staffFiltered.map((r) => r.referenceCode).sort();
    expect(adminRefs).toEqual(staffRefs);
  });

  it("QAD-TC26-05: Render manual resolution email with scheduled date and time", () => {
    const rendered = renderManualResolutionEmail({
      to: "guest@example.com",
      customerFirstName: "Clark",
      customerLastName: "Kent",
      referenceCode: "REF-CK-001",
      trackingUrl: "https://deskatlas.com/track?code=REF-CK-001",
      scheduledDate: "Oct 15, 2026",
      scheduledTime: "09:00 AM to 12:00 PM",
      workspaceName: "Hot Desk #12",
    });

    expect(rendered.subject).toContain("REF-CK-001");
    // Verify HTML contains scheduled booking details box
    expect(rendered.html).toContain("Scheduled Booking Details");
    expect(rendered.html).toContain("Date(s):");
    expect(rendered.html).toContain("Oct 15, 2026");
    expect(rendered.html).toContain("Scheduled Time:");
    expect(rendered.html).toContain("09:00 AM to 12:00 PM");
    expect(rendered.html).toContain("Reserved Spot:");
    expect(rendered.html).toContain("Hot Desk #12");

    // Verify Plain-Text contains scheduled booking details
    expect(rendered.text).toContain("SCHEDULED BOOKING DETAILS");
    expect(rendered.text).toContain("Date(s): Oct 15, 2026");
    expect(rendered.text).toContain("Scheduled Time: 09:00 AM to 12:00 PM");
    expect(rendered.text).toContain("Reserved Spot: Hot Desk #12");
  });

  it("QAD-TC26-06: Render manual resolution email without explicit date (graceful fallback test)", () => {
    const rendered = renderManualResolutionEmail({
      to: "guest@example.com",
      customerFirstName: "Barry",
      customerLastName: "Allen",
      referenceCode: "REF-BA-002",
      trackingUrl: "https://deskatlas.com/track?code=REF-BA-002",
    });

    expect(rendered.subject).toContain("REF-BA-002");
    // Fallbacks in HTML
    expect(rendered.html).toContain("Upcoming Scheduled Date");
    expect(rendered.html).toContain("Booked Time Slot");

    // Fallbacks in Text
    expect(rendered.text).toContain("Date(s): Upcoming Scheduled Date");
    expect(rendered.text).toContain("Scheduled Time: Booked Time Slot");
  });
});
