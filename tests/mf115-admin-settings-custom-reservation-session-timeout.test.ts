import { describe, it, expect, beforeEach } from "vitest";
import {
  getCustomerSessionTimeoutSeconds,
  getOrCreateSessionExpiry,
  CUSTOMER_RESERVATION_SESSION_TIMEOUT_SECONDS,
  CUSTOMER_RESERVATION_SESSION_STORAGE_KEY,
  createAdminSettingsService,
  SettingsValidationError,
  InMemorySettingsRepository,
} from "@deskatlas/domain";

describe("MF-115: Admin Settings Configurable Customer Reservation Session Reset Timer", () => {
  describe("Domain Helper: getCustomerSessionTimeoutSeconds", () => {
    it("returns 1200s (20 mins default) when minutes parameter is undefined, null, or invalid", () => {
      expect(getCustomerSessionTimeoutSeconds()).toBe(1200);
      expect(getCustomerSessionTimeoutSeconds(undefined)).toBe(1200);
      expect(getCustomerSessionTimeoutSeconds(null)).toBe(1200);
      expect(getCustomerSessionTimeoutSeconds(NaN)).toBe(1200);
      expect(getCustomerSessionTimeoutSeconds(0)).toBe(1200);
      expect(getCustomerSessionTimeoutSeconds(-5)).toBe(1200);
    });

    it("converts configured minutes to seconds accurately", () => {
      expect(getCustomerSessionTimeoutSeconds(1)).toBe(60);
      expect(getCustomerSessionTimeoutSeconds(10)).toBe(600);
      expect(getCustomerSessionTimeoutSeconds(15)).toBe(900);
      expect(getCustomerSessionTimeoutSeconds(20)).toBe(1200);
      expect(getCustomerSessionTimeoutSeconds(30)).toBe(1800);
      expect(getCustomerSessionTimeoutSeconds(45)).toBe(2700);
      expect(getCustomerSessionTimeoutSeconds(60)).toBe(3600);
      expect(getCustomerSessionTimeoutSeconds(120)).toBe(7200);
      expect(getCustomerSessionTimeoutSeconds(180)).toBe(10800);
    });
  });

  describe("getOrCreateSessionExpiry with custom timeout duration", () => {
    it("initializes a fresh expiry matching the custom configured timeout duration", () => {
      const mockStorageMap = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => mockStorageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mockStorageMap.set(k, v);
        },
      };

      const now = 1000000;
      const customTimeoutSeconds = 900; // 15 minutes
      const expiry = getOrCreateSessionExpiry(mockStorage, now, customTimeoutSeconds);

      expect(expiry).toBe(now + 900 * 1000);
      expect(mockStorageMap.get(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY)).toBe(String(expiry));
    });

    it("maintains compatibility with default 20-minute timeout when custom duration is not supplied", () => {
      const mockStorageMap = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => mockStorageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mockStorageMap.set(k, v);
        },
      };

      const now = 2000000;
      const expiry = getOrCreateSessionExpiry(mockStorage, now);

      expect(expiry).toBe(now + CUSTOMER_RESERVATION_SESSION_TIMEOUT_SECONDS * 1000);
    });
  });

  describe("Settings Service: customerSessionTimeoutMinutes Validation & Persistence", () => {
    let settingsRepo: InMemorySettingsRepository;
    let service: ReturnType<typeof createAdminSettingsService>;

    beforeEach(() => {
      settingsRepo = new InMemorySettingsRepository();
      service = createAdminSettingsService(settingsRepo);
    });

    it("defaults customerSessionTimeoutMinutes to 20 on initial retrieval", async () => {
      const overview = await service.getSettingsOverview();
      expect(overview.businessSettings.customerSessionTimeoutMinutes).toBe(20);

      const publicSettings = await service.getPublicBusinessSettings();
      expect(publicSettings.customerSessionTimeoutMinutes).toBe(20);
    });

    it("successfully updates customerSessionTimeoutMinutes within valid boundaries (1 to 180 minutes)", async () => {
      const validDurations = [1, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180];

      for (const minutes of validDurations) {
        const updated = await service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          contactPhone: "+639171234567",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          customerSessionTimeoutMinutes: minutes,
        });

        expect(updated.customerSessionTimeoutMinutes).toBe(minutes);

        const overview = await service.getSettingsOverview();
        expect(overview.businessSettings.customerSessionTimeoutMinutes).toBe(minutes);

        const publicSettings = await service.getPublicBusinessSettings();
        expect(publicSettings.customerSessionTimeoutMinutes).toBe(minutes);
      }
    });

    it("rejects non-positive numbers (0 or negative minutes)", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          customerSessionTimeoutMinutes: 0,
        })
      ).rejects.toThrow(SettingsValidationError);

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          customerSessionTimeoutMinutes: -10,
        })
      ).rejects.toThrow("Customer reservation session timeout must be an integer between 1 and 180 minutes");
    });

    it("rejects timeout values exceeding 180 minutes (3 hours)", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          customerSessionTimeoutMinutes: 181,
        })
      ).rejects.toThrow("Customer reservation session timeout must be an integer between 1 and 180 minutes");

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          customerSessionTimeoutMinutes: 300,
        })
      ).rejects.toThrow("Customer reservation session timeout must be an integer between 1 and 180 minutes");
    });

    it("rejects non-integer fractional numbers", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas Manila",
          timezone: "Asia/Manila",
          contactEmail: "admin@deskatlas.ph",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          customerSessionTimeoutMinutes: 15.5,
        })
      ).rejects.toThrow("Customer reservation session timeout must be an integer between 1 and 180 minutes");
    });

    it("defaults to 20 when customerSessionTimeoutMinutes is undefined in update payload", async () => {
      const updated = await service.updateBusinessSettings({
        businessName: "DeskAtlas Manila",
        timezone: "Asia/Manila",
        contactEmail: "admin@deskatlas.ph",
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
      });

      expect(updated.customerSessionTimeoutMinutes).toBe(20);
    });
  });
});
