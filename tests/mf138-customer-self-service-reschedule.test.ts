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
  renderReservationRescheduledEmail,
  zonedDateTimeToUtc,
} from '@deskatlas/domain';

describe('MF-138: Customer Self-Service Reservation Reschedule via Track Reservation', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let settingsRepo: InMemorySettingsRepository;
  let sentEmails: any[] = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    // Current time: 2026-09-15 08:00 AM Manila time
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
      startDate = '2026-09-16', // Tomorrow
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
        customerFirstName: 'Alice',
        customerLastName: 'Customer',
        customerEmail: `alice.${refCodeSuffix}@example.com`,
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

  describe('1. Admin Settings Configurable Reschedule Cutoff Hours', () => {
    it('defaults to 12 hours cutoff in business settings', async () => {
      const settingsService = createAdminSettingsService(settingsRepo);
      const overview = await settingsService.getSettingsOverview();
      expect(overview.businessSettings.customerRescheduleCutoffHours).toBe(12);

      const publicSettings = await settingsService.getPublicBusinessSettings();
      expect(publicSettings.customerRescheduleCutoffHours).toBe(12);
    });

    it('allows administrators to update customer reschedule cutoff hours', async () => {
      const settingsService = createAdminSettingsService(settingsRepo);
      const updated = await settingsService.updateBusinessSettings({
        businessName: 'DeskAtlas Manila',
        timezone: 'Asia/Manila',
        contactEmail: 'contact@deskatlas.com',
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        customerRescheduleCutoffHours: 24,
      });

      expect(updated.customerRescheduleCutoffHours).toBe(24);

      const publicSettings = await settingsService.getPublicBusinessSettings();
      expect(publicSettings.customerRescheduleCutoffHours).toBe(24);
    });

    it('rejects invalid cutoff hours (< 0 or > 720)', async () => {
      const settingsService = createAdminSettingsService(settingsRepo);

      await expect(
        settingsService.updateBusinessSettings({
          businessName: 'DeskAtlas Manila',
          timezone: 'Asia/Manila',
          contactEmail: 'contact@deskatlas.com',
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          customerRescheduleCutoffHours: -1,
        })
      ).rejects.toThrow('Customer self-service reschedule cutoff must be an integer between 0 and 720 hours');

      await expect(
        settingsService.updateBusinessSettings({
          businessName: 'DeskAtlas Manila',
          timezone: 'Asia/Manila',
          contactEmail: 'contact@deskatlas.com',
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          customerRescheduleCutoffHours: 800,
        })
      ).rejects.toThrow('Customer self-service reschedule cutoff must be an integer between 0 and 720 hours');
    });
  });

  describe('2. Guest Tracking Reschedule Eligibility Calculation', () => {
    it('marks canReschedule = true when confirmed, 0 reschedules, and > 12h before start', async () => {
      // Booking is on 2026-09-16 10:00 (26 hours in future relative to 2026-09-15 08:00)
      const detail = await createConfirmedReservation({ refCodeSuffix: 'A1', startDate: '2026-09-16', startHour: 10 });
      const trackingService = createGuestReservationTrackingService(repo, settingsRepo, nowProvider);

      const tracking = await trackingService.getReservationTracking({ referenceCode: detail!.referenceCode });
      expect(tracking.status).toBe('CONFIRMED');
      expect(tracking.rescheduleCount).toBe(0);
      expect(tracking.canReschedule).toBe(true);
      expect(tracking.rescheduleCutoffHours).toBe(12);
    });

    it('marks canReschedule = false when within the 12-hour cutoff notice window', async () => {
      // Booking is on 2026-09-15 15:00 (7 hours from now 08:00, which is < 12h cutoff)
      const detail = await createConfirmedReservation({ refCodeSuffix: 'A2', startDate: '2026-09-15', startHour: 15 });
      const trackingService = createGuestReservationTrackingService(repo, settingsRepo, nowProvider);

      const tracking = await trackingService.getReservationTracking({ referenceCode: detail!.referenceCode });
      expect(tracking.status).toBe('CONFIRMED');
      expect(tracking.canReschedule).toBe(false);
    });

    it('respects customized cutoff hours from settings repository', async () => {
      // Set cutoff to 48 hours
      await settingsRepo.updateBusinessSettings({
        businessName: 'DeskAtlas Manila',
        timezone: 'Asia/Manila',
        contactEmail: 'contact@deskatlas.com',
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        customerRescheduleCutoffHours: 48,
      });

      // Booking is 26 hours in future (2026-09-16 10:00 vs 2026-09-15 08:00)
      const detail = await createConfirmedReservation({ refCodeSuffix: 'A3', startDate: '2026-09-16', startHour: 10 });
      const trackingService = createGuestReservationTrackingService(repo, settingsRepo, nowProvider);

      const tracking = await trackingService.getReservationTracking({ referenceCode: detail!.referenceCode });
      expect(tracking.rescheduleCutoffHours).toBe(48);
      // 26h is less than 48h, so canReschedule must be false
      expect(tracking.canReschedule).toBe(false);
    });
  });

  describe('3. Customer Self-Service Reschedule Execution & Constraints', () => {
    it('successfully reschedules booking with same duration, updates schedule, increments rescheduleCount, and dispatches email', async () => {
      const detail = await createConfirmedReservation({ refCodeSuffix: 'B1', startDate: '2026-09-16', startHour: 10, duration: 2 });
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const newStartUtc = zonedDateTimeToUtc('2026-09-17', '14:00:00', 'Asia/Manila');
      const newEndUtc = zonedDateTimeToUtc('2026-09-17', '16:00:00', 'Asia/Manila'); // Exact 2h duration

      const result = await adminService.rescheduleReservation({
        reservationId: detail!.id,
        startAt: newStartUtc.toISOString(),
        endAt: newEndUtc.toISOString(),
        actorRole: 'CUSTOMER',
        cutoffHours: 12,
      });

      expect(result.success).toBe(true);
      expect(result.reservation.rescheduleCount).toBe(1);

      // Verify timeline entry records "Rescheduled by Customer"
      const updated = await repo.getAdminReservationDetail(detail!.id);
      expect(updated!.timeline.some((t) => t.includes('Rescheduled by Customer'))).toBe(true);

      // Verify tracking now reflects rescheduleCount = 1 and canReschedule = false
      const trackingService = createGuestReservationTrackingService(repo, settingsRepo, nowProvider);
      const tracking = await trackingService.getReservationTracking({ referenceCode: detail!.referenceCode });
      expect(tracking.rescheduleCount).toBe(1);
      expect(tracking.canReschedule).toBe(false);

      // Verify confirmation email was dispatched with customer phrasing
      const email = sentEmails.find((e) => e.body.subject.includes(detail!.referenceCode));
      expect(email).toBeDefined();
      expect(email.body.html).toContain('successfully rescheduled upon your request');
    });

    it('enforces max 1 customer reschedule limit', async () => {
      const detail = await createConfirmedReservation({ refCodeSuffix: 'B2', startDate: '2026-09-16', startHour: 10, duration: 2 });
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const firstStartUtc = zonedDateTimeToUtc('2026-09-17', '14:00:00', 'Asia/Manila');
      const firstEndUtc = zonedDateTimeToUtc('2026-09-17', '16:00:00', 'Asia/Manila');

      // 1st customer reschedule -> passes
      await adminService.rescheduleReservation({
        reservationId: detail!.id,
        startAt: firstStartUtc.toISOString(),
        endAt: firstEndUtc.toISOString(),
        actorRole: 'CUSTOMER',
        cutoffHours: 12,
      });

      const secondStartUtc = zonedDateTimeToUtc('2026-09-18', '09:00:00', 'Asia/Manila');
      const secondEndUtc = zonedDateTimeToUtc('2026-09-18', '11:00:00', 'Asia/Manila');

      // 2nd customer reschedule -> rejected
      await expect(
        adminService.rescheduleReservation({
          reservationId: detail!.id,
          startAt: secondStartUtc.toISOString(),
          endAt: secondEndUtc.toISOString(),
          actorRole: 'CUSTOMER',
          cutoffHours: 12,
        })
      ).rejects.toThrow('Customer can only reschedule a reservation once.');
    });

    it('rejects customer reschedule requested inside cutoff notice window', async () => {
      // Reservation is on 2026-09-15 15:00 (7 hours from current time 08:00)
      const detail = await createConfirmedReservation({ refCodeSuffix: 'B3', startDate: '2026-09-15', startHour: 15, duration: 2 });
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const newStartUtc = zonedDateTimeToUtc('2026-09-16', '10:00:00', 'Asia/Manila');
      const newEndUtc = zonedDateTimeToUtc('2026-09-16', '12:00:00', 'Asia/Manila');

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

    it('rejects customer reschedule if duration differs from original duration', async () => {
      // Original duration is 2 hours
      const detail = await createConfirmedReservation({ refCodeSuffix: 'B4', startDate: '2026-09-16', startHour: 10, duration: 2 });
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const newStartUtc = zonedDateTimeToUtc('2026-09-17', '10:00:00', 'Asia/Manila');
      const newEndUtc = zonedDateTimeToUtc('2026-09-17', '14:00:00', 'Asia/Manila'); // 4 hours instead of 2 hours

      await expect(
        adminService.rescheduleReservation({
          reservationId: detail!.id,
          startAt: newStartUtc.toISOString(),
          endAt: newEndUtc.toISOString(),
          actorRole: 'CUSTOMER',
          cutoffHours: 12,
        })
      ).rejects.toThrow('Rescheduled reservation must have the exact same duration as the original booking.');
    });

    it('rejects reschedule if target spot has overlapping booking', async () => {
      // Reservation 1 on Spot 1: 2026-09-16 14:00-16:00
      await createConfirmedReservation({ refCodeSuffix: 'RES1', spotIndexOrId: 1, startDate: '2026-09-16', startHour: 14, duration: 2 });

      // Reservation 2 on Spot 1: 2026-09-17 10:00-12:00
      const res2 = await createConfirmedReservation({ refCodeSuffix: 'RES2', spotIndexOrId: 1, startDate: '2026-09-17', startHour: 10, duration: 2 });

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      // Attempt to reschedule Reservation 2 to 2026-09-16 15:00-17:00 (overlaps with Reservation 1 on Spot 1)
      const targetStartUtc = zonedDateTimeToUtc('2026-09-16', '15:00:00', 'Asia/Manila');
      const targetEndUtc = zonedDateTimeToUtc('2026-09-16', '17:00:00', 'Asia/Manila');

      await expect(
        adminService.rescheduleReservation({
          reservationId: res2!.id,
          startAt: targetStartUtc.toISOString(),
          endAt: targetEndUtc.toISOString(),
          actorRole: 'CUSTOMER',
          cutoffHours: 12,
        })
      ).rejects.toThrow('Selected workspace slot is already booked for this time window');
    });

    it('allows earlier or later start time as long as no overlap exists and duration matches', async () => {
      // Original: 2026-09-16 16:00-18:00
      const detail = await createConfirmedReservation({ refCodeSuffix: 'B5', startDate: '2026-09-16', startHour: 16, duration: 2 });
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      // Reschedule to earlier that day: 2026-09-16 09:00-11:00
      const earlierStartUtc = zonedDateTimeToUtc('2026-09-16', '09:00:00', 'Asia/Manila');
      const earlierEndUtc = zonedDateTimeToUtc('2026-09-16', '11:00:00', 'Asia/Manila');

      const result = await adminService.rescheduleReservation({
        reservationId: detail!.id,
        startAt: earlierStartUtc.toISOString(),
        endAt: earlierEndUtc.toISOString(),
        actorRole: 'CUSTOMER',
        cutoffHours: 12,
      });

      expect(result.success).toBe(true);
      expect(result.reservation.schedule).toContain('Sep 16');
      expect(result.reservation.schedule).toContain('9:00 AM - 11:00 AM');
    });

    it('allows Admin to reschedule without customer cutoff or 1x limits', async () => {
      // Customer has already rescheduled once
      const detail = await createConfirmedReservation({ refCodeSuffix: 'B6', startDate: '2026-09-16', startHour: 10, duration: 2 });
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const custStartUtc = zonedDateTimeToUtc('2026-09-17', '10:00:00', 'Asia/Manila');
      const custEndUtc = zonedDateTimeToUtc('2026-09-17', '12:00:00', 'Asia/Manila');

      await adminService.rescheduleReservation({
        reservationId: detail!.id,
        startAt: custStartUtc.toISOString(),
        endAt: custEndUtc.toISOString(),
        actorRole: 'CUSTOMER',
        cutoffHours: 12,
      });

      // Admin reschedules again (2nd reschedule total) -> Admin bypasses customer 1x limit
      const adminStartUtc = zonedDateTimeToUtc('2026-09-18', '14:00:00', 'Asia/Manila');
      const adminEndUtc = zonedDateTimeToUtc('2026-09-18', '16:00:00', 'Asia/Manila');

      const adminResult = await adminService.rescheduleReservation({
        reservationId: detail!.id,
        startAt: adminStartUtc.toISOString(),
        endAt: adminEndUtc.toISOString(),
        actorRole: 'ADMIN',
      });

      expect(adminResult.success).toBe(true);
    });
  });

  describe('4. Transactional Reschedule Email Template Copy', () => {
    it('renders customer requested copy when actorRole is CUSTOMER', () => {
      const email = renderReservationRescheduledEmail({
        to: 'customer@example.com',
        customerFirstName: 'Bob',
        referenceCode: 'DA-2026-9999',
        oldSchedule: 'Sep 16, 2026, 10:00 AM - 12:00 PM',
        newSchedule: 'Sep 17, 2026, 2:00 PM - 4:00 PM',
        workspaceDisplayName: 'Spot 1',
        actorRole: 'CUSTOMER',
      });

      expect(email.html).toContain('successfully rescheduled upon your request');
      expect(email.html).toContain('DA-2026-9999');
      expect(email.html).toContain('Sep 17, 2026, 2:00 PM - 4:00 PM');
    });

    it('renders administration copy when actorRole is ADMIN or undefined', () => {
      const email = renderReservationRescheduledEmail({
        to: 'customer@example.com',
        customerFirstName: 'Bob',
        referenceCode: 'DA-2026-8888',
        oldSchedule: 'Sep 16, 2026, 10:00 AM - 12:00 PM',
        newSchedule: 'Sep 17, 2026, 2:00 PM - 4:00 PM',
        workspaceDisplayName: 'Spot 1',
        actorRole: 'ADMIN',
      });

      expect(email.html).toContain('rescheduled by the administration');
    });
  });
});
