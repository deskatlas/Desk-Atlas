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

describe("MF-116: Admin Settings Custom Numeric Booking Slot Interval Input", () => {
  describe("UI Helper: canSaveBusinessProfile", () => {
    it("rejects when bookingIntervalMinutes is <= 5", () => {
      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: 5,
        })
      ).toEqual({
        canSave: false,
        reason: "Booking slot interval must be greater than 5 minutes",
      });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: 0,
        })
      ).toEqual({
        canSave: false,
        reason: "Booking slot interval must be greater than 5 minutes",
      });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: -15,
        })
      ).toEqual({
        canSave: false,
        reason: "Booking slot interval must be greater than 5 minutes",
      });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: "5",
        })
      ).toEqual({
        canSave: false,
        reason: "Booking slot interval must be greater than 5 minutes",
      });
    });

    it("allows saving when bookingIntervalMinutes is strictly greater than 5", () => {
      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: 6,
        })
      ).toEqual({
        canSave: true,
      });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: 10,
        })
      ).toEqual({
        canSave: true,
      });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: 20,
        })
      ).toEqual({
        canSave: true,
      });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: 45,
        })
      ).toEqual({
        canSave: true,
      });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: "60",
        })
      ).toEqual({
        canSave: true,
      });
    });

    it("preserves compatibility when bookingIntervalMinutes is undefined or omitted", () => {
      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
        })
      ).toEqual({
        canSave: true,
      });
    });
  });

  describe("Domain Layer: settingsService.updateBusinessSettings", () => {
    let settingsRepo: InMemorySettingsRepository;
    let service: ReturnType<typeof createAdminSettingsService>;

    beforeEach(() => {
      settingsRepo = new InMemorySettingsRepository();
      service = createAdminSettingsService(settingsRepo);
    });

    it("rejects booking interval values <= 5 or invalid integers with SettingsValidationError", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas HQ",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: 5,
          paymentExpiryMinutes: 60,
        })
      ).rejects.toThrow("Booking slot interval must be greater than 5 minutes");

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas HQ",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: 0,
          paymentExpiryMinutes: 60,
        })
      ).rejects.toThrow("Booking slot interval must be greater than 5 minutes");

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas HQ",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: -10,
          paymentExpiryMinutes: 60,
        })
      ).rejects.toThrow("Booking slot interval must be greater than 5 minutes");

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas HQ",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: 10.5,
          paymentExpiryMinutes: 60,
        })
      ).rejects.toThrow("Booking slot interval must be greater than 5 minutes");
    });

    it("successfully updates custom booking intervals greater than 5 minutes", async () => {
      for (const interval of [6, 10, 15, 20, 30, 45, 60, 120]) {
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
  });

  describe("Availability Service: Custom slot interval generation", () => {
    it("generates slots stepped by custom intervals within operating hours", async () => {
      const repo = new InMemoryAvailabilityRepository();
      repo.setBusinessSettings({
        businessName: "DeskAtlas Test",
        timezone: "Asia/Manila",
        bookingIntervalMinutes: 20, // 20 minute interval
      });
      repo.seedWorkspaceInstance({
        id: "workspace-a1",
        templateId: "template-desk",
        floorId: "floor-a",
        instanceCode: "A1",
        displayName: "Desk A1",
        operationalStatus: "ACTIVE",
      });
      repo.seedOperatingHours(4, [{ opensAt: "08:00:00", closesAt: "10:00:00" }]); // 2099-08-27 is a Thursday (day 4)

      const availability = createAvailabilityService(repo);
      const res = await availability.listTimeAvailability({
        workspaceInstanceId: "workspace-a1",
        date: "2099-08-27",
        durationMinutes: 60,
        nowIso: "2099-08-26T00:00:00.000Z",
      });

      // From 08:00 to 10:00 (120 mins) with 60m duration and 20m interval:
      // Valid start times: 08:00 (ends 09:00), 08:20 (ends 09:20), 08:40 (ends 09:40), 09:00 (ends 10:00)
      const startTimes = res.slots.map((s) => s.startTime);
      expect(startTimes).toContain("08:00");
      expect(startTimes).toContain("08:20");
      expect(startTimes).toContain("08:40");
      expect(startTimes).toContain("09:00");
      expect(startTimes).not.toContain("09:20"); // 09:20 + 60m = 10:20 > 10:00 closesAt
    });
  });
});
