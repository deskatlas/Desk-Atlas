import { describe, it, expect } from "vitest";
import {
  paginateList,
  getPaginationPageNumbers,
  filterReservationsBySearch,
  filterStaffReservationsByStatus,
  sortAdminReservationsBySchedule,
  sortStaffReservationsBySchedule,
  type AdminReservationSummary,
  type StaffOperationalReservation,
} from "@deskatlas/domain";

describe("Admin and Staff Reservations Pagination (15 records per page)", () => {
  const createMockAdminReservations = (count: number): AdminReservationSummary[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `res-${i + 1}`,
      referenceCode: `DA-${1000 + i + 1}`,
      source: i % 2 === 0 ? "WEB" : "KIOSK",
      customerFirstName: `User${i + 1}`,
      customerLastName: `Test`,
      customerName: `User${i + 1} Test`,
      customerInitials: `U${i + 1}`,
      customerEmail: `user${i + 1}@test.com`,
      workspaceDisplayName: `Desk ${(i % 10) + 1}`,
      schedule: `Sep 19, 09:00 - 17:00`,
      startAt: `2026-09-19T09:00:00Z`,
      endAt: `2026-09-19T17:00:00Z`,
      paymentStatus: "Paid",
      paymentColor: "var(--da-success)",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "var(--da-info)", color: "var(--da-brand-dark)" },
      mark: "✓",
      amountDue: 500,
      currency: "PHP",
      createdAt: `2026-09-18T10:00:00Z`,
    }));
  };

  const createMockStaffReservations = (count: number): StaffOperationalReservation[] => {
    return Array.from({ length: count }, (_, i) => ({
      reservationId: `staff-res-${i + 1}`,
      referenceCode: `DA-${2000 + i + 1}`,
      source: i % 2 === 0 ? "WEB" : "KIOSK",
      customerFirstName: `Guest${i + 1}`,
      customerLastName: `Staff`,
      customerEmail: `guest${i + 1}@staff.com`,
      reservationStatus: i % 3 === 0 ? "CHECKED_IN" : "CONFIRMED",
      checkInState: i % 3 === 0 ? "CHECKED_IN" : "NOT_CHECKED_IN",
      workspaceInstanceId: `ws-${i + 1}`,
      workspaceDisplayName: `Hot Desk ${i + 1}`,
      workspaceInstanceCode: `HD-${i + 1}`,
      workspaceTemplateName: "Hot Desk",
      floorName: "Floor 1",
      bookingStartAt: `2026-09-19T${String(8 + (i % 8)).padStart(2, "0")}:00:00Z`,
      bookingEndAt: `2026-09-19T${String(12 + (i % 8)).padStart(2, "0")}:00:00Z`,
      confirmedAt: "2026-09-19T07:00:00Z",
      checkedInAt: i % 3 === 0 ? "2026-09-19T08:00:00Z" : null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-19T07:00:00Z",
    }));
  };

  describe("paginateList utility", () => {
    it("correctly paginates empty list", () => {
      const result = paginateList([], 1, 15);
      expect(result.items).toEqual([]);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(15);
      expect(result.totalItems).toBe(0);
      expect(result.totalPages).toBe(1);
      expect(result.startIndex).toBe(0);
      expect(result.endIndex).toBe(0);
    });

    it("correctly paginates list with fewer than 15 records", () => {
      const list = createMockAdminReservations(8);
      const result = paginateList(list, 1, 15);
      expect(result.items.length).toBe(8);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(15);
      expect(result.totalItems).toBe(8);
      expect(result.totalPages).toBe(1);
      expect(result.startIndex).toBe(1);
      expect(result.endIndex).toBe(8);
      expect(result.items[0].referenceCode).toBe("DA-1001");
      expect(result.items[7].referenceCode).toBe("DA-1008");
    });

    it("correctly paginates exactly 15 records on page 1", () => {
      const list = createMockAdminReservations(15);
      const result = paginateList(list, 1, 15);
      expect(result.items.length).toBe(15);
      expect(result.totalPages).toBe(1);
      expect(result.startIndex).toBe(1);
      expect(result.endIndex).toBe(15);
    });

    it("correctly paginates 37 records across 3 pages with 15 records per page", () => {
      const list = createMockAdminReservations(37);

      // Page 1
      const page1 = paginateList(list, 1, 15);
      expect(page1.items.length).toBe(15);
      expect(page1.page).toBe(1);
      expect(page1.totalPages).toBe(3);
      expect(page1.startIndex).toBe(1);
      expect(page1.endIndex).toBe(15);
      expect(page1.items[0].referenceCode).toBe("DA-1001");
      expect(page1.items[14].referenceCode).toBe("DA-1015");

      // Page 2
      const page2 = paginateList(list, 2, 15);
      expect(page2.items.length).toBe(15);
      expect(page2.page).toBe(2);
      expect(page2.totalPages).toBe(3);
      expect(page2.startIndex).toBe(16);
      expect(page2.endIndex).toBe(30);
      expect(page2.items[0].referenceCode).toBe("DA-1016");
      expect(page2.items[14].referenceCode).toBe("DA-1030");

      // Page 3
      const page3 = paginateList(list, 3, 15);
      expect(page3.items.length).toBe(7);
      expect(page3.page).toBe(3);
      expect(page3.totalPages).toBe(3);
      expect(page3.startIndex).toBe(31);
      expect(page3.endIndex).toBe(37);
      expect(page3.items[0].referenceCode).toBe("DA-1031");
      expect(page3.items[6].referenceCode).toBe("DA-1037");
    });

    it("clamps requested page number to valid range [1, totalPages]", () => {
      const list = createMockAdminReservations(37); // 3 pages

      const pageZero = paginateList(list, 0, 15);
      expect(pageZero.page).toBe(1);

      const pageNegative = paginateList(list, -5, 15);
      expect(pageNegative.page).toBe(1);

      const pageOverflow = paginateList(list, 999, 15);
      expect(pageOverflow.page).toBe(3);
      expect(pageOverflow.items.length).toBe(7);
    });
  });

  describe("getPaginationPageNumbers helper", () => {
    it("returns simple array when totalPages <= 7", () => {
      expect(getPaginationPageNumbers(1, 1)).toEqual([1]);
      expect(getPaginationPageNumbers(2, 5)).toEqual([1, 2, 3, 4, 5]);
      expect(getPaginationPageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("returns ellipsis at the end when near start of many pages", () => {
      expect(getPaginationPageNumbers(2, 10)).toEqual([1, 2, 3, 4, 5, "...", 10]);
      expect(getPaginationPageNumbers(4, 10)).toEqual([1, 2, 3, 4, 5, "...", 10]);
    });

    it("returns ellipsis at the beginning when near end of many pages", () => {
      expect(getPaginationPageNumbers(8, 10)).toEqual([1, "...", 6, 7, 8, 9, 10]);
    });

    it("returns ellipses on both sides when in the middle of many pages", () => {
      expect(getPaginationPageNumbers(6, 12)).toEqual([1, "...", 5, 6, 7, "...", 12]);
    });
  });

  describe("Admin and Staff Pipeline Integration with 15 records per page", () => {
    it("paginates filtered and sorted admin reservations properly", () => {
      const adminList = createMockAdminReservations(35);
      const searchFiltered = filterReservationsBySearch(adminList, "User1"); // Matches User1, User10..User19
      const sorted = sortAdminReservationsBySchedule(searchFiltered, "asc");
      const paged = paginateList(sorted, 1, 15);

      expect(paged.totalItems).toBe(11);
      expect(paged.items.length).toBe(11);
      expect(paged.totalPages).toBe(1);
      expect(paged.startIndex).toBe(1);
      expect(paged.endIndex).toBe(11);
    });

    it("paginates staff operational reservations properly with 15 records per page", () => {
      const staffList = createMockStaffReservations(40);
      const statusFiltered = filterStaffReservationsByStatus(staffList, "all");
      const sorted = sortStaffReservationsBySchedule(statusFiltered, "asc");

      const page1 = paginateList(sorted, 1, 15);
      expect(page1.items.length).toBe(15);
      expect(page1.startIndex).toBe(1);
      expect(page1.endIndex).toBe(15);
      expect(page1.totalPages).toBe(3);

      const page2 = paginateList(sorted, 2, 15);
      expect(page2.items.length).toBe(15);
      expect(page2.startIndex).toBe(16);
      expect(page2.endIndex).toBe(30);

      const page3 = paginateList(sorted, 3, 15);
      expect(page3.items.length).toBe(10);
      expect(page3.startIndex).toBe(31);
      expect(page3.endIndex).toBe(40);
    });
  });
});
