import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateMaxBookingDate,
  validateBookingDateWithinHorizon,
  InMemorySettingsRepository,
  createAdminSettingsService,
  createAvailabilityService,
  InMemoryAvailabilityRepository,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  createReservationService,
  createPaymentSessionService,
  zonedDateTimeToUtc,
} from '@deskatlas/domain';

describe('MS-08: Configurable Maximum Advance Booking Horizon Window', () => {
  let settingsRepo: InMemorySettingsRepository;
  let settingsService: ReturnType<typeof createAdminSettingsService>;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let reservationRepo: ReservationMemoryRepository;
  let now: Date;

  const nowProvider = () => now;

  const validBaseSettings = {
    businessName: 'DeskAtlas Hub',
    timezone: 'Asia/Manila',
    contactEmail: 'admin@deskatlas.com',
    contactPhone: '+639171234567',
    bookingIntervalMinutes: 30,
    paymentExpiryMinutes: 60,
  };

  beforeEach(async () => {
    // Current time: 2026-09-26 10:00 AM Manila (UTC: 2026-09-26 02:00:00Z)
    now = new Date('2026-09-26T10:00:00+08:00');
    settingsRepo = new InMemorySettingsRepository();
    settingsService = createAdminSettingsService(settingsRepo);
    workspaceRepo = new InMemoryWorkspaceRepository();
    reservationRepo = new ReservationMemoryRepository(nowProvider);

    const floor = await workspaceRepo.createFloor({ name: 'Floor 1' });
    const template = await workspaceRepo.createTemplate({
      name: 'Hot Desk',
      capacity: 1,
      rateAmount: 100,
      pricingUnit: 'HOURLY',
    });

    await workspaceRepo.createInstance({
      floorId: floor.id,
      templateId: template.id,
      instanceCode: 'desk-1',
      displayName: 'Desk 1',
    });
  });

  describe('QAD-TC8.1: Schema and default settings persistence', () => {
    it('initializes business settings with default maxAdvanceBookingDays = 90', async () => {
      const settings = await settingsRepo.getBusinessSettings();
      expect(settings.maxAdvanceBookingDays).toBe(90);

      const publicSettings = await settingsService.getPublicBusinessSettings();
      expect(publicSettings.maxAdvanceBookingDays).toBe(90);
    });

    it('persists customized maxAdvanceBookingDays when updated', async () => {
      const updated = await settingsService.updateBusinessSettings({
        ...validBaseSettings,
        maxAdvanceBookingDays: 60,
      });
      expect(updated.maxAdvanceBookingDays).toBe(60);

      const loaded = await settingsRepo.getBusinessSettings();
      expect(loaded.maxAdvanceBookingDays).toBe(60);

      const publicSettings = await settingsService.getPublicBusinessSettings();
      expect(publicSettings.maxAdvanceBookingDays).toBe(60);
    });
  });

  describe('QAD-TC8.2: Admin settings validation range', () => {
    it('accepts valid horizon boundaries (1, 50, 80, 100, 365 days)', async () => {
      for (const validDays of [1, 50, 80, 100, 365]) {
        const result = await settingsService.updateBusinessSettings({
          ...validBaseSettings,
          maxAdvanceBookingDays: validDays,
        });
        expect(result.maxAdvanceBookingDays).toBe(validDays);
      }
    });

    it('rejects values less than 1 day with ValidationError', async () => {
      await expect(
        settingsService.updateBusinessSettings({
          ...validBaseSettings,
          maxAdvanceBookingDays: 0,
        })
      ).rejects.toThrow(/Maximum advance booking days must be an integer between 1 and 365 days/i);

      await expect(
        settingsService.updateBusinessSettings({
          ...validBaseSettings,
          maxAdvanceBookingDays: -10,
        })
      ).rejects.toThrow(/Maximum advance booking days must be an integer between 1 and 365 days/i);
    });

    it('rejects values greater than 365 days with ValidationError', async () => {
      await expect(
        settingsService.updateBusinessSettings({
          ...validBaseSettings,
          maxAdvanceBookingDays: 366,
        })
      ).rejects.toThrow(/Maximum advance booking days must be an integer between 1 and 365 days/i);

      await expect(
        settingsService.updateBusinessSettings({
          ...validBaseSettings,
          maxAdvanceBookingDays: 500,
        })
      ).rejects.toThrow(/Maximum advance booking days must be an integer between 1 and 365 days/i);
    });

    it('rejects non-integer values with ValidationError', async () => {
      await expect(
        settingsService.updateBusinessSettings({
          ...validBaseSettings,
          maxAdvanceBookingDays: 30.5,
        })
      ).rejects.toThrow(/Maximum advance booking days must be an integer between 1 and 365 days/i);
    });
  });

  describe('QAD-TC8.3: Horizon date calculation utility', () => {
    it('accurately calculates target date strings across standard months', () => {
      // 2026-09-26 + 90 days -> 2026-12-25
      const max90 = calculateMaxBookingDate('2026-09-26', 90);
      expect(max90).toBe('2026-12-25');

      // 2026-01-15 + 50 days -> 2026-03-06 (2026 is not a leap year, Feb has 28 days)
      const max50 = calculateMaxBookingDate('2026-01-15', 50);
      expect(max50).toBe('2026-03-06');
    });

    it('accurately calculates target date across leap year leap days (Feb 29)', () => {
      // 2028 is a leap year (Feb 29 exists)
      // 2028-02-01 + 30 days -> 2028-03-02
      const leapMax = calculateMaxBookingDate('2028-02-01', 30);
      expect(leapMax).toBe('2028-03-02');
    });

    it('accurately handles year rollovers', () => {
      // 2026-12-01 + 60 days -> 2027-01-30
      const rollover = calculateMaxBookingDate('2026-12-01', 60);
      expect(rollover).toBe('2027-01-30');
    });

    it('validates booking dates within or beyond horizon with validateBookingDateWithinHorizon', () => {
      const today = '2026-09-26';
      const maxAdvanceDays = 50;
      const maxAllowed = calculateMaxBookingDate(today, maxAdvanceDays); // 2026-11-15

      // Boundary date is inclusive and valid
      expect(() => validateBookingDateWithinHorizon(maxAllowed, today, maxAdvanceDays)).not.toThrow();
      expect(() => validateBookingDateWithinHorizon('2026-10-15', today, maxAdvanceDays)).not.toThrow();

      // One day past horizon throws ValidationError
      const dayPast = calculateMaxBookingDate(today, maxAdvanceDays + 1); // 2026-11-16
      expect(() => validateBookingDateWithinHorizon(dayPast, today, maxAdvanceDays)).toThrow(
        /exceeds the maximum allowable booking window of 50 days/i
      );
    });
  });

  describe('QAD-TC8.4: Calendar date disabling beyond horizon', () => {
    it('marks dates beyond maxAdvanceBookingDays as unavailable in listDateAvailability', async () => {
      const repository = new InMemoryAvailabilityRepository();
      repository.setBusinessSettings({
        timezone: 'Asia/Manila',
        bookingIntervalMinutes: 30,
        maxAdvanceBookingDays: 30, // 30 days horizon
      });
      repository.seedWorkspaceInstance({
        id: 'spot-1',
        templateId: 'template-desk',
        floorId: 'floor-1',
        instanceCode: 'A1',
        displayName: 'Desk A1',
        operationalStatus: 'ACTIVE',
      });
      for (let day = 0; day <= 6; day++) {
        repository.seedOperatingHours(day, [{ opensAt: '08:00:00', closesAt: '22:00:00' }]);
      }

      const service = createAvailabilityService(repository);

      // Query from 2026-09-26 (today) to 2026-11-05 (40 days later, horizon is 30 days -> 2026-10-26)
      const result = await service.listDateAvailability({
        workspaceInstanceId: 'spot-1',
        startDate: '2026-09-26',
        endDate: '2026-11-05',
        durationMinutes: 120,
        nowIso: '2026-09-26T02:00:00.000Z',
      });

      const todayAvail = result.dates.find((d) => d.date === '2026-09-26');
      expect(todayAvail?.isAvailable).toBe(true);

      const day30Avail = result.dates.find((d) => d.date === '2026-10-26');
      expect(day30Avail?.isAvailable).toBe(true);

      const day31Avail = result.dates.find((d) => d.date === '2026-10-27');
      expect(day31Avail?.isAvailable).toBe(false);
      expect(day31Avail?.reason).toBe('BLOCKED');
    });
  });

  describe('QAD-TC8.5: Next month navigation ceiling calculation', () => {
    it('computes ceiling month and identifies when navigation should be disabled', () => {
      const todayStr = '2026-09-26';
      const maxAdvanceDays = 50; // 50 days from Sep 26 is Nov 15
      const maxAllowedDateStr = calculateMaxBookingDate(todayStr, maxAdvanceDays);
      expect(maxAllowedDateStr).toBe('2026-11-15');

      const [maxViewYear, maxViewMonth] = maxAllowedDateStr.split('-').map(Number);
      expect(maxViewYear).toBe(2026);
      expect(maxViewMonth).toBe(11);

      // Current view is September (Month 9): Next button enabled
      let viewYear = 2026;
      let viewMonth = 9;
      let isAtOrPastMaxMonth =
        viewYear > maxViewYear || (viewYear === maxViewYear && viewMonth >= maxViewMonth);
      expect(isAtOrPastMaxMonth).toBe(false);

      // User navigates to October (Month 10): Next button enabled
      viewMonth = 10;
      isAtOrPastMaxMonth =
        viewYear > maxViewYear || (viewYear === maxViewYear && viewMonth >= maxViewMonth);
      expect(isAtOrPastMaxMonth).toBe(false);

      // User navigates to November (Month 11, ceiling month): Next button disabled
      viewMonth = 11;
      isAtOrPastMaxMonth =
        viewYear > maxViewYear || (viewYear === maxViewYear && viewMonth >= maxViewMonth);
      expect(isAtOrPastMaxMonth).toBe(true);
    });
  });

  describe('QAD-TC8.6: Server-side reservation rejection', () => {
    it('rejects reservations requested beyond configured horizon with ValidationError', async () => {
      const catalog = await workspaceRepo.listCatalog();
      const instance = catalog.instances[0];

      await settingsService.updateBusinessSettings({
        ...validBaseSettings,
        maxAdvanceBookingDays: 30, // 30 days horizon
      });

      const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
      const reservationService = createReservationService(
        reservationRepo,
        workspaceRepo as any,
        reservationRepo,
        paymentSessionService
      );

      // Try booking 60 days into future (2026-11-25)
      const requestedDate = '2026-11-25';
      const startUtc = zonedDateTimeToUtc(requestedDate, '10:00', 'Asia/Manila');
      const endUtc = new Date(startUtc.getTime() + 2 * 60 * 60 * 1000);

      await expect(
        reservationService.createReservation(
          {
            customerFirstName: 'Juan',
            customerLastName: 'Dela Cruz',
            customerEmail: 'juan@example.com',
            source: 'WEB',
            candidates: [
              {
                rank: 0,
                workspaceInstanceId: instance.id,
                startAt: startUtc.toISOString(),
                endAt: endUtc.toISOString(),
              },
            ],
          },
          {
            paymentLinkBaseUrl: 'https://deskatlas.com/pay',
            maxAdvanceBookingDays: 30,
            now,
          }
        )
      ).rejects.toThrow(/exceeds the maximum allowable booking window of 30 days/i);
    });

    it('accepts reservations requested within configured horizon', async () => {
      const catalog = await workspaceRepo.listCatalog();
      const instance = catalog.instances[0];

      const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
      const reservationService = createReservationService(
        reservationRepo,
        workspaceRepo as any,
        reservationRepo,
        paymentSessionService
      );

      // Book 10 days into future (2026-10-06)
      const requestedDate = '2026-10-06';
      const startUtc = zonedDateTimeToUtc(requestedDate, '10:00', 'Asia/Manila');
      const endUtc = new Date(startUtc.getTime() + 2 * 60 * 60 * 1000);

      const reservation = await reservationService.createReservation(
        {
          customerFirstName: 'Maria',
          customerLastName: 'Santos',
          customerEmail: 'maria@example.com',
          source: 'WEB',
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: instance.id,
              startAt: startUtc.toISOString(),
              endAt: endUtc.toISOString(),
            },
          ],
        },
        {
          paymentLinkBaseUrl: 'https://deskatlas.com/pay',
          maxAdvanceBookingDays: 30,
          now,
        }
      );

      expect(reservation).toBeDefined();
      expect(reservation.id).toBeDefined();
      expect(reservation.status).toBe('PENDING_PAYMENT');
    });
  });
});
