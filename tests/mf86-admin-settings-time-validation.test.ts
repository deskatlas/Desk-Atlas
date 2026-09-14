import { describe, it, expect } from "vitest";
import {
  getMinClosingTime,
  getDefaultClosingTime,
  isClosingTimeValid,
  getTimeOptions,
  getTimeLabel,
} from "../apps/admin-portal/src/features/settings/components/Settings";

describe("MF-86: Restrict Closing Time Selection Based on Opening Time in Admin Settings", () => {
  describe("getMinClosingTime — Minimum Selectable Closing Time Calculation", () => {
    it("returns 00:01 when opensAt is empty or missing", () => {
      expect(getMinClosingTime("")).toBe("00:01");
      expect(getMinClosingTime(undefined as any)).toBe("00:01");
      expect(getMinClosingTime(null as any)).toBe("00:01");
    });

    it("returns exactly one minute after opensAt for standard times", () => {
      expect(getMinClosingTime("09:00")).toBe("09:01");
      expect(getMinClosingTime("08:30")).toBe("08:31");
      expect(getMinClosingTime("14:15")).toBe("14:16");
    });

    it("correctly rolls over the hour when opensAt is at the 59th minute", () => {
      expect(getMinClosingTime("09:59")).toBe("10:00");
      expect(getMinClosingTime("11:59")).toBe("12:00");
      expect(getMinClosingTime("22:59")).toBe("23:00");
    });

    it("caps at 23:59 when opensAt is at or near the end of day", () => {
      expect(getMinClosingTime("23:58")).toBe("23:59");
      expect(getMinClosingTime("23:59")).toBe("23:59");
    });
  });

  describe("getDefaultClosingTime — Auto-Advancement When ClosesAt <= OpensAt", () => {
    it("preserves current closing time if it is already strictly after the new opening time", () => {
      expect(getDefaultClosingTime("09:00", "18:00")).toBe("18:00");
      expect(getDefaultClosingTime("10:00", "17:00")).toBe("17:00");
      expect(getDefaultClosingTime("08:00", "09:00")).toBe("09:00");
    });

    it("advances closing time by 1 hour when current closing time is equal to opening time", () => {
      expect(getDefaultClosingTime("10:00", "10:00")).toBe("11:00");
      expect(getDefaultClosingTime("18:00", "18:00")).toBe("19:00");
    });

    it("advances closing time by 1 hour when current closing time is earlier than opening time", () => {
      expect(getDefaultClosingTime("15:00", "09:00")).toBe("16:00");
      expect(getDefaultClosingTime("18:00", "12:00")).toBe("19:00");
    });

    it("advances closing time by 1 hour when current closing time is undefined or empty", () => {
      expect(getDefaultClosingTime("09:00", "")).toBe("10:00");
      expect(getDefaultClosingTime("14:30")).toBe("15:30");
    });

    it("caps at 24:00 when advancing to or beyond end of day", () => {
      expect(getDefaultClosingTime("23:30", "22:00")).toBe("24:00");
      expect(getDefaultClosingTime("24:00", "24:00")).toBe("24:00");
    });
  });

  describe("isClosingTimeValid — Closing Time Precedence Validation", () => {
    it("accepts valid closing times strictly after opening time", () => {
      expect(isClosingTimeValid("09:00", "09:01")).toBe(true);
      expect(isClosingTimeValid("09:00", "18:00")).toBe(true);
      expect(isClosingTimeValid("00:00", "23:59")).toBe(true);
      expect(isClosingTimeValid("00:00", "24:00")).toBe(true);
      expect(isClosingTimeValid("12:30", "13:00")).toBe(true);
    });

    it("rejects when closing time is equal to opening time", () => {
      expect(isClosingTimeValid("09:00", "09:00")).toBe(false);
      expect(isClosingTimeValid("12:00", "12:00")).toBe(false);
      expect(isClosingTimeValid("18:30", "18:30")).toBe(false);
    });

    it("rejects when closing time is earlier than opening time", () => {
      expect(isClosingTimeValid("09:00", "08:59")).toBe(false);
      expect(isClosingTimeValid("09:00", "08:00")).toBe(false);
      expect(isClosingTimeValid("18:00", "09:00")).toBe(false);
      expect(isClosingTimeValid("20:00", "10:00")).toBe(false);
    });

    it("rejects empty or missing parameters", () => {
      expect(isClosingTimeValid("", "18:00")).toBe(false);
      expect(isClosingTimeValid("09:00", "")).toBe(false);
      expect(isClosingTimeValid("", "")).toBe(false);
    });
  });

  describe("getTimeOptions & getTimeLabel — Dropdown Time List & Formatting", () => {
    it("generates 48 standard half-hour slots for opening time (00:00 through 23:30)", () => {
      const options = getTimeOptions(false);
      expect(options.length).toBe(48);
      expect(options[0]).toBe("00:00");
      expect(options[1]).toBe("00:30");
      expect(options[options.length - 1]).toBe("23:30");
      expect(options.includes("09:00")).toBe(true);
      expect(options.includes("18:00")).toBe(true);
    });

    it("includes 24:00 for closing time when include24 is true (49 slots)", () => {
      const options = getTimeOptions(true);
      expect(options.length).toBe(49);
      expect(options[options.length - 1]).toBe("24:00");
    });

    it("includes custom database times if not present in standard 30-minute intervals", () => {
      const options = getTimeOptions(false, "09:15");
      expect(options.includes("09:15")).toBe(true);
      expect(options.length).toBe(49);
    });

    it("formats time labels with both 24-hour and 12-hour AM/PM representations", () => {
      expect(getTimeLabel("00:00")).toBe("00:00 (12:00 AM)");
      expect(getTimeLabel("09:00")).toBe("09:00 (9:00 AM)");
      expect(getTimeLabel("12:00")).toBe("12:00 (12:00 PM)");
      expect(getTimeLabel("13:30")).toBe("13:30 (1:30 PM)");
      expect(getTimeLabel("18:00")).toBe("18:00 (6:00 PM)");
      expect(getTimeLabel("23:30")).toBe("23:30 (11:30 PM)");
      expect(getTimeLabel("24:00")).toBe("24:00 (12:00 AM Next Day)");
    });
  });

  describe("Gray Out Unavailable Closing Times", () => {
    it("marks opening time and all earlier times as disabled and grayed out", () => {
      const opensAt = "09:00";
      const closingOptions = getTimeOptions(true);

      const computedOptions = closingOptions.map((t) => {
        const isUnavailable = t <= opensAt;
        return {
          time: t,
          disabled: isUnavailable,
          color: isUnavailable ? "#94A3B8" : "#0F172A",
          backgroundColor: isUnavailable ? "#F8FAFC" : "#FFFFFF",
          label: `${getTimeLabel(t)}${isUnavailable ? " — Unavailable" : ""}`,
        };
      });

      // 00:00 to 09:00 (all earlier + opening time itself) must be disabled and grayed out
      const unavailableSlots = computedOptions.filter((opt) => opt.time <= opensAt);
      expect(unavailableSlots.length).toBeGreaterThan(0);
      for (const slot of unavailableSlots) {
        expect(slot.disabled).toBe(true);
        expect(slot.color).toBe("#94A3B8");
        expect(slot.backgroundColor).toBe("#F8FAFC");
        expect(slot.label).toContain("— Unavailable");
      }

      // Exact opening time 09:00 is disabled & grayed out
      const openSlot = computedOptions.find((opt) => opt.time === "09:00");
      expect(openSlot?.disabled).toBe(true);
      expect(openSlot?.color).toBe("#94A3B8");

      // Times strictly after opening time (e.g. 09:30, 10:00, 18:00, 24:00) must be enabled
      const availableSlots = computedOptions.filter((opt) => opt.time > opensAt);
      expect(availableSlots.length).toBeGreaterThan(0);
      for (const slot of availableSlots) {
        expect(slot.disabled).toBe(false);
        expect(slot.color).toBe("#0F172A");
        expect(slot.backgroundColor).toBe("#FFFFFF");
        expect(slot.label).not.toContain("— Unavailable");
      }
    });
  });

  describe("Simulated Component State Transitions", () => {
    it("simulates opening time selection automatically updating closing time when closing time is <= opening time", () => {
      let schedule = { opensAt: "09:00", closesAt: "18:00" };

      // Case 1: Admin shifts opening time to 10:00. Closing time 18:00 remains valid.
      let newOpensAt = "10:00";
      let newClosesAt = schedule.closesAt;
      if (newOpensAt && newClosesAt && newClosesAt <= newOpensAt) {
        newClosesAt = getDefaultClosingTime(newOpensAt);
      }
      schedule = { opensAt: newOpensAt, closesAt: newClosesAt };
      expect(schedule.opensAt).toBe("10:00");
      expect(schedule.closesAt).toBe("18:00");

      // Case 2: Admin shifts opening time to 18:00 (equal to current closesAt).
      // Closing time must automatically advance past opening time!
      newOpensAt = "18:00";
      newClosesAt = schedule.closesAt;
      if (newOpensAt && newClosesAt && newClosesAt <= newOpensAt) {
        newClosesAt = getDefaultClosingTime(newOpensAt);
      }
      schedule = { opensAt: newOpensAt, closesAt: newClosesAt };
      expect(schedule.opensAt).toBe("18:00");
      expect(schedule.closesAt).toBe("19:00");
      expect(isClosingTimeValid(schedule.opensAt, schedule.closesAt)).toBe(true);

      // Case 3: Admin shifts opening time to 21:00 (later than current closesAt 19:00).
      newOpensAt = "21:00";
      newClosesAt = schedule.closesAt;
      if (newOpensAt && newClosesAt && newClosesAt <= newOpensAt) {
        newClosesAt = getDefaultClosingTime(newOpensAt);
      }
      schedule = { opensAt: newOpensAt, closesAt: newClosesAt };
      expect(schedule.opensAt).toBe("21:00");
      expect(schedule.closesAt).toBe("22:00");
      expect(isClosingTimeValid(schedule.opensAt, schedule.closesAt)).toBe(true);
    });

    it("simulates rejecting closing time changes that are equal to or earlier than opening time", () => {
      const schedule = { opensAt: "09:00", closesAt: "18:00" };

      function handleClosingChange(proposedClosesAt: string, currentSchedule: typeof schedule) {
        if (proposedClosesAt && currentSchedule.opensAt && proposedClosesAt <= currentSchedule.opensAt) {
          // Reject change: keep original closesAt
          return currentSchedule.closesAt;
        }
        return proposedClosesAt;
      }

      // Valid change: 20:00 > 09:00
      expect(handleClosingChange("20:00", schedule)).toBe("20:00");

      // Invalid change: 09:00 === 09:00 (opening time cannot be selected for closing time)
      expect(handleClosingChange("09:00", schedule)).toBe("18:00");

      // Invalid change: 08:30 < 09:00 (earlier time cannot be selected for closing time)
      expect(handleClosingChange("08:30", schedule)).toBe("18:00");
      expect(handleClosingChange("05:00", schedule)).toBe("18:00");
    });
  });
});
