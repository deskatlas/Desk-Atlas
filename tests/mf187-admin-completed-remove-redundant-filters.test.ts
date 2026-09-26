import { describe, it, expect } from "vitest";
import {
  filterAdminReservationsByTab,
  getAdminReservationTabCounts,
  isAdminCompletedReservation,
  isAdminOperationsReservation,
  isAdminExpiredReservation,
  ADMIN_RESERVATIONS_TAB_FILTERS,
  ADMIN_OPERATIONS_TAB_FILTERS,
  ADMIN_EXPIRED_TAB_FILTERS,
  type AdminReservationSummary,
} from "@deskatlas/domain";

describe("MF-187: Admin Completed - Remove Redundant Sub-Filters", () => {
  const fixedNow = new Date("2026-09-22T10:00:00Z");

  const sampleAdminReservations: AdminReservationSummary[] = [
    // 1. Confirmed / Upcoming
    {
      id: "res-conf-1",
      referenceNumber: "DA-CONF-1",
      customerName: "Alice Smith",
      customerEmail: "alice@example.com",
      status: "Confirmed",
      reservationStatus: "CONFIRMED",
      paymentStatus: "Paid",
      paymentMethod: "GCASH",
      workspaceTemplateName: "Hot Desk",
      workspaceName: "Hot Desk 01",
      startAt: "2026-09-22T14:00:00Z",
      endAt: "2026-09-22T18:00:00Z",
      totalAmount: 500,
    },
    // 2. Checked In / Active Operations
    {
      id: "res-act-1",
      referenceNumber: "DA-ACT-1",
      customerName: "Bob Jones",
      customerEmail: "bob@example.com",
      status: "Checked In",
      reservationStatus: "CHECKED_IN",
      paymentStatus: "Paid",
      paymentMethod: "GCASH",
      workspaceTemplateName: "Hot Desk",
      workspaceName: "Hot Desk 02",
      startAt: "2026-09-22T09:00:00Z",
      endAt: "2026-09-22T13:00:00Z",
      checkedInAt: "2026-09-22T09:05:00Z",
      totalAmount: 500,
    },
    // 3. Completed Reservation 1
    {
      id: "res-comp-1",
      referenceNumber: "DA-COMP-1",
      customerName: "Charlie Brown",
      customerEmail: "charlie@example.com",
      status: "Completed",
      reservationStatus: "COMPLETED",
      paymentStatus: "Paid",
      paymentMethod: "GCASH",
      workspaceTemplateName: "Meeting Room",
      workspaceName: "Meeting Room A",
      startAt: "2026-09-22T06:00:00Z",
      endAt: "2026-09-22T09:00:00Z",
      checkedInAt: "2026-09-22T06:01:00Z",
      checkedOutAt: "2026-09-22T08:58:00Z",
      totalAmount: 1500,
    },
    // 4. Completed Reservation 2 (Explicit checkedOutAt)
    {
      id: "res-comp-2",
      referenceNumber: "DA-COMP-2",
      customerName: "Diana Prince",
      customerEmail: "diana@example.com",
      status: "Completed",
      reservationStatus: "COMPLETED",
      paymentStatus: "Paid",
      paymentMethod: "CASH",
      workspaceTemplateName: "Dedicated Desk",
      workspaceName: "Dedicated Desk 01",
      startAt: "2026-09-22T07:00:00Z",
      endAt: "2026-09-22T09:30:00Z",
      checkedInAt: "2026-09-22T07:00:00Z",
      checkedOutAt: "2026-09-22T09:30:00Z",
      totalAmount: 750,
    },
    // 5. Expired Reservation
    {
      id: "res-exp-1",
      referenceNumber: "DA-EXP-1",
      customerName: "Edward Elric",
      customerEmail: "edward@example.com",
      status: "Expired",
      reservationStatus: "EXPIRED",
      paymentStatus: "Unpaid",
      paymentMethod: "GCASH",
      workspaceTemplateName: "Hot Desk",
      workspaceName: "Hot Desk 03",
      startAt: "2026-09-22T06:00:00Z",
      endAt: "2026-09-22T08:00:00Z",
      totalAmount: 300,
    },
  ];

  it("filters Admin 'Completed' tab directly to show all completed records without requiring sub-filters", () => {
    const completedResults = filterAdminReservationsByTab(
      sampleAdminReservations,
      "completed",
      "all",
      fixedNow
    );

    expect(completedResults).toHaveLength(2);
    expect(completedResults.map((r) => r.referenceNumber)).toEqual(["DA-COMP-1", "DA-COMP-2"]);
    expect(completedResults.every((r) => isAdminCompletedReservation(r))).toBe(true);
  });

  it("ensures completed reservations are segregated and not visible in reservations, operations, or expired tabs", () => {
    const reservationsTab = filterAdminReservationsByTab(sampleAdminReservations, "reservations", "all", fixedNow);
    const operationsTab = filterAdminReservationsByTab(sampleAdminReservations, "operations", "all", fixedNow);
    const expiredTab = filterAdminReservationsByTab(sampleAdminReservations, "expired", "all", fixedNow);

    expect(reservationsTab.find((r) => r.referenceNumber === "DA-COMP-1" || r.referenceNumber === "DA-COMP-2")).toBeUndefined();
    expect(operationsTab.find((r) => r.referenceNumber === "DA-COMP-1" || r.referenceNumber === "DA-COMP-2")).toBeUndefined();
    expect(expiredTab.find((r) => r.referenceNumber === "DA-COMP-1" || r.referenceNumber === "DA-COMP-2")).toBeUndefined();
  });

  it("calculates accurate tab counts including the completedBadgeCount", () => {
    const counts = getAdminReservationTabCounts(sampleAdminReservations, fixedNow);
    expect(counts.completedBadgeCount).toBe(2);
    expect(counts.reservationsBadgeCount).toBe(1);
    expect(counts.operationsBadgeCount).toBe(1);
    expect(counts.expiredBadgeCount).toBe(1);
  });

  it("retains required sub-filter options for Reservations, Operations, and Expired tabs", () => {
    expect(ADMIN_RESERVATIONS_TAB_FILTERS.map((f) => f.filter)).toEqual([
      "all",
      "upcoming",
      "awaiting_proof",
      "counter_queue",
      "closure_impacted",
      "cancelled",
    ]);

    expect(ADMIN_OPERATIONS_TAB_FILTERS.map((f) => f.filter)).toEqual([
      "all",
      "active",
      "checked_in",
    ]);

    expect(ADMIN_EXPIRED_TAB_FILTERS.map((f) => f.filter)).toEqual([
      "all",
      "expired",
      "rejected",
      "cancelled",
    ]);
  });
});
