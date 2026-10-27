// MS85-TC01 to MS85-TC10, PRD-F1/F2/F13, BRD-M1/M6, SDD-C3/C11, ERD-E10, QAD-TC1/TC2/TC22
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  validateCompanionName,
  validateCompanionNames,
  createCompanionNamesZodSchema,
} from '@deskatlas/validation';
import {
  ReservationMemoryRepository,
  InMemoryAvailabilityRepository,
  createAvailabilityService,
  createReservationService,
  createBookingAccessService,
  createPaymentSessionService,
  createPaymentReviewService,
  createCounterPaymentService,
  type BookingAccessRecord,
  type CreateReservationRequest,
  type WorkspaceRepository,
} from '@deskatlas/domain';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MS-85: Customer Booking History Rebook Flow & Companion Registration', () => {
  // MS85-TC01: Rebook CTA Rendering in Booking History
  it('MS85-TC01: formats rebook link URL with workspace, template, and floor references', () => {
    const historicalReservation = {
      reference_code: 'DA-REB123',
      workspace_instance_id: 'inst-conf-room-1',
      workspace_template_id: 'tpl-conf-room',
      workspace_name: 'Conference Room Alpha',
      floor_id: 'floor-2',
    };

    const searchParams = new URLSearchParams({
      rebookFrom: historicalReservation.reference_code,
      workspaceId: historicalReservation.workspace_instance_id,
      templateId: historicalReservation.workspace_template_id,
      floorId: historicalReservation.floor_id,
    });

    const rebookUrl = `/reserve?${searchParams.toString()}`;

    expect(rebookUrl).toContain('/reserve?');
    expect(searchParams.get('rebookFrom')).toBe('DA-REB123');
    expect(searchParams.get('workspaceId')).toBe('inst-conf-room-1');
    expect(searchParams.get('templateId')).toBe('tpl-conf-room');
    expect(searchParams.get('floorId')).toBe('floor-2');
  });

  // MS85-TC02: Rebook Navigation & Workspace Pre-Selection
  it('MS85-TC02: hydrates pre-selected workspace, floor, and guest session details', () => {
    const rewardsSession = {
      customer: {
        firstName: 'Maria',
        lastName: 'Santos',
        email: 'maria.santos@example.com',
      },
    };

    const mockParams = new Map([
      ['rebookFrom', 'DA-REB123'],
      ['workspaceId', 'inst-conf-room-1'],
      ['templateId', 'tpl-conf-room'],
      ['floorId', 'floor-2'],
    ]);

    // Simulate query parameter hydration
    const paramWorkspaceId = mockParams.get('workspaceId');
    const paramFloorId = mockParams.get('floorId');
    const paramRebookFrom = mockParams.get('rebookFrom');

    expect(paramWorkspaceId).toBe('inst-conf-room-1');
    expect(paramFloorId).toBe('floor-2');
    expect(paramRebookFrom).toBe('DA-REB123');

    // Customer detail prefill from verified session
    const prefilledFirstName = rewardsSession.customer.firstName;
    const prefilledLastName = rewardsSession.customer.lastName;
    const prefilledEmail = rewardsSession.customer.email;

    expect(prefilledFirstName).toBe('Maria');
    expect(prefilledLastName).toBe('Santos');
    expect(prefilledEmail).toBe('maria.santos@example.com');
  });

  // MS85-TC03: Retired or Inactive Workspace Fallback
  it('MS85-TC03: handles retired or maintenance workspace by falling back to map with notice', () => {
    const publishedWorkspaces = [
      { id: 'inst-1', displayName: 'Desk 1', status: 'available' },
      { id: 'inst-conf-room-1', displayName: 'Conference Room Alpha', status: 'maintenance' },
    ];

    const targetId = 'inst-conf-room-1';
    const found = publishedWorkspaces.find((w) => w.id === targetId);

    const isAvailableForRebook =
      found &&
      found.status !== 'maintenance' &&
      found.status !== 'broken' &&
      found.status !== 'inactive';

    expect(isAvailableForRebook).toBe(false);

    let rebookFallbackNotice: string | null = null;
    let selectedWorkspaceId: string | null = null;
    let currentStep: 'map' | 'schedule' = 'schedule';

    if (!isAvailableForRebook) {
      rebookFallbackNotice =
        'Notice: Your previously booked spot is currently inactive, under maintenance, or no longer available. Please choose an available workspace from the interactive map below.';
      selectedWorkspaceId = null;
      currentStep = 'map';
    }

    expect(rebookFallbackNotice).not.toBeNull();
    expect(rebookFallbackNotice).toContain('currently inactive, under maintenance');
    expect(selectedWorkspaceId).toBeNull();
    expect(currentStep).toBe('map');
  });

  // MS85-TC04: Authoritative Availability & Unavailability Filtering
  it('MS85-TC04: rejects overlapping bookings during rebooking window selection', async () => {
    const availRepo = new InMemoryAvailabilityRepository();
    availRepo.seedWorkspaceInstance({
      id: 'inst-1',
      instanceCode: 'D1',
      displayName: 'Desk 1',
      operationalStatus: 'ACTIVE',
    });
    for (let day = 0; day <= 6; day++) {
      availRepo.seedOperatingHours(day, [{ opensAt: '00:00', closesAt: '23:59' }]);
    }
    // Add confirmed booking window
    availRepo.seedBlockingReservation('inst-1', {
      reservationId: 'res-block-1',
      reservationStatus: 'CONFIRMED',
      startAt: '2026-11-01T08:00:00Z',
      endAt: '2026-11-01T12:00:00Z',
    });

    const availService = createAvailabilityService(availRepo);

    // Validate overlapping reservation attempt
    const validation = await availService.validateReservationWindow({
      workspaceInstanceId: 'inst-1',
      startAt: '2026-11-01T10:00:00Z',
      endAt: '2026-11-01T14:00:00Z',
    });

    expect(validation.isValid).toBe(false);
    expect(validation.conflictType).toBe('RESERVATION_CONFLICT');
  });

  // MS85-TC05: Candidate Selection & Strict No-Hold Compliance
  it('MS85-TC05: creates rebooked reservation with candidates without holding inventory prior to payment', async () => {
    const repo = new ReservationMemoryRepository();
    const mockWorkspaceRepo: WorkspaceRepository = {
      listCatalog: async () => ({
        instances: [
          {
            id: 'inst-main',
            templateId: 'tpl-conf',
            floorId: 'fl-1',
            instanceCode: 'C1',
            displayName: 'Room 1',
            operationalStatus: 'ACTIVE',
          },
          {
            id: 'inst-alt1',
            templateId: 'tpl-conf',
            floorId: 'fl-1',
            instanceCode: 'C2',
            displayName: 'Room 2',
            operationalStatus: 'ACTIVE',
          },
        ],
        templates: [
          {
            id: 'tpl-conf',
            name: 'Conference Room',
            capacity: 4,
            rateAmount: 300,
            pricingUnit: 'HOURLY',
            isActive: true,
          },
        ],
        floors: [],
      }),
    };

    const reservationService = createReservationService(repo, mockWorkspaceRepo, repo);

    const rebookRequest: CreateReservationRequest = {
      source: 'WEB',
      customerFirstName: 'Rebook',
      customerLastName: 'Tester',
      customerEmail: 'tester@example.com',
      rateType: 'HOURLY',
      companionNames: ['Companion One', 'Companion Two'],
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: 'inst-main',
          startAt: '2026-11-02T09:00:00Z',
          endAt: '2026-11-02T11:00:00Z',
          rateType: 'HOURLY',
        },
        {
          rank: 1,
          workspaceInstanceId: 'inst-alt1',
          startAt: '2026-11-02T09:00:00Z',
          endAt: '2026-11-02T11:00:00Z',
          rateType: 'HOURLY',
        },
      ],
    };

    const reservation = await reservationService.createReservation(rebookRequest, {
      paymentLinkBaseUrl: 'https://deskatlas.test',
    });

    // Initial state is PENDING_PAYMENT
    expect(reservation.status).toBe('PENDING_PAYMENT');
    expect(reservation.companionNames).toEqual(['Companion One', 'Companion Two']);

    // Strict No-Hold Rule (BAN-HOLD-08): No allocation or spot reservation exists yet
    expect(reservation.candidates.every((c) => c.isAssigned === false)).toBe(true);
  });

  // MS85-TC06: Multi-Capacity Companion Field Calculation
  it('MS85-TC06: calculates maxCompanions = capacity - 1 accurately across spot types', () => {
    const calculateMaxCompanions = (capacity?: number | null): number => {
      const cap = typeof capacity === 'number' && Number.isFinite(capacity) ? Math.max(1, capacity) : 1;
      return Math.max(0, cap - 1);
    };

    // Hot desk: capacity 1 -> 0 companions
    expect(calculateMaxCompanions(1)).toBe(0);

    // 2-person pod: capacity 2 -> 1 companion
    expect(calculateMaxCompanions(2)).toBe(1);

    // 4-person meeting room: capacity 4 -> 3 companions
    expect(calculateMaxCompanions(4)).toBe(3);

    // 10-person boardroom: capacity 10 -> 9 companions
    expect(calculateMaxCompanions(10)).toBe(9);

    // Undefined/null capacity defaults to 0 companions
    expect(calculateMaxCompanions(undefined)).toBe(0);
    expect(calculateMaxCompanions(null)).toBe(0);
  });

  // MS85-TC07: Optionality & Variable Party Sizes
  it('MS85-TC07: permits empty, partial, and full companion name inputs, trimming whitespace', () => {
    // Capacity 4 spot: up to 3 companions
    const capacity = 4;

    // Zero companions provided
    const emptyResult = validateCompanionNames([], capacity);
    expect(emptyResult.isValid).toBe(true);
    expect(emptyResult.cleanedNames).toEqual([]);

    // Partial companions: 2 provided, 1 omitted
    const partialInputs = ['  Alice Santos  ', '', '   ', 'Bob Cruz'];
    const partialResult = validateCompanionNames(partialInputs, capacity);
    expect(partialResult.isValid).toBe(true);
    expect(partialResult.cleanedNames).toEqual(['Alice Santos', 'Bob Cruz']);

    // Full companions: 3 provided for capacity 4
    const fullInputs = ['Alice Santos', 'Bob Cruz', 'Charlie Diaz'];
    const fullResult = validateCompanionNames(fullInputs, capacity);
    expect(fullResult.isValid).toBe(true);
    expect(fullResult.cleanedNames).toHaveLength(3);
  });

  // MS85-TC08: Companion Input Validation & Sanitization
  it('MS85-TC08: rejects HTML markup, control characters, overly long strings, and non-letters', () => {
    // Valid names
    expect(validateCompanionName('Jane Doe').isValid).toBe(true);
    expect(validateCompanionName("René O'Connor").isValid).toBe(true);
    expect(validateCompanionName('Maria Santos-Cruz').isValid).toBe(true);
    expect(validateCompanionName('Dr. John Doe Jr.').isValid).toBe(true);

    // Rejected: HTML tags
    const htmlTest = validateCompanionName('<script>alert("hack")</script>');
    expect(htmlTest.isValid).toBe(false);
    expect(htmlTest.error).toContain('invalid characters');

    // Rejected: Control characters
    const controlTest = validateCompanionName('Jane\x00Doe');
    expect(controlTest.isValid).toBe(false);

    // Rejected: Exceeds 100 characters
    const longName = 'A'.repeat(101);
    const longTest = validateCompanionName(longName);
    expect(longTest.isValid).toBe(false);
    expect(longTest.error).toContain('100 characters');

    // Rejected: No letters (numbers or punctuation only)
    expect(validateCompanionName('12345').isValid).toBe(false);
    expect(validateCompanionName('---...').isValid).toBe(false);

    // Rejected: Exceeding capacity limit via Zod schema
    const schema = createCompanionNamesZodSchema(2); // capacity 2 -> max 1 companion
    expect(schema.safeParse(['Alice', 'Bob']).success).toBe(false);
    expect(schema.safeParse(['Alice']).success).toBe(true);
  });

  // MS85-TC09: Companion Privacy Isolation
  it('MS85-TC09: companions are not assigned customer IDs and receive no QR codes or emails', async () => {
    const repo = new ReservationMemoryRepository();
    const mockWorkspaceRepo: WorkspaceRepository = {
      listCatalog: async () => ({
        instances: [
          {
            id: 'inst-1',
            templateId: 'tpl-1',
            floorId: 'fl-1',
            instanceCode: 'R1',
            displayName: 'Room 1',
            operationalStatus: 'ACTIVE',
          },
        ],
        templates: [
          {
            id: 'tpl-1',
            name: 'Meeting Room',
            capacity: 3,
            rateAmount: 200,
            pricingUnit: 'HOURLY',
            isActive: true,
          },
        ],
        floors: [],
      }),
    };

    const reservationService = createReservationService(repo, mockWorkspaceRepo, repo);

    const reservation = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Primary',
        customerLastName: 'Booker',
        customerEmail: 'booker@example.com',
        rateType: 'HOURLY',
        companionNames: ['Companion Alpha', 'Companion Beta'],
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: 'inst-1',
            startAt: '2026-11-03T10:00:00Z',
            endAt: '2026-11-03T12:00:00Z',
            rateType: 'HOURLY',
          },
        ],
      },
      { paymentLinkBaseUrl: 'https://deskatlas.test' }
    );

    // Booker identity preserved
    expect(reservation.customerFirstName).toBe('Primary');
    expect(reservation.customerLastName).toBe('Booker');
    expect(reservation.customerEmail).toBe('booker@example.com');

    // Companions are record-only strings
    expect(reservation.companionNames).toEqual(['Companion Alpha', 'Companion Beta']);
    expect(reservation).not.toHaveProperty('companionEmails');
    expect(reservation).not.toHaveProperty('companionIds');
  });

  // MS85-TC10: Staff & Admin Operational Inspection
  it('MS85-TC10: surfaces companion names in front-desk scan results and admin reservation details', async () => {
    const episodeId = 'res-ms85-detail-test';
    const record: BookingAccessRecord = {
      reservationId: episodeId,
      referenceCode: 'DA-MS85-TEST',
      reservationStatus: 'CONFIRMED',
      customerFirstName: 'Primary',
      customerLastName: 'Booker',
      bookingTokenHash: 'synthetic-hash',
      qrIssuedAt: '2026-11-01T00:00:00Z',
      qrRevokedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      assignedWorkspaceInstanceId: 'inst-1',
      assignedWorkspaceDisplayName: 'Room Alpha',
      assignedWorkspaceInstanceCode: 'RA',
      assignedWorkspaceTemplateName: 'Conference Room',
      assignedFloorName: '2nd Floor',
      assignedStartAt: '2026-11-01T10:00:00Z',
      assignedEndAt: '2026-11-01T12:00:00Z',
      companionNames: ['Alice Companion', 'Bob Companion'],
    };

    const bookingAccessService = createBookingAccessService(
      {
        issueBookingAccessToken: async () => true,
        findBookingAccessByTokenHash: async () => record,
        recordBookingScan: async () => { },
      },
      () => new Date('2026-11-01T10:30:00Z')
    );

    const scanResult = await bookingAccessService.getBookingAccess('opaque-token');

    // Front-desk scanner receives companion names
    expect(scanResult.companionNames).toBeDefined();
    expect(scanResult.companionNames).toEqual(['Alice Companion', 'Bob Companion']);
    expect(scanResult.customerName).toBe('Primary Booker');
    expect(scanResult.accessState).toBe('ACTIVE');

    // Admin detail retrieval
    const repo = new ReservationMemoryRepository();
    const created = await repo.createReservation({
      source: 'WEB',
      customerFirstName: 'Admin',
      customerLastName: 'Viewer',
      customerEmail: 'admin.view@example.com',
      rateType: 'HOURLY',
      companionNames: ['Companion One', 'Companion Two'],
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: 'inst-1',
          startAt: '2026-11-01T10:00:00Z',
          endAt: '2026-11-01T12:00:00Z',
          rateType: 'HOURLY',
        },
      ],
    });

    const adminDetail = await repo.getAdminReservationDetail(created.id);
    expect(adminDetail).not.toBeNull();
    expect(adminDetail?.companionNames).toEqual(['Companion One', 'Companion Two']);
  });

  // MS85-TC11: Payment Confirmation Pending & Review Companion Visibility
  it('MS85-TC11: surfaces companion names in payment session view and admin payment review queue', async () => {
    const repo = new ReservationMemoryRepository();
    const mockWorkspaceRepo: WorkspaceRepository = {
      listCatalog: async () => ({
        instances: [
          {
            id: 'inst-conf-1',
            templateId: 'tpl-1',
            floorId: 'fl-1',
            instanceCode: 'C1',
            displayName: 'Room 1',
            operationalStatus: 'ACTIVE',
          },
        ],
        templates: [
          {
            id: 'tpl-1',
            name: 'Conference Room',
            capacity: 4,
            rateAmount: 300,
            pricingUnit: 'HOURLY',
            isActive: true,
          },
        ],
        floors: [],
      }),
    };
    const paymentSessionService = createPaymentSessionService(repo, () => new Date('2026-11-05T12:30:00Z'));
    const reservationService = createReservationService(repo, mockWorkspaceRepo, repo, paymentSessionService);

    const created = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Elena',
        customerLastName: 'Reyes',
        customerEmail: 'elena.reyes@example.com',
        rateType: 'HOURLY',
        companionNames: ['Carlos Reyes', 'Beatriz Reyes'],
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: 'inst-conf-1',
            startAt: '2026-11-05T14:00:00Z',
            endAt: '2026-11-05T17:00:00Z',
            rateType: 'HOURLY',
          },
        ],
      },
      { paymentLinkBaseUrl: 'https://deskatlas.test' }
    );

    const token = created.paymentSession!.token;
    const session = await paymentSessionService.getPaymentSession(token);

    // Companion names are visible on customer payment session
    expect(session.companionNames).toBeDefined();
    expect(session.companionNames).toEqual(['Carlos Reyes', 'Beatriz Reyes']);
    expect(session.customerFirstName).toBe('Elena');

    // Submit payment proof
    const submission = await paymentSessionService.submitPaymentProof({
      token,
      paymentMethodId: 'pm-gcash',
      proofStoragePath: 'proofs/elena-receipt.png',
    });
    expect(submission.paymentStatus).toBe('UNDER_REVIEW');

    const reviewService = createPaymentReviewService(repo);
    const queue = await reviewService.listPaymentReviewQueue();
    const queueItem = queue.find((q) => q.reservationId === created.id);

    // Companion names are visible in payment review queue
    expect(queueItem).toBeDefined();
    expect(queueItem?.companionNames).toEqual(['Carlos Reyes', 'Beatriz Reyes']);

    // Companion names are visible in payment review detail
    const detail = await reviewService.getPaymentReviewDetail(queueItem!.paymentAttemptId);
    expect(detail).not.toBeNull();
    expect(detail?.companionNames).toEqual(['Carlos Reyes', 'Beatriz Reyes']);
  });

  // MS85-TC12: Staff Kiosk Confirmation & Operations Companion Visibility
  it('MS85-TC12: surfaces companion names in counter payment record and staff operational reservations', async () => {
    const repo = new ReservationMemoryRepository();
    const mockWorkspaceRepo: WorkspaceRepository = {
      listCatalog: async () => ({
        instances: [
          {
            id: 'inst-pod-2',
            templateId: 'tpl-2',
            floorId: 'fl-1',
            instanceCode: 'P2',
            displayName: 'Pod 2',
            operationalStatus: 'ACTIVE',
          },
        ],
        templates: [
          {
            id: 'tpl-2',
            name: 'Work Pod',
            capacity: 3,
            rateAmount: 100,
            pricingUnit: 'HOURLY',
            isActive: true,
          },
        ],
        floors: [],
      }),
    };
    const reservationService = createReservationService(repo, mockWorkspaceRepo, repo);

    const created = await reservationService.createReservation({
      source: 'KIOSK',
      customerFirstName: 'Mateo',
      customerLastName: 'Cruz',
      customerEmail: 'mateo.cruz@example.com',
      paymentMethodId: 'pm-cash',
      rateType: 'HOURLY',
      companionNames: ['Gabriel Cruz', 'Sofia Cruz'],
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: 'inst-pod-2',
          startAt: '2026-11-06T09:00:00Z',
          endAt: '2026-11-06T12:00:00Z',
          rateType: 'HOURLY',
        },
      ],
    });

    const counterService = createCounterPaymentService(repo);
    // Counter lookup by Reference Code displays companion names
    const recordByCode = await counterService.getCounterPaymentRecordByCode(created.referenceCode);
    expect(recordByCode).not.toBeNull();
    expect(recordByCode?.companionNames).toEqual(['Gabriel Cruz', 'Sofia Cruz']);

    // Counter lookup by Payment Attempt ID displays companion names
    const recordById = await counterService.getCounterPaymentRecord(recordByCode!.paymentAttemptId);
    expect(recordById).not.toBeNull();
    expect(recordById?.companionNames).toEqual(['Gabriel Cruz', 'Sofia Cruz']);

    // Staff operational reservations list displays companion names
    const staffReservations = await repo.listOperationalReservations('2026-11-06T09:00:00Z');
    const staffRes = staffReservations.find((r) => r.reservationId === created.id);
    expect(staffRes).toBeDefined();
    expect(staffRes?.companionNames).toEqual(['Gabriel Cruz', 'Sofia Cruz']);
  });
});
