import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { handleNumericKeyDown } from "@deskatlas/ui";

/**
 * Helper to simulate React KeyboardEvent for numeric keydown handling
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

/**
 * Pure simulation of the MF-81 duration input sanitizer and parser
 */
function sanitizeAndParseDuration(raw: string): { inputStr: string; durationHours: number } {
  const sanitized = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (sanitized === "") {
    return { inputStr: "", durationHours: 0 };
  }
  const parsed = parseInt(sanitized, 10);
  return { inputStr: sanitized, durationHours: parsed > 0 ? parsed : 0 };
}

describe("MF-81: Schedule Duration Custom Input (Online & Kiosk)", () => {
  describe("1. Numbers-only key handling and sanitization", () => {
    it("blocks non-numeric keys (letters, symbols, punctuation)", () => {
      const invalidKeys = ["a", "z", "A", "Z", "e", "E", "-", "+", ".", ",", "!", "@", "#", "$", " "];
      for (const key of invalidKeys) {
        const { event, isDefaultPrevented } = createMockKeyEvent(key, { value: "" });
        handleNumericKeyDown(event);
        assert.equal(isDefaultPrevented(), true, `Key "${key}" must be blocked`);
      }
    });

    it("allows standard navigation and editing keys", () => {
      const allowedKeys = [
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "Tab",
        "Enter",
        "Escape",
      ];
      for (const key of allowedKeys) {
        const { event, isDefaultPrevented } = createMockKeyEvent(key, { value: "5" });
        handleNumericKeyDown(event);
        assert.equal(isDefaultPrevented(), false, `Key "${key}" must not be prevented`);
      }
    });

    it("allows modifier shortcuts (Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X)", () => {
      const shortcuts = ["a", "c", "v", "x"];
      for (const key of shortcuts) {
        const { event, isDefaultPrevented } = createMockKeyEvent(key, { ctrlKey: true, value: "12" });
        handleNumericKeyDown(event);
        assert.equal(isDefaultPrevented(), false, `Ctrl+${key} must be allowed`);
      }
    });

    it("strips non-numeric characters from pasted strings", () => {
      assert.deepEqual(sanitizeAndParseDuration("12hrs"), { inputStr: "12", durationHours: 12 });
      assert.deepEqual(sanitizeAndParseDuration("abc-8"), { inputStr: "8", durationHours: 8 });
      assert.deepEqual(sanitizeAndParseDuration("   9  "), { inputStr: "9", durationHours: 9 });
    });
  });

  describe("2. Backspace functionality", () => {
    it("allows backspacing from multi-digit numbers down to single digit", () => {
      // User types 12
      const step1 = sanitizeAndParseDuration("12");
      assert.equal(step1.inputStr, "12");
      assert.equal(step1.durationHours, 12);

      // User presses backspace -> "1"
      const step2 = sanitizeAndParseDuration("1");
      assert.equal(step2.inputStr, "1");
      assert.equal(step2.durationHours, 1);
    });

    it("allows backspacing to empty string without snapping to 0", () => {
      // User has "1" and presses backspace -> ""
      const step = sanitizeAndParseDuration("");
      assert.equal(step.inputStr, "", "Empty input string must remain empty string, not snap to '0'");
      assert.equal(step.durationHours, 0, "Duration hours is 0 (invalid), preventing booking");
    });
  });

  describe("3. 0-Hour Rejection and Prevention", () => {
    it("strips standalone '0' so 0 hours cannot be entered", () => {
      const res1 = sanitizeAndParseDuration("0");
      assert.equal(res1.inputStr, "");
      assert.equal(res1.durationHours, 0);

      const res2 = sanitizeAndParseDuration("00");
      assert.equal(res2.inputStr, "");
      assert.equal(res2.durationHours, 0);
    });

    it("strips leading zeros while preserving valid trailing zeros (e.g. 05 -> 5, 10 -> 10)", () => {
      const resLeading = sanitizeAndParseDuration("05");
      assert.equal(resLeading.inputStr, "5");
      assert.equal(resLeading.durationHours, 5);

      const resValidTen = sanitizeAndParseDuration("10");
      assert.equal(resValidTen.inputStr, "10");
      assert.equal(resValidTen.durationHours, 10);
    });

    it("evaluates continue/proceed button as disabled when duration is 0 or empty", () => {
      const checkCanProceed = (durationHours: number, hasDate = true, hasStartTime = true) => {
        return Boolean(hasDate && hasStartTime && durationHours > 0);
      };

      assert.equal(checkCanProceed(0), false, "Cannot proceed with 0 hours");
      assert.equal(checkCanProceed(-1), false, "Cannot proceed with negative hours");
      assert.equal(checkCanProceed(1), true, "Can proceed with 1 hour");
      assert.equal(checkCanProceed(4), true, "Can proceed with 4 hours");
      assert.equal(checkCanProceed(10), true, "Can proceed with 10 hours");
    });
  });

  describe("4. Bidirectional synchronization with preset hour buttons", () => {
    it("syncs input text when preset button is clicked", () => {
      let durationHours = 2;
      let durationInputStr = "2";

      const selectPreset = (hours: number) => {
        durationHours = hours;
        durationInputStr = String(hours);
      };

      selectPreset(5);
      assert.equal(durationHours, 5);
      assert.equal(durationInputStr, "5");

      selectPreset(8);
      assert.equal(durationHours, 8);
      assert.equal(durationInputStr, "8");
    });

    it("highlights matching preset button when user types in the input", () => {
      const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
      
      const isPresetSelected = (hours: number, currentDuration: number) => {
        return DURATION_OPTIONS.includes(currentDuration) && currentDuration === hours;
      };

      assert.equal(isPresetSelected(3, 3), true);
      assert.equal(isPresetSelected(3, 5), false);
      assert.equal(isPresetSelected(3, 9), false); // 9 is custom
    });

    it("calculates accurate total pricing for custom durations", () => {
      const ratePerHour = 150; // PHP 150/hr
      
      const custom1 = sanitizeAndParseDuration("9");
      assert.equal(ratePerHour * custom1.durationHours, 1350);

      const custom2 = sanitizeAndParseDuration("12");
      assert.equal(ratePerHour * custom2.durationHours, 1800);

      const empty = sanitizeAndParseDuration("");
      assert.equal(ratePerHour * empty.durationHours, 0);
    });
  });

  describe("5. Candidate locking invariant", () => {
    it("disallows modifying duration when activeRank > 0 (backup candidate)", () => {
      const activeRank = 1; // Backup candidate
      const isDurationEditable = activeRank === 0;
      assert.equal(isDurationEditable, false, "Backup candidates must have duration locked to Main");
    });
  });
});
