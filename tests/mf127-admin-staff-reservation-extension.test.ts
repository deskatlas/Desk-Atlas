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
  zonedDateTimeToUtc,
} from '@deskatlas/domain';

describe('MF-127: Admin and Staff Reservation Time Extension (Add Time with Overlap Prevention)', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    // Current time: 2026-09-15 08:00 AM Manila (00:00 UTC)
    now = new Date('2026-09-15T00:00:00.000Z');
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();

    const floor = await workspaceRepo.createFloor({ name: 'Main Floor' });
    const template = await workspaceRepo.createTemplate({
      name: 'Dedicated Desk',
      capacity: 1,
      rateAmount: 150,
      pricingUnit: 'HOURLY',
    });

    for (let i = 1; i <= 5; i++) {
      await workspaceRepo.createInstance({
        floorId: floor.id,
        templateId: template.id,
        instanceCode: `spot-${i}`,
        displayName: `Spot ${i}`,
      });
    }

    // Default operating hours: 06:00 to 22:00 (10:00 PM) Manila time
    // Tuesday = day 2
    repo.seedOperatingHours(2, [{ opensAt: '06:00', closesAt: '22:00', isActive: true }]);
  });

  async function createConfirmedReservation(options: {
    refCodeSuffix: string;
    spotIndexOrId?: string | number;
    startHour?: number;
    duration?: number;
    customerFirstName?: string;
    customerLastName?: string;
    checkIn?: boolean;
  }) {
    const spotIndexOrId = options.spotIndexOrId ?? 1;
    const startHour = options.startHour ?? 14; // 2:00 PM
    const duration = options.duration ?? 2; // 2 hours -> 4:00 PM
    const catalog = await workspaceRepo.listCatalog();
    let instance = typeof spotIndexOrId === 'number'
      ? catalog.instances[spotIndexOrId - 1]
      : catalog.instances.find((i) => i.id === spotIndexOrId || i.instanceCode === spotIndexOrId);

    if (!instance) {
      instance = catalog.instances[0];
    }

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const paymentReviewService = createPaymentReviewService(repo, nowProvider);

    const startAt = zonedDateTimeToUtc('2026-09-15', `${String(startHour).padStart(2, '0')}:00`, 'Asia/Manila').toISOString();
    const endAt = zonedDateTimeToUtc('2026-09-15', `${String(startHour + duration).padStart(2, '0')}:00`, 'Asia/Manila').toISOString();

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: options.customerFirstName || 'Jane',
        customerLastName: options.customerLastName || 'Doe',
        customerEmail: `jane.${options.refCodeSuffix}@example.com`,
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
    await bookingAccessService.issueBookingAccess(res.id, res.referenceCode, 'https://deskatlas.test/access');

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

  it('Happy path: extends active booking by 1 hour when spot has no subsequent conflicts', async () => {
    // 2:00 PM to 4:00 PM Manila
    const booking = await createConfirmedReservation({
      refCodeSuffix: 'happy',
      spotIndexOrId: 1,
      startHour: 14,
      duration: 2,
    });

    const adminService = createAdminReservationService(repo, nowProvider);

    // Check availability for 60 min extension
    const avail = await adminService.checkExtendAvailability({
      reservationId: booking.id,
      extensionMinutes: 60,
    });

    expect(avail.canExtend).toBe(true);
    expect(avail.hourlyRate).toBe(150);
    expect(avail.additionalFee).toBe(150);
    expect(avail.maxExtensionMinutes).toBeGreaterThanOrEqual(60);

    // Extend booking
    const result = await adminService.extendReservation({
      reservationId: booking.id,
      extensionMinutes: 60,
      actorUserId: 'admin-1',
      actorRole: 'ADMIN',
    });

    expect(result.success).toBe(true);
    expect(result.addedDurationMinutes).toBe(60);
    expect(result.additionalFee).toBe(150);

    const updated = await repo.getAdminReservationDetail(booking.id);
    expect(updated?.schedule).toContain('2:00 PM');
    expect(updated?.schedule).toContain('5:00 PM');
    expect(updated?.timeline.some((t) => t.includes('Time extended by Admin by 1 hour'))).toBe(true);
  });

  it('Overlap prevention: blocks 2-hour extension when another booking starts in 30 minutes', async () => {
    // Booking 1: 2:00 PM - 4:00 PM Manila on Spot 1
    const booking1 = await createConfirmedReservation({
      refCodeSuffix: 'first',
      spotIndexOrId: 1,
      startHour: 14,
      duration: 2,
    });

    // Booking 2: 4:30 PM - 6:30 PM Manila on Spot 1
    // (starts 30 minutes after Booking 1 ends)
    const start430Iso = zonedDateTimeToUtc('2026-09-15', '16:30', 'Asia/Manila').toISOString();
    const end630Iso = zonedDateTimeToUtc('2026-09-15', '18:30', 'Asia/Manila').toISOString();

    const catalog = await workspaceRepo.listCatalog();
    const spot1 = catalog.instances[0];

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const resService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const reviewService = createPaymentReviewService(repo, nowProvider);

    const res2 = await resService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Bob',
        customerLastName: 'Smith',
        customerEmail: 'bob@example.com',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: spot1.id,
            startAt: start430Iso,
            endAt: end630Iso,
          },
        ],
      },
      { paymentLinkBaseUrl: 'https://deskatlas.test/pay' }
    );

    await paymentSessionService.submitPaymentProof({
      token: res2.paymentSession!.token,
      paymentMethodId: 'pm-gcash',
      proofStoragePath: 'proofs/bob.png',
    });

    await reviewService.reviewPayment({
      paymentAttemptId: res2.paymentSession!.paymentAttemptId,
      actor: { userId: 'admin-1', role: 'ADMIN' },
      decision: 'APPROVE',
    });

    const adminService = createAdminReservationService(repo, nowProvider);

    // 1. Check availability for 30 minutes -> CAN EXTEND
    const avail30 = await adminService.checkExtendAvailability({
      reservationId: booking1.id,
      extensionMinutes: 30,
    });
    expect(avail30.canExtend).toBe(true);
    expect(avail30.maxExtensionMinutes).toBe(30);
    expect(avail30.nextBooking?.customerName).toContain('Bob');

    // 2. Check availability for 60 or 120 minutes -> BLOCKED
    const avail120 = await adminService.checkExtendAvailability({
      reservationId: booking1.id,
      extensionMinutes: 120,
    });
    expect(avail120.canExtend).toBe(false);
    expect(avail120.reason).toContain('Cannot extend');
    expect(avail120.reason).toContain('Bob');
    expect(avail120.reason).toContain('Maximum extension possible: 30 minutes');

    // 3. Attempting to extend by 120 minutes throws error
    await expect(
      adminService.extendReservation({
        reservationId: booking1.id,
        extensionMinutes: 120,
        actorRole: 'ADMIN',
      })
    ).rejects.toThrow(/Maximum extension possible: 30 minutes/);
  });

  it('Boundary check: clamps max extension to venue operating closing time', async () => {
    // Venue closes at 22:00 (10:00 PM) Manila.
    // Booking: 8:00 PM to 9:00 PM Manila (20:00 - 21:00).
    const booking = await createConfirmedReservation({
      refCodeSuffix: 'closing-test',
      spotIndexOrId: 1,
      startHour: 20,
      duration: 1,
    });

    const adminService = createAdminReservationService(repo, nowProvider);

    // From 9:00 PM to 10:00 PM is 60 minutes until closing.
    const avail = await adminService.checkExtendAvailability({
      reservationId: booking.id,
      extensionMinutes: 120,
    });

    expect(avail.canExtend).toBe(false);
    expect(avail.maxExtensionMinutes).toBe(60);
    expect(avail.reason).toContain('Venue closes');
  });

  it('QR window check: booking access token validity is dynamically extended', async () => {
    // Booking: 2:00 PM - 4:00 PM Manila (06:00 - 08:00 UTC)
    const booking = await createConfirmedReservation({
      refCodeSuffix: 'qr-test',
      spotIndexOrId: 1,
      startHour: 14,
      duration: 2,
      checkIn: true,
    });

    const accessService = createBookingAccessService(repo, nowProvider);

    // Advance clock to 4:15 PM Manila (15 mins past original 4:00 PM end time)
    now = new Date('2026-09-15T08:15:00.000Z');

    // Before extension: access should be EXPIRED
    const token = booking.bookingToken || booking.referenceCode;
    const accessBefore = await accessService.getBookingAccess(token);
    expect(accessBefore.accessState).toBe('EXPIRED');

    // Extend booking by 1 hour (new end time is 5:00 PM Manila = 09:00 UTC)
    const adminService = createAdminReservationService(repo, nowProvider);
    await adminService.extendReservation({
      reservationId: booking.id,
      extensionMinutes: 60,
      actorRole: 'ADMIN',
    });

    // After extension: access should now be ACTIVE!
    const accessAfter = await accessService.getBookingAccess(token);
    expect(accessAfter.accessState).toBe('ACTIVE');
    expect(accessAfter.timeRemainingSeconds).toBeGreaterThan(0);
  });

  it('Staff operations: allows Staff actor to extend reservation and logs staff timeline', async () => {
    const booking = await createConfirmedReservation({
      refCodeSuffix: 'staff-test',
      spotIndexOrId: 2,
      startHour: 10,
      duration: 2,
      checkIn: true,
    });

    const staffService = createStaffOperationsService(repo, nowProvider);

    const result = await staffService.extendReservation({
      reservationId: booking.id,
      extensionMinutes: 30,
      paymentMethod: 'COUNTER_QR',
      actorUserId: 'staff-1',
      actorRole: 'STAFF',
    });

    expect(result.success).toBe(true);
    expect(result.addedDurationMinutes).toBe(30);
    expect(result.additionalFee).toBe(75); // 30m @ 150/hr = 75

    const updated = await repo.getAdminReservationDetail(booking.id);
    expect(updated?.timeline.some((t) => t.includes('Time extended by Staff by 30 mins'))).toBe(true);
  });

  it('Rejection: rejects extension on cancelled or expired reservations', async () => {
    const booking = await createConfirmedReservation({
      refCodeSuffix: 'cancelled-test',
      spotIndexOrId: 1,
      startHour: 14,
      duration: 2,
    });

    const adminService = createAdminReservationService(repo, nowProvider);
    await adminService.cancelReservation({
      reservationId: booking.id,
      reason: 'Customer requested cancellation',
      actorRole: 'ADMIN',
    });

    const avail = await adminService.checkExtendAvailability({
      reservationId: booking.id,
      extensionMinutes: 60,
    });

    expect(avail.canExtend).toBe(false);
    expect(avail.reason).toContain('Cannot extend a cancelled reservation');

    await expect(
      adminService.extendReservation({
        reservationId: booking.id,
        extensionMinutes: 60,
        actorRole: 'ADMIN',
      })
    ).rejects.toThrow(/Cannot extend/);
  });
});
