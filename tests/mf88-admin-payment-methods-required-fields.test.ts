import { describe, it, expect, beforeEach } from "vitest";
import { validatePaymentMethodRequiredFields } from "../apps/admin-portal/src/features/settings/components/Settings";
import {
  createAdminSettingsService,
  SettingsValidationError,
  InMemorySettingsRepository,
} from "@deskatlas/domain";

describe("MF-88: Admin Payment Methods Required Fields Validation", () => {
  describe("validatePaymentMethodRequiredFields — UI Helper Validation", () => {
    it("returns invalid with error when accountName is missing or empty for non-cash methods", () => {
      expect(
        validatePaymentMethodRequiredFields({
          accountName: "",
          accountNumber: "09171234567",
          methodType: "GCASH",
        })
      ).toEqual({
        isValid: false,
        error: "Account/Receiver name is required",
      });

      expect(
        validatePaymentMethodRequiredFields({
          accountName: "   ",
          accountNumber: "09171234567",
          methodType: "BANK",
        })
      ).toEqual({
        isValid: false,
        error: "Account/Receiver name is required",
      });

      expect(
        validatePaymentMethodRequiredFields({
          accountName: null,
          accountNumber: "09171234567",
        })
      ).toEqual({
        isValid: false,
        error: "Account/Receiver name is required",
      });

      expect(
        validatePaymentMethodRequiredFields({
          accountName: undefined,
          accountNumber: "09171234567",
        })
      ).toEqual({
        isValid: false,
        error: "Account/Receiver name is required",
      });
    });

    it("returns invalid with error when accountNumber is missing or empty for non-cash methods", () => {
      expect(
        validatePaymentMethodRequiredFields({
          accountName: "DeskAtlas Manila Inc.",
          accountNumber: "",
          methodType: "GCASH",
        })
      ).toEqual({
        isValid: false,
        error: "Account/Mobile number is required",
      });

      expect(
        validatePaymentMethodRequiredFields({
          accountName: "DeskAtlas Manila Inc.",
          accountNumber: "   ",
          methodType: "BANK",
        })
      ).toEqual({
        isValid: false,
        error: "Account/Mobile number is required",
      });

      expect(
        validatePaymentMethodRequiredFields({
          accountName: "DeskAtlas Manila Inc.",
          accountNumber: null,
        })
      ).toEqual({
        isValid: false,
        error: "Account/Mobile number is required",
      });

      expect(
        validatePaymentMethodRequiredFields({
          accountName: "DeskAtlas Manila Inc.",
          accountNumber: undefined,
        })
      ).toEqual({
        isValid: false,
        error: "Account/Mobile number is required",
      });
    });

    it("prioritizes accountName error when both fields are missing", () => {
      expect(
        validatePaymentMethodRequiredFields({
          accountName: "",
          accountNumber: "",
          methodType: "GCASH",
        })
      ).toEqual({
        isValid: false,
        error: "Account/Receiver name is required",
      });
    });

    it("returns valid when both accountName and accountNumber are present", () => {
      expect(
        validatePaymentMethodRequiredFields({
          accountName: "DeskAtlas Manila Inc.",
          accountNumber: "09171234567",
          methodType: "GCASH",
        })
      ).toEqual({
        isValid: true,
      });

      expect(
        validatePaymentMethodRequiredFields({
          accountName: "DeskAtlas Manila Inc.",
          accountNumber: "1234-5678-9012",
          methodType: "BANK",
        })
      ).toEqual({
        isValid: true,
      });
    });

    it("exempts CASH payment methods from requiring accountName and accountNumber", () => {
      expect(
        validatePaymentMethodRequiredFields({
          accountName: "",
          accountNumber: "",
          methodType: "CASH",
        })
      ).toEqual({
        isValid: true,
      });

      expect(
        validatePaymentMethodRequiredFields({
          accountName: null,
          accountNumber: null,
          methodType: "CASH",
        })
      ).toEqual({
        isValid: true,
      });
    });
  });

  describe("SettingsService — Domain Enforcement of Required Fields", () => {
    let service: ReturnType<typeof createAdminSettingsService>;
    let repo: InMemorySettingsRepository;

    beforeEach(() => {
      repo = new InMemorySettingsRepository();
      service = createAdminSettingsService(repo);
    });

    describe("createPaymentMethod", () => {
      it("rejects creating non-cash payment method without accountName", async () => {
        await expect(
          service.createPaymentMethod({
            methodType: "GCASH",
            displayName: "GCash Online",
            accountName: "",
            accountNumber: "09171234567",
          })
        ).rejects.toThrow("Account/Receiver name is required");

        await expect(
          service.createPaymentMethod({
            methodType: "BANK",
            displayName: "BDO Unibank",
            accountName: "   ",
            accountNumber: "1234-5678-9012",
          })
        ).rejects.toThrow("Account/Receiver name is required");

        await expect(
          service.createPaymentMethod({
            methodType: "GCASH",
            displayName: "GCash Online",
            accountName: null,
            accountNumber: "09171234567",
          })
        ).rejects.toThrow("Account/Receiver name is required");
      });

      it("rejects creating non-cash payment method without accountNumber", async () => {
        await expect(
          service.createPaymentMethod({
            methodType: "GCASH",
            displayName: "GCash Online",
            accountName: "DeskAtlas Manila Inc.",
            accountNumber: "",
          })
        ).rejects.toThrow("Account/Mobile number is required");

        await expect(
          service.createPaymentMethod({
            methodType: "BANK",
            displayName: "BDO Unibank",
            accountName: "DeskAtlas Manila Inc.",
            accountNumber: "   ",
          })
        ).rejects.toThrow("Account/Mobile number is required");

        await expect(
          service.createPaymentMethod({
            methodType: "GCASH",
            displayName: "GCash Online",
            accountName: "DeskAtlas Manila Inc.",
            accountNumber: null,
          })
        ).rejects.toThrow("Account/Mobile number is required");
      });

      it("successfully creates non-cash payment method when both required fields are provided", async () => {
        const created = await service.createPaymentMethod({
          methodType: "GCASH",
          displayName: "GCash Online",
          accountName: "DeskAtlas Manila Inc.",
          accountNumber: "09171234567",
        });

        expect(created.id).toBeDefined();
        expect(created.displayName).toBe("GCash Online");
        expect(created.accountName).toBe("DeskAtlas Manila Inc.");
        expect(created.accountNumber).toBe("09171234567");
      });

      it("allows creating CASH payment method without accountName or accountNumber", async () => {
        const cash = await service.createPaymentMethod({
          methodType: "CASH",
          displayName: "Front Desk Cash",
          allowWeb: false,
          allowKiosk: true,
        });

        expect(cash.id).toBeDefined();
        expect(cash.accountName).toBeNull();
        expect(cash.accountNumber).toBeNull();
      });
    });

    describe("updatePaymentMethod", () => {
      it("rejects updating non-cash payment method when accountName is cleared or missing", async () => {
        const created = await service.createPaymentMethod({
          methodType: "GCASH",
          displayName: "GCash Online",
          accountName: "DeskAtlas Manila Inc.",
          accountNumber: "09171234567",
        });

        await expect(
          service.updatePaymentMethod({
            id: created.id,
            methodType: "GCASH",
            displayName: "GCash Online",
            accountName: "",
            accountNumber: "09171234567",
          })
        ).rejects.toThrow("Account/Receiver name is required");

        await expect(
          service.updatePaymentMethod({
            id: created.id,
            methodType: "GCASH",
            displayName: "GCash Online",
            accountName: "   ",
            accountNumber: "09171234567",
          })
        ).rejects.toThrow("Account/Receiver name is required");
      });

      it("rejects updating non-cash payment method when accountNumber is cleared or missing", async () => {
        const created = await service.createPaymentMethod({
          methodType: "GCASH",
          displayName: "GCash Online",
          accountName: "DeskAtlas Manila Inc.",
          accountNumber: "09171234567",
        });

        await expect(
          service.updatePaymentMethod({
            id: created.id,
            methodType: "GCASH",
            displayName: "GCash Online",
            accountName: "DeskAtlas Manila Inc.",
            accountNumber: "",
          })
        ).rejects.toThrow("Account/Mobile number is required");

        await expect(
          service.updatePaymentMethod({
            id: created.id,
            methodType: "GCASH",
            displayName: "GCash Online",
            accountName: "DeskAtlas Manila Inc.",
            accountNumber: "   ",
          })
        ).rejects.toThrow("Account/Mobile number is required");
      });

      it("successfully updates non-cash payment method when both required fields are provided", async () => {
        const created = await service.createPaymentMethod({
          methodType: "GCASH",
          displayName: "GCash Online",
          accountName: "DeskAtlas Manila Inc.",
          accountNumber: "09171234567",
        });

        const updated = await service.updatePaymentMethod({
          id: created.id,
          methodType: "GCASH",
          displayName: "GCash Online Renamed",
          accountName: "DeskAtlas Global Operations",
          accountNumber: "0918-999-8888",
        });

        expect(updated.displayName).toBe("GCash Online Renamed");
        expect(updated.accountName).toBe("DeskAtlas Global Operations");
        expect(updated.accountNumber).toBe("0918-999-8888");
      });
    });
  });
});
