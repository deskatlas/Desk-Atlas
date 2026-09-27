import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemorySettingsRepository,
  createAdminSettingsService,
  InMemoryWorkspaceRepository,
  createWorkspaceService,
  resolvePassInterval,
  isPassTypeSupportedByOperatingHours,
  calculateReservationPrice,
  validatePassPricingConfig,
  RateType,
} from '@deskatlas/domain';

describe('MS-11: Workspace Template Pass Pricing and Configurable Operating Schedule Windows', () => {
  let settingsRepo: InMemorySettingsRepository;
  let settingsService: ReturnType<typeof createAdminSettingsService>;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let workspaceService: ReturnType<typeof createWorkspaceService>;

  const validBaseSettings = {
    businessName: 'DeskAtlas Hub',
    timezone: 'Asia/Manila',
    contactEmail: 'admin@deskatlas.com',
    contactPhone: '+639171234567',
    bookingIntervalMinutes: 30,
    paymentExpiryMinutes: 60,
  };

  beforeEach(async () => {
    settingsRepo = new InMemorySettingsRepository();
    settingsService = createAdminSettingsService(settingsRepo);
    workspaceRepo = new InMemoryWorkspaceRepository();
    workspaceService = createWorkspaceService(workspaceRepo);
  });

  describe('QAD-TC11.1: Schema and settings persistence', () => {
    it('initializes business settings with default pass shift windows', async () => {
      const settings = await settingsRepo.getBusinessSettings();
      expect(settings.dayPassStartTime).toBe('07:00');
      expect(settings.dayPassEndTime).toBe('23:30');
      expect(settings.nightPassStartTime).toBe('20:00');
      expect(settings.nightPassEndTime).toBe('07:00');
    });

    it('persists and retrieves custom day and night pass shift windows', async () => {
      const updated = await settingsService.updateBusinessSettings({
        ...validBaseSettings,
        dayPassStartTime: '08:00',
        dayPassEndTime: '18:00',
        nightPassStartTime: '19:00',
        nightPassEndTime: '06:00',
      });

      expect(updated.dayPassStartTime).toBe('08:00');
      expect(updated.dayPassEndTime).toBe('18:00');
      expect(updated.nightPassStartTime).toBe('19:00');
      expect(updated.nightPassEndTime).toBe('06:00');

      const fetched = await settingsRepo.getBusinessSettings();
      expect(fetched.dayPassStartTime).toBe('08:00');
      expect(fetched.dayPassEndTime).toBe('18:00');
      expect(fetched.nightPassStartTime).toBe('19:00');
      expect(fetched.nightPassEndTime).toBe('06:00');
    });
  });

  describe('QAD-TC11.2: Overnight schedule calculation', () => {
    it('resolves same-day intervals when end time is strictly after start time', () => {
      const interval = resolvePassInterval('2026-10-15', '07:00', '23:30');
      expect(interval.startAt).toBe('2026-10-15T07:00:00');
      expect(interval.endAt).toBe('2026-10-15T23:30:00');
    });

    it('correctly increments calendar day for overnight intervals spanning midnight', () => {
      const interval = resolvePassInterval('2026-10-15', '20:00', '07:00');
      expect(interval.startAt).toBe('2026-10-15T20:00:00');
      expect(interval.endAt).toBe('2026-10-16T07:00:00');
    });

    it('handles month and year rollover on overnight intervals', () => {
      const monthEnd = resolvePassInterval('2026-10-31', '21:00', '06:00');
      expect(monthEnd.startAt).toBe('2026-10-31T21:00:00');
      expect(monthEnd.endAt).toBe('2026-11-01T06:00:00');

      const yearEnd = resolvePassInterval('2026-12-31', '22:00', '05:00');
      expect(yearEnd.startAt).toBe('2026-12-31T22:00:00');
      expect(yearEnd.endAt).toBe('2027-01-01T05:00:00');
    });
  });

  describe('QAD-TC11.3: Template pass pricing validation', () => {
    it('creates workspace template with optional pass tiers and prices', async () => {
      const template = await workspaceService.createTemplate({
        name: 'Dedicated Desk Alpha',
        capacity: 1,
        rateAmount: 60,
        pricingUnit: 'HOURLY',
        hasDayPass: true,
        dayPassPrice: 350,
        hasNightPass: true,
        nightPassPrice: 250,
        hasWholeDayPass: true,
        wholeDayPassPrice: 500,
        hasHalfDayPass: true,
        halfDayPassPrice: 300,
      });

      expect(template.hasDayPass).toBe(true);
      expect(template.dayPassPrice).toBe(350);
      expect(template.hasNightPass).toBe(true);
      expect(template.nightPassPrice).toBe(250);
      expect(template.hasWholeDayPass).toBe(true);
      expect(template.wholeDayPassPrice).toBe(500);
      expect(template.hasHalfDayPass).toBe(true);
      expect(template.halfDayPassPrice).toBe(300);
    });

    it('rejects negative pass prices when enabled', () => {
      const result = validatePassPricingConfig({
        hasDayPass: true,
        dayPassPrice: -50,
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Day Pass price cannot be negative');
    });

    it('rejects missing pass prices when pass tier is enabled', () => {
      const result = validatePassPricingConfig({
        hasNightPass: true,
        nightPassPrice: null,
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Night Pass price is required when Night Pass is enabled');
    });

    it('allows disabled pass tiers with null prices', () => {
      const result = validatePassPricingConfig({
        hasDayPass: false,
        dayPassPrice: null,
        hasNightPass: false,
        nightPassPrice: null,
      });
      expect(result.isValid).toBe(true);
    });
  });

  describe('QAD-TC11.4: Operating hours feasibility guard', () => {
    it('permits all pass types under 24/7 operating mode', () => {
      const open24h = { openTime: '00:00', closeTime: '24:00', is24Hours: true };
      expect(isPassTypeSupportedByOperatingHours('HOURLY', open24h)).toBe(true);
      expect(isPassTypeSupportedByOperatingHours('DAY_PASS', open24h)).toBe(true);
      expect(isPassTypeSupportedByOperatingHours('NIGHT_PASS', open24h)).toBe(true);
      expect(isPassTypeSupportedByOperatingHours('WHOLE_DAY_PASS', open24h)).toBe(true);
      expect(isPassTypeSupportedByOperatingHours('HALF_DAY_PASS', open24h)).toBe(true);
    });

    it('blocks 24-hour Whole Day pass when venue is not 24h', () => {
      const daytimeOnly = { openTime: '08:00', closeTime: '18:00', is24Hours: false };
      expect(isPassTypeSupportedByOperatingHours('WHOLE_DAY_PASS', daytimeOnly)).toBe(false);
    });

    it('blocks Night Pass when business closes before night shift hours', () => {
      const daytimeOnly = { openTime: '08:00', closeTime: '18:00', is24Hours: false };
      expect(isPassTypeSupportedByOperatingHours('NIGHT_PASS', daytimeOnly)).toBe(false);
    });

    it('permits Night Pass when venue operating hours span night shift', () => {
      const extendedHours = { openTime: '06:00', closeTime: '23:30', is24Hours: false };
      expect(isPassTypeSupportedByOperatingHours('NIGHT_PASS', extendedHours)).toBe(true);
    });
  });

  describe('QAD-TC11.5: Reservation total calculation', () => {
    const templatePricing = {
      rateAmount: 50,
      hasDayPass: true,
      dayPassPrice: 350,
      hasNightPass: true,
      nightPassPrice: 250,
      hasWholeDayPass: true,
      wholeDayPassPrice: 500,
      hasHalfDayPass: true,
      halfDayPassPrice: 300,
    };

    it('computes hourly total based on duration hours multiplied by rateAmount', () => {
      const calc = calculateReservationPrice(templatePricing, 'HOURLY', 4);
      expect(calc.rateType).toBe('HOURLY');
      expect(calc.unitPrice).toBe(50);
      expect(calc.totalAmount).toBe(200);
    });

    it('applies flat fixed rate for Day Pass without multiplying by hours', () => {
      const calc = calculateReservationPrice(templatePricing, 'DAY_PASS', 12);
      expect(calc.rateType).toBe('DAY_PASS');
      expect(calc.unitPrice).toBe(350);
      expect(calc.totalAmount).toBe(350);
    });

    it('applies flat fixed rate for Night Pass without multiplying by hours', () => {
      const calc = calculateReservationPrice(templatePricing, 'NIGHT_PASS', 11);
      expect(calc.rateType).toBe('NIGHT_PASS');
      expect(calc.unitPrice).toBe(250);
      expect(calc.totalAmount).toBe(250);
    });

    it('applies flat fixed rate for 24-Hour Whole Day Pass', () => {
      const calc = calculateReservationPrice(templatePricing, 'WHOLE_DAY_PASS', 24);
      expect(calc.rateType).toBe('WHOLE_DAY_PASS');
      expect(calc.unitPrice).toBe(500);
      expect(calc.totalAmount).toBe(500);
    });

    it('applies flat fixed rate for 12-Hour Half Day Pass', () => {
      const calc = calculateReservationPrice(templatePricing, 'HALF_DAY_PASS', 12);
      expect(calc.rateType).toBe('HALF_DAY_PASS');
      expect(calc.unitPrice).toBe(300);
      expect(calc.totalAmount).toBe(300);
    });

    it('throws error when requested pass type is disabled on template', () => {
      const noNightPassTemplate = {
        rateAmount: 50,
        hasNightPass: false,
        nightPassPrice: null,
      };

      expect(() =>
        calculateReservationPrice(noNightPassTemplate, 'NIGHT_PASS', 10)
      ).toThrow('NIGHT_PASS is not enabled for this workspace template');
    });
  });
});
