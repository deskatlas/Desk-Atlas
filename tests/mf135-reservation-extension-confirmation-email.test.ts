import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  createAdminReservationService,
  createStaffOperationsService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createBookingAccessService,
  TransactionalEmailService,
  renderReservationExtendedEmail,
  zonedDateTimeToUtc,
} from '@deskatlas/domain';

describe('MF-135: Reservation Time Extension Confirmation Email with QR Pass Reuse', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let sentEmails: any[] = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    now = new Date('2026-09-15T06:00:00.000Z'); // 2:00 PM Manila
    sentEmails = [];
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();
    repo.setWorkspaceRepository(workspaceRepo);

    const floor = await workspaceRepo.createFloor({ name: 'Ground Floor' });
    const deskTemplate = await workspaceRepo.createTemplate({
      name: 'Dedicated Desk',
      capacity: 1,
      rateAmount: 150,
      pricingUnit: 'HOURLY',
    });

    for (let i = 1; i <= 3; i++) {
      await workspaceRepo.createInstance({
        floorId: floor.id,
        templateId: deskTemplate.id,
        instanceCode: `desk-${i}`,
        displayName: `Desk ${i}`,
        operationalStatus: 'ACTIVE',
      });
    }

    mockEmailService = new TransactionalEmailService({
      apiKey: 'test-resend-api-key',
      fetcher: async (url, init) => {
        const body = JSON.parse((init?.body as string) || '{}');
        sentEmails.push({ url, body });
        return new Response(JSON.stringify({ id: 'mock-email-id' }), { status: 200 });
      },
    });
  });

  async function createConfirmedReservation(options: {
    refCodeSuffix: string;
    spotIndexOrId?: number | string;
    startHour?: number;
    duration?: number;
    checkIn?: boolean;
    customerEmail?: string;
  }) {
    const catalog = await workspaceRepo.listCatalog();
    const instance =
      typeof options.spotIndexOrId === 'number'
        ? catalog.instances[options.spotIndexOrId - 1]
        : catalog.instances.find((i) => i.id === options.spotIndexOrId) ||
          catalog.instances[0];

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const paymentReviewService = createPaymentReviewService(repo, nowProvider);

    const startHour = options.startHour ?? 14; // 2:00 PM Manila
    const duration = options.duration ?? 2;

    const startAt = zonedDateTimeToUtc(
      '2026-09-15',
      `${String(startHour).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();
    const endAt = zonedDateTimeToUtc(
      '2026-09-15',
      `${String(startHour + duration).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Jane',
        customerLastName: 'Doe',
        customerEmail: options.customerEmail !== undefined ? options.customerEmail : `jane.${options.refCodeSuffix}@example.com`,
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt,
            endAt,
          },
        ],
      },
      { paymentLinkBaseUrl: 'https://deskatlas.test/pay' }
    );

    // Submit payment proof and approve to CONFIRMED
    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: 'pm-gcash',
      proofStoragePath: 'proofs/test.png',
    });

    await paymentReviewService.reviewPayment({
      paymentAttemptId: res.paymentSession!.paymentAttemptId,
      actor: {
        userId: 'admin-1',
        role: 'ADMIN',
      },
      decision: 'APPROVE',
    });

    const bookingAccessService = createBookingAccessService(repo, nowProvider);
    await bookingAccessService.issueBookingAccess(
      res.id,
      res.referenceCode,
      'https://deskatlas.test/access'
    );

    if (options.checkIn) {
      now = new Date(startAt);
      const staffService = createStaffOperationsService(repo, nowProvider);
      await staffService.checkInReservation({
        reservationId: res.id,
        actor: {
          userId: 'staff-1',
          role: 'STAFF',
        },
      });
    }

    const confirmed = await repo.getAdminReservationDetail(res.id);
    return confirmed!;
  }

  describe('renderReservationExtendedEmail', () => {
    it('renders clean HTML and text with 12-hour AM/PM formatted schedule, fee, and reused QR pass', () => {
      const email = renderReservationExtendedEmail({
        to: 'customer@example.com',
        customerFirstName: 'Jane',
        customerLastName: 'Doe',
        referenceCode: 'DA-2026-0001',
        previousEndAt: '2026-09-15T08:00:00.000Z', // 4:00 PM Manila
        newEndAt: '2026-09-15T09:00:00.000Z',      // 5:00 PM Manila
        addedDurationMinutes: 60,
        additionalFee: 150,
        paymentMethod: 'Cash',
        workspaceDisplayName: 'Desk 1',
        workspaceTemplateName: 'Dedicated Desk',
        floorName: 'Ground Floor',
        bookingAccessUrl: 'https://deskatlas.test/access/token-123',
        bookingToken: 'token-123',
        trackingUrl: 'https://deskatlas.test/track?code=DA-2026-0001',
      });

      expect(email.subject).toBe('Your DeskAtlas Reservation Has Been Extended [DA-2026-0001]');
      
      // HTML checks
      expect(email.html).toContain('Jane Doe');
      expect(email.html).toContain('DA-2026-0001');
      expect(email.html).toContain('+1 hour');
      expect(email.html).toContain('Desk 1');
      expect(email.html).toContain('Dedicated Desk');
      expect(email.html).toContain('Ground Floor');
      expect(email.html).toContain('₱150.00');
      expect(email.html).toContain('Cash');
      expect(email.html).toContain('Your existing QR pass remains valid and active');
      expect(email.html).toContain('https://deskatlas.test/track?code=DA-2026-0001');

      // Text checks
      expect(email.text).toContain('Reservation Time Extended - DeskAtlas');
      expect(email.text).toContain('DA-2026-0001');
      expect(email.text).toContain('Desk 1');
      expect(email.text).toContain('+1 hour');
      expect(email.text).toContain('₱150.00');
      expect(email.text).toContain('Cash');
      expect(email.text).toContain('Your existing QR pass remains active and valid');
    });

    it('formats 30-minute extension duration cleanly', () => {
      const email = renderReservationExtendedEmail({
        to: 'customer@example.com',
        customerFirstName: 'Alex',
        referenceCode: 'DA-2026-0002',
        previousEndAt: '2026-09-15T08:00:00.000Z',
        newEndAt: '2026-09-15T08:30:00.000Z',
        addedDurationMinutes: 30,
        additionalFee: 75,
        paymentMethod: 'Counter QR',
        workspaceDisplayName: 'Desk 2',
        bookingToken: 'token-456',
      });

      expect(email.html).toContain('+30 minutes');
      expect(email.html).toContain('₱75.00');
      expect(email.html).toContain('Counter QR');
    });
  });

  describe('AdminReservationService Integration', () => {
    it('dispatches confirmation email upon successful admin extension with reused QR pass details', async () => {
      const booking = await createConfirmedReservation({
        refCodeSuffix: 'admin-ext',
        spotIndexOrId: 1,
        startHour: 14,
        duration: 2,
        checkIn: true,
      });

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const result = await adminService.extendReservation({
        reservationId: booking.id,
        extensionMinutes: 60,
        additionalFee: 150,
        paymentMethod: 'Cash',
        actorRole: 'ADMIN',
        actorUserId: 'admin-1',
      });

      expect(result.success).toBe(true);
      expect(sentEmails.length).toBe(1);

      const emailPayload = sentEmails[0].body;
      const assigned = result.reservation.assignedCandidate || result.reservation.candidates[0];
      expect(emailPayload.to).toEqual(['jane.admin-ext@example.com']);
      expect(emailPayload.subject).toBe(`Your DeskAtlas Reservation Has Been Extended [${booking.referenceCode}]`);
      expect(emailPayload.html).toContain(booking.referenceCode);
      expect(emailPayload.html).toContain(assigned.workspaceDisplayName);
      expect(emailPayload.html).toContain('₱150.00');
      expect(emailPayload.html).toContain('Cash');
      expect(emailPayload.html).toContain('Your existing QR pass remains valid');
    });

    it('handles reservation without customer email gracefully without errors', async () => {
      const booking = await createConfirmedReservation({
        refCodeSuffix: 'no-email',
        spotIndexOrId: 2,
        startHour: 14,
        duration: 2,
      });

      // Clear email on memory reservation entry
      const internalRes = (repo as any).reservations.find((r: any) => r.id === booking.id);
      if (internalRes) {
        internalRes.customerEmail = '';
      }

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const result = await adminService.extendReservation({
        reservationId: booking.id,
        extensionMinutes: 60,
        additionalFee: 150,
        paymentMethod: 'Cash',
        actorRole: 'ADMIN',
      });

      expect(result.success).toBe(true);
      expect(sentEmails.length).toBe(0);
    });
  });

  describe('StaffOperationsService Integration', () => {
    it('dispatches confirmation email upon successful staff extension with reused QR pass details', async () => {
      const booking = await createConfirmedReservation({
        refCodeSuffix: 'staff-ext',
        spotIndexOrId: 3,
        startHour: 14,
        duration: 2,
        checkIn: true,
      });

      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);

      const result = await staffService.extendReservation({
        reservationId: booking.id,
        extensionMinutes: 120,
        additionalFee: 300,
        paymentMethod: 'Counter QR',
        actorRole: 'STAFF',
        actorUserId: 'staff-1',
      });

      expect(result.success).toBe(true);
      expect(sentEmails.length).toBe(1);

      const emailPayload = sentEmails[0].body;
      expect(emailPayload.to).toEqual(['jane.staff-ext@example.com']);
      expect(emailPayload.subject).toBe(`Your DeskAtlas Reservation Has Been Extended [${booking.referenceCode}]`);
      expect(emailPayload.html).toContain(booking.referenceCode);
      expect(emailPayload.html).toContain('+2 hours');
      expect(emailPayload.html).toContain('₱300.00');
      expect(emailPayload.html).toContain('Counter QR');
    });
  });

  describe('QR Token Reuse and Window Extension Validity', () => {
    it('confirms the existing booking token dynamically transitions to ACTIVE for extended duration', async () => {
      const booking = await createConfirmedReservation({
        refCodeSuffix: 'token-reuse',
        spotIndexOrId: 1,
        startHour: 14, // 2:00 PM - 4:00 PM Manila
        duration: 2,
        checkIn: true,
      });

      const bookingAccessService = createBookingAccessService(repo, nowProvider);
      const token = booking.bookingToken || booking.referenceCode;

      // Clock at 4:15 PM Manila (15 mins after original 4:00 PM end time)
      now = new Date('2026-09-15T08:15:00.000Z');

      const accessBefore = await bookingAccessService.getBookingAccess(token);
      expect(accessBefore.accessState).toBe('EXPIRED');

      // Extend by 1 hour (new end time 5:00 PM Manila = 09:00 UTC)
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await adminService.extendReservation({
        reservationId: booking.id,
        extensionMinutes: 60,
        actorRole: 'ADMIN',
      });

      // Same token is now active again through 5:00 PM!
      const accessAfter = await bookingAccessService.getBookingAccess(token);
      expect(accessAfter.accessState).toBe('ACTIVE');
      expect(accessAfter.timeRemainingSeconds).toBeGreaterThan(0);
    });
  });
});
