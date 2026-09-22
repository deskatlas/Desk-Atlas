import { describe, it, expect } from "vitest";
import {
  filterAdminReservationsByTab,
  filterStaffReservationsByTab,
  getAdminReservationTabCounts,
  getStaffReservationTabCounts,
  isAdminExpiredReservation,
  isStaffExpiredReservation,
  filterReservations,
  matchesReservationFilters,
  countActiveFilters,
  ADMIN_EXPIRED_TAB_FILTERS,
  STAFF_EXPIRED_TAB_FILTERS,
  type AdminReservationSummary,
  type StaffOperationalReservation,
} from "@deskatlas/domain";

describe("MF-188: Separate Rejected and Cancelled Reservation Filters in Admin and Staff Dashboards", () => {
  const fixedNow = new Date("2026-09-23T12:00:00Z");

  const sampleAdminReservations: AdminReservationSummary[] = [
    // 1. Confirmed upcoming
    {
      id: "admin-res-conf-1",
      referenceCode: "ADM-CONF-1",
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Smith",
      customerName: "Alice Smith",
      customerInitials: "AS",
      customerEmail: "alice@example.com",
      workspaceDisplayName: "Hot Desk 1",
      schedule: "Sep 23, 14:00 - 18:00",
      startAt: "2026-09-23T14:00:00Z",
      endAt: "2026-09-23T18:00:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-primary)",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "#D1FAE5", color: "#065F46" },
      mark: "✓",
      amountDue: 500,
      currency: "PHP",
      createdAt: "2026-09-23T08:00:00Z",
    },
    // 2. Truly Expired (Un-checked-in past end time)
    {
      id: "admin-res-exp-1",
      referenceCode: "ADM-EXP-1",
      source: "WEB",
      customerFirstName: "Bob",
      customerLastName: "Jones",
      customerName: "Bob Jones",
      customerInitials: "BJ",
      customerEmail: "bob@example.com",
      workspaceDisplayName: "Dedicated Desk 1",
      schedule: "Sep 23, 08:00 - 11:00",
      startAt: "2026-09-23T08:00:00Z",
      endAt: "2026-09-23T11:00:00Z",
      paymentStatus: "Expired",
      paymentColor: "var(--da-text-secondary)",
      reservationStatus: "EXPIRED",
      status: "Expired",
      statusStyle: { background: "#F1F5F9", color: "#64748B" },
      mark: "✕",
      amountDue: 600,
      currency: "PHP",
      createdAt: "2026-09-23T07:00:00Z",
    },
    // 3. Rejected via payment proof / attempt
    {
      id: "admin-res-rej-1",
      referenceCode: "ADM-REJ-1",
      source: "WEB",
      customerFirstName: "Charlie",
      customerLastName: "Brown",
      customerName: "Charlie Brown",
      customerInitials: "CB",
      customerEmail: "charlie@example.com",
      workspaceDisplayName: "Meeting Room A",
      schedule: "Sep 23, 10:00 - 14:00",
      startAt: "2026-09-23T10:00:00Z",
      endAt: "2026-09-23T14:00:00Z",
      paymentStatus: "Rejected",
      paymentColor: "var(--da-danger)",
      paymentAttemptStatus: "REJECTED",
      reservationStatus: "REJECTED",
      status: "Rejected",
      statusStyle: { background: "#FEE2E2", color: "#991B1B" },
      mark: "✕",
      amountDue: 1200,
      currency: "PHP",
      createdAt: "2026-09-23T09:00:00Z",
    },
    // 4. Cancelled by customer/staff
    {
      id: "admin-res-canc-1",
      referenceCode: "ADM-CANC-1",
      source: "WEB",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerName: "Diana Prince",
      customerInitials: "DP",
      customerEmail: "diana@example.com",
      workspaceDisplayName: "Private Office 1",
      schedule: "Sep 23, 09:00 - 17:00",
      startAt: "2026-09-23T09:00:00Z",
      endAt: "2026-09-23T17:00:00Z",
      paymentStatus: "Cancelled",
      paymentColor: "var(--da-danger)",
      reservationStatus: "CANCELLED",
      status: "Cancelled",
      statusStyle: { background: "#FEE2E2", color: "#991B1B" },
      mark: "✕",
      amountDue: 2000,
      currency: "PHP",
      createdAt: "2026-09-23T08:30:00Z",
      cancellationReason: "Customer requested schedule change",
    },
  ];

  const sampleStaffReservations: StaffOperationalReservation[] = [
    // 1. Confirmed upcoming
    {
      reservationId: "staff-res-conf-1",
      referenceCode: "STF-CONF-1",
      source: "WEB",
      customerFirstName: "Edward",
      customerLastName: "Elric",
      customerEmail: "edward@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Hot Desk 01",
      workspaceInstanceCode: "HD-01",
      bookingStartAt: "2026-09-23T14:00:00Z",
      bookingEndAt: "2026-09-23T18:00:00Z",
    },
    // 2. Truly Expired
    {
      reservationId: "staff-res-exp-1",
      referenceCode: "STF-EXP-1",
      source: "WEB",
      customerFirstName: "Fiona",
      customerLastName: "Gallagher",
      customerEmail: "fiona@example.com",
      reservationStatus: "EXPIRED",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Hot Desk 02",
      workspaceInstanceCode: "HD-02",
      bookingStartAt: "2026-09-23T07:00:00Z",
      bookingEndAt: "2026-09-23T10:00:00Z",
    },
    // 3. Rejected
    {
      reservationId: "staff-res-rej-1",
      referenceCode: "STF-REJ-1",
      source: "WEB",
      customerFirstName: "George",
      customerLastName: "Clark",
      customerEmail: "george@example.com",
      reservationStatus: "REJECTED",
      status: "Rejected",
      paymentStatus: "REJECTED",
      paymentAttemptStatus: "REJECTED",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Dedicated Desk 01",
      workspaceInstanceCode: "DD-01",
      bookingStartAt: "2026-09-23T10:00:00Z",
      bookingEndAt: "2026-09-23T14:00:00Z",
    },
    // 4. Cancelled
    {
      reservationId: "staff-res-canc-1",
      referenceCode: "STF-CANC-1",
      source: "WEB",
      customerFirstName: "Hannah",
      customerLastName: "Abbott",
      customerEmail: "hannah@example.com",
      reservationStatus: "CANCELLED",
      status: "Cancelled",
      checkInState: "NOT_CHECKED_IN",
      workspaceDisplayName: "Meeting Room A",
      workspaceInstanceCode: "MR-A",
      bookingStartAt: "2026-09-23T11:00:00Z",
      bookingEndAt: "2026-09-23T13:00:00Z",
    },
  ];

  describe("Sub-filter Definitions Parity", () => {
    it("Admin Expired tab includes dedicated Rejected and Cancelled sub-filter options", () => {
      expect(ADMIN_EXPIRED_TAB_FILTERS).toEqual([
        { label: "All", filter: "all" },
        { label: "Expired", filter: "expired" },
        { label: "Rejected", filter: "rejected" },
        { label: "Cancelled", filter: "cancelled" },
      ]);
    });

    it("Staff Expired tab includes dedicated Rejected and Cancelled sub-filter options", () => {
      expect(STAFF_EXPIRED_TAB_FILTERS).toEqual([
        { label: "All", filter: "all" },
        { label: "Expired", filter: "expired" },
        { label: "Rejected", filter: "rejected" },
        { label: "Cancelled", filter: "cancelled" },
      ]);
    });
  });

  describe("Admin Expired Tab Filter Mutually Exclusive Separation", () => {
    it("Admin 'all' sub-filter returns expired, rejected, and cancelled bookings", () => {
      const results = filterAdminReservationsByTab(sampleAdminReservations, "expired", "all", fixedNow);
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.referenceCode)).toEqual(["ADM-EXP-1", "ADM-REJ-1", "ADM-CANC-1"]);
    });

    it("Admin 'expired' sub-filter returns ONLY expired records (excludes rejected and cancelled)", () => {
      const results = filterAdminReservationsByTab(sampleAdminReservations, "expired", "expired", fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("ADM-EXP-1");
      expect(results[0].reservationStatus).toBe("EXPIRED");
    });

    it("Admin 'rejected' sub-filter returns ONLY rejected records (excludes expired and cancelled)", () => {
      const results = filterAdminReservationsByTab(sampleAdminReservations, "expired", "rejected", fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("ADM-REJ-1");
      expect(results[0].reservationStatus).toBe("REJECTED");
    });

    it("Admin 'cancelled' sub-filter returns ONLY cancelled records (excludes expired and rejected)", () => {
      const results = filterAdminReservationsByTab(sampleAdminReservations, "expired", "cancelled", fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("ADM-CANC-1");
      expect(results[0].reservationStatus).toBe("CANCELLED");
    });
  });

  describe("Staff Expired Tab Filter Mutually Exclusive Separation", () => {
    it("Staff 'all' sub-filter returns expired, rejected, and cancelled bookings", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "expired", "all", fixedNow);
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.referenceCode)).toEqual(["STF-EXP-1", "STF-REJ-1", "STF-CANC-1"]);
    });

    it("Staff 'expired' sub-filter returns ONLY expired records (excludes rejected and cancelled)", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "expired", "expired", fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("STF-EXP-1");
      expect(results[0].reservationStatus).toBe("EXPIRED");
    });

    it("Staff 'rejected' sub-filter returns ONLY rejected records (excludes expired and cancelled)", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "expired", "rejected", fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("STF-REJ-1");
      expect(results[0].reservationStatus).toBe("REJECTED");
    });

    it("Staff 'cancelled' sub-filter returns ONLY cancelled records (excludes expired and rejected)", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "expired", "cancelled", fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("STF-CANC-1");
      expect(results[0].reservationStatus).toBe("CANCELLED");
    });
  });

  describe("Filter Modal / Advanced Filter Status Isolation", () => {
    it("status = 'REJECTED' returns only rejected reservations", () => {
      const results = filterReservations(sampleAdminReservations, { status: "REJECTED" }, fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("ADM-REJ-1");
    });

    it("status = 'CANCELLED' returns only cancelled reservations without rejected or expired", () => {
      const results = filterReservations(sampleAdminReservations, { status: "CANCELLED" }, fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("ADM-CANC-1");
    });

    it("status = 'EXPIRED' returns only expired reservations without rejected or cancelled", () => {
      const results = filterReservations(sampleAdminReservations, { status: "EXPIRED" }, fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("ADM-EXP-1");
    });

    it("paymentStatus = 'rejected' filters rejected bookings exclusively", () => {
      const results = filterReservations(sampleAdminReservations, { paymentStatus: "rejected" }, fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("ADM-REJ-1");
    });
  });

  describe("Tab Badge Count Verification", () => {
    it("Admin tab badge counts count expired, rejected, and cancelled under expiredBadgeCount", () => {
      const counts = getAdminReservationTabCounts(sampleAdminReservations, fixedNow);
      expect(counts.reservationsBadgeCount).toBe(1); // ADM-CONF-1
      expect(counts.expiredBadgeCount).toBe(3); // ADM-EXP-1, ADM-REJ-1, ADM-CANC-1
      expect(counts.operationsBadgeCount).toBe(0);
      expect(counts.completedBadgeCount).toBe(0);
    });

    it("Staff tab badge counts count expired, rejected, and cancelled under expiredBadgeCount", () => {
      const counts = getStaffReservationTabCounts(sampleStaffReservations, fixedNow);
      expect(counts.reservationsBadgeCount).toBe(1); // STF-CONF-1
      expect(counts.expiredBadgeCount).toBe(3); // STF-EXP-1, STF-REJ-1, STF-CANC-1
      expect(counts.operationsBadgeCount).toBe(0);
      expect(counts.completedBadgeCount).toBe(0);
    });
  });
});
