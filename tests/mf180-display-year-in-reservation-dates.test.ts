import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  formatSchedule,
  formatTimelineDate,
  createAdminReservationService,
  createStaffOperationsService,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("MF-180: Display Year in Reservation Date Formats Across Admin and Staff", () => {
  describe("formatSchedule", () => {
    it("formats same-day schedule with 4-digit year", () => {
      // 2026-09-23 09:00 to 11:00 Manila (UTC: 01:00 to 03:00)
      const startAt = "2026-09-23T01:00:00.000Z";
      const endAt = "2026-09-23T03:00:00.000Z";
      const result = formatSchedule(startAt, endAt, "Asia/Manila");

      assert.equal(result, "Sep 23, 2026, 9:00 AM - 11:00 AM");
      assert.ok(result.includes("2026"), "Should include the 4-digit year 2026");
    });

    it("formats cross-day schedule within the same year with date and year on both bounds", () => {
      // 2026-09-23 23:00 to 2026-09-24 02:00 Manila
      const startAt = "2026-09-23T15:00:00.000Z";
      const endAt = "2026-09-23T18:00:00.000Z";
      const result = formatSchedule(startAt, endAt, "Asia/Manila");

      assert.equal(result, "Sep 23, 2026, 11:00 PM - Sep 24, 2026, 2:00 AM");
      assert.ok(result.includes("Sep 23, 2026"), "Start date includes year");
      assert.ok(result.includes("Sep 24, 2026"), "End date includes year");
    });

    it("formats cross-year schedule with both calendar years clearly displayed", () => {
      // 2026-12-31 22:00 to 2027-01-01 02:00 Manila
      const startAt = "2026-12-31T14:00:00.000Z";
      const endAt = "2026-12-31T18:00:00.000Z";
      const result = formatSchedule(startAt, endAt, "Asia/Manila");

      assert.equal(result, "Dec 31, 2026, 10:00 PM - Jan 1, 2027, 2:00 AM");
      assert.ok(result.includes("2026"), "Should include 2026 for start");
      assert.ok(result.includes("2027"), "Should include 2027 for end");
    });

    it("handles missing or unparseable inputs gracefully", () => {
      assert.equal(formatSchedule(null, null), "Schedule not set");
      assert.equal(formatSchedule(undefined, "2026-09-23T01:00:00.000Z"), "Schedule not set");
      assert.equal(formatSchedule("not-a-date", "also-not-a-date"), "not-a-date - also-not-a-date");
    });
  });

  describe("formatTimelineDate", () => {
    it("formats timeline dates with 4-digit year", () => {
      const iso = "2026-09-23T01:30:00.000Z"; // 09:30 AM Manila
      const result = formatTimelineDate(iso, "Asia/Manila");

      assert.equal(result, "Sep 23, 2026, 9:30 AM");
      assert.ok(result.includes("2026"), "Should include the 4-digit year");
    });

    it("handles unparseable date inputs gracefully", () => {
      assert.equal(formatTimelineDate("invalid-iso"), "invalid-iso");
    });
  });

  describe("Admin & Staff Reservation Service Integration", () => {
    it("Admin reservation list and detail include 4-digit year in candidate and main schedules", async () => {
      const repo = new ReservationMemoryRepository();
      const adminService = createAdminReservationService(repo);

      const reservation = await repo.createReservation({
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "Smith",
        customerEmail: "alice@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "desk-01",
            startAt: "2026-09-23T01:00:00.000Z",
            endAt: "2026-09-23T03:00:00.000Z",
          },
          {
            rank: 1,
            workspaceInstanceId: "desk-02",
            startAt: "2026-09-23T03:00:00.000Z",
            endAt: "2026-09-23T05:00:00.000Z",
          },
        ],
      });

      // Fetch admin reservation list
      const list = await adminService.listReservations();
      const item = list.reservations.find((r) => r.referenceCode === reservation.referenceCode);
      assert.ok(item, "Reservation should be in admin list");
      assert.ok(item.schedule.includes("2026"), `Admin list row schedule should include year: ${item.schedule}`);
      assert.equal(item.schedule, "Sep 23, 2026, 9:00 AM - 11:00 AM");

      // Fetch admin detail
      const detail = await adminService.getReservationDetail(reservation.id);
      assert.ok(detail, "Detail should exist");
      assert.ok(detail.schedule.includes("2026"), `Detail schedule should include year: ${detail.schedule}`);
      assert.equal(detail.schedule, "Sep 23, 2026, 9:00 AM - 11:00 AM");

      // Check candidate schedules
      assert.ok(detail.candidates && detail.candidates.length === 2);
      assert.ok(detail.candidates[0].schedule.includes("2026"), "Main candidate schedule includes year");
      assert.ok(detail.candidates[1].schedule.includes("2026"), "Alternative candidate schedule includes year");
    });

    it("Staff operational reservation detail includes 4-digit year in schedule", async () => {
      const repo = new ReservationMemoryRepository();
      const staffService = createStaffOperationsService(repo);

      const reservation = await repo.createReservation({
        source: "KIOSK",
        customerFirstName: "Bob",
        customerLastName: "Brown",
        customerEmail: "bob@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "desk-03",
            startAt: "2026-10-15T02:00:00.000Z",
            endAt: "2026-10-15T04:00:00.000Z",
          },
        ],
      });

      const detail = await staffService.getReservationDetail(reservation.id, "STAFF");
      assert.ok(detail, "Staff detail should exist");
      assert.ok(detail.schedule.includes("2026"), `Staff detail schedule should include year: ${detail.schedule}`);
      assert.equal(detail.schedule, "Oct 15, 2026, 10:00 AM - 12:00 PM");
    });
  });
});
