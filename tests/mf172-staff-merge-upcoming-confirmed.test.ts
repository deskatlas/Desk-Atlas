import { describe, it, expect } from "vitest";
import {
  filterStaffReservationsByTab,
  getStaffReservationTabCounts,
  isStaffBookingManagementReservation,
  isStaffOperationsReservation,
  isStaffCompletedReservation,
  isStaffExpiredReservation,
  STAFF_RESERVATIONS_TAB_FILTERS,
  STAFF_OPERATIONS_TAB_FILTERS,
  STAFF_COMPLETED_TAB_FILTERS,
  STAFF_EXPIRED_TAB_FILTERS,
  type StaffOperationalReservation,
} from "@deskatlas/domain";

describe("MF-172: Staff Reservations - Merge Upcoming and Confirmed Filters", () => {
  const fixedNow = new Date("2026-09-22T10:00:00Z");

  const sampleStaffReservations: StaffOperationalReservation[] = [
    // 1. Upcoming Confirmed (Starts in future: 14:00 - 18:00)
    {
      reservationId: "res-conf-future-1",
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
    // 2. Upcoming Confirmed (Starts in future: 11:00 - 15:00)
    {
      reservationId: "res-conf-future-2",
      referenceCode: "DA-CONF-2",
      source: "KIOSK",
      customerFirstName: "Bob",
      customerLastName: "Jones",
      customerEmail: "bob@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Dedicated Desk 02",
      workspaceInstanceCode: "DD-02",
      bookingStartAt: "2026-09-22T11:00:00Z",
      bookingEndAt: "2026-09-22T15:00:00Z",
    },
    // 3. Counter Queue
    {
      reservationId: "res-counter-1",
      referenceCode: "DA-CQ-1",
      source: "KIOSK",
      customerFirstName: "Charlie",
      customerLastName: "Brown",
      customerEmail: "charlie@example.com",
      reservationStatus: "PENDING_COUNTER_CONFIRMATION",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Hot Desk 03",
      workspaceInstanceCode: "HD-03",
      bookingStartAt: "2026-09-22T10:00:00Z",
      bookingEndAt: "2026-09-22T12:00:00Z",
    },
    // 4. In-Session Active Confirmed (Active Operations: 09:00 - 13:00)
    {
      reservationId: "res-act-1",
      referenceCode: "DA-ACT-1",
      source: "WEB",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerEmail: "diana@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Meeting Room A",
      workspaceInstanceCode: "MR-A",
      bookingStartAt: "2026-09-22T09:00:00Z",
      bookingEndAt: "2026-09-22T13:00:00Z",
    },
    // 5. Checked-In Active (Active Operations)
    {
      reservationId: "res-ci-1",
      referenceCode: "DA-CI-1",
      source: "WEB",
      customerFirstName: "Edward",
      customerLastName: "Elric",
      customerEmail: "edward@example.com",
      reservationStatus: "CHECKED_IN",
      checkInState: "CHECKED_IN",
      workspaceDisplayName: "Hot Desk 04",
      workspaceInstanceCode: "HD-04",
      bookingStartAt: "2026-09-22T08:00:00Z",
      bookingEndAt: "2026-09-22T12:00:00Z",
      checkedInAt: "2026-09-22T08:05:00Z",
    },
    // 6. Completed
    {
      reservationId: "res-comp-1",
      referenceCode: "DA-COMP-1",
      source: "WEB",
      customerFirstName: "Fiona",
      customerLastName: "Gallagher",
      customerEmail: "fiona@example.com",
      reservationStatus: "COMPLETED",
      checkInState: "CHECKED_OUT",
      workspaceDisplayName: "Hot Desk 05",
      workspaceInstanceCode: "HD-05",
      bookingStartAt: "2026-09-22T06:00:00Z",
      bookingEndAt: "2026-09-22T09:00:00Z",
      checkedInAt: "2026-09-22T06:01:00Z",
      checkedOutAt: "2026-09-22T08:58:00Z",
    },
    // 7. Expired
    {
      reservationId: "res-exp-1",
      referenceCode: "DA-EXP-1",
      source: "WEB",
      customerFirstName: "George",
      customerLastName: "Clark",
      customerEmail: "george@example.com",
      reservationStatus: "EXPIRED",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Hot Desk 06",
      workspaceInstanceCode: "HD-06",
      bookingStartAt: "2026-09-22T06:00:00Z",
      bookingEndAt: "2026-09-22T08:00:00Z",
    },
    // 8. Cancelled
    {
      reservationId: "res-canc-1",
      referenceCode: "DA-CANC-1",
      source: "WEB",
      customerFirstName: "Hannah",
      customerLastName: "Abbott",
      customerEmail: "hannah@example.com",
      reservationStatus: "CANCELLED",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Hot Desk 07",
      workspaceInstanceCode: "HD-07",
      bookingStartAt: "2026-09-22T15:00:00Z",
      bookingEndAt: "2026-09-22T17:00:00Z",
    },
  ];

  it("verifies STAFF_RESERVATIONS_TAB_FILTERS contains exactly one merged Upcoming filter (no duplicate Confirmed)", () => {
    expect(STAFF_RESERVATIONS_TAB_FILTERS).toEqual([
      { label: "All", filter: "all" },
      { label: "Upcoming", filter: "upcoming" },
      { label: "Counter Queue", filter: "counter_queue" },
      { label: "Cancelled", filter: "cancelled" },
    ]);

    const filters = STAFF_RESERVATIONS_TAB_FILTERS.map((f) => f.filter);
    expect(filters).toContain("upcoming");
    expect(filters).not.toContain("confirmed");
    expect(filters).toHaveLength(4);
  });

  it("confirms filter equivalence: upcoming subfilter returns all upcoming confirmed bookings", () => {
    const upcomingResults = filterStaffReservationsByTab(
      sampleStaffReservations,
      "reservations",
      "upcoming",
      fixedNow
    );

    expect(upcomingResults).toHaveLength(2);
    expect(upcomingResults.map((r) => r.referenceCode)).toEqual(["DA-CONF-1", "DA-CONF-2"]);
    expect(upcomingResults.every((r) => r.reservationStatus === "CONFIRMED")).toBe(true);
  });

  it("confirms backwards compatibility: passing 'confirmed' produces the exact same records as 'upcoming'", () => {
    const upcomingResults = filterStaffReservationsByTab(
      sampleStaffReservations,
      "reservations",
      "upcoming",
      fixedNow
    );
    const confirmedResults = filterStaffReservationsByTab(
      sampleStaffReservations,
      "reservations",
      "confirmed",
      fixedNow
    );

    expect(confirmedResults).toEqual(upcomingResults);
  });

  it("verifies that in-session active confirmed reservations are excluded from Upcoming filter and routed to Operations", () => {
    const upcomingResults = filterStaffReservationsByTab(
      sampleStaffReservations,
      "reservations",
      "upcoming",
      fixedNow
    );
    expect(upcomingResults.find((r) => r.referenceCode === "DA-ACT-1")).toBeUndefined();

    const operationsResults = filterStaffReservationsByTab(
      sampleStaffReservations,
      "operations",
      "all",
      fixedNow
    );
    expect(operationsResults.map((r) => r.referenceCode)).toContain("DA-ACT-1");
  });

  it("verifies badge counts and other tab subfilters remain correct", () => {
    const counts = getStaffReservationTabCounts(sampleStaffReservations, fixedNow);
    // Reservations: 2 upcoming confirmed + 1 counter queue = 3
    expect(counts.reservationsBadgeCount).toBe(3);
    // Operations: 1 in-session active + 1 checked in = 2
    expect(counts.operationsBadgeCount).toBe(2);
    // Completed: 1
    expect(counts.completedBadgeCount).toBe(1);
    // Expired: 1 expired + 1 cancelled = 2
    expect(counts.expiredBadgeCount).toBe(2);

    // Other tab filters are intact
    expect(STAFF_OPERATIONS_TAB_FILTERS.map((f) => f.filter)).toEqual(["all", "active", "checked_in"]);
    expect(STAFF_COMPLETED_TAB_FILTERS.map((f) => f.filter)).toEqual(["all", "completed"]);
    expect(STAFF_EXPIRED_TAB_FILTERS.map((f) => f.filter)).toEqual(["all", "expired", "rejected", "cancelled"]);
  });
});
