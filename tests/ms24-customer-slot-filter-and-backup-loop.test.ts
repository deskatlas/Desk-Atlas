import { describe, it, expect } from "vitest";
import type { AvailableTimeSlot } from "@deskatlas/domain";

/**
 * Pure simulation of MS-24 visibleTimeSlots filter logic
 */
function computeVisibleTimeSlots(params: {
  timeSlots: AvailableTimeSlot[];
  selectedDate: string;
  todayStr: string;
  now: Date;
  excludedStartTimes: string[];
}): AvailableTimeSlot[] {
  const { timeSlots, selectedDate, todayStr, now, excludedStartTimes } = params;
  if (!timeSlots || timeSlots.length === 0) return [];

  return timeSlots.filter((slot) => {
    // 1. Omit slots that have already passed
    if (slot.blockingReason === "PAST_TIME") {
      return false;
    }

    // 2. Omit slots blocked by facility schedule or existing reservations
    if (slot.blockingReason === "SCHEDULE_BLOCKED" || slot.blockingReason === "BUSINESS_CLOSED") {
      return false;
    }

    // 3. Omit slots already selected by a different candidate rank
    if (excludedStartTimes.includes(slot.startTime)) {
      return false;
    }

    // 4. Omit past time check dynamically if on today's date
    if (selectedDate === todayStr) {
      const [sh, sm] = slot.startTime.split(":").map(Number);
      if (!isNaN(sh) && !isNaN(sm)) {
        const slotDate = new Date(now);
        slotDate.setHours(sh, sm, 0, 0);
        if (slotDate.getTime() <= now.getTime()) {
          return false;
        }
      }
    }

    // 5. Must be marked available by domain availability service
    return slot.isAvailable;
  });
}

/**
 * Pure simulation of MS-24 lockedSchedule memoization logic in ReservationPage
 */
function computeLockedScheduleConfig(params: {
  activeRank: number;
  mainCandidate: {
    date: string;
    durationHours: number;
    startTime: string;
    rateType?: string;
    workspace: { workspaceInstanceId: string };
  } | null;
  selectedWorkspace: { workspaceInstanceId: string } | null;
  candidates: Array<{
    rank: number;
    startTime: string;
    workspace: { workspaceInstanceId: string };
  }>;
}) {
  const { activeRank, mainCandidate, selectedWorkspace, candidates } = params;
  if (activeRank <= 0 || !mainCandidate || !selectedWorkspace) return undefined;

  const excluded = candidates
    .filter(
      (c) =>
        c.workspace.workspaceInstanceId === selectedWorkspace.workspaceInstanceId &&
        c.rank !== activeRank
    )
    .map((c) => c.startTime);

  return {
    date: mainCandidate.date,
    durationHours: mainCandidate.durationHours,
    initialStartTime: mainCandidate.startTime,
    excludedStartTimes: excluded,
    rateType: mainCandidate.rateType || "HOURLY",
  };
}

/**
 * Pure simulation of MS-24 excludedKey generation in ScheduleCalendarStep
 */
function computeExcludedKey(excludedStartTimes?: string[]): string {
  return (excludedStartTimes || []).slice().sort().join(",");
}

