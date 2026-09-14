import { describe, it, expect, beforeEach } from "vitest";
import { sanitizeAccountNumber } from "../apps/admin-portal/src/features/settings/components/Settings";
import { handleNumericKeyDown } from "@deskatlas/ui";
import { createAdminSettingsService, SettingsValidationError, InMemorySettingsRepository } from "@deskatlas/domain";

describe("MF-87: Admin Payment Methods Account / Mobile Number Input (Digits and Dash Only)", () => {
  describe("sanitizeAccountNumber — Sanitization & Cleaning", () => {
    it("preserves purely numerical values", () => {
      expect(sanitizeAccountNumber("09171234567")).toBe("09171234567");
      expect(sanitizeAccountNumber("1234567890123456")).toBe("1234567890123456");
      expect(sanitizeAccountNumber("00123456789")).toBe("00123456789");
    });

    it("preserves numerical values containing dashes", () => {
      expect(sanitizeAccountNumber("1234-5678-9012")).toBe("1234-5678-9012");
      expect(sanitizeAccountNumber("0917-123-4567")).toBe("0917-123-4567");
      expect(sanitizeAccountNumber("001-234-567-89")).toBe("001-234-567-89");
      expect(sanitizeAccountNumber("12-3456-7890-12")).toBe("12-3456-7890-12");
    });

    it("strips out alphabetic characters", () => {
      expect(sanitizeAccountNumber("abc09171234567")).toBe("09171234567");
      expect(sanitizeAccountNumber("0917-ABC-4567")).toBe("0917--4567");
      expect(sanitizeAccountNumber("Acct-123-456")).toBe("-123-456");
    });

    it("strips out whitespace and spaces", () => {
      expect(sanitizeAccountNumber("0917 123 4567")).toBe("09171234567");
      expect(sanitizeAccountNumber(" 1234 - 5678 - 9012 ")).toBe("1234-5678-9012");
      expect(sanitizeAccountNumber("\t09171234567\n")).toBe("09171234567");
    });

    it("strips out symbols other than dash (+, #, (), @, etc.)", () => {
      expect(sanitizeAccountNumber("+63-917-123-4567")).toBe("63-917-123-4567");
      expect(sanitizeAccountNumber("(02) 8123-4567")).toBe("028123-4567");
      expect(sanitizeAccountNumber("#123-456-789#")).toBe("123-456-789");
      expect(sanitizeAccountNumber("123.456.789")).toBe("123456789");
    });

    it("handles null, undefined, and empty strings safely", () => {
      expect(sanitizeAccountNumber(null)).toBe("");
      expect(sanitizeAccountNumber(undefined)).toBe("");
      expect(sanitizeAccountNumber("")).toBe("");
      expect(sanitizeAccountNumber("   ")).toBe("");
    });
  });

  describe("handleNumericKeyDown with { allowDash: true } — Keystroke Filtering", () => {
    function createMockKeyboardEvent(
      key: string,
      options: { ctrlKey?: boolean; value?: string; selectionStart?: number } = {}
    ): {
      event: any;
      defaultPrevented: boolean;
    } {
      let defaultPrevented = false;
      const event = {
        key,
        ctrlKey: options.ctrlKey ?? false,
        metaKey: false,
        altKey: false,
        currentTarget: {
          value: options.value ?? "1234",
          selectionStart: options.selectionStart ?? 2,
        },
        preventDefault: () => {
          defaultPrevented = true;
        },
      };
      return { event, defaultPrevented: () => defaultPrevented };
    }

    it("allows numerical digits 0-9", () => {
      for (let i = 0; i <= 9; i++) {
        const mock = createMockKeyboardEvent(String(i));
        handleNumericKeyDown(mock.event, { allowDash: true });
        expect(mock.defaultPrevented()).toBe(false);
      }
    });

    it("allows dash/hyphen (-) at any cursor position when allowDash is true", () => {
      // Beginning
      const mockStart = createMockKeyboardEvent("-", { selectionStart: 0, value: "1234" });
      handleNumericKeyDown(mockStart.event, { allowDash: true });
      expect(mockStart.defaultPrevented()).toBe(false);

      // Middle (even when already containing dashes)
      const mockMiddle = createMockKeyboardEvent("-", { selectionStart: 4, value: "1234-5678" });
      handleNumericKeyDown(mockMiddle.event, { allowDash: true });
      expect(mockMiddle.defaultPrevented()).toBe(false);

      // End
      const mockEnd = createMockKeyboardEvent("-", { selectionStart: 8, value: "12345678" });
      handleNumericKeyDown(mockEnd.event, { allowDash: true });
      expect(mockEnd.defaultPrevented()).toBe(false);
    });

    it("allows navigation and editing keys", () => {
      const allowedKeys = [
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Tab",
        "Enter",
        "Home",
        "End",
        "Escape",
      ];
      for (const key of allowedKeys) {
        const mock = createMockKeyboardEvent(key);
        handleNumericKeyDown(mock.event, { allowDash: true });
        expect(mock.defaultPrevented()).toBe(false);
      }
    });

    it("allows standard keyboard shortcuts (Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X)", () => {
      for (const key of ["a", "c", "v", "x"]) {
        const mock = createMockKeyboardEvent(key, { ctrlKey: true });
        handleNumericKeyDown(mock.event, { allowDash: true });
        expect(mock.defaultPrevented()).toBe(false);
      }
    });

    it("blocks non-numeric, non-dash characters", () => {
      const blockedKeys = [
        "a", "B", "z", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")",
        "+", "=", "_", "[", "]", "{", "}", ";", ":", "'", '"', ",", "<",
        ">", "/", "?", " ", "e", "E", ".",
      ];
      for (const key of blockedKeys) {
        const mock = createMockKeyboardEvent(key);
        handleNumericKeyDown(mock.event, { allowDash: true });
        expect(mock.defaultPrevented()).toBe(true);
      }
    });

    it("regression: blocks dash when allowDash is false and allowNegative is false", () => {
      const mock = createMockKeyboardEvent("-", { selectionStart: 2, value: "1234" });
      handleNumericKeyDown(mock.event, { allowDash: false });
      expect(mock.defaultPrevented()).toBe(true);
    });
  });

  describe("SettingsService — Domain Validation for Account / Mobile Number", () => {
    let service: ReturnType<typeof createAdminSettingsService>;
    let repo: InMemorySettingsRepository;

    beforeEach(() => {
      repo = new InMemorySettingsRepository();
      service = createAdminSettingsService(repo);
    });

    it("accepts creating a payment method with numeric-only account number", async () => {
      const result = await service.createPaymentMethod({
        methodType: "GCASH",
        displayName: "GCash Test",
        accountName: "DeskAtlas Inc.",
        accountNumber: "09171234567",
      });
      expect(result.accountNumber).toBe("09171234567");
    });

    it("accepts creating a payment method with dashes in account number", async () => {
      const result = await service.createPaymentMethod({
        methodType: "BANK",
        displayName: "BDO Savings",
        accountName: "DeskAtlas Inc.",
        accountNumber: "1234-5678-9012",
      });
      expect(result.accountNumber).toBe("1234-5678-9012");
    });

    it("accepts creating a CASH payment method without account number or account name", async () => {
      const result = await service.createPaymentMethod({
        methodType: "CASH",
        displayName: "Cashier Payment",
        allowWeb: false,
        allowKiosk: true,
      });
      expect(result.accountNumber).toBeNull();
      expect(result.accountName).toBeNull();
    });

    it("rejects creating a payment method when account number contains letters", async () => {
      await expect(
        service.createPaymentMethod({
          methodType: "BANK",
          displayName: "Invalid Bank",
          accountName: "DeskAtlas Inc.",
          accountNumber: "1234-ABCD-5678",
        })
      ).rejects.toThrow(SettingsValidationError);
    });

    it("rejects creating a payment method when account number contains spaces or symbols", async () => {
      await expect(
        service.createPaymentMethod({
          methodType: "GCASH",
          displayName: "Invalid GCash",
          accountName: "DeskAtlas Inc.",
          accountNumber: "+63 917 123 4567",
        })
      ).rejects.toThrow(SettingsValidationError);
    });

    it("accepts updating a payment method with valid numbers and dashes", async () => {
      const created = await service.createPaymentMethod({
        methodType: "GCASH",
        displayName: "Update Test",
        accountName: "DeskAtlas Inc.",
        accountNumber: "09171112222",
      });

      const updated = await service.updatePaymentMethod({
        id: created.id,
        methodType: "GCASH",
        displayName: "Update Test",
        accountName: "DeskAtlas Inc.",
        accountNumber: "0917-111-2222",
      });
      expect(updated.accountNumber).toBe("0917-111-2222");
    });

    it("rejects updating a payment method with invalid account number characters", async () => {
      const created = await service.createPaymentMethod({
        methodType: "GCASH",
        displayName: "Update Test 2",
        accountName: "DeskAtlas Inc.",
        accountNumber: "09171112222",
      });

      await expect(
        service.updatePaymentMethod({
          id: created.id,
          methodType: "GCASH",
          displayName: "Update Test 2",
          accountName: "DeskAtlas Inc.",
          accountNumber: "0917#111#2222",
        })
      ).rejects.toThrow(SettingsValidationError);
    });
  });
});
