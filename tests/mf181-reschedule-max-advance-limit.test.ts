import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  InMemorySettingsRepository,
  createAdminSettingsService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createBookingAccessService,
  calculateRescheduleMaxAdvanceHours,
  zonedDateTimeToUtc,
} from '@deskatlas/domain';

describe('MF-181: Configurable Reschedule Max Advance Limit in Admin Settings', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let settingsRepo: InMemorySettingsRepository;
  let settingsService: ReturnType<typeof createAdminSettingsService>;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    // Manila time: 2026-09-15 08:00 AM (UTC: 2026-09-15 00:00:00Z)
    now = new Date('2026-09-15T08:00:00+08:00');
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();
    settingsRepo = new InMemorySettingsRepository();
    settingsService = createAdminSettingsService(settingsRepo);

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
  });

  async function createConfirmedReservation(refSuffix: string, startDate = '2026-09-16') {
    const catalog = await workspaceRepo.listCatalog();
    const instance = catalog.instances[0];

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const paymentReviewService = createPaymentReviewService(repo, nowProvider);

    const startUtc = zonedDateTimeToUtc(startDate, '10:00', 'Asia/Manila');
    const endUtc = new Date(startUtc.getTime() + 2 * 60 * 60 * 1000);

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Maria',
        customerLastName: 'Santos',
        customerEmail: `maria.${refSuffix}@example.com`,
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

    return res;
  }

  describe('Settings Domain & Persistence', () => {
    it('has default reschedule max advance limit of 30 DAYS (720 hours)', async () => {
      const settings = await settingsRepo.getBusinessSettings();
      expect(settings.rescheduleMaxAdvanceValue).toBe(30);
      expect(settings.rescheduleMaxAdvanceUnit).toBe('DAYS');

      const hours = calculateRescheduleMaxAdvanceHours(settings.rescheduleMaxAdvanceValue, settings.rescheduleMaxAdvanceUnit);
      expect(hours).toBe(720);
    });

    it('calculates max advance hours correctly for DAYS and HOURS', () => {
      expect(calculateRescheduleMaxAdvanceHours(14, 'DAYS')).toBe(336);
      expect(calculateRescheduleMaxAdvanceHours(48, 'HOURS')).toBe(48);
      expect(calculateRescheduleMaxAdvanceHours(1, 'DAYS')).toBe(24);
      expect(calculateRescheduleMaxAdvanceHours(12, 'HOURS')).toBe(12);
    });

    it('persists and updates reschedule max advance settings via AdminSettingsService', async () => {
      const existing = await settingsRepo.getBusinessSettings();

      await settingsService.updateBusinessSettings({
        ...existing,
        rescheduleMaxAdvanceValue: 14,
        rescheduleMaxAdvanceUnit: 'DAYS',
      });

      let settings = await settingsRepo.getBusinessSettings();
      expect(settings.rescheduleMaxAdvanceValue).toBe(14);
      expect(settings.rescheduleMaxAdvanceUnit).toBe('DAYS');

      await settingsService.updateBusinessSettings({
        ...existing,
        rescheduleMaxAdvanceValue: 48,
        rescheduleMaxAdvanceUnit: 'HOURS',
      });

      settings = await settingsRepo.getBusinessSettings();
      expect(settings.rescheduleMaxAdvanceValue).toBe(48);
      expect(settings.rescheduleMaxAdvanceUnit).toBe('HOURS');
    });

    it('validates ranges in settings normalization (Days: 1-365, Hours: 1-8760)', async () => {
      const existing = await settingsRepo.getBusinessSettings();

      // Invalid days (< 1 or > 365)
      await expect(
        settingsService.updateBusinessSettings({
          ...existing,
          rescheduleMaxAdvanceValue: 0,
          rescheduleMaxAdvanceUnit: 'DAYS',
        })
      ).rejects.toThrow();

      await expect(
        settingsService.updateBusinessSettings({
          ...existing,
          rescheduleMaxAdvanceValue: 366,
          rescheduleMaxAdvanceUnit: 'DAYS',
        })
      ).rejects.toThrow();

      // Invalid hours (< 1 or > 8760)
      await expect(
        settingsService.updateBusinessSettings({
          ...existing,
          rescheduleMaxAdvanceValue: -5,
          rescheduleMaxAdvanceUnit: 'HOURS',
        })
      ).rejects.toThrow();

      await expect(
        settingsService.updateBusinessSettings({
          ...existing,
          rescheduleMaxAdvanceValue: 9000,
          rescheduleMaxAdvanceUnit: 'HOURS',
        })
      ).rejects.toThrow();
    });
  });

  describe('Reschedule Availability Checks', () => {
    it('returns maxAdvanceValue, maxAdvanceUnit, maxAdvanceHours, and maxAllowedDate in availability response', async () => {
      const res = await createConfirmedReservation('avail-1');

      // Check availability with maxAdvance 14 DAYS
      const availability = await repo.checkRescheduleAvailability({
        reservationId: res.id,
        date: '2026-09-20',
        durationHours: 2,
        maxAdvanceValue: 14,
        maxAdvanceUnit: 'DAYS',
        maxAdvanceHours: 336,
      });

      expect(availability.maxAdvanceValue).toBe(14);
      expect(availability.maxAdvanceUnit).toBe('DAYS');
      expect(availability.maxAdvanceHours).toBe(336);
      expect(availability.maxAllowedDate).toBeDefined();
      expect(availability.available).toBe(true);
    });

    it('rejects availability check if requested date exceeds max allowed advance date', async () => {
      const res = await createConfirmedReservation('avail-2');

      // Now is 2026-09-15. 14 days limit means max date is 2026-09-29.
      // Requesting 2026-10-15 (30 days ahead)
      const availability = await repo.checkRescheduleAvailability({
        reservationId: res.id,
        date: '2026-10-15',
        durationHours: 2,
        maxAdvanceValue: 14,
        maxAdvanceUnit: 'DAYS',
        maxAdvanceHours: 336,
      });

      expect(availability.available).toBe(false);
      expect(availability.reason).toBe('Rescheduling is only allowed up to 14 days in advance.');
    });
  });

  describe('Reschedule Execution Enforcement', () => {
    it('blocks rescheduling beyond max advance limit with exact formatted message for DAYS', async () => {
      const res = await createConfirmedReservation('exec-1');

      // Target: 2026-10-15 (30 days out)
      const futureStart = new Date('2026-10-15T10:00:00+08:00');
      const futureEnd = new Date('2026-10-15T12:00:00+08:00');

      await expect(
        repo.rescheduleReservation({
          reservationId: res.id,
          startAt: futureStart.toISOString(),
          endAt: futureEnd.toISOString(),
          maxAdvanceValue: 14,
          maxAdvanceUnit: 'DAYS',
          maxAdvanceHours: 336,
        })
      ).rejects.toThrow('Rescheduling is only allowed up to 14 days in advance.');
    });

    it('blocks rescheduling beyond max advance limit with exact formatted message for HOURS', async () => {
      const res = await createConfirmedReservation('exec-2');

      // Target: 3 days out (72 hours). Limit is 48 HOURS.
      const futureStart = new Date('2026-09-18T10:00:00+08:00');
      const futureEnd = new Date('2026-09-18T12:00:00+08:00');

      await expect(
        repo.rescheduleReservation({
          reservationId: res.id,
          startAt: futureStart.toISOString(),
          endAt: futureEnd.toISOString(),
          maxAdvanceValue: 48,
          maxAdvanceUnit: 'HOURS',
          maxAdvanceHours: 48,
        })
      ).rejects.toThrow('Rescheduling is only allowed up to 48 hours in advance.');
    });

    it('successfully reschedules when target date is within max advance limit', async () => {
      const res = await createConfirmedReservation('exec-3');

      // Target: 5 days out (within 14 days limit)
      const futureStart = new Date('2026-09-20T10:00:00+08:00');
      const futureEnd = new Date('2026-09-20T12:00:00+08:00');

      const result = await repo.rescheduleReservation({
        reservationId: res.id,
        startAt: futureStart.toISOString(),
        endAt: futureEnd.toISOString(),
        maxAdvanceValue: 14,
        maxAdvanceUnit: 'DAYS',
        maxAdvanceHours: 336,
      });

      expect(result.success).toBe(true);
      expect(result.reservation).toBeDefined();
      expect(result.reservation.assignedCandidate?.startAt).toBe(futureStart.toISOString());
      expect(result.reservation.assignedCandidate?.endAt).toBe(futureEnd.toISOString());
    });
  });
});
