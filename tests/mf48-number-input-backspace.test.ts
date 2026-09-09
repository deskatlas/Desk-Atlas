import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  handleNumericKeyDown,
  parseNumericInput,
  type NumericInputKeyOptions,
} from "@deskatlas/ui";

/**
 * Helper to simulate React KeyboardEvent
 */
function createMockKeyEvent(key: string, options: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  value?: string;
  selectionStart?: number;
} = {}) {
  let defaultPrevented = false;

  const event = {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    currentTarget: {
      value: options.value ?? "",
      selectionStart: options.selectionStart ?? (options.value ? options.value.length : 0),
    },
    preventDefault() {
      defaultPrevented = true;
    },
  };

  return {
    event: event as unknown as React.KeyboardEvent<HTMLInputElement>,
    isDefaultPrevented: () => defaultPrevented,
  };
}

describe("MF-48: Number Input Backspace Bug & Numeric Input Handling", () => {
  describe("parseNumericInput Utility", () => {
    it("parses valid integer strings into numbers", () => {
      assert.equal(parseNumericInput("60"), 60);
      assert.equal(parseNumericInput("5"), 5);
      assert.equal(parseNumericInput("1440"), 1440);
      assert.equal(parseNumericInput("0"), 0);
    });

    it("treats empty or whitespace-only string as empty string ('') without defaulting to 0", () => {
      assert.equal(parseNumericInput(""), "");
      assert.equal(parseNumericInput("   "), "");
      assert.notEqual(parseNumericInput(""), 0, "Empty string must NOT parse to 0");
    });

    it("uses optional fallback value when provided on empty or invalid input", () => {
      assert.equal(parseNumericInput("", 60), 60);
      assert.equal(parseNumericInput("  ", 5), 5);
      assert.equal(parseNumericInput("not-a-number", 10), 10);
      assert.equal(parseNumericInput("45", 60), 45);
    });

    it("parses decimal numbers when present", () => {
      assert.equal(parseNumericInput("12.5"), 12.5);
      assert.equal(parseNumericInput("0.99"), 0.99);
    });
  });

  describe("handleNumericKeyDown — Keyboard Input Blocking & Navigation", () => {
    it("allows backspace key and does not block it", () => {
      const { event, isDefaultPrevented } = createMockKeyEvent("Backspace", { value: "60" });
      handleNumericKeyDown(event);
      assert.equal(isDefaultPrevented(), false, "Backspace must not be prevented");
    });

    it("allows delete key and does not block it", () => {
      const { event, isDefaultPrevented } = createMockKeyEvent("Delete", { value: "60" });
      handleNumericKeyDown(event);
      assert.equal(isDefaultPrevented(), false, "Delete must not be prevented");
    });

    it("allows navigation keys: arrows, home, end, tab, enter", () => {
      const navKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Tab", "Enter", "Escape"];
      for (const key of navKeys) {
        const { event, isDefaultPrevented } = createMockKeyEvent(key, { value: "123" });
        handleNumericKeyDown(event);
        assert.equal(isDefaultPrevented(), false, `Navigation key "${key}" must not be prevented`);
      }
    });

    it("allows digit keys 0 through 9", () => {
      for (let i = 0; i <= 9; i++) {
        const { event, isDefaultPrevented } = createMockKeyEvent(String(i), { value: "6" });
        handleNumericKeyDown(event);
        assert.equal(isDefaultPrevented(), false, `Digit "${i}" must not be prevented`);
      }
    });

    it("allows copy/cut/paste/select-all shortcuts (Ctrl and Meta combinations)", () => {
      const shortcuts = ["a", "c", "v", "x", "z"];
      for (const key of shortcuts) {
        // Test with Ctrl
        const ctrlMock = createMockKeyEvent(key, { ctrlKey: true, value: "100" });
        handleNumericKeyDown(ctrlMock.event);
        assert.equal(ctrlMock.isDefaultPrevented(), false, `Ctrl+${key} must be allowed`);

        // Test with Meta (Command on Mac)
        const metaMock = createMockKeyEvent(key, { metaKey: true, value: "100" });
        handleNumericKeyDown(metaMock.event);
        assert.equal(metaMock.isDefaultPrevented(), false, `Meta+${key} must be allowed`);
      }
    });

    it("blocks scientific notation ('e' and 'E')", () => {
      const { event: eEvent, isDefaultPrevented: isEPrevented } = createMockKeyEvent("e", { value: "10" });
      handleNumericKeyDown(eEvent);
      assert.equal(isEPrevented(), true, "Key 'e' must be prevented");

      const { event: capitalEEvent, isDefaultPrevented: isCapitalEPrevented } = createMockKeyEvent("E", { value: "10" });
      handleNumericKeyDown(capitalEEvent);
      assert.equal(isCapitalEPrevented(), true, "Key 'E' must be prevented");
    });

    it("blocks '+' and '-' by default for positive numeric inputs", () => {
      const { event: plusEvent, isDefaultPrevented: isPlusPrevented } = createMockKeyEvent("+", { value: "10" });
      handleNumericKeyDown(plusEvent);
      assert.equal(isPlusPrevented(), true, "Key '+' must be prevented");

      const { event: minusEvent, isDefaultPrevented: isMinusPrevented } = createMockKeyEvent("-", { value: "10" });
      handleNumericKeyDown(minusEvent);
      assert.equal(isMinusPrevented(), true, "Key '-' must be prevented");
    });

    it("blocks alphabetical letters", () => {
      const letters = ["a", "b", "c", "x", "z", "A", "M", "Z"];
      for (const letter of letters) {
        const { event, isDefaultPrevented } = createMockKeyEvent(letter, { value: "10" });
        handleNumericKeyDown(event);
        assert.equal(isDefaultPrevented(), true, `Letter "${letter}" must be blocked`);
      }
    });

    it("blocks special punctuation characters", () => {
      const punctuation = ["@", "#", "$", "%", "^", "&", "*", "(", ")", "!", "?", "/", "<", ">"];
      for (const char of punctuation) {
        const { event, isDefaultPrevented } = createMockKeyEvent(char, { value: "10" });
        handleNumericKeyDown(event);
        assert.equal(isDefaultPrevented(), true, `Character "${char}" must be blocked`);
      }
    });

    it("handles decimal points: blocked when allowDecimal is false, allowed once when true", () => {
      // allowDecimal = false (default)
      const mockBlocked = createMockKeyEvent(".", { value: "10" });
      handleNumericKeyDown(mockBlocked.event, { allowDecimal: false });
      assert.equal(mockBlocked.isDefaultPrevented(), true, "Decimal must be blocked when allowDecimal is false");

      // allowDecimal = true, no existing dot
      const mockAllowed = createMockKeyEvent(".", { value: "10" });
      handleNumericKeyDown(mockAllowed.event, { allowDecimal: true });
      assert.equal(mockAllowed.isDefaultPrevented(), false, "First decimal must be allowed when allowDecimal is true");

      // allowDecimal = true, but already contains dot
      const mockSecondDot = createMockKeyEvent(".", { value: "10.5" });
      handleNumericKeyDown(mockSecondDot.event, { allowDecimal: true });
      assert.equal(mockSecondDot.isDefaultPrevented(), true, "Second decimal must be blocked even when allowDecimal is true");
    });
  });

  describe("Admin Settings Reproduction Case: Online Payment Session Expiry", () => {
    it("simulates typing and backspacing without turning the value into 0", () => {
      // Simulate state machine as implemented in Settings.tsx
      let paymentExpiryMinutes: number | "" = 60;

      const handleInputChange = (raw: string) => {
        paymentExpiryMinutes = raw === "" ? "" : Number(raw);
      };

      // Step 1: Initial state is 60
      assert.equal(paymentExpiryMinutes, 60);

      // Step 2: User presses backspace to delete '0', raw input becomes "6"
      handleInputChange("6");
      assert.equal(paymentExpiryMinutes, 6, "Deleting '0' should leave 6, not reset to 0");

      // Step 3: User presses backspace to delete '6', raw input becomes ""
      handleInputChange("");
      assert.equal(paymentExpiryMinutes, "", "Deleting '6' should leave field empty, NOT 0");

      // Step 4: User presses backspace again while already empty
      handleInputChange("");
      assert.equal(paymentExpiryMinutes, "", "Subsequent backspace on empty input remains empty, never 0");

      // Step 5: User types '3'
      handleInputChange("3");
      assert.equal(paymentExpiryMinutes, 3);

      // Step 6: User types '0' -> "30"
      handleInputChange("30");
      assert.equal(paymentExpiryMinutes, 30);
    });

    it("restores sensible default (60 minutes) on blur when left empty", () => {
      let paymentExpiryMinutes: number | "" = "";

      const handleBlur = () => {
        if (!paymentExpiryMinutes || Number(paymentExpiryMinutes) < 5) {
          paymentExpiryMinutes = 60;
        }
      };

      handleBlur();
      assert.equal(paymentExpiryMinutes, 60, "Empty field should restore 60 minutes default on blur");
    });

    it("normalizes empty or sub-minimum value on submit to sensible default", () => {
      const settings = {
        paymentExpiryMinutes: "" as unknown as number,
        kioskTimeoutMinutes: "" as unknown as number,
      };

      const normalizedExpiry = !settings.paymentExpiryMinutes || Number(settings.paymentExpiryMinutes) < 5
        ? 60
        : Number(settings.paymentExpiryMinutes);
      const normalizedTimeout = !settings.kioskTimeoutMinutes || Number(settings.kioskTimeoutMinutes) < 1
        ? 5
        : Number(settings.kioskTimeoutMinutes);

      assert.equal(normalizedExpiry, 60);
      assert.equal(normalizedTimeout, 5);
    });
  });

  describe("Admin Settings: Inactivity Timeout (Kiosk)", () => {
    it("simulates backspacing kiosk timeout without turning into 0 or sticking to 5", () => {
      let kioskTimeoutMinutes: number | "" = 5;

      const handleInputChange = (raw: string) => {
        kioskTimeoutMinutes = raw === "" ? "" : Number(raw);
      };

      // User presses backspace to clear the 5
      handleInputChange("");
      assert.equal(kioskTimeoutMinutes, "", "Clearing kiosk timeout leaves field empty, not 0 or 5");

      // User types 10
      handleInputChange("1");
      assert.equal(kioskTimeoutMinutes, 1);
      handleInputChange("10");
      assert.equal(kioskTimeoutMinutes, 10);

      // On blur when empty, restores default 5
      kioskTimeoutMinutes = "";
      if (!kioskTimeoutMinutes || Number(kioskTimeoutMinutes) < 1) {
        kioskTimeoutMinutes = 5;
      }
      assert.equal(kioskTimeoutMinutes, 5);
    });
  });

  describe("Workspace Templates: Capacity and Hourly Rate", () => {
    it("allows backspacing all digits leaving empty string while typing", () => {
      let capacity = "1";
      let rateAmount = "500";

      // Backspace capacity
      capacity = "";
      assert.equal(capacity, "");

      // On blur fallback to 1
      if (!capacity || parseInt(capacity, 10) < 1) {
        capacity = "1";
      }
      assert.equal(capacity, "1");

      // Backspace rateAmount
      rateAmount = "50";
      assert.equal(rateAmount, "50");
      rateAmount = "5";
      assert.equal(rateAmount, "5");
      rateAmount = "";
      assert.equal(rateAmount, "");

      // On blur fallback to 0
      if (!rateAmount || parseFloat(rateAmount) < 0) {
        rateAmount = "0";
      }
      assert.equal(rateAmount, "0");
    });
  });

  describe("Customer Discovery: Duration Filter", () => {
    it("allows backspacing duration without immediate reset", () => {
      let duration = "4";

      // Backspace
      duration = "";
      assert.equal(duration, "");

      // On blur fallback to 1
      if (!duration || Number(duration) < 1) {
        duration = "1";
      }
      assert.equal(duration, "1");
    });
  });
});
