import { describe, it, expect, beforeEach } from "vitest";
import {
  setServerTimeSync,
  getServerTimeSyncOffset,
  getPhtNow,
  getPhtDateString,
  getPhtTimeString,
  resolveEffectivePrice,
  isDayPassEligibleAtTime,
  isNightPassEligibleAtTime,
  isDayTime,
  resolveTimeBasedHourlyRate,
  calculateReservationPrice,
} from "@deskatlas/domain";

describe("MS-11: Authoritative PHT Time Sync & Pass Pricing Tiers", () => {
  beforeEach(() => {
    // Reset clock offset
    setServerTimeSync(Date.now());
  });

  describe("Built-in PHT Server Clock Synchronization & Anti-Tampering", () => {
    it("adjusts client clock drift when server timestamp is provided", () => {
      const clientLocalNow = Date.now();
      // Simulate client clock being 2 hours ahead of server (clock tampering)
      const serverTimestamp = clientLocalNow - 2 * 3600 * 1000;
      setServerTimeSync(serverTimestamp);

      const offset = getServerTimeSyncOffset();
      expect(offset).toBeCloseTo(-2 * 3600 * 1000, -2);

      const phtNow = getPhtNow();
      // PHT now should be derived from adjusted server time
      expect(phtNow.getTime()).toBeLessThan(clientLocalNow - 3600 * 1000);
    });

    it("formats authoritative PHT date and time in Asia/Manila timezone (UTC+8)", () => {
      // 2026-09-27 14:30:00 UTC = 2026-09-27 22:30:00 PHT (UTC+8)
      const utcDate = new Date("2026-09-27T14:30:00.000Z");
      expect(getPhtDateString(utcDate)).toBe("2026-09-27");
      expect(getPhtTimeString(utcDate)).toBe("22:30");
    });
  });

  describe("Day & Night Pass Time Window Eligibility", () => {
    it("validates Day Pass operating window (07:00 to 23:30 PHT)", () => {
      expect(isDayPassEligibleAtTime("08:00", "07:00", "23:30")).toBe(true);
      expect(isDayPassEligibleAtTime("15:00", "07:00", "23:30")).toBe(true);
      expect(isDayPassEligibleAtTime("05:00", "07:00", "23:30")).toBe(false);
    });

    it("validates Night Pass overnight window (20:00 to 07:00 PHT)", () => {
      expect(isNightPassEligibleAtTime("21:00", "20:00", "07:00")).toBe(true);
      expect(isNightPassEligibleAtTime("02:00", "20:00", "07:00")).toBe(true);
      expect(isNightPassEligibleAtTime("14:00", "20:00", "07:00")).toBe(false);
    });
  });

  describe("Extended Pass Pricing Tier Calculations (24h and 12h)", () => {
    const templateId = "tpl-dedicated-desk-1";
    const wholeDayPassPrice = 650;
    const halfDayPassPrice = 380;
    const targetDate = new Date("2026-09-27T02:00:00.000Z"); // 10:00 AM PHT

    it("resolves 24-Hour Whole Day Pass flat pricing", () => {
      const result = resolveEffectivePrice(
        templateId,
        "WHOLE_DAY_PASS",
        wholeDayPassPrice,
        targetDate,
        [],
        1
      );
      expect(result.rateType).toBe("WHOLE_DAY_PASS");
      expect(result.effectivePrice).toBe(650);
      expect(result.estimatedTotal).toBe(650);
    });

    it("resolves 12-Hour Half Day Pass flat pricing", () => {
      const result = resolveEffectivePrice(
        templateId,
        "HALF_DAY_PASS",
        halfDayPassPrice,
        targetDate,
        [],
        1
      );
      expect(result.rateType).toBe("HALF_DAY_PASS");
      expect(result.effectivePrice).toBe(380);
      expect(result.estimatedTotal).toBe(380);
    });

    it("applies promotional discount to 24-Hour Pass if promo targets WHOLE_DAY_PASS", () => {
      const promo = {
        id: "promo-whole-day",
        name: "Weekend 24h Promo",
        rateType: "WHOLE_DAY_PASS" as const,
        workspaceTemplateIds: [templateId],
        promotionalPrice: 500,
        startAt: "2026-09-01T00:00:00.000Z",
        endAt: "2026-09-30T23:59:59.000Z",
        isActive: true,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      };

      const result = resolveEffectivePrice(
        templateId,
        "WHOLE_DAY_PASS",
        wholeDayPassPrice,
        targetDate,
        [promo],
        1
      );
      expect(result.isPromotional).toBe(true);
      expect(result.effectivePrice).toBe(500);
      expect(result.estimatedTotal).toBe(500);
      expect(result.promoName).toBe("Weekend 24h Promo");
    });
  });

  describe("Dynamic Day & Night Hourly Rate Determination", () => {
    const config = {
      rateAmount: 60,
      hasDayPass: true,
      dayPassPrice: 50,
      hasNightPass: true,
      nightPassPrice: 80,
    };

    it("evaluates day vs night window accurately", () => {
      expect(isDayTime("10:00", "07:00", "20:00")).toBe(true);
      expect(isDayTime("19:59", "07:00", "20:00")).toBe(true);
      expect(isDayTime("20:00", "07:00", "20:00")).toBe(false);
      expect(isDayTime("23:00", "07:00", "20:00")).toBe(false);
      expect(isDayTime("05:30", "07:00", "20:00")).toBe(false);
      expect(isDayTime("07:00", "07:00", "20:00")).toBe(true);
    });

    it("resolves Day hourly price when start time is in daytime window", () => {
      const dayRate = resolveTimeBasedHourlyRate(config, "10:00", "07:00", "20:00");
      expect(dayRate.rate).toBe(50);
      expect(dayRate.isNight).toBe(false);
      expect(dayRate.tierLabel).toBe("Day Rate");
      expect(dayRate.hasConfiguredRate).toBe(true);

      const pricing = calculateReservationPrice("HOURLY", config, 3, "10:00", "07:00", "20:00");
      expect(pricing.unitPrice).toBe(50);
      expect(pricing.totalAmount).toBe(150);
    });

    it("resolves Night hourly price when start time is in nighttime window", () => {
      const nightRate = resolveTimeBasedHourlyRate(config, "21:30", "07:00", "20:00");
      expect(nightRate.rate).toBe(80);
      expect(nightRate.isNight).toBe(true);
      expect(nightRate.tierLabel).toBe("Night Rate");
      expect(nightRate.hasConfiguredRate).toBe(true);

      const pricing = calculateReservationPrice("HOURLY", config, 3, "21:30", "07:00", "20:00");
      expect(pricing.unitPrice).toBe(80);
      expect(pricing.totalAmount).toBe(240);
    });

    it("resolves Night hourly price when night start is configured at 10:00 and booking time is 10:30", () => {
      const customShiftConfig = {
        dayPassStartTime: "07:00",
        dayPassEndTime: "23:30",
        nightPassStartTime: "10:00",
        nightPassEndTime: "07:00",
      };
      const res = resolveTimeBasedHourlyRate(config, "10:30", customShiftConfig);
      expect(res.isNight).toBe(true);
      expect(res.rate).toBe(80);
      expect(res.tierLabel).toBe("Night Rate");

      const pricing = calculateReservationPrice("HOURLY", config, 2, "10:30", customShiftConfig);
      expect(pricing.unitPrice).toBe(80);
      expect(pricing.totalAmount).toBe(160);
    });

    it("falls back to base rate when specific day or night rate is not enabled", () => {
      const unconfigured = { rateAmount: 60 };
      const res = resolveTimeBasedHourlyRate(unconfigured, "22:00");
      expect(res.rate).toBe(60);
      expect(res.hasConfiguredRate).toBe(false);
    });
  });
});
