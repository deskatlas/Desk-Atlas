import { describe, it, expect } from "vitest";
import {
  createAdminSettingsService,
  InMemorySettingsRepository,
  SettingsValidationError,
  getTodayDateInTimezone,
  isDateInPast,
} from "@deskatlas/domain";
import {
  getTodayDateString,
  isPastDate as isUIPastDate,
} from "../apps/admin-portal/src/features/settings/components/Settings";

describe("MF-98: Disallow Setting Closures and Holidays for Past Dates", () => {
  describe("Date Utility Helpers", () => {
    it("getTodayDateInTimezone returns valid YYYY-MM-DD date string", () => {
      const todayManila = getTodayDateInTimezone("Asia/Manila");
      expect(todayManila).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const todayUtc = getTodayDateInTimezone("UTC");
      expect(todayUtc).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("isDateInPast correctly identifies past dates", () => {
      const timezone = "Asia/Manila";
      const today = getTodayDateInTimezone(timezone);

      // Deep past
      expect(isDateInPast("2020-01-01", timezone)).toBe(true);
      expect(isDateInPast("2024-12-31", timezone)).toBe(true);

      // Tomorrow and future
      expect(isDateInPast("2099-01-01", timezone)).toBe(false);
      expect(isDateInPast("2099-12-25", timezone)).toBe(false);

      // Today is NOT in the past (allowed for emergency closures / today's events)
      expect(isDateInPast(today, timezone)).toBe(false);
    });

    it("UI helpers getTodayDateString and isUIPastDate match domain behavior", () => {
      const timezone = "Asia/Manila";
      const uiToday = getTodayDateString(timezone);
      expect(uiToday).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      expect(isUIPastDate("2020-01-01", timezone)).toBe(true);
      expect(isUIPastDate("2099-12-25", timezone)).toBe(false);
      expect(isUIPastDate(uiToday, timezone)).toBe(false);
      expect(isUIPastDate("", timezone)).toBe(false);
    });
  });

  describe("Domain SettingsService.createClosure Validation", () => {
    function setupService(timezone = "Asia/Manila") {
      const repo = new InMemorySettingsRepository();
      if (timezone !== "Asia/Manila") {
        repo.updateBusinessSettings({ timezone });
      }
      return { repo, service: createAdminSettingsService(repo), timezone };
    }

    it("strictly rejects full-day closure on past dates", async () => {
      const { service } = setupService();

      await expect(
        service.createClosure({
          date: "2020-05-10",
          closureType: "FULL_DAY",
          reason: "Past holiday attempt",
        })
      ).rejects.toThrow(SettingsValidationError);

      await expect(
        service.createClosure({
          date: "2020-05-10",
          closureType: "FULL_DAY",
          reason: "Past holiday attempt",
        })
      ).rejects.toThrow(/cannot be set for past dates/i);
    });

    it("strictly rejects special hours on past dates", async () => {
      const { service } = setupService();

      await expect(
        service.createClosure({
          date: "2021-08-15",
          closureType: "SPECIAL_HOURS",
          opensAt: "10:00",
          closesAt: "14:00",
          reason: "Past special hours attempt",
        })
      ).rejects.toThrow(SettingsValidationError);

      await expect(
        service.createClosure({
          date: "2021-08-15",
          closureType: "SPECIAL_HOURS",
          opensAt: "10:00",
          closesAt: "14:00",
        })
      ).rejects.toThrow(/cannot be set for past dates/i);
    });

    it("strictly rejects multi-day closures where start date is in the past", async () => {
      const { service, timezone } = setupService();
      const today = getTodayDateInTimezone(timezone);

      await expect(
        service.createClosure({
          date: "2020-01-01",
          endDate: today,
          closureType: "FULL_DAY",
          reason: "Spans from past to today",
        })
      ).rejects.toThrow(SettingsValidationError);
    });

    it("strictly rejects multi-day closures where end date is in the past", async () => {
      const { service } = setupService();

      await expect(
        service.createClosure({
          date: "2019-01-01",
          endDate: "2019-01-05",
          closureType: "FULL_DAY",
          reason: "Entirely in the past",
        })
      ).rejects.toThrow(SettingsValidationError);
    });

    it("allows creating a full-day closure for today", async () => {
      const { service, timezone } = setupService();
      const today = getTodayDateInTimezone(timezone);

      const closure = await service.createClosure({
        date: today,
        closureType: "FULL_DAY",
        reason: "Emergency today closure",
      });

      expect(closure.date).toBe(today);
      expect(closure.closureType).toBe("FULL_DAY");
      expect(closure.reason).toBe("Emergency today closure");

      const list = await service.listClosures();
      expect(list.length).toBe(1);
      expect(list[0].date).toBe(today);
    });

    it("allows creating special opening hours for today", async () => {
      const { service, timezone } = setupService();
      const today = getTodayDateInTimezone(timezone);

      const closure = await service.createClosure({
        date: today,
        closureType: "SPECIAL_HOURS",
        opensAt: "09:00",
        closesAt: "15:00",
        reason: "Half day today",
      });

      expect(closure.date).toBe(today);
      expect(closure.closureType).toBe("SPECIAL_HOURS");
      expect(closure.opensAt).toBe("09:00");
      expect(closure.closesAt).toBe("15:00");
    });

    it("allows creating closures for future dates and multi-day ranges", async () => {
      const { service } = setupService();

      const closure = await service.createClosure({
        date: "2099-12-24",
        endDate: "2099-12-26",
        closureType: "FULL_DAY",
        reason: "Christmas Holiday 2099",
      });

      expect(closure.date).toBe("2099-12-24");
      expect(closure.endDate).toBe("2099-12-26");

      const list = await service.listClosures();
      expect(list.length).toBe(1);
      expect(list[0].reason).toBe("Christmas Holiday 2099");
    });
  });
});