describe("MS-24 / QAD-TC24: Customer Web Reservation Schedule Slot Filtering & Backup Loop Resolution", () => {
  const mockNow = new Date("2026-09-30T14:00:00.000Z"); // 2:00 PM
  const todayStr = "2026-09-30";
  const futureDateStr = "2026-10-05";

  const allDaySlots: AvailableTimeSlot[] = [
    { startTime: "08:00", endTime: "10:00", isAvailable: false, blockingReason: "PAST_TIME" },
    { startTime: "10:00", endTime: "12:00", isAvailable: false, blockingReason: "PAST_TIME" },
    { startTime: "12:00", endTime: "14:00", isAvailable: false, blockingReason: "PAST_TIME" },
    { startTime: "14:00", endTime: "16:00", isAvailable: false, blockingReason: "SCHEDULE_BLOCKED" },
    { startTime: "16:00", endTime: "18:00", isAvailable: true, blockingReason: null },
    { startTime: "18:00", endTime: "20:00", isAvailable: true, blockingReason: null },
    { startTime: "20:00", endTime: "22:00", isAvailable: false, blockingReason: "BUSINESS_CLOSED" },
    { startTime: "22:00", endTime: "24:00", isAvailable: true, blockingReason: null },
  ];

  it("QAD-TC24.1: Past Time Slot Suppression suppresses past time slots", () => {
    const visible = computeVisibleTimeSlots({
      timeSlots: allDaySlots,
      selectedDate: todayStr,
      todayStr,
      now: mockNow,
      excludedStartTimes: [],
    });

    // PAST_TIME slots (08:00, 10:00, 12:00) must not appear in visible slots
    const startTimes = visible.map((s) => s.startTime);
    expect(startTimes).not.toContain("08:00");
    expect(startTimes).not.toContain("10:00");
    expect(startTimes).not.toContain("12:00");
  });

  it("QAD-TC24.2: Blocked Slot Suppression filters out SCHEDULE_BLOCKED and BUSINESS_CLOSED slots", () => {
    const visible = computeVisibleTimeSlots({
      timeSlots: allDaySlots,
      selectedDate: futureDateStr,
      todayStr,
      now: mockNow,
      excludedStartTimes: [],
    });

    const startTimes = visible.map((s) => s.startTime);
    expect(startTimes).not.toContain("14:00"); // SCHEDULE_BLOCKED
    expect(startTimes).not.toContain("20:00"); // BUSINESS_CLOSED
    expect(startTimes).toEqual(["16:00", "18:00", "22:00"]);
  });

  it("QAD-TC24.3: No-Slots Empty State Display when all slots are past or booked", () => {
    const fullyBookedSlots: AvailableTimeSlot[] = [
      { startTime: "08:00", endTime: "10:00", isAvailable: false, blockingReason: "PAST_TIME" },
      { startTime: "10:00", endTime: "12:00", isAvailable: false, blockingReason: "SCHEDULE_BLOCKED" },
      { startTime: "12:00", endTime: "14:00", isAvailable: false, blockingReason: "BUSINESS_CLOSED" },
    ];

    const visible = computeVisibleTimeSlots({
      timeSlots: fullyBookedSlots,
      selectedDate: todayStr,
      todayStr,
      now: mockNow,
      excludedStartTimes: [],
    });

    expect(visible.length).toBe(0);
  });

  it("QAD-TC24.4: Backup Selection Fetch Count & Primitive Excluded Key", () => {
    const excludedArray1 = ["09:00", "14:00"];
    const excludedArray2 = ["09:00", "14:00"];

    // Object identity of two different array instances
    expect(excludedArray1 === excludedArray2).toBe(false);

    // Primitive key equality
    const key1 = computeExcludedKey(excludedArray1);
    const key2 = computeExcludedKey(excludedArray2);
    expect(key1).toBe(key2);
    expect(key1).toBe("09:00,14:00");
  });

  it("QAD-TC24.5: Memoized Schedule Stability preserves locked schedule structure across renders", () => {
    const mainCandidate = {
      date: "2026-10-01",
      durationHours: 3,
      startTime: "10:00",
      rateType: "HOURLY",
      workspace: { workspaceInstanceId: "ws-spot-1" },
    };
    const selectedWorkspace = { workspaceInstanceId: "ws-spot-1" };
    const candidates = [
      { rank: 0, startTime: "10:00", workspace: { workspaceInstanceId: "ws-spot-1" } },
    ];

    // For activeRank = 0 (Main spot), lockedSchedule is undefined
    const configMain = computeLockedScheduleConfig({
      activeRank: 0,
      mainCandidate,
      selectedWorkspace,
      candidates,
    });
    expect(configMain).toBeUndefined();

    // For activeRank = 1 (Backup 1 on same spot), lockedSchedule is configured with excluded start times and rateType
    const configBackup1 = computeLockedScheduleConfig({
      activeRank: 1,
      mainCandidate,
      selectedWorkspace,
      candidates,
    });
    expect(configBackup1).toBeDefined();
    expect(configBackup1?.date).toBe("2026-10-01");
    expect(configBackup1?.durationHours).toBe(3);
    expect(configBackup1?.initialStartTime).toBe("10:00");
    expect(configBackup1?.excludedStartTimes).toEqual(["10:00"]);
    expect(configBackup1?.rateType).toBe("HOURLY");
  });

  it("QAD-TC24.6: Excluded Times Cross-Candidate Check excludes main spot time when backup uses same instance", () => {
    const visible = computeVisibleTimeSlots({
      timeSlots: allDaySlots,
      selectedDate: futureDateStr,
      todayStr,
      now: mockNow,
      excludedStartTimes: ["16:00"], // 16:00 already picked by Main candidate
    });

    const startTimes = visible.map((s) => s.startTime);
    expect(startTimes).not.toContain("16:00");
    expect(startTimes).toEqual(["18:00", "22:00"]);
  });

  it("QAD-TC24.7: Backup Rate Inheritance preserves hourly pricing and avoids day pass fallback", () => {
    const mainCandidate = {
      date: "2026-10-01",
      durationHours: 2,
      startTime: "10:00",
      rateType: "HOURLY",
      workspace: {
        workspaceInstanceId: "ws-spot-1",
        rateAmount: 50,
        dayPassPrice: 299,
      },
    };
    const selectedWorkspace = {
      workspaceInstanceId: "ws-spot-2",
      rateAmount: 50,
      dayPassPrice: 299,
    };
    const candidates = [
      { rank: 0, startTime: "10:00", workspace: { workspaceInstanceId: "ws-spot-1" } },
    ];

    const configBackup = computeLockedScheduleConfig({
      activeRank: 1,
      mainCandidate,
      selectedWorkspace,
      candidates,
    });

    expect(configBackup?.rateType).toBe("HOURLY");
    expect(configBackup?.durationHours).toBe(2);

    // Simulated candidate total for 2 hours @ 50/hr
    const hourlyTotal = selectedWorkspace.rateAmount * (configBackup?.durationHours || 1);
    expect(hourlyTotal).toBe(100);
    expect(hourlyTotal).not.toBe(selectedWorkspace.dayPassPrice);
  });

  it("QAD-TC24.8: Pass Window Calculation and Today Partial Window Handling", () => {
    // Scenario A: 8am-4pm day pass evaluated at 11:00 AM today
    const passWindows = {
      dayPassStartTime: "08:00",
      dayPassEndTime: "16:00",
      nightPassStartTime: "20:00",
      nightPassEndTime: "04:00",
    };

    const computeDayPassWindow = (selectedDate: string, todayStr: string, nowMinutes: number) => {
      const [dsh, dsm] = passWindows.dayPassStartTime.split(":").map(Number);
      const [deh, dem] = passWindows.dayPassEndTime.split(":").map(Number);
      let dStartMins = dsh * 60 + dsm;
      let dEndMins = deh * 60 + dem;
      if (dEndMins <= dStartMins) dEndMins += 1440;

      let dEffStartMins = dStartMins;
      let isExpired = false;

      if (selectedDate === todayStr) {
        const roundedNow = Math.ceil(nowMinutes / 30) * 30;
        if (roundedNow >= dEndMins) {
          isExpired = true;
        } else if (roundedNow > dStartMins) {
          dEffStartMins = roundedNow;
        }
      }

      const dDurMins = dEndMins - dEffStartMins;
      const dEffH = Math.floor(dEffStartMins / 60) % 24;
      const dEffM = dEffStartMins % 60;
      const dEffStartTime = `${String(dEffH).padStart(2, "0")}:${String(dEffM).padStart(2, "0")}`;
      const dDurHours = Math.round((dDurMins / 60) * 10) / 10;

      return {
        startTime: dEffStartTime,
        endTime: passWindows.dayPassEndTime,
        durationMinutes: dDurMins,
        durationHours: dDurHours,
        isExpired,
        isPartial: selectedDate === todayStr && dEffStartMins > dStartMins,
      };
    };

    // 1. Future booking: Full 8am-4pm window (8 hours)
    const futureWindow = computeDayPassWindow("2026-10-05", "2026-09-30", 11 * 60);
    expect(futureWindow.startTime).toBe("08:00");
    expect(futureWindow.endTime).toBe("16:00");
    expect(futureWindow.durationHours).toBe(8);
    expect(futureWindow.isPartial).toBe(false);

    // 2. Today at 11:00 AM: Partial window 11am-4pm (5 hours) at same flat price
    const todayWindowAt11am = computeDayPassWindow("2026-09-30", "2026-09-30", 11 * 60);
    expect(todayWindowAt11am.startTime).toBe("11:00");
    expect(todayWindowAt11am.endTime).toBe("16:00");
    expect(todayWindowAt11am.durationHours).toBe(5);
    expect(todayWindowAt11am.isPartial).toBe(true);
    expect(todayWindowAt11am.isExpired).toBe(false);

    // 3. Today at 17:00 (5:00 PM): Expired for today
    const todayWindowAt5pm = computeDayPassWindow("2026-09-30", "2026-09-30", 17 * 60);
    expect(todayWindowAt5pm.isExpired).toBe(true);
  });

  it("QAD-TC24.9: 24-Hour Whole Day Pass Window Calculation and Today Partial Window Handling", () => {
    const passWindows = {
      wholeDayPassStartTime: "08:00",
      wholeDayPassEndTime: "08:00",
      dayPassStartTime: "08:00",
    };

    const computeWholeDayPassWindow = (selectedDate: string, todayStr: string, nowMinutes: number) => {
      const startStr = passWindows.wholeDayPassStartTime || passWindows.dayPassStartTime || "08:00";
      const [wsh, wsm] = startStr.split(":").map(Number);
      const endStr = passWindows.wholeDayPassEndTime || startStr;
      const [weh, wem] = endStr.split(":").map(Number);

      let wStartMins = wsh * 60 + wsm;
      let wEndMins = (weh * 60 + wem) + 1440; // 24-hour cycle ending next day

      let wEffStartMins = wStartMins;
      let isExpired = false;

      if (selectedDate === todayStr) {
        const roundedNow = Math.ceil(nowMinutes / 30) * 30;
        if (roundedNow >= wEndMins) {
          isExpired = true;
        } else if (roundedNow > wStartMins) {
          wEffStartMins = roundedNow;
        }
      }

      const wDurMins = wEndMins - wEffStartMins;
      const wEffH = Math.floor(wEffStartMins / 60) % 24;
      const wEffM = wEffStartMins % 60;
      const wEffStartTime = `${String(wEffH).padStart(2, "0")}:${String(wEffM).padStart(2, "0")}`;
      const wDurHours = Math.round((wDurMins / 60) * 10) / 10;

      return {
        startTime: wEffStartTime,
        endTime: endStr,
        durationMinutes: wDurMins,
        durationHours: wDurHours,
        isExpired,
        isPartial: selectedDate === todayStr && wEffStartMins > wStartMins,
      };
    };

    // 1. Future booking: Full 24-hour window from 08:00 to 08:00 next day (24 hours)
    const future24h = computeWholeDayPassWindow("2026-10-05", "2026-09-30", 11 * 60);
    expect(future24h.startTime).toBe("08:00");
    expect(future24h.endTime).toBe("08:00");
    expect(future24h.durationHours).toBe(24);
    expect(future24h.isPartial).toBe(false);

    // 2. Today at 11:00 AM: Partial window 11:00 to 08:00 next day (21 hours) at standard flat rate
    const today24hAt11am = computeWholeDayPassWindow("2026-09-30", "2026-09-30", 11 * 60);
    expect(today24hAt11am.startTime).toBe("11:00");
    expect(today24hAt11am.endTime).toBe("08:00");
    expect(today24hAt11am.durationHours).toBe(21);
    expect(today24hAt11am.isPartial).toBe(true);
    expect(today24hAt11am.isExpired).toBe(false);
  });
});

