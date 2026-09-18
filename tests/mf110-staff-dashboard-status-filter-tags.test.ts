import { describe, it, expect } from "vitest";
import {
  matchesStaffReservationFilter,
  filterStaffReservationsByStatus,
  STAFF_RESERVATION_FILTERS,
  filterReservationsBySearch,
  type StaffOperationalReservation,
  type StaffReservationFilter,
} from "@deskatlas/domain";

describe("MF-110: Staff Dashboard Reservations Status Filter Tags Parity", () => {
  const fixedNow = new Date("2026-09-16T14:00:00Z");

  const sampleReservations: StaffOperationalReservation[] = [
    {
      reservationId: "res-1",
      referenceCode: "DA-1001",
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Smith",
      customerEmail: "alice@example.com",
      reservationStatus: "CHECKED_IN",
      checkInState: "CHECKED_IN",
      workspaceInstanceId: "ws-1",
      workspaceDisplayName: "Hot Desk 01",
      workspaceInstanceCode: "HD-01",
      workspaceTemplateName: "Hot Desk",
      floorName: "Main Floor",
      bookingStartAt: "2026-09-16T13:00:00Z",
      bookingEndAt: "2026-09-16T17:00:00Z",
      confirmedAt: "2026-09-16T12:00:00Z",
      checkedInAt: "2026-09-16T13:05:00Z",
      checkedOutAt: null,
      qrIssuedAt: "2026-09-16T12:00:00Z",
    },
    {
      reservationId: "res-2",
      referenceCode: "DA-1002",
      source: "KIOSK",
      customerFirstName: "Bob",
      customerLastName: "Johnson",
      customerEmail: "bob@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-2",
      workspaceDisplayName: "Dedicated Desk 04",
      workspaceInstanceCode: "DD-04",
      workspaceTemplateName: "Dedicated Desk",
      floorName: "Main Floor",
      bookingStartAt: "2026-09-16T13:30:00Z",
      bookingEndAt: "2026-09-16T16:30:00Z",
      confirmedAt: "2026-09-16T13:15:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-16T13:15:00Z",
    },
    {
      reservationId: "res-3",
      referenceCode: "DA-1003",
      source: "WEB",
      customerFirstName: "Charlie",
      customerLastName: "Brown",
      customerEmail: "charlie@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-3",
      workspaceDisplayName: "Meeting Room Alpha",
      workspaceInstanceCode: "MR-A",
      workspaceTemplateName: "Meeting Room",
      floorName: "Second Floor",
      bookingStartAt: "2026-09-16T15:00:00Z",
      bookingEndAt: "2026-09-16T18:00:00Z",
      confirmedAt: "2026-09-16T11:00:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-16T11:00:00Z",
    },
    {
      reservationId: "res-4",
      referenceCode: "DA-1004",
      source: "WEB",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerEmail: "diana@example.com",
      reservationStatus: "COMPLETED",
      checkInState: "CHECKED_OUT",
      workspaceInstanceId: "ws-4",
      workspaceDisplayName: "Hot Desk 02",
      workspaceInstanceCode: "HD-02",
      workspaceTemplateName: "Hot Desk",
      floorName: "Main Floor",
      bookingStartAt: "2026-09-16T09:00:00Z",
      bookingEndAt: "2026-09-16T12:00:00Z",
      confirmedAt: "2026-09-16T08:30:00Z",
      checkedInAt: "2026-09-16T09:02:00Z",
      checkedOutAt: "2026-09-16T11:55:00Z",
      qrIssuedAt: "2026-09-16T08:30:00Z",
    },
    {
      reservationId: "res-5",
      referenceCode: "DA-1005",
      source: "KIOSK",
      customerFirstName: "Evan",
      customerLastName: "Wright",
      customerEmail: "evan@example.com",
      reservationStatus: "PENDING_COUNTER_CONFIRMATION",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: null,
      workspaceDisplayName: "Hot Desk",
      workspaceInstanceCode: null,
      workspaceTemplateName: "Hot Desk",
      floorName: null,
      bookingStartAt: "2026-09-16T14:30:00Z",
      bookingEndAt: "2026-09-16T17:30:00Z",
      confirmedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: null,
    },
  ];

  it("exports the required 6 status filter options in expected order", () => {
    expect(STAFF_RESERVATION_FILTERS).toEqual([
      { label: "Active", filter: "active" },
      { label: "All", filter: "all" },
      { label: "Checked In", filter: "checked_in" },
      { label: "Upcoming", filter: "upcoming" },
      { label: "Confirmed", filter: "confirmed" },
      { label: "Counter Queue", filter: "counter_queue" },
    ]);
  });

  it("filters by 'Active' to include currently CHECKED_IN or CONFIRMED bookings within current time range", () => {
    const result = filterStaffReservationsByStatus(sampleReservations, "active", fixedNow);
    // res-1: CHECKED_IN (active)
    // res-2: CONFIRMED and 14:00 is between 13:30 and 16:30 (active)
    // res-3: CONFIRMED but start is 15:00 (upcoming, not yet active)
    // res-4: COMPLETED (not active)
    // res-5: PENDING_COUNTER_CONFIRMATION (not active)
    expect(result.map((r) => r.reservationId)).toEqual(["res-1", "res-2"]);
  });

  it("filters by 'All' to return all operational reservations", () => {
    const result = filterStaffReservationsByStatus(sampleReservations, "all", fixedNow);
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.reservationId)).toEqual(["res-1", "res-2", "res-3", "res-4", "res-5"]);
  });

  it("filters by 'Checked In' to return only checked-in guests", () => {
    const result = filterStaffReservationsByStatus(sampleReservations, "checked_in", fixedNow);
    expect(result.map((r) => r.reservationId)).toEqual(["res-1"]);
    expect(result[0].customerFirstName).toBe("Alice");
  });

  it("filters by 'Upcoming' to return future confirmed bookings that have not started yet", () => {
    const result = filterStaffReservationsByStatus(sampleReservations, "upcoming", fixedNow);
    // Only res-3 is CONFIRMED with start time 15:00 > now (14:00)
    expect(result.map((r) => r.reservationId)).toEqual(["res-3"]);
    expect(result[0].customerFirstName).toBe("Charlie");
  });

  it("filters by 'Confirmed' to return all confirmed bookings regardless of time", () => {
    const result = filterStaffReservationsByStatus(sampleReservations, "confirmed", fixedNow);
    // res-2 and res-3 are CONFIRMED
    expect(result.map((r) => r.reservationId)).toEqual(["res-2", "res-3"]);
  });

  it("filters by 'Counter Queue' to return reservations pending counter confirmation", () => {
    const result = filterStaffReservationsByStatus(sampleReservations, "counter_queue", fixedNow);
    expect(result.map((r) => r.reservationId)).toEqual(["res-5"]);
    expect(result[0].customerFirstName).toBe("Evan");
  });

  it("combines status filtering with search queries accurately", () => {
    // Under 'Active', search for "Alice" -> returns only res-1
    const activeResults = filterStaffReservationsByStatus(sampleReservations, "active", fixedNow);
    const searchedAlice = filterReservationsBySearch(activeResults, "Alice");
    expect(searchedAlice.map((r) => r.reservationId)).toEqual(["res-1"]);

    // Under 'Active', search for "Charlie" -> returns empty since Charlie is upcoming
    const searchedCharlie = filterReservationsBySearch(activeResults, "Charlie");
    expect(searchedCharlie).toHaveLength(0);

    // Under 'Upcoming', search for "Charlie" -> returns res-3
    const upcomingResults = filterStaffReservationsByStatus(sampleReservations, "upcoming", fixedNow);
    const searchedCharlieUpcoming = filterReservationsBySearch(upcomingResults, "Charlie");
    expect(searchedCharlieUpcoming.map((r) => r.reservationId)).toEqual(["res-3"]);

    // Search by reference code
    const searchedRef = filterReservationsBySearch(activeResults, "DA-1001");
    expect(searchedRef.map((r) => r.reservationId)).toEqual(["res-1"]);
  });

  it("handles boundary edge cases for active and upcoming time calculations", () => {
    const boundaryRes: StaffOperationalReservation = {
      reservationId: "res-boundary",
      referenceCode: "DA-9999",
      source: "WEB",
      customerFirstName: "Test",
      customerLastName: "User",
      customerEmail: "test@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-1",
      workspaceDisplayName: "Desk 1",
      workspaceInstanceCode: "D1",
      workspaceTemplateName: "Desk",
      floorName: "Floor 1",
      bookingStartAt: "2026-09-16T14:00:00Z",
      bookingEndAt: "2026-09-16T15:00:00Z",
      confirmedAt: "2026-09-16T13:00:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-16T13:00:00Z",
    };

    // Exactly at start time (14:00:00Z) -> Active = true, Upcoming = false
    expect(matchesStaffReservationFilter(boundaryRes, "active", new Date("2026-09-16T14:00:00Z"))).toBe(true);
    expect(matchesStaffReservationFilter(boundaryRes, "upcoming", new Date("2026-09-16T14:00:00Z"))).toBe(false);

    // 1 millisecond before start time (13:59:59.999Z) -> Active = false, Upcoming = true
    expect(matchesStaffReservationFilter(boundaryRes, "active", new Date("2026-09-16T13:59:59.999Z"))).toBe(false);
    expect(matchesStaffReservationFilter(boundaryRes, "upcoming", new Date("2026-09-16T13:59:59.999Z"))).toBe(true);

    // Exactly at end time (15:00:00Z) -> Active = false, Upcoming = false
    expect(matchesStaffReservationFilter(boundaryRes, "active", new Date("2026-09-16T15:00:00Z"))).toBe(false);
    expect(matchesStaffReservationFilter(boundaryRes, "upcoming", new Date("2026-09-16T15:00:00Z"))).toBe(false);
  });
});
