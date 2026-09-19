import { describe, it, expect, beforeEach } from "vitest";
import {
  canSaveBusinessProfile,
} from "../apps/admin-portal/src/features/settings/components/Settings";
import {
  getKioskAllowanceMinutes,
  createAdminSettingsService,
  SettingsValidationError,
  InMemorySettingsRepository,
} from "@deskatlas/domain";

describe("MF-147: Admin Configurable Kiosk Booking Allowance in Settings", () => {
  describe("Domain Helper: getKioskAllowanceMinutes", () => {
    it("returns 5 minutes default when configured value is undefined, null, NaN, or out-of-bounds", () => {
      expect(getKioskAllowanceMinutes()).toBe(5);
      expect(getKioskAllowanceMinutes(undefined)).toBe(5);
      expect(getKioskAllowanceMinutes(null)).toBe(5);
      expect(getKioskAllowanceMinutes(NaN)).toBe(5);
      expect(getKioskAllowanceMinutes(-1)).toBe(5);
      expect(getKioskAllowanceMinutes(-10)).toBe(5);
      expect(getKioskAllowanceMinutes(61)).toBe(5);
      expect(getKioskAllowanceMinutes(120)).toBe(5);
      expect(getKioskAllowanceMinutes(5.5)).toBe(5);
    });

    it("returns exact configured minutes for valid integers between 0 and 60", () => {
      expect(getKioskAllowanceMinutes(0)).toBe(0);
      expect(getKioskAllowanceMinutes(1)).toBe(1);
      expect(getKioskAllowanceMinutes(5)).toBe(5);
      expect(getKioskAllowanceMinutes(10)).toBe(10);
      expect(getKioskAllowanceMinutes(15)).toBe(15);
      expect(getKioskAllowanceMinutes(30)).toBe(30);
      expect(getKioskAllowanceMinutes(45)).toBe(45);
      expect(getKioskAllowanceMinutes(60)).toBe(60);
    });
  });

  describe("UI Validation: canSaveBusinessProfile", () => {
    const validBase = {
      businessName: "DeskAtlas Manila",
      contactEmail: "admin@deskatlas.ph",
      phoneDigits: "9171234567",
      bookingIntervalMinutes: 30,
    };

    it("allows saving with valid kiosk allowance (0 to 60 minutes)", () => {
      expect(canSaveBusinessProfile({ ...validBase, kioskAllowanceMinutes: 0 })).toEqual({
        canSave: true,
      });
      expect(canSaveBusinessProfile({ ...validBase, kioskAllowanceMinutes: 5 })).toEqual({
        canSave: true,
      });
      expect(canSaveBusinessProfile({ ...validBase, kioskAllowanceMinutes: 15 })).toEqual({
        canSave: true,
      });
      expect(canSaveBusinessProfile({ ...validBase, kioskAllowanceMinutes: 60 })).toEqual({
        canSave: true,
      });
    });

    it("rejects saving when kiosk allowance is negative or exceeds 60 minutes", () => {
      expect(canSaveBusinessProfile({ ...validBase, kioskAllowanceMinutes: -1 })).toEqual({
        canSave: false,
        reason: "Kiosk booking allowance must be between 0 and 60 minutes",
      });
      expect(canSaveBusinessProfile({ ...validBase, kioskAllowanceMinutes: 61 })).toEqual({
        canSave: false,
        reason: "Kiosk booking allowance must be between 0 and 60 minutes",
      });
      expect(canSaveBusinessProfile({ ...validBase, kioskAllowanceMinutes: "abc" })).toEqual({
        canSave: false,
        reason: "Kiosk booking allowance must be between 0 and 60 minutes",
      });
    });
  });

  describe("Settings Service: kioskAllowanceMinutes Persistence & Validation", () => {
    let repo: InMemorySettingsRepository;
    let service: ReturnType<typeof createAdminSettingsService>;

    beforeEach(() => {
      repo = new InMemorySettingsRepository();
      service = createAdminSettingsService(repo);
    });

    it("defaults kioskAllowanceMinutes to 5 on initial retrieval", async () => {
      const overview = await service.getSettingsOverview();
      expect(overview.businessSettings.kioskAllowanceMinutes).toBe(5);

      const publicSettings = await service.getPublicBusinessSettings();
      expect(publicSettings.kioskAllowanceMinutes).toBe(5);
    });

    it("successfully updates kioskAllowanceMinutes within valid boundaries (0 to 60 minutes)", async () => {
      const validCases = [0, 1, 5, 10, 15, 30, 45, 60];

      for (const minutes of validCases) {
        const updated = await service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          kioskAllowanceMinutes: minutes,
        });

        expect(updated.kioskAllowanceMinutes).toBe(minutes);

        const overview = await service.getSettingsOverview();
        expect(overview.businessSettings.kioskAllowanceMinutes).toBe(minutes);

        const publicSettings = await service.getPublicBusinessSettings();
        expect(publicSettings.kioskAllowanceMinutes).toBe(minutes);
      }
    });

    it("rejects negative kioskAllowanceMinutes with SettingsValidationError", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          kioskAllowanceMinutes: -1,
        })
      ).rejects.toThrow(SettingsValidationError);

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          kioskAllowanceMinutes: -10,
        })
      ).rejects.toThrow("Kiosk booking allowance must be an integer between 0 and 60 minutes");
    });

    it("rejects kioskAllowanceMinutes greater than 60 with SettingsValidationError", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          kioskAllowanceMinutes: 61,
        })
      ).rejects.toThrow(SettingsValidationError);

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          kioskAllowanceMinutes: 100,
        })
      ).rejects.toThrow("Kiosk booking allowance must be an integer between 0 and 60 minutes");
    });

    it("rejects non-integer kioskAllowanceMinutes with SettingsValidationError", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          kioskAllowanceMinutes: 7.5,
        })
      ).rejects.toThrow(SettingsValidationError);
    });

    it("defaults to 5 when kioskAllowanceMinutes is undefined in update payload", async () => {
      const updated = await service.updateBusinessSettings({
        businessName: "DeskAtlas Manila",
        timezone: "Asia/Manila",
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
      });

      expect(updated.kioskAllowanceMinutes).toBe(5);
    });
  });

  describe("Kiosk Booking Time Calculation with Dynamic Allowance", () => {
    it("calculates walk-in start time matching configured allowance exactly", () => {
      const baseNowMs = 1726740000000; // Fixed timestamp

      const allowance0Ms = getKioskAllowanceMinutes(0) * 60 * 1000;
      const start0 = new Date(baseNowMs + allowance0Ms);
      expect(start0.getTime()).toBe(baseNowMs);

      const allowance10Ms = getKioskAllowanceMinutes(10) * 60 * 1000;
      const start10 = new Date(baseNowMs + allowance10Ms);
      expect(start10.getTime()).toBe(baseNowMs + 10 * 60 * 1000);

      const allowance15Ms = getKioskAllowanceMinutes(15) * 60 * 1000;
      const start15 = new Date(baseNowMs + allowance15Ms);
      expect(start15.getTime()).toBe(baseNowMs + 15 * 60 * 1000);
    });
  });
});
