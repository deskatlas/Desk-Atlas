import { describe, it, expect, beforeEach } from "vitest";
import {
  canSaveBusinessProfile,
} from "../apps/admin-portal/src/features/settings/components/Settings";
import {
  createAdminSettingsService,
  SettingsValidationError,
  InMemorySettingsRepository,
  createAvailabilityService,
  InMemoryAvailabilityRepository,
} from "@deskatlas/domain";

describe("MF-148: Remove Booking Slot Interval Minimum 5-Minute Rule", () => {
  describe("canSaveBusinessProfile UI helper", () => {
    it("accepts bookingIntervalMinutes of 1, 2, 3, 4, 5 minutes", () => {
      for (const interval of [1, 2, 3, 4, 5]) {
        const result = canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: interval,
        });
        expect(result).toEqual({ canSave: true });
      }
    });

    it("rejects bookingIntervalMinutes of 0 or negative numbers", () => {
      for (const interval of [0, -1, -5, -10]) {
        const result = canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: interval,
        });
        expect(result.canSave).toBe(false);
        expect(result.reason).toBe("Booking slot interval must be a positive integer in minutes");
      }
    });

    it("accepts bookingIntervalMinutes for larger intervals (6-240 minutes)", () => {
      for (const interval of [6, 10, 15, 20, 30, 45, 60, 120, 240]) {
        const result = canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: interval,
        });
        expect(result).toEqual({ canSave: true });
      }
    });
  });

  describe("Domain Layer: settingsService.updateBusinessSettings", () => {
    let settingsRepo: InMemorySettingsRepository;
    let service: ReturnType<typeof createAdminSettingsService>;

    beforeEach(() => {
      settingsRepo = new InMemorySettingsRepository();
      service = createAdminSettingsService(settingsRepo);
    });

    it("successfully accepts and persists intervals from 1 to 5 minutes", async () => {
      for (const interval of [1, 2, 3, 4, 5]) {
        const updated = await service.updateBusinessSettings({
          businessName: "DeskAtlas Manila HQ",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: interval,
          paymentExpiryMinutes: 60,
        });

        expect(updated.bookingIntervalMinutes).toBe(interval);
      }
    });

    it("rejects 0, negative values, and non-integers with SettingsValidationError", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas HQ",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: 0,
          paymentExpiryMinutes: 60,
        })
      ).rejects.toThrow("Booking slot interval must be a positive integer in minutes");

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas HQ",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: -5,
          paymentExpiryMinutes: 60,
        })
      ).rejects.toThrow("Booking slot interval must be a positive integer in minutes");

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas HQ",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: 2.5,
          paymentExpiryMinutes: 60,
        })
      ).rejects.toThrow("Booking slot interval must be a positive integer in minutes");
    });
  });

  describe("Availability Service: Sub-5-minute slot generation", () => {
    it("generates slots stepped by sub-5-minute intervals (e.g., 2-minute step)", async () => {
      const repo = new InMemoryAvailabilityRepository();
      repo.setBusinessSettings({
        businessName: "DeskAtlas Test",
        timezone: "Asia/Manila",
        bookingIntervalMinutes: 2, // 2-minute interval
      });
      repo.seedWorkspaceInstance({
        id: "workspace-a1",
        templateId: "template-desk",
        floorId: "floor-a",
        instanceCode: "A1",
        displayName: "Desk A1",
        operationalStatus: "ACTIVE",
      });
      repo.seedOperatingHours(4, [{ opensAt: "08:00:00", closesAt: "08:10:00" }]); // 10 minutes total

      const availability = createAvailabilityService(repo);
      const res = await availability.listTimeAvailability({
        workspaceInstanceId: "workspace-a1",
        date: "2099-08-27",
        durationMinutes: 4,
        nowIso: "2099-08-26T00:00:00.000Z",
      });

      // From 08:00 to 08:10 (10 mins) with 4m duration and 2m interval:
      // Valid start times: 08:00 (ends 08:04), 08:02 (ends 08:06), 08:04 (ends 08:08), 08:06 (ends 08:10)
      const startTimes = res.slots.map((s) => s.startTime);
      expect(startTimes).toEqual(["08:00", "08:02", "08:04", "08:06"]);
    });

    it("generates 1-minute step slots correctly", async () => {
      const repo = new InMemoryAvailabilityRepository();
      repo.setBusinessSettings({
        businessName: "DeskAtlas Test",
        timezone: "Asia/Manila",
        bookingIntervalMinutes: 1, // 1-minute interval
      });
      repo.seedWorkspaceInstance({
        id: "workspace-a1",
        templateId: "template-desk",
        floorId: "floor-a",
        instanceCode: "A1",
        displayName: "Desk A1",
        operationalStatus: "ACTIVE",
      });
      repo.seedOperatingHours(4, [{ opensAt: "09:00:00", closesAt: "09:05:00" }]);

      const availability = createAvailabilityService(repo);
      const res = await availability.listTimeAvailability({
        workspaceInstanceId: "workspace-a1",
        date: "2099-08-27",
        durationMinutes: 2,
        nowIso: "2099-08-26T00:00:00.000Z",
      });

      // From 09:00 to 09:05 (5 mins) with 2m duration and 1m interval:
      // Valid start times: 09:00, 09:01, 09:02, 09:03
      const startTimes = res.slots.map((s) => s.startTime);
      expect(startTimes).toEqual(["09:00", "09:01", "09:02", "09:03"]);
    });
  });
});
