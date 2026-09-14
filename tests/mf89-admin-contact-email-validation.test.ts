import { describe, it, expect, beforeEach } from "vitest";
import {
  isValidEmail,
  validateContactEmail,
  canSaveBusinessProfile,
} from "../apps/admin-portal/src/features/settings/components/Settings";
import {
  createAdminSettingsService,
  SettingsValidationError,
  InMemorySettingsRepository,
} from "@deskatlas/domain";

describe("MF-89: Admin Settings Contact Email & Phone Validation", () => {
  describe("UI Helpers: isValidEmail & validateContactEmail", () => {
    it("rejects null, undefined, empty string, and whitespace-only string", () => {
      expect(isValidEmail(null)).toBe(false);
      expect(isValidEmail(undefined)).toBe(false);
      expect(isValidEmail("")).toBe(false);
      expect(isValidEmail("   ")).toBe(false);

      expect(validateContactEmail(null)).toEqual({
        isValid: false,
        error: "Contact email is required.",
      });
      expect(validateContactEmail(undefined)).toEqual({
        isValid: false,
        error: "Contact email is required.",
      });
      expect(validateContactEmail("")).toEqual({
        isValid: false,
        error: "Contact email is required.",
      });
      expect(validateContactEmail("   ")).toEqual({
        isValid: false,
        error: "Contact email is required.",
      });
    });

    it("rejects malformed email addresses", () => {
      const invalidEmails = [
        "not-an-email",
        "missingatsign.com",
        "@missingusername.com",
        "username@.com",
        "username@domain",
        "user name@domain.com",
        "admin@",
      ];

      for (const email of invalidEmails) {
        expect(isValidEmail(email)).toBe(false);
        expect(validateContactEmail(email)).toEqual({
          isValid: false,
          error: "Please enter a valid contact email address.",
        });
      }
    });

    it("accepts valid email addresses", () => {
      const validEmails = [
        "admin@deskatlas.ph",
        "contact@example.com",
        "support@domain.org",
        "first.last+tag@sub.example.com",
        "info@coworking.co",
      ];

      for (const email of validEmails) {
        expect(isValidEmail(email)).toBe(true);
        expect(validateContactEmail(email)).toEqual({
          isValid: true,
        });
      }
    });

    it("trims whitespace when validating", () => {
      expect(isValidEmail("  admin@deskatlas.com  ")).toBe(true);
      expect(validateContactEmail("  admin@deskatlas.com  ")).toEqual({
        isValid: true,
      });
    });
  });

  describe("UI Helper: canSaveBusinessProfile", () => {
    it("rejects when business name is missing or whitespace", () => {
      expect(
        canSaveBusinessProfile({
          businessName: "",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
        })
      ).toEqual({
        canSave: false,
        reason: "Business name is required",
      });

      expect(
        canSaveBusinessProfile({
          businessName: "   ",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
        })
      ).toEqual({
        canSave: false,
        reason: "Business name is required",
      });

      expect(
        canSaveBusinessProfile({
          businessName: null,
          contactEmail: "admin@deskatlas.ph",
        })
      ).toEqual({
        canSave: false,
        reason: "Business name is required",
      });
    });

    it("rejects when BOTH contact email and contact number are empty", () => {
      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "",
          phoneDigits: "",
        })
      ).toEqual({
        canSave: false,
        reason: "At least one contact method (email or contact number) is required",
      });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: null,
          phoneDigits: "",
        })
      ).toEqual({
        canSave: false,
        reason: "At least one contact method (email or contact number) is required",
      });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "   ",
          contactPhone: null,
        })
      ).toEqual({
        canSave: false,
        reason: "At least one contact method (email or contact number) is required",
      });
    });

    it("rejects when contact email is filled but has invalid format", () => {
      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "invalid-email",
          phoneDigits: "9171234567",
        })
      ).toEqual({
        canSave: false,
        reason: "Please enter a valid contact email address",
      });
    });

    it("rejects when contact number is filled but is not 10 digits", () => {
      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "91712",
        })
      ).toEqual({
        canSave: false,
        reason: "Contact number must be exactly 10 digits (e.g., 9171234567)",
      });
    });

    it("allows saving when ONLY contact email is provided and valid", () => {
      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "",
        })
      ).toEqual({
        canSave: true,
      });
    });

    it("allows saving when ONLY contact number is provided and 10 digits", () => {
      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas Manila",
          contactEmail: "",
          phoneDigits: "9171234567",
        })
      ).toEqual({
        canSave: true,
      });
    });

    it("allows saving when BOTH contact email and contact number are valid", () => {
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

    it("throws SettingsValidationError when both contact email and phone are empty/null", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas HQ",
          timezone: "Asia/Manila",
          contactEmail: "",
          contactPhone: "",
          bookingIntervalMinutes: 60,
          paymentExpiryMinutes: 60,
        })
      ).rejects.toThrow("At least one contact method (email or contact number) is required");

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas HQ",
          timezone: "Asia/Manila",
          contactEmail: null,
          contactPhone: null,
          bookingIntervalMinutes: 60,
          paymentExpiryMinutes: 60,
        })
      ).rejects.toThrow("At least one contact method (email or contact number) is required");
    });

    it("throws SettingsValidationError when contactEmail has an invalid email format", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas HQ",
          timezone: "Asia/Manila",
          contactEmail: "invalid-email-format",
          contactPhone: "+639171234567",
          bookingIntervalMinutes: 60,
          paymentExpiryMinutes: 60,
        })
      ).rejects.toThrow("Invalid contact email format");
    });

    it("successfully saves when ONLY contactEmail is provided", async () => {
      const updated = await service.updateBusinessSettings({
        businessName: "DeskAtlas Manila HQ",
        timezone: "Asia/Manila",
        contactEmail: "hello@deskatlas.ph",
        contactPhone: null,
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
      });

      expect(updated.contactEmail).toBe("hello@deskatlas.ph");
      expect(updated.contactPhone).toBeNull();
      expect(updated.businessName).toBe("DeskAtlas Manila HQ");
    });

    it("successfully saves when ONLY contactPhone is provided", async () => {
      const updated = await service.updateBusinessSettings({
        businessName: "DeskAtlas Manila HQ",
        timezone: "Asia/Manila",
        contactEmail: null,
        contactPhone: "+639171234567",
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
      });

      expect(updated.contactEmail).toBeNull();
      expect(updated.contactPhone).toBe("+639171234567");
      expect(updated.businessName).toBe("DeskAtlas Manila HQ");
    });

    it("successfully saves when BOTH contactEmail and contactPhone are valid", async () => {
      const updated = await service.updateBusinessSettings({
        businessName: "DeskAtlas Manila HQ",
        timezone: "Asia/Manila",
        contactEmail: "hello@deskatlas.ph",
        contactPhone: "+639171234567",
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
      });

      expect(updated.contactEmail).toBe("hello@deskatlas.ph");
      expect(updated.contactPhone).toBe("+639171234567");
      expect(updated.businessName).toBe("DeskAtlas Manila HQ");
    });

    it("preserves compatibility when contact fields are omitted (undefined)", async () => {
      const updated = await service.updateBusinessSettings({
        businessName: "DeskAtlas Manila HQ",
        timezone: "Asia/Manila",
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
      });

      expect(updated.businessName).toBe("DeskAtlas Manila HQ");
    });
  });
});
