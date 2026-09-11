import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CUSTOMER_RESERVATION_SESSION_TIMEOUT_SECONDS,
  CUSTOMER_RESERVATION_SESSION_WARNING_SECONDS,
  CUSTOMER_RESERVATION_SESSION_STORAGE_KEY,
  formatSessionCountdown,
  calculateRemainingSessionSeconds,
  isSessionWarning,
  isSessionExpired,
  getOrCreateSessionExpiry,
  clearSessionExpiry,
} from "@deskatlas/domain";

describe("MF-70: Customer Reserve Session Timeout Service", () => {
  it("defines standard 20-minute timeout and 2-minute warning thresholds", () => {
    assert.equal(CUSTOMER_RESERVATION_SESSION_TIMEOUT_SECONDS, 1200); // 20 minutes * 60 seconds
    assert.equal(CUSTOMER_RESERVATION_SESSION_WARNING_SECONDS, 120); // 2 minutes * 60 seconds
    assert.equal(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY, "deskatlas_reserve_session_expiry");
  });

  describe("formatSessionCountdown", () => {
    it("formats 20 minutes as 20:00", () => {
      assert.equal(formatSessionCountdown(1200), "20:00");
    });

    it("formats intermediate minutes and seconds accurately", () => {
      assert.equal(formatSessionCountdown(1199), "19:59");
      assert.equal(formatSessionCountdown(600), "10:00");
      assert.equal(formatSessionCountdown(125), "02:05");
      assert.equal(formatSessionCountdown(120), "02:00");
      assert.equal(formatSessionCountdown(59), "00:59");
      assert.equal(formatSessionCountdown(5), "00:05");
    });

    it("formats zero and negative values safely as 00:00", () => {
      assert.equal(formatSessionCountdown(0), "00:00");
      assert.equal(formatSessionCountdown(-10), "00:00");
      assert.equal(formatSessionCountdown(-999), "00:00");
    });

    it("handles floating point seconds safely", () => {
      assert.equal(formatSessionCountdown(125.75), "02:05");
    });
  });

  describe("calculateRemainingSessionSeconds", () => {
    it("computes remaining seconds from current timestamp", () => {
      const now = 1756684800000;
      const expiry = now + 450 * 1000; // 450 seconds in future
      assert.equal(calculateRemainingSessionSeconds(expiry, now), 450);
    });

    it("clamps negative difference to 0 when expired", () => {
      const now = 1756684800000;
      const expiry = now - 5000; // 5 seconds in past
      assert.equal(calculateRemainingSessionSeconds(expiry, now), 0);
    });
  });

  describe("isSessionWarning and isSessionExpired", () => {
    it("detects warning state when remaining seconds <= 120 and > 0", () => {
      assert.equal(isSessionWarning(120), true);
      assert.equal(isSessionWarning(119), true);
      assert.equal(isSessionWarning(1), true);
      assert.equal(isSessionWarning(121), false);
      assert.equal(isSessionWarning(1200), false);
      assert.equal(isSessionWarning(0), false);
      assert.equal(isSessionWarning(-5), false);
    });

    it("detects expired state when remaining seconds <= 0", () => {
      assert.equal(isSessionExpired(0), true);
      assert.equal(isSessionExpired(-1), true);
      assert.equal(isSessionExpired(-100), true);
      assert.equal(isSessionExpired(1), false);
      assert.equal(isSessionExpired(1200), false);
    });
  });

  describe("getOrCreateSessionExpiry and clearSessionExpiry", () => {
    it("initializes a fresh 20-minute expiry when storage is empty", () => {
      const mockStorageMap = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => mockStorageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mockStorageMap.set(k, v);
        },
      };

      const now = 1000000;
      const expiry = getOrCreateSessionExpiry(mockStorage, now);

      assert.equal(expiry, now + 1200 * 1000);
      assert.equal(mockStorageMap.get(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY), String(expiry));
    });

    it("reuses existing valid expiry timestamp from storage across page refresh", () => {
      const now = 1000000;
      const existingExpiry = now + 800 * 1000; // 800s left
      const mockStorageMap = new Map<string, string>([
        [CUSTOMER_RESERVATION_SESSION_STORAGE_KEY, String(existingExpiry)],
      ]);
      const mockStorage = {
        getItem: (k: string) => mockStorageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mockStorageMap.set(k, v);
        },
      };

      const result = getOrCreateSessionExpiry(mockStorage, now);
      assert.equal(result, existingExpiry);
    });

    it("resets and generates a fresh expiry if stored value is already expired", () => {
      const now = 1000000;
      const expiredTimestamp = now - 50000; // 50s in past
      const mockStorageMap = new Map<string, string>([
        [CUSTOMER_RESERVATION_SESSION_STORAGE_KEY, String(expiredTimestamp)],
      ]);
      const mockStorage = {
        getItem: (k: string) => mockStorageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mockStorageMap.set(k, v);
        },
      };

      const result = getOrCreateSessionExpiry(mockStorage, now);
      assert.equal(result, now + 1200 * 1000);
      assert.equal(mockStorageMap.get(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY), String(now + 1200 * 1000));
    });

    it("clears storage key on clearSessionExpiry", () => {
      const mockStorageMap = new Map<string, string>([
        [CUSTOMER_RESERVATION_SESSION_STORAGE_KEY, "12345678"],
      ]);
      const mockStorage = {
        removeItem: (k: string) => {
          mockStorageMap.delete(k);
        },
      };

      clearSessionExpiry(mockStorage);
      assert.equal(mockStorageMap.has(CUSTOMER_RESERVATION_SESSION_STORAGE_KEY), false);
    });

    it("safely handles null/undefined storage without throwing", () => {
      const now = 5000000;
      const result = getOrCreateSessionExpiry(undefined, now);
      assert.equal(result, now + 1200 * 1000);
      assert.doesNotThrow(() => clearSessionExpiry(undefined));
    });
  });
});
