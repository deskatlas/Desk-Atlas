import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  InMemorySettingsRepository,
  createAdminReservationService,
  createAdminSettingsService,
  createGuestReservationTrackingService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createBookingAccessService,
  TransactionalEmailService,
  zonedDateTimeToUtc,
} from '@deskatlas/domain';

describe('MF-161: Rescheduling Available Time Constrained by Operating Hours and 24-Hour Configuration', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let settingsRepo: InMemorySettingsRepository;
  let sentEmails: any[] = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    // Current time: 2026-09-15 08:00 AM Manila time (Tuesday, dayOfWeek = 2)
    now = new Date('2026-09-15T08:00:00+08:00');
    sentEmails = [];
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();
    settingsRepo = new InMemorySettingsRepository();

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

    mockEmailService = new TransactionalEmailService({
      apiKey: 'test-resend-api-key',
      fetcher: async (url, init) => {
        const body = JSON.parse((init?.body as string) || '{}');
        sentEmails.push({ url, body });
        return new Response(JSON.stringify({ id: 'mock-email-id' }), { status: 200 });
      },
    });
  });

  async function createConfirmedReservation(params: {
    refCodeSuffix: string;
    spotIndexOrId?: string | number;
    startDate?: string;
    startHour?: number;
    duration?: number;
  }) {
    const {
      refCodeSuffix,
      spotIndexOrId = 1,
      startDate = '2026-09-16', // Wednesday
      startHour = 10,
      duration = 2,
    } = params;

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

    const startUtc = zonedDateTimeToUtc(
      startDate,
      `${String(startHour).padStart(2, '0')}:00`,
      'Asia/Manila'
    );
    const endUtc = new Date(startUtc.getTime() + duration * 60 * 60 * 1000);

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Bob',
        customerLastName: 'User',
        customerEmail: `bob.${refCodeSuffix}@example.com`,
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: startUtc.toISOString(),
            endAt: endUtc.toISOString(),
          },
        ],
      },
      { paymentLinkBaseUrl: 'https://deskatlas.test/pay' }
    );

    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: 'pm-gcash',
      proofStoragePath: `proofs/${res.id}.jpg`,
    });

    await paymentReviewService.reviewPayment({
      paymentAttemptId: res.paymentSession!.paymentAttemptId,
      actor: { userId: 'admin-1', role: 'ADMIN' },
      decision: 'APPROVE',
    });

    const bookingAccessService = createBookingAccessService(repo, nowProvider);
    await bookingAccessService.issueBookingAccess(res.id, res.referenceCode, 'https://deskatlas.test/access');

    return repo.getAdminReservationDetail(res.id);
  }

  describe('1. Operating Hours Constraint for Standard-Hours Days', () => {
    it('derives open/close times and clamps slots to standard configured window (e.g. 09:00–22:00)', async () => {
      // 2026-09-16 is Wednesday (dayOfWeek = 3)
      repo.seedOperatingHours(3, [
        { opensAt: '09:00:00', closesAt: '22:00:00', isActive: true },
      ]);

      const detail = await createConfirmedReservation({
        refCodeSuffix: 'STD1',
        startDate: '2026-09-16',
        startHour: 10,
        duration: 2,
      });

      const availability = await repo.checkRescheduleAvailability({
        reservationId: detail!.id,
        date: '2026-09-16',
        durationHours: 2,
      });

      expect(availability.isClosed).toBe(false);
      expect(availability.is24Hours).toBe(false);
      expect(availability.openTime).toBe('09:00');
      expect(availability.closeTime).toBe('22:00');
      expect(availability.slots).toBeDefined();

      const startTimes = availability.slots!.map((s) => s.startTime);
      expect(startTimes[0]).toBe('09:00');
      // For 2h duration and 22:00 close, latest start slot is 20:00 (ends at 22:00)
      expect(startTimes[startTimes.length - 1]).toBe('20:00');
      expect(startTimes).not.toContain('07:00');
      expect(startTimes).not.toContain('08:00');
      expect(startTimes).not.toContain('21:00');
    });

    it('rejects requested start time 07:00 on a day that opens at 09:00', async () => {
      // Wednesday 09:00–22:00
      repo.seedOperatingHours(3, [
        { opensAt: '09:00:00', closesAt: '22:00:00', isActive: true },
      ]);

      const detail = await createConfirmedReservation({
        refCodeSuffix: 'STD2',
        startDate: '2026-09-16',
        startHour: 10,
        duration: 2,
      });

      const startUtc = zonedDateTimeToUtc('2026-09-16', '07:00:00', 'Asia/Manila');
      const endUtc = zonedDateTimeToUtc('2026-09-16', '09:00:00', 'Asia/Manila');

      const check = await repo.checkRescheduleAvailability({
        reservationId: detail!.id,
        startAt: startUtc.toISOString(),
        endAt: endUtc.toISOString(),
        date: '2026-09-16',
        durationHours: 2,
      });

      expect(check.available).toBe(false);
      expect(check.reason).toContain('Selected time is outside operating hours');

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await expect(
        adminService.rescheduleReservation({
          reservationId: detail!.id,
          startAt: startUtc.toISOString(),
          endAt: endUtc.toISOString(),
          actorRole: 'CUSTOMER',
          cutoffHours: 12,
        })
      ).rejects.toThrow('Cannot reschedule outside business operating hours');
    });
  });

  describe('2. 24-Hour Operation Configuration Support', () => {
    it('allows all 24-hour slots through 23:30 for overnight stay on a 24-hour configured day', async () => {
      // 2026-09-17 is Thursday (dayOfWeek = 4)
      repo.seedOperatingHours(4, [
        { opensAt: '00:00:00', closesAt: '24:00:00', isActive: true },
      ]);
      // 2026-09-18 is Friday (dayOfWeek = 5)
      repo.seedOperatingHours(5, [
        { opensAt: '00:00:00', closesAt: '24:00:00', isActive: true },
      ]);

      const detail = await createConfirmedReservation({
        refCodeSuffix: '24H1',
        startDate: '2026-09-16',
        startHour: 10,
        duration: 4, // 4-hour booking
      });

      const availability = await repo.checkRescheduleAvailability({
        reservationId: detail!.id,
        date: '2026-09-17',
        durationHours: 4,
      });

      expect(availability.isClosed).toBe(false);
      expect(availability.is24Hours).toBe(true);
      expect(availability.openTime).toBe('00:00');
      expect(availability.closeTime).toBe('24:00');
      expect(availability.slots).toBeDefined();

      const startTimes = availability.slots!.map((s) => s.startTime);
      expect(startTimes[0]).toBe('00:00');
      expect(startTimes).toContain('20:00');
      expect(startTimes).toContain('21:00');
      expect(startTimes).toContain('22:00');
      expect(startTimes).toContain('23:00');
      expect(startTimes).toContain('23:30');
      expect(startTimes[startTimes.length - 1]).toBe('23:30');
    });

    it('accepts overnight reschedule e.g. 23:00 to 03:00 (Next Day) when 24-hour open', async () => {
      // Thursday and Friday are 24-hour
      repo.seedOperatingHours(4, [
        { opensAt: '00:00:00', closesAt: '24:00:00', isActive: true },
      ]);
      repo.seedOperatingHours(5, [
        { opensAt: '00:00:00', closesAt: '24:00:00', isActive: true },
      ]);

      const detail = await createConfirmedReservation({
        refCodeSuffix: '24H-ON',
        startDate: '2026-09-16',
        startHour: 10,
        duration: 4,
      });

      const startUtc = zonedDateTimeToUtc('2026-09-17', '23:00:00', 'Asia/Manila');
      const endUtc = zonedDateTimeToUtc('2026-09-18', '03:00:00', 'Asia/Manila');

      const check = await repo.checkRescheduleAvailability({
        reservationId: detail!.id,
        startAt: startUtc.toISOString(),
        endAt: endUtc.toISOString(),
        date: '2026-09-17',
        durationHours: 4,
      });

      expect(check.available).toBe(true);
      expect(check.reason).toBeUndefined();

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const res = await adminService.rescheduleReservation({
        reservationId: detail!.id,
        startAt: startUtc.toISOString(),
        endAt: endUtc.toISOString(),
        actorRole: 'CUSTOMER',
        cutoffHours: 12,
      });

      expect(res.success).toBe(true);
      expect(res.reservation.schedule).toContain('11:00 PM');
      expect(res.reservation.schedule).toContain('3:00 AM');
    });

    it('rejects overnight reschedule if the next day is closed during overnight hours', async () => {
      // Thursday 2026-09-17 is 24-hour, but Friday 2026-09-18 has holiday block
      repo.seedOperatingHours(4, [
        { opensAt: '00:00:00', closesAt: '24:00:00', isActive: true },
      ]);
      repo.seedOperatingHours(5, [
        { opensAt: '00:00:00', closesAt: '24:00:00', isActive: true },
      ]);
      repo.seedBusinessScheduleBlocks([
        {
          startAt: '2026-09-18T00:00:00+08:00',
          endAt: '2026-09-18T23:59:59+08:00',
          blockType: 'HOLIDAY',
          scope: 'BUSINESS',
          reason: 'Holiday Closure',
        },
      ]);

      const detail = await createConfirmedReservation({
        refCodeSuffix: '24H-ON-CLS',
        startDate: '2026-09-16',
        startHour: 10,
        duration: 4,
      });

      const startUtc = zonedDateTimeToUtc('2026-09-17', '23:00:00', 'Asia/Manila');
      const endUtc = zonedDateTimeToUtc('2026-09-18', '03:00:00', 'Asia/Manila');

      const check = await repo.checkRescheduleAvailability({
        reservationId: detail!.id,
        startAt: startUtc.toISOString(),
        endAt: endUtc.toISOString(),
        date: '2026-09-17',
        durationHours: 4,
      });

      expect(check.available).toBe(false);
      expect(check.reason).toContain('closed during overnight hours');

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await expect(
        adminService.rescheduleReservation({
          reservationId: detail!.id,
          startAt: startUtc.toISOString(),
          endAt: endUtc.toISOString(),
          actorRole: 'CUSTOMER',
          cutoffHours: 12,
        })
      ).rejects.toThrow('facility is closed during overnight hours');
    });

    it('accepts start time 00:30 on a 24-hour configured day in availability check and execution', async () => {
      // 2026-09-17 Thursday is 24-hour
      repo.seedOperatingHours(4, [
        { opensAt: '00:00:00', closesAt: '24:00:00', isActive: true },
      ]);

      const detail = await createConfirmedReservation({
        refCodeSuffix: '24H2',
        startDate: '2026-09-16',
        startHour: 10,
        duration: 2,
      });

      const startUtc = zonedDateTimeToUtc('2026-09-17', '00:30:00', 'Asia/Manila');
      const endUtc = zonedDateTimeToUtc('2026-09-17', '02:30:00', 'Asia/Manila');

      const check = await repo.checkRescheduleAvailability({
        reservationId: detail!.id,
        startAt: startUtc.toISOString(),
        endAt: endUtc.toISOString(),
        date: '2026-09-17',
        durationHours: 2,
      });

      expect(check.available).toBe(true);
      expect(check.reason).toBeUndefined();

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const res = await adminService.rescheduleReservation({
        reservationId: detail!.id,
        startAt: startUtc.toISOString(),
        endAt: endUtc.toISOString(),
        actorRole: 'CUSTOMER',
        cutoffHours: 12,
      });

      expect(res.success).toBe(true);
      expect(res.reservation.schedule).toContain('12:30 AM - 2:30 AM');
    });
  });

  describe('3. Closed Day & Business Schedule Block Handling', () => {
    it('rejects rescheduling on a day with no active operating hours', async () => {
      // Sunday (dayOfWeek = 0) has no active operating hours (closed day)
      repo.seedOperatingHours(0, []);

      const detail = await createConfirmedReservation({
        refCodeSuffix: 'CLS1',
        startDate: '2026-09-16',
        startHour: 10,
        duration: 2,
      });

      // 2026-09-20 is Sunday
      const availability = await repo.checkRescheduleAvailability({
        reservationId: detail!.id,
        date: '2026-09-20',
        durationHours: 2,
      });

      expect(availability.isClosed).toBe(true);
      expect(availability.available).toBe(false);
      expect(availability.reason).toContain('facility is closed');
      expect(availability.slots).toEqual([]);

      const startUtc = zonedDateTimeToUtc('2026-09-20', '10:00:00', 'Asia/Manila');
      const endUtc = zonedDateTimeToUtc('2026-09-20', '12:00:00', 'Asia/Manila');

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await expect(
        adminService.rescheduleReservation({
          reservationId: detail!.id,
          startAt: startUtc.toISOString(),
          endAt: endUtc.toISOString(),
          actorRole: 'CUSTOMER',
          cutoffHours: 12,
        })
      ).rejects.toThrow('The facility is closed on the selected date.');
    });

    it('rejects rescheduling on a date with a business closure / holiday block', async () => {
      // 2026-09-18 (Friday, dayOfWeek = 5) has normal hours but has a holiday block
      repo.seedOperatingHours(5, [
        { opensAt: '09:00:00', closesAt: '18:00:00', isActive: true },
      ]);
      repo.seedBusinessScheduleBlocks([
        {
          startAt: '2026-09-18T00:00:00+08:00',
          endAt: '2026-09-18T23:59:59+08:00',
          blockType: 'HOLIDAY',
          scope: 'BUSINESS',
          reason: 'National Holiday',
        },
      ]);

      const detail = await createConfirmedReservation({
        refCodeSuffix: 'CLS2',
        startDate: '2026-09-16',
        startHour: 10,
        duration: 2,
      });

      const availability = await repo.checkRescheduleAvailability({
        reservationId: detail!.id,
        date: '2026-09-18',
        durationHours: 2,
      });

      expect(availability.isClosed).toBe(true);
      expect(availability.available).toBe(false);
      expect(availability.reason).toContain('facility is closed');

      const startUtc = zonedDateTimeToUtc('2026-09-18', '10:00:00', 'Asia/Manila');
      const endUtc = zonedDateTimeToUtc('2026-09-18', '12:00:00', 'Asia/Manila');

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await expect(
        adminService.rescheduleReservation({
          reservationId: detail!.id,
          startAt: startUtc.toISOString(),
          endAt: endUtc.toISOString(),
          actorRole: 'CUSTOMER',
          cutoffHours: 12,
        })
      ).rejects.toThrow('The facility is closed on the selected date.');
    });
  });

  describe('4. Regression: MF-138 Notice Cutoff & Limit Rules', () => {
    it('still rejects customer reschedule within cutoff notice window', async () => {
      repo.seedOperatingHours(2, [
        { opensAt: '00:00:00', closesAt: '24:00:00', isActive: true },
      ]);

      // Booking is on 2026-09-15 15:00 (7 hours from current time 08:00, < 12h cutoff)
      const detail = await createConfirmedReservation({
        refCodeSuffix: 'REG1',
        startDate: '2026-09-15',
        startHour: 15,
        duration: 2,
      });

      const trackingService = createGuestReservationTrackingService(repo, settingsRepo, nowProvider);
      const tracking = await trackingService.getReservationTracking({ referenceCode: detail!.referenceCode });
      expect(tracking.canReschedule).toBe(false);

      const newStartUtc = zonedDateTimeToUtc('2026-09-16', '10:00:00', 'Asia/Manila');
      const newEndUtc = zonedDateTimeToUtc('2026-09-16', '12:00:00', 'Asia/Manila');

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await expect(
        adminService.rescheduleReservation({
          reservationId: detail!.id,
          startAt: newStartUtc.toISOString(),
          endAt: newEndUtc.toISOString(),
          actorRole: 'CUSTOMER',
          cutoffHours: 12,
        })
      ).rejects.toThrow('Reschedule must be requested at least 12 hours before the scheduled start time.');
    });
  });
});
