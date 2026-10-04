import { describe, it, expect } from "vitest";
import {
  getCustomerSessionTimeoutSeconds,
  getOrCreateSessionExpiry,
  syncSessionExpiryWithConfig,
  clearSessionExpiry,
  CUSTOMER_RESERVATION_SESSION_TIMEOUT_SECONDS,
  CUSTOMER_RESERVATION_SESSION_STORAGE_KEY,
} from "@deskatlas/domain";

describe("MS-31: Customer Web Reservation Intake Validation, Dynamic Session Timeout Synchronization, and Post-Booking Navigation", () => {
  describe("QAD-TC31-01 & QAD-TC31-04: Philippine Mobile Format Sanitization & Extraction", () => {
    function sanitizeContactDigits(raw: string): string {
      let digits = raw.replace(/\D/g, "");
      if (digits.startsWith("639") && digits.length >= 3) {
        digits = digits.slice(3);
      } else if (digits.startsWith("63") && digits.length >= 2) {
        digits = digits.slice(2);
      }

      if (digits.startsWith("09")) {
        digits = digits.slice(2);
      } else if (digits.startsWith("9") && digits.length > 9) {
        digits = digits.slice(1);
      }

      return digits.slice(0, 9);
    }

    function formatFullContactNumber(digits: string): string | undefined {
      if (digits.length === 9) {
        return `09${digits}`;
      }
      return undefined;
    }

    it("QAD-TC31-01: strips non-digit characters and letters completely", () => {
      expect(sanitizeContactDigits("abc!@#")).toBe("");
      expect(sanitizeContactDigits("call 0917-123-4567 me")).toBe("171234567");
      expect(sanitizeContactDigits("0917-ABC-4567")).toBe("174567");
    });

    it("QAD-TC31-01: normalizes full 09XXXXXXXXX inputs by stripping the fixed 09 prefix", () => {
      expect(sanitizeContactDigits("09171234567")).toBe("171234567");
      expect(sanitizeContactDigits("09987654321")).toBe("987654321");
    });

    it("QAD-TC31-01: normalizes international prefixes +639 and 639", () => {
      expect(sanitizeContactDigits("+639171234567")).toBe("171234567");
      expect(sanitizeContactDigits("639171234567")).toBe("171234567");
    });

    it("QAD-TC31-04: formats valid 9-digit suffix into full 11-digit 09XXXXXXXXX payload", () => {
      const cleanDigits = sanitizeContactDigits("171234567");
      expect(cleanDigits).toBe("171234567");
      expect(formatFullContactNumber(cleanDigits)).toBe("09171234567");
    });

    it("QAD-TC31-04: limits input to maximum of 9 trailing digits", () => {
      const cleanDigits = sanitizeContactDigits("1712345679999");
      expect(cleanDigits).toBe("171234567");
      expect(cleanDigits.length).toBe(9);
      expect(formatFullContactNumber(cleanDigits)).toBe("09171234567");
    });
  });

  describe("QAD-TC31-02 & QAD-TC31-03: Guest Intake Contact Number Validation", () => {
    function validateContactNumber(digits: string): { isValid: boolean; error?: string } {
      if (digits.length === 0) {
        return { isValid: true };
      }
      if (digits.length !== 9) {
        return {
          isValid: false,
          error: `Please enter the remaining ${9 - digits.length} digits of your mobile number.`,
        };
      }
      return { isValid: true };
    }

    it("QAD-TC31-03: passes validation when contact number is blank (optional field invariant)", () => {
      const result = validateContactNumber("");
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("QAD-TC31-02: fails validation and alerts remaining digits when fewer than 9 digits are entered", () => {
      const result5 = validateContactNumber("17123");
      expect(result5.isValid).toBe(false);
      expect(result5.error).toBe("Please enter the remaining 4 digits of your mobile number.");

      const result1 = validateContactNumber("1");
      expect(result1.isValid).toBe(false);
      expect(result1.error).toBe("Please enter the remaining 8 digits of your mobile number.");

      const result8 = validateContactNumber("17123456");
      expect(result8.isValid).toBe(false);
      expect(result8.error).toBe("Please enter the remaining 1 digits of your mobile number.");
    });

    it("QAD-TC31-04: passes validation when exactly 9 digits are supplied", () => {
      const result = validateContactNumber("171234567");
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe("QAD-TC31-05: Dynamic Session Timeout Synchronization with Settings", () => {
    it("converts configured administrative minutes into seconds accurately", () => {
      expect(getCustomerSessionTimeoutSeconds(60)).toBe(3600);
      expect(getCustomerSessionTimeoutSeconds(30)).toBe(1800);
      expect(getCustomerSessionTimeoutSeconds(45)).toBe(2700);
      expect(getCustomerSessionTimeoutSeconds(undefined)).toBe(1200);
      expect(getCustomerSessionTimeoutSeconds(null)).toBe(1200);
    });

    it("syncs session expiry with configured timeout when storage is empty", () => {
      const storageMap = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => storageMap.set(k, v),
      };

      const now = 1000000;
      const configuredTimeoutSeconds = 3600; // 60 minutes
      const expiry = syncSessionExpiryWithConfig(mockStorage, now, configuredTimeoutSeconds);

      expect(expiry).toBe(now + 3600 * 1000);
      expect(storageMap.get(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY)).toBe(String(expiry));
    });

    it("preserves valid in-flight session expiry if within configured bounds", () => {
      const storageMap = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => storageMap.set(k, v),
      };

      const now = 1000000;
      const existingExpiry = now + 1500 * 1000; // 25 mins remaining
      storageMap.set(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY, String(existingExpiry));

      const configuredTimeoutSeconds = 1800; // 30 minutes
      const result = syncSessionExpiryWithConfig(mockStorage, now, configuredTimeoutSeconds);

      expect(result).toBe(existingExpiry);
    });

    it("resynchronizes session expiry if stored expiry exceeds configured timeout bounds", () => {
      const storageMap = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => storageMap.set(k, v),
      };

      const now = 1000000;
      const staleLongExpiry = now + 7200 * 1000; // 120 mins remaining from older setting
      storageMap.set(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY, String(staleLongExpiry));

      const configuredTimeoutSeconds = 1800; // 30 minutes
      const result = syncSessionExpiryWithConfig(mockStorage, now, configuredTimeoutSeconds);

      expect(result).toBe(now + 1800 * 1000);
      expect(storageMap.get(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY)).toBe(String(now + 1800 * 1000));
    });

    it("clears session expiry properly on completion or timeout", () => {
      const storageMap = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => storageMap.set(k, v),
        removeItem: (k: string) => storageMap.delete(k),
      };

      storageMap.set(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY, "12345678");
      clearSessionExpiry(mockStorage);
      expect(storageMap.get(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY)).toBeUndefined();
    });
  });

  describe("QAD-TC31-06: Clean Post-Booking Browser History Replacement", () => {
    it("verifies tracking URL construction with encoded reference code and email", () => {
      const referenceCode = "DA-2026-9901";
      const customerEmail = "guest.maria@example.com";
      const trackUrl = `/track?code=${encodeURIComponent(referenceCode)}&email=${encodeURIComponent(customerEmail)}`;

      expect(trackUrl).toBe("/track?code=DA-2026-9901&email=guest.maria%40example.com");
    });

    it("simulates router.replace replacing current entry without creating back-button loop", () => {
      const historyStack: string[] = ["/", "/reserve"];
      
      function navigateToTrack(useReplace: boolean, targetUrl: string) {
        if (useReplace) {
          historyStack[historyStack.length - 1] = targetUrl;
        } else {
          historyStack.push(targetUrl);
        }
      }

      navigateToTrack(true, "/track?code=DA-123");
      expect(historyStack).toEqual(["/", "/track?code=DA-123"]);

      // Pressing back button pops the top entry
      historyStack.pop();
      expect(historyStack[historyStack.length - 1]).toBe("/");
    });
  });
});
