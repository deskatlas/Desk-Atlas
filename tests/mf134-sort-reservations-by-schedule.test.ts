import { describe, it, expect } from "vitest";
import {
  sortAdminReservationsBySchedule,
  sortStaffReservationsBySchedule,
  filterReservations,
  filterReservationsBySearch,
  filterStaffReservationsByStatus,
  type AdminReservationSummary,
  type StaffOperationalReservation,
} from "@deskatlas/domain";

describe("MF-134: Sort Reservations by Schedule / Time (Admin and Staff)", () => {
  const adminSample: AdminReservationSummary[] = [
    {
      id: "res-1",
      referenceCode: "DA-1001",
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Smith",
      customerName: "Alice Smith",
      customerInitials: "AS",
      customerEmail: "alice@example.com",
      workspaceDisplayName: "Hot Desk 01",
      schedule: "Sep 19, 09:00 - 12:00",
      startAt: "2026-09-19T09:00:00Z",
      endAt: "2026-09-19T12:00:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-success)",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "var(--da-info)", color: "var(--da-brand-dark)" },
      mark: "✓",
      amountDue: 500,
      currency: "PHP",
      createdAt: "2026-09-18T10:00:00Z",
    },
    {
      id: "res-2",
      referenceCode: "DA-1002",
      source: "WEB",
      customerFirstName: "Bob",
      customerLastName: "Jones",
      customerName: "Bob Jones",
      customerInitials: "BJ",
      customerEmail: "bob@example.com",
      workspaceDisplayName: "Dedicated Desk 04",
      schedule: "Sep 19, 14:00 - 18:00",
      startAt: "2026-09-19T14:00:00Z",
      endAt: "2026-09-19T18:00:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-success)",
      reservationStatus: "CHECKED_IN",
      status: "Checked In",
      statusStyle: { background: "var(--da-info)", color: "var(--da-brand-dark)" },
      mark: "✓",
      amountDue: 800,
      currency: "PHP",
      createdAt: "2026-09-18T11:00:00Z",
    },
    {
      id: "res-3",
      referenceCode: "DA-1003",
      source: "KIOSK",
      customerFirstName: "Charlie",
      customerLastName: "Brown",
      customerName: "Charlie Brown",
      customerInitials: "CB",
      customerEmail: "charlie@example.com",
      workspaceDisplayName: "Meeting Room Alpha",
      schedule: "Sep 19, 08:00 - 10:00",
      startAt: "2026-09-19T08:00:00Z",
      endAt: "2026-09-19T10:00:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-success)",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "var(--da-info)", color: "var(--da-brand-dark)" },
      mark: "✓",
      amountDue: 1500,
      currency: "PHP",
      createdAt: "2026-09-18T09:00:00Z",
    },
    {
      id: "res-4",
      referenceCode: "DA-1004",
      source: "WEB",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerName: "Diana Prince",
      customerInitials: "DP",
      customerEmail: "diana@example.com",
      workspaceDisplayName: "Hot Desk 02",
      schedule: "Sep 19, 09:00 - 13:00",
      startAt: "2026-09-19T09:00:00Z",
      endAt: "2026-09-19T13:00:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-success)",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "var(--da-info)", color: "var(--da-brand-dark)" },
      mark: "✓",
      amountDue: 600,
      currency: "PHP",
      createdAt: "2026-09-18T09:30:00Z",
    },
  ];

  const staffSample: StaffOperationalReservation[] = [
    {
      reservationId: "res-1",
      referenceCode: "DA-1001",
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Smith",
      customerEmail: "alice@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-1",
      workspaceDisplayName: "Hot Desk 01",
      workspaceInstanceCode: "HD-01",
      workspaceTemplateName: "Hot Desk",
      floorName: "Floor 1",
      bookingStartAt: "2026-09-19T10:00:00Z",
      bookingEndAt: "2026-09-19T14:00:00Z",
      confirmedAt: "2026-09-19T08:00:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-19T08:00:00Z",
    },
    {
      reservationId: "res-2",
      referenceCode: "DA-1002",
      source: "KIOSK",
      customerFirstName: "Bob",
      customerLastName: "Johnson",
      customerEmail: "bob@example.com",
      reservationStatus: "CHECKED_IN",
      checkInState: "CHECKED_IN",
      workspaceInstanceId: "ws-2",
      workspaceDisplayName: "Dedicated Desk 04",
      workspaceInstanceCode: "DD-04",
      workspaceTemplateName: "Dedicated Desk",
      floorName: "Floor 1",
      bookingStartAt: "2026-09-19T08:30:00Z",
      bookingEndAt: "2026-09-19T12:30:00Z",
      confirmedAt: "2026-09-19T08:15:00Z",
      checkedInAt: "2026-09-19T08:30:00Z",
      checkedOutAt: null,
      qrIssuedAt: "2026-09-19T08:15:00Z",
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
      floorName: "Floor 2",
      bookingStartAt: "2026-09-19T15:00:00Z",
      bookingEndAt: "2026-09-19T18:00:00Z",
      confirmedAt: "2026-09-19T09:00:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-19T09:00:00Z",
    },
    {
      reservationId: "res-4",
      referenceCode: "DA-1004",
      source: "WEB",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerEmail: "diana@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-4",
      workspaceDisplayName: "Hot Desk 02",
      workspaceInstanceCode: "HD-02",
      workspaceTemplateName: "Hot Desk",
      floorName: "Floor 1",
      bookingStartAt: "2026-09-19T10:00:00Z",
      bookingEndAt: "2026-09-19T16:00:00Z",
      confirmedAt: "2026-09-19T08:30:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-19T08:30:00Z",
    },
  ];

  describe("Admin Reservation Sorting", () => {
    it("sorts admin reservations by schedule ascending (earliest first)", () => {
      const sorted = sortAdminReservationsBySchedule(adminSample, "asc");
      expect(sorted.map((r) => r.referenceCode)).toEqual([
        "DA-1003", // 08:00
        "DA-1001", // 09:00 - 12:00
        "DA-1004", // 09:00 - 13:00
        "DA-1002", // 14:00
      ]);
    });

    it("sorts admin reservations by schedule descending (latest first)", () => {
      const sorted = sortAdminReservationsBySchedule(adminSample, "desc");
      expect(sorted.map((r) => r.referenceCode)).toEqual([
        "DA-1002", // 14:00
        "DA-1004", // 09:00 - 13:00
        "DA-1001", // 09:00 - 12:00
        "DA-1003", // 08:00
      ]);
    });

    it("breaks ties with end time and created at", () => {
      const tiedSample: AdminReservationSummary[] = [
        {
          ...adminSample[0],
          referenceCode: "REF-B",
          startAt: "2026-09-19T09:00:00Z",
          endAt: "2026-09-19T11:00:00Z",
        },
        {
          ...adminSample[0],
          referenceCode: "REF-A",
          startAt: "2026-09-19T09:00:00Z",
          endAt: "2026-09-19T10:00:00Z",
        },
      ];
      const asc = sortAdminReservationsBySchedule(tiedSample, "asc");
      expect(asc.map((r) => r.referenceCode)).toEqual(["REF-A", "REF-B"]);

      const desc = sortAdminReservationsBySchedule(tiedSample, "desc");
      expect(desc.map((r) => r.referenceCode)).toEqual(["REF-B", "REF-A"]);
    });

    it("places items with missing dates at the end without throwing", () => {
      const withMissing: AdminReservationSummary[] = [
        { ...adminSample[0], startAt: null, createdAt: "" },
        { ...adminSample[1], startAt: "2026-09-19T12:00:00Z" },
      ];
      const asc = sortAdminReservationsBySchedule(withMissing, "asc");
      expect(asc[0].referenceCode).toBe("DA-1002");
    });
  });

  describe("Staff Reservation Sorting", () => {
    it("sorts staff reservations by booking time ascending (earliest first)", () => {
      const sorted = sortStaffReservationsBySchedule(staffSample, "asc");
      expect(sorted.map((r) => r.referenceCode)).toEqual([
        "DA-1002", // 08:30
        "DA-1001", // 10:00 - 14:00
        "DA-1004", // 10:00 - 16:00
        "DA-1003", // 15:00
      ]);
    });

    it("sorts staff reservations by booking time descending (latest first)", () => {
      const sorted = sortStaffReservationsBySchedule(staffSample, "desc");
      expect(sorted.map((r) => r.referenceCode)).toEqual([
        "DA-1003", // 15:00
        "DA-1004", // 10:00 - 16:00
        "DA-1001", // 10:00 - 14:00
        "DA-1002", // 08:30
      ]);
    });

    it("places null/invalid booking dates at the end without errors", () => {
      const withNull: StaffOperationalReservation[] = [
        { ...staffSample[0], bookingStartAt: null },
        { ...staffSample[1], bookingStartAt: "2026-09-19T09:00:00Z" },
      ];
      const asc = sortStaffReservationsBySchedule(withNull, "asc");
      expect(asc[0].referenceCode).toBe("DA-1002");
      expect(asc[1].referenceCode).toBe("DA-1001");
    });
  });

  describe("Integration with Filters and Search Pipelines", () => {
    it("correctly integrates with Admin filter and search pipelines", () => {
      const searchFiltered = filterReservationsBySearch(adminSample, "Smith");
      const advancedFiltered = filterReservations(searchFiltered, {});
      const sorted = sortAdminReservationsBySchedule(advancedFiltered, "asc");
      expect(sorted.length).toBe(1);
      expect(sorted[0].referenceCode).toBe("DA-1001");
    });

    it("correctly integrates with Staff status filter and search pipelines", () => {
      const statusFiltered = filterStaffReservationsByStatus(staffSample, "confirmed", new Date("2026-09-19T09:00:00Z"));
      const searchFiltered = filterReservationsBySearch(statusFiltered, "");
      const sorted = sortStaffReservationsBySchedule(searchFiltered, "desc");
      expect(sorted.map((r) => r.referenceCode)).toEqual([
        "DA-1003",
        "DA-1004",
        "DA-1001",
      ]);
    });
  });
});
