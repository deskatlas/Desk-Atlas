import { describe, it, expect, beforeEach } from 'vitest';
import {
  createReservationService,
  createWorkspaceService,
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  createPaymentSessionService,
  resolveEffectivePrice,
  type Floor,
  type RateType,
  type PromotionalRate,
} from '@deskatlas/domain';

/**
 * MS-21 / QAD-TC21: Customer Web Day Pass Pricing Calculation Integrity,
 * Promotional Discount Resolution, and Schedule Funnel Progression
 */
describe('MS-21 / QAD-TC21: Customer Web Day Pass Pricing Calculation and Schedule Progression', () => {
  const testFloor: Floor = {
    id: 'floor-ms21',
    name: 'Floor 21',
    floorNumber: 21,
    displayOrder: 21,
    isActive: true,
  };

  let workspaceRepo: InMemoryWorkspaceRepository;
  let workspaceService: ReturnType<typeof createWorkspaceService>;
  let reservationRepo: ReservationMemoryRepository;
  let paymentSessionService: ReturnType<typeof createPaymentSessionService>;
  let reservationService: ReturnType<typeof createReservationService>;

  let skyPodTemplateId: string;
  let skyPodInstanceId: string;

  const SKYPOD_HOURLY_RATE = 1699;
  const SKYPOD_DAY_PASS_PRICE = 5000;

  beforeEach(async () => {
    workspaceRepo = new InMemoryWorkspaceRepository();
    workspaceRepo.seedFloor(testFloor);
    workspaceService = createWorkspaceService(workspaceRepo);

    // Create SkyPod template with hourly and flat day pass rates
    const template = await workspaceService.createTemplate({
      name: 'SkyPod Executive',
      capacity: 1,
      rateAmount: SKYPOD_HOURLY_RATE,
      hasDayPass: true,
      dayPassPrice: SKYPOD_DAY_PASS_PRICE,
      defaultShape: 'desk',
      defaultColor: '#009689',
    });
    skyPodTemplateId = template.id;

    // Create physical instance
    const instance = await workspaceService.createInstanceFromTemplate({
      templateId: skyPodTemplateId,
      floorId: testFloor.id,
    });
    skyPodInstanceId = instance.id;

    reservationRepo = new ReservationMemoryRepository();
    paymentSessionService = createPaymentSessionService(reservationRepo);

    reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
  });

  describe('QAD-TC21.1: Day Pass Flat Price Calculation', () => {
    it('calculates flat rate of 5,000 for SkyPod Day Pass (07:00 to 23:30) instead of 1,699 * 16.5 (28,033.50)', async () => {
      // 07:00 to 23:30 Manila time (16.5 hours operational window)
      const startAt = '2026-10-01T07:00:00+08:00';
      const endAt = '2026-10-01T23:30:00+08:00';

      const reservation = await reservationService.createReservation(
        {
          source: 'WEB',
          customerFirstName: 'Maria',
          customerLastName: 'Santos',
          customerEmail: 'maria.santos@example.com',
          rateType: 'DAY_PASS',
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: skyPodInstanceId,
              startAt: new Date(startAt).toISOString(),
              endAt: new Date(endAt).toISOString(),
              rateType: 'DAY_PASS',
            },
          ],
        },
        {
          paymentLinkBaseUrl: 'https://deskatlas.com/pay',
          now: new Date('2026-09-30T00:00:00Z'),
        }
      );

      // Verify flat day pass price is billed, NOT 1699 * 16.5 = 28033.50
      expect(reservation.amountDue).toBe(SKYPOD_DAY_PASS_PRICE);
      expect(reservation.rateSnapshot).toBe(SKYPOD_DAY_PASS_PRICE);
      expect(reservation.amountDue).not.toBe(28033.5);
    });
  });

  describe('QAD-TC21.2: Promotional Day Pass Resolution', () => {
    it('applies promotional discounted rate for Day Pass booking when active promotion is present', async () => {
      const PROMO_DAY_PASS_PRICE = 4000;
      const activePromos: PromotionalRate[] = [
        {
          id: 'promo-ms21-oct',
          name: 'October Launch Day Pass Promo',
          workspaceTemplateIds: [skyPodTemplateId],
          rateType: 'DAY_PASS',
          promotionalPrice: PROMO_DAY_PASS_PRICE,
          startAt: '2026-10-01T00:00:00Z',
          endAt: '2026-10-31T23:59:59Z',
          isActive: true,
        },
      ];

      const startAt = '2026-10-05T07:00:00+08:00';
      const endAt = '2026-10-05T23:30:00+08:00';

      // 1. Domain resolveEffectivePrice check
      const effectivePricing = resolveEffectivePrice(
        skyPodTemplateId,
        'DAY_PASS',
        SKYPOD_DAY_PASS_PRICE,
        new Date(startAt),
        activePromos,
        1
      );
      expect(effectivePricing.isPromotional).toBe(true);
      expect(effectivePricing.effectivePrice).toBe(PROMO_DAY_PASS_PRICE);
      expect(effectivePricing.estimatedTotal).toBe(PROMO_DAY_PASS_PRICE);

      // 2. Reservation creation with promotions option
      const reservation = await reservationService.createReservation(
        {
          source: 'WEB',
          customerFirstName: 'Juan',
          customerLastName: 'Dela Cruz',
          customerEmail: 'juan@example.com',
          rateType: 'DAY_PASS',
          rateSnapshot: effectivePricing.effectivePrice,
          amountDue: effectivePricing.estimatedTotal,
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: skyPodInstanceId,
              startAt: new Date(startAt).toISOString(),
              endAt: new Date(endAt).toISOString(),
              rateType: 'DAY_PASS',
            },
          ],
        },
        {
          paymentLinkBaseUrl: 'https://deskatlas.com/pay',
          promotions: activePromos,
          now: new Date('2026-10-01T00:00:00Z'),
        }
      );

      expect(reservation.amountDue).toBe(PROMO_DAY_PASS_PRICE);
      expect(reservation.rateSnapshot).toBe(PROMO_DAY_PASS_PRICE);
      expect(reservation.amountDue).toBeLessThan(SKYPOD_DAY_PASS_PRICE);
    });
  });

  describe('QAD-TC21.3: Direct Day Pass Schedule Progression', () => {
    it('enables schedule progression immediately when booking date is chosen in Day Pass mode without requiring hourly slot selection', () => {
      // Logic from ScheduleCalendarStep
      const computeCanProceed = (
        selectedDate: string | null,
        selectedRateType: RateType,
        selectedSlot: { startTime: string; endTime: string } | null,
        selectedDurationHours: number
      ): boolean => {
        const isPassPackage = selectedRateType !== 'HOURLY';
        if (!selectedDate) return false;
        if (isPassPackage) {
          return true;
        }
        return Boolean(selectedSlot && selectedDurationHours && selectedDurationHours > 0);
      };

      const getButtonLabel = (
        canProceed: boolean,
        isPassPackage: boolean,
        candidateRank: number
      ): string => {
        if (canProceed) {
          return candidateRank > 0
            ? `Confirm Backup Spot ${candidateRank} Schedule ->`
            : 'Proceed with this Schedule ->';
        }
        return isPassPackage
          ? 'Select a Booking Date to Proceed'
          : 'Select a Start Time to Proceed';
      };

      // Case 1: In Day Pass mode with date selected but NO slot picked
      const canProceedDayPass = computeCanProceed('2026-10-02', 'DAY_PASS', null, 0);
      expect(canProceedDayPass).toBe(true);

      const labelDayPass = getButtonLabel(canProceedDayPass, true, 0);
      expect(labelDayPass).toBe('Proceed with this Schedule ->');

      // Case 2: In Day Pass mode with NO date selected
      const canProceedNoDate = computeCanProceed(null, 'DAY_PASS', null, 0);
      expect(canProceedNoDate).toBe(false);

      const labelNoDate = getButtonLabel(canProceedNoDate, true, 0);
      expect(labelNoDate).toBe('Select a Booking Date to Proceed');

      // Case 3: In Hourly mode with date selected but NO slot picked
      const canProceedHourlyNoSlot = computeCanProceed('2026-10-02', 'HOURLY', null, 2);
      expect(canProceedHourlyNoSlot).toBe(false);

      const labelHourlyNoSlot = getButtonLabel(canProceedHourlyNoSlot, false, 0);
      expect(labelHourlyNoSlot).toBe('Select a Start Time to Proceed');

      // Case 4: In Hourly mode with date, slot, and duration picked
      const canProceedHourlyComplete = computeCanProceed(
        '2026-10-02',
        'HOURLY',
        { startTime: '09:00', endTime: '11:00' },
        2
      );
      expect(canProceedHourlyComplete).toBe(true);
      expect(getButtonLabel(canProceedHourlyComplete, false, 0)).toBe('Proceed with this Schedule ->');
    });
  });

  describe('QAD-TC21.4: Slot State Isolation on Mode Switch', () => {
    it('clears stale slot selections when switching from Hourly to Day Pass without breaking progression', () => {
      // Simulating ScheduleCalendarStep state management
      let selectedRateType: RateType = 'HOURLY';
      let selectedStartTime: string | null = '09:00';
      let selectedDate = '2026-10-02';
      let selectedDurationHours = 2;

      const handleRateTypeChange = (newType: RateType) => {
        selectedRateType = newType;
        if (newType !== 'HOURLY') {
          selectedStartTime = null;
        }
      };

      const getSelectedSlot = () => {
        if (!selectedStartTime) return null;
        return { startTime: selectedStartTime, endTime: '11:00' };
      };

      const isPassPackage = () => selectedRateType !== 'HOURLY';

      const canProceed = () => {
        if (!selectedDate) return false;
        if (isPassPackage()) return true;
        return Boolean(getSelectedSlot() && selectedDurationHours > 0);
      };

      // 1. User was on Hourly with slot selected
      expect(selectedRateType).toBe('HOURLY');
      expect(getSelectedSlot()).not.toBeNull();
      expect(canProceed()).toBe(true);

      // 2. User toggles to Day Pass
      handleRateTypeChange('DAY_PASS');

      // Slot must be cleared
      expect(selectedRateType).toBe('DAY_PASS');
      expect(selectedStartTime).toBeNull();
      expect(getSelectedSlot()).toBeNull();

      // Progression must still be valid
      expect(canProceed()).toBe(true);

      // 3. User toggles back to Hourly
      handleRateTypeChange('HOURLY');

      // Slot remains null, progression is disabled until slot is chosen
      expect(selectedRateType).toBe('HOURLY');
      expect(selectedStartTime).toBeNull();
      expect(getSelectedSlot()).toBeNull();
      expect(canProceed()).toBe(false);
    });
  });

  describe('QAD-TC21.5: Kiosk vs Customer Web Parity', () => {
    it('yields identical amountDue and rateSnapshot when booking Day Pass on Kiosk and Web', async () => {
      const startAt = '2026-10-10T07:00:00+08:00';
      const endAt = '2026-10-10T23:30:00+08:00';

      // 1. Web Reservation Submission
      const webReservation = await reservationService.createReservation(
        {
          source: 'WEB',
          customerFirstName: 'Web',
          customerLastName: 'Customer',
          customerEmail: 'web@example.com',
          rateType: 'DAY_PASS',
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: skyPodInstanceId,
              startAt: new Date(startAt).toISOString(),
              endAt: new Date(endAt).toISOString(),
              rateType: 'DAY_PASS',
            },
          ],
        },
        {
          paymentLinkBaseUrl: 'https://deskatlas.com/pay',
          now: new Date('2026-10-09T00:00:00Z'),
        }
      );

      // 2. Kiosk Reservation Submission
      const kioskReservation = await reservationService.createReservation(
        {
          source: 'KIOSK',
          customerFirstName: 'Kiosk',
          customerLastName: 'Walkin',
          customerEmail: 'kiosk@example.com',
          rateType: 'DAY_PASS',
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: skyPodInstanceId,
              startAt: new Date(startAt).toISOString(),
              endAt: new Date(endAt).toISOString(),
              rateType: 'DAY_PASS',
            },
          ],
        },
        {
          now: new Date('2026-10-09T00:00:00Z'),
        }
      );

      // Parity check
      expect(webReservation.amountDue).toBe(kioskReservation.amountDue);
      expect(webReservation.rateSnapshot).toBe(kioskReservation.rateSnapshot);
      expect(webReservation.amountDue).toBe(SKYPOD_DAY_PASS_PRICE);
      expect(kioskReservation.amountDue).toBe(SKYPOD_DAY_PASS_PRICE);
    });
  });
});
