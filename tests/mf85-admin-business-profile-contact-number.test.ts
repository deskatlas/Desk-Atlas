import { describe, it, expect } from "vitest";
import { extractTenDigitPhone } from "../apps/admin-portal/src/features/settings/components/Settings";
import { handleNumericKeyDown } from "@deskatlas/ui";

describe("MF-85: Admin Business Profile Contact Number", () => {
  describe("extractTenDigitPhone — Phone Parsing & Cleaning", () => {
    it("correctly extracts 10 digits from standard Philippine formats with +63 prefix", () => {
      expect(extractTenDigitPhone("+63 917 123 4567")).toBe("9171234567");
      expect(extractTenDigitPhone("+639171234567")).toBe("9171234567");
      expect(extractTenDigitPhone("+63-917-123-4567")).toBe("9171234567");
      expect(extractTenDigitPhone("+63 920 999 8888")).toBe("9209998888");
    });

    it("correctly extracts 10 digits from numbers starting with leading 0 (e.g. 0917...)", () => {
      expect(extractTenDigitPhone("09171234567")).toBe("9171234567");
      expect(extractTenDigitPhone("0917-123-4567")).toBe("9171234567");
      expect(extractTenDigitPhone("0918 555 1234")).toBe("9185551234");
    });

    it("correctly extracts raw 10-digit numbers without prefix", () => {
      expect(extractTenDigitPhone("9171234567")).toBe("9171234567");
      expect(extractTenDigitPhone("9988776655")).toBe("9988776655");
    });

    it("handles null, undefined, or empty values safely", () => {
      expect(extractTenDigitPhone(null)).toBe("");
      expect(extractTenDigitPhone(undefined)).toBe("");
      expect(extractTenDigitPhone("")).toBe("");
      expect(extractTenDigitPhone("   ")).toBe("");
    });

    it("truncates any numbers longer than 10 digits", () => {
      expect(extractTenDigitPhone("9171234567890")).toBe("9171234567");
      expect(extractTenDigitPhone("+6391712345678999")).toBe("9171234567");
    });

    it("strips all non-digit characters", () => {
      expect(extractTenDigitPhone("abc917def123ghi4567")).toBe("9171234567");
      expect(extractTenDigitPhone("(0917) 123-4567")).toBe("9171234567");
    });
  });

  describe("Numeric-only Keystroke Handling", () => {
    function createMockKeyboardEvent(key: string, ctrlKey = false): {
      event: any;
      defaultPrevented: boolean;
    } {
      let defaultPrevented = false;
      const event = {
        key,
        ctrlKey,
        metaKey: false,
        altKey: false,
        currentTarget: { value: "917" },
        preventDefault: () => {
          defaultPrevented = true;
        },
      };
      return { event, defaultPrevented: () => defaultPrevented };
    }

    it("allows numeric digits 0-9", () => {
      for (let i = 0; i <= 9; i++) {
        const mock = createMockKeyboardEvent(String(i));
        handleNumericKeyDown(mock.event);
        expect(mock.defaultPrevented()).toBe(false);
      }
    });

    it("allows navigation and editing keys (Backspace, Delete, ArrowLeft, ArrowRight, Tab, Enter)", () => {
      const allowedKeys = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab", "Enter", "Home", "End"];
      for (const key of allowedKeys) {
        const mock = createMockKeyboardEvent(key);
        handleNumericKeyDown(mock.event);
        expect(mock.defaultPrevented()).toBe(false);
      }
    });

    it("allows standard keyboard shortcuts (Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X)", () => {
      const shortcutKeys = ["a", "c", "v", "x"];
      for (const key of shortcutKeys) {
        const mock = createMockKeyboardEvent(key, true);
        handleNumericKeyDown(mock.event);
        expect(mock.defaultPrevented()).toBe(false);
      }
    });

    it("blocks non-numeric characters (letters, punctuation, symbols)", () => {
      const blockedKeys = ["a", "Z", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "-", "_", "+", "=", "[", "]", "{", "}", ";", ":", "'", '"', ",", "<", ">", "/", "?", "e", "E", "."];
      for (const key of blockedKeys) {
        const mock = createMockKeyboardEvent(key);
        handleNumericKeyDown(mock.event);
        expect(mock.defaultPrevented()).toBe(true);
      }
    });
  });

  describe("10-Digit Validation & Serialization Rules", () => {
    function validateAndSerializePhone(phoneDigits: string): {
      isValid: boolean;
      errorMessage?: string;
      serializedPhone: string | null;
    } {
      if (phoneDigits && phoneDigits.length !== 10) {
        return {
          isValid: false,
          errorMessage: "Contact number must be exactly 10 digits (e.g., 9171234567).",
          serializedPhone: null,
        };
      }
      return {
        isValid: true,
        serializedPhone: phoneDigits ? `+63${phoneDigits}` : null,
      };
    }

    it("rejects incomplete inputs with fewer than 10 digits", () => {
      const resultShort = validateAndSerializePhone("91712");
      expect(resultShort.isValid).toBe(false);
      expect(resultShort.errorMessage).toContain("must be exactly 10 digits");

      const resultNine = validateAndSerializePhone("917123456");
      expect(resultNine.isValid).toBe(false);
      expect(resultNine.errorMessage).toContain("must be exactly 10 digits");
    });

    it("accepts valid 10-digit input and serializes with +63 prefix", () => {
      const result = validateAndSerializePhone("9171234567");
      expect(result.isValid).toBe(true);
      expect(result.serializedPhone).toBe("+639171234567");
    });

    it("permits null when empty/cleared", () => {
      const result = validateAndSerializePhone("");
      expect(result.isValid).toBe(true);
      expect(result.serializedPhone).toBeNull();
    });
  });
});
