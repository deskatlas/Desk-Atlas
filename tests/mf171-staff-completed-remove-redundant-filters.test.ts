import { describe, it, expect } from "vitest";
import {
  filterStaffReservationsByTab,
  getStaffReservationTabCounts,
  isStaffCompletedReservation,
  isStaffBookingManagementReservation,
  isStaffOperationsReservation,
  isStaffExpiredReservation,
  STAFF_RESERVATIONS_TAB_FILTERS,
  STAFF_OPERATIONS_TAB_FILTERS,
  STAFF_EXPIRED_TAB_FILTERS,
  type StaffOperationalReservation,
} from "@deskatlas/domain";

describe("MF-171: Staff Reservations - Remove Redundant All/Completed Filters Under Completed Tab", () => {
  const fixedNow = new Date("2026-09-22T10:00:00Z");

  const sampleStaffReservations: StaffOperationalReservation[] = [
    // 1. Confirmed / Upcoming
    {
      reservationId: "res-conf-1",
      referenceCode: "DA-CONF-1",
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Smith",
      customerEmail: "alice@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Hot Desk 01",
      workspaceInstanceCode: "HD-01",
      bookingStartAt: "2026-09-22T14:00:00Z",
      bookingEndAt: "2026-09-22T18:00:00Z",
    },
    // 2. Checked In / Active Operations
    {
      reservationId: "res-act-1",
      referenceCode: "DA-ACT-1",
      source: "WEB",
      customerFirstName: "Bob",
      customerLastName: "Jones",
      customerEmail: "bob@example.com",
      reservationStatus: "CHECKED_IN",
      checkInState: "CHECKED_IN",
      workspaceDisplayName: "Hot Desk 02",
      workspaceInstanceCode: "HD-02",
      bookingStartAt: "2026-09-22T09:00:00Z",
      bookingEndAt: "2026-09-22T13:00:00Z",
      checkedInAt: "2026-09-22T09:05:00Z",
    },
    // 3. Completed Reservation 1
    {
      reservationId: "res-comp-1",
      referenceCode: "DA-COMP-1",
      source: "WEB",
      customerFirstName: "Charlie",
      customerLastName: "Brown",
      customerEmail: "charlie@example.com",
      reservationStatus: "COMPLETED",
      checkInState: "CHECKED_OUT",
      workspaceDisplayName: "Meeting Room A",
      workspaceInstanceCode: "MR-A",
      bookingStartAt: "2026-09-22T06:00:00Z",
      bookingEndAt: "2026-09-22T09:00:00Z",
      checkedInAt: "2026-09-22T06:01:00Z",
      checkedOutAt: "2026-09-22T08:58:00Z",
    },
    // 4. Completed Reservation 2 (Checked out with status COMPLETED)
    {
      reservationId: "res-comp-2",
      referenceCode: "DA-COMP-2",
      source: "KIOSK",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerEmail: "diana@example.com",
      reservationStatus: "COMPLETED",
      checkInState: "CHECKED_OUT",
      workspaceDisplayName: "Dedicated Desk 01",
      workspaceInstanceCode: "DD-01",
      bookingStartAt: "2026-09-22T07:00:00Z",
      bookingEndAt: "2026-09-22T09:30:00Z",
      checkedInAt: "2026-09-22T07:00:00Z",
      checkedOutAt: "2026-09-22T09:30:00Z",
    },
    // 5. Expired Reservation
    {
      reservationId: "res-exp-1",
      referenceCode: "DA-EXP-1",
      source: "WEB",
      customerFirstName: "Edward",
      customerLastName: "Elric",
      customerEmail: "edward@example.com",
      reservationStatus: "EXPIRED",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Hot Desk 03",
      workspaceInstanceCode: "HD-03",
      bookingStartAt: "2026-09-22T06:00:00Z",
      bookingEndAt: "2026-09-22T08:00:00Z",
    },
  ];

  it("filters Staff 'Completed' tab directly without requiring sub-filters and displays all completed records", () => {
    // Default / 'all' subfilter yields all completed items
    const completedResults = filterStaffReservationsByTab(
      sampleStaffReservations,
      "completed",
      "all",
      fixedNow
    );

    expect(completedResults).toHaveLength(2);
    expect(completedResults.map((r) => r.referenceCode)).toEqual(["DA-COMP-1", "DA-COMP-2"]);
    expect(completedResults.every((r) => isStaffCompletedReservation(r))).toBe(true);
  });

  it("ensures completed reservations are not shown in reservations, operations, or expired tabs", () => {
    const reservationsTab = filterStaffReservationsByTab(sampleStaffReservations, "reservations", "all", fixedNow);
    const operationsTab = filterStaffReservationsByTab(sampleStaffReservations, "operations", "all", fixedNow);
    const expiredTab = filterStaffReservationsByTab(sampleStaffReservations, "expired", "all", fixedNow);

    expect(reservationsTab.find((r) => r.referenceCode === "DA-COMP-1" || r.referenceCode === "DA-COMP-2")).toBeUndefined();
    expect(operationsTab.find((r) => r.referenceCode === "DA-COMP-1" || r.referenceCode === "DA-COMP-2")).toBeUndefined();
    expect(expiredTab.find((r) => r.referenceCode === "DA-COMP-1" || r.referenceCode === "DA-COMP-2")).toBeUndefined();
  });

  it("verifies badge count accuracy for completed reservations", () => {
    const counts = getStaffReservationTabCounts(sampleStaffReservations, fixedNow);
    expect(counts.completedBadgeCount).toBe(2);
    expect(counts.reservationsBadgeCount).toBe(1);
    expect(counts.operationsBadgeCount).toBe(1);
    expect(counts.expiredBadgeCount).toBe(1);
  });

  it("confirms other tabs (Reservations, Operations, Expired) retain their required sub-filters", () => {
    // Reservations Tab sub-filters
    expect(STAFF_RESERVATIONS_TAB_FILTERS.map((f) => f.filter)).toEqual([
      "all",
      "upcoming",
      "counter_queue",
      "cancelled",
    ]);

    // Operations Tab sub-filters
    expect(STAFF_OPERATIONS_TAB_FILTERS.map((f) => f.filter)).toEqual([
      "all",
      "active",
      "checked_in",
    ]);

    // Expired Tab sub-filters
    expect(STAFF_EXPIRED_TAB_FILTERS.map((f) => f.filter)).toEqual([
      "all",
      "expired",
      "cancelled",
    ]);
  });
});
