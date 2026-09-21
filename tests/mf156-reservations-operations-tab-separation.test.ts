import { describe, it, expect } from "vitest";
import {
  filterAdminReservationsByTab,
  filterStaffReservationsByTab,
  getAdminReservationTabCounts,
  getStaffReservationTabCounts,
  isAdminOperationsReservation,
  isAdminBookingManagementReservation,
  isAdminCompletedReservation,
  isAdminExpiredReservation,
  isStaffOperationsReservation,
  isStaffBookingManagementReservation,
  isStaffCompletedReservation,
  isStaffExpiredReservation,
  ADMIN_RESERVATIONS_TAB_FILTERS,
  ADMIN_OPERATIONS_TAB_FILTERS,
  ADMIN_COMPLETED_TAB_FILTERS,
  ADMIN_EXPIRED_TAB_FILTERS,
  STAFF_RESERVATIONS_TAB_FILTERS,
  STAFF_OPERATIONS_TAB_FILTERS,
  STAFF_COMPLETED_TAB_FILTERS,
  STAFF_EXPIRED_TAB_FILTERS,
  type AdminReservationSummary,
  type StaffOperationalReservation,
} from "@deskatlas/domain";

describe("MF-156: 4-Way Tab Separation (Reservations, Active Operations, Completed, Expired)", () => {
  const fixedNow = new Date("2026-09-20T14:00:00Z");

  const sampleAdminReservations: AdminReservationSummary[] = [
    // 1. Pending Payment / Awaiting Proof (Reservations Tab)
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
      schedule: "1:00 PM - 5:00 PM",
      startAt: "2026-09-20T15:00:00Z",
      endAt: "2026-09-20T19:00:00Z",
      paymentStatus: "Pending",
      paymentColor: "var(--da-warning)",
      reservationStatus: "PENDING_PAYMENT",
      status: "Awaiting Proof",
      statusStyle: { background: "#FEF3C7", color: "#92400E" },
      mark: "⏳",
      amountDue: 500,
      currency: "PHP",
      createdAt: "2026-09-20T13:40:00Z",
    },
    // 2. Payment Under Review (Reservations Tab)
    {
      id: "res-2",
      referenceCode: "DA-1002",
      source: "WEB",
      customerFirstName: "Bob",
      customerLastName: "Johnson",
      customerName: "Bob Johnson",
      customerInitials: "BJ",
      customerEmail: "bob@example.com",
      workspaceDisplayName: "Dedicated Desk 04",
      schedule: "3:00 PM - 7:00 PM",
      startAt: "2026-09-20T15:00:00Z",
      endAt: "2026-09-20T19:00:00Z",
      paymentStatus: "Under Review",
      paymentColor: "var(--da-warning)",
      reservationStatus: "PAYMENT_UNDER_REVIEW",
      status: "Review Required",
      statusStyle: { background: "#FEF3C7", color: "#92400E" },
      mark: "🔍",
      amountDue: 600,
      currency: "PHP",
      createdAt: "2026-09-20T13:30:00Z",
    },
    // 3. Upcoming Confirmed (Reservations Tab)
    {
      id: "res-3",
      referenceCode: "DA-1003",
      source: "WEB",
      customerFirstName: "Charlie",
      customerLastName: "Brown",
      customerName: "Charlie Brown",
      customerInitials: "CB",
      customerEmail: "charlie@example.com",
      workspaceDisplayName: "Meeting Room Alpha",
      schedule: "4:00 PM - 6:00 PM",
      startAt: "2026-09-20T16:00:00Z",
      endAt: "2026-09-20T18:00:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-primary)",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "#D1FAE5", color: "#065F46" },
      mark: "✓",
      amountDue: 1200,
      currency: "PHP",
      createdAt: "2026-09-20T10:00:00Z",
      confirmedAt: "2026-09-20T10:15:00Z",
    },
    // 4. Counter Queue Pending (Reservations Tab)
    {
      id: "res-4",
      referenceCode: "DA-1004",
      source: "KIOSK",
      customerFirstName: "David",
      customerLastName: "Miller",
      customerName: "David Miller",
      customerInitials: "DM",
      customerEmail: "david@example.com",
      workspaceDisplayName: "Hot Desk 02",
      schedule: "2:30 PM - 5:30 PM",
      startAt: "2026-09-20T14:30:00Z",
      endAt: "2026-09-20T17:30:00Z",
      paymentStatus: "Unpaid",
      paymentColor: "var(--da-warning)",
      reservationStatus: "PENDING_COUNTER_CONFIRMATION",
      status: "Counter Queue",
      statusStyle: { background: "#EDE9FE", color: "#5B21B6" },
      mark: "👤",
      amountDue: 450,
      currency: "PHP",
      createdAt: "2026-09-20T13:45:00Z",
    },
    // 5. Expired (Expired Tab)
    {
      id: "res-5",
      referenceCode: "DA-1005",
      source: "WEB",
      customerFirstName: "Emma",
      customerLastName: "Watson",
      customerName: "Emma Watson",
      customerInitials: "EW",
      customerEmail: "emma@example.com",
      workspaceDisplayName: "Hot Desk 03",
      schedule: "9:00 AM - 1:00 PM",
      startAt: "2026-09-20T09:00:00Z",
      endAt: "2026-09-20T13:00:00Z",
      paymentStatus: "Expired",
      paymentColor: "var(--da-text-secondary)",
      reservationStatus: "EXPIRED",
      status: "Expired",
      statusStyle: { background: "#F3F4F6", color: "#4B5563" },
      mark: "⏱",
      amountDue: 500,
      currency: "PHP",
      createdAt: "2026-09-20T07:00:00Z",
    },
    // 6. Rejected (Expired Tab)
    {
      id: "res-6",
      referenceCode: "DA-1006",
      source: "WEB",
      customerFirstName: "Frank",
      customerLastName: "Castle",
      customerName: "Frank Castle",
      customerInitials: "FC",
      customerEmail: "frank@example.com",
      workspaceDisplayName: "Dedicated Desk 01",
      schedule: "10:00 AM - 2:00 PM",
      startAt: "2026-09-20T10:00:00Z",
      endAt: "2026-09-20T14:00:00Z",
      paymentStatus: "Rejected",
      paymentColor: "var(--da-danger)",
      paymentAttemptStatus: "REJECTED",
      reservationStatus: "CANCELLED",
      status: "Rejected",
      statusStyle: { background: "#FEE2E2", color: "#991B1B" },
      mark: "✕",
      amountDue: 500,
      currency: "PHP",
      createdAt: "2026-09-20T08:00:00Z",
    },
    // 7. Active / Checked In (Active Operations Tab)
    {
      id: "res-7",
      referenceCode: "DA-1007",
      source: "WEB",
      customerFirstName: "Grace",
      customerLastName: "Hopper",
      customerName: "Grace Hopper",
      customerInitials: "GH",
      customerEmail: "grace@example.com",
      workspaceDisplayName: "Hot Desk 05",
      schedule: "1:00 PM - 5:00 PM",
      startAt: "2026-09-20T13:00:00Z",
      endAt: "2026-09-20T17:00:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-primary)",
      reservationStatus: "CHECKED_IN",
      status: "Checked In",
      statusStyle: { background: "#D1FAE5", color: "#065F46" },
      mark: "✓",
      amountDue: 500,
      currency: "PHP",
      createdAt: "2026-09-20T11:00:00Z",
      checkedInAt: "2026-09-20T13:05:00Z",
      checkedOutAt: null,
    },
    // 8. Active In-Session Confirmed (Active Operations Tab)
    {
      id: "res-8",
      referenceCode: "DA-1008",
      source: "WEB",
      customerFirstName: "Henry",
      customerLastName: "Ford",
      customerName: "Henry Ford",
      customerInitials: "HF",
      customerEmail: "henry@example.com",
      workspaceDisplayName: "Pod A",
      schedule: "1:30 PM - 4:30 PM",
      startAt: "2026-09-20T13:30:00Z",
      endAt: "2026-09-20T16:30:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-primary)",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "#D1FAE5", color: "#065F46" },
      mark: "✓",
      amountDue: 600,
      currency: "PHP",
      createdAt: "2026-09-20T11:30:00Z",
    },
    // 9. Completed / Checked Out (Completed Tab)
    {
      id: "res-9",
      referenceCode: "DA-1009",
      source: "WEB",
      customerFirstName: "Ivy",
      customerLastName: "League",
      customerName: "Ivy League",
      customerInitials: "IL",
      customerEmail: "ivy@example.com",
      workspaceDisplayName: "Meeting Room Beta",
      schedule: "10:00 AM - 1:00 PM",
      startAt: "2026-09-20T10:00:00Z",
      endAt: "2026-09-20T13:00:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-primary)",
      reservationStatus: "COMPLETED",
      status: "Completed",
      statusStyle: { background: "#F3F4F6", color: "#4B5563" },
      mark: "✓",
      amountDue: 1800,
      currency: "PHP",
      createdAt: "2026-09-20T08:00:00Z",
      checkedInAt: "2026-09-20T10:02:00Z",
      checkedOutAt: "2026-09-20T12:55:00Z",
    },
  ];

  const sampleStaffReservations: StaffOperationalReservation[] = [
    // 1. Upcoming Confirmed (Reservations Tab)
    {
      reservationId: "s-res-1",
      referenceCode: "DA-2001",
      source: "WEB",
      customerFirstName: "Jack",
      customerLastName: "Sparrow",
      customerEmail: "jack@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-1",
      workspaceDisplayName: "Hot Desk 01",
      workspaceInstanceCode: "HD-01",
      workspaceTemplateName: "Hot Desk",
      floorName: "Floor 1",
      bookingStartAt: "2026-09-20T16:00:00Z",
      bookingEndAt: "2026-09-20T19:00:00Z",
      confirmedAt: "2026-09-20T12:00:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-20T12:00:00Z",
    },
    // 2. Counter Queue (Reservations Tab)
    {
      reservationId: "s-res-2",
      referenceCode: "DA-2002",
      source: "KIOSK",
      customerFirstName: "Kelly",
      customerLastName: "Clark",
      customerEmail: "kelly@example.com",
      reservationStatus: "PENDING_COUNTER_CONFIRMATION",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: null,
      workspaceDisplayName: "Hot Desk",
      workspaceInstanceCode: null,
      workspaceTemplateName: "Hot Desk",
      floorName: null,
      bookingStartAt: "2026-09-20T14:30:00Z",
      bookingEndAt: "2026-09-20T17:30:00Z",
      confirmedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: null,
    },
    // 3. Checked In (Active Operations Tab)
    {
      reservationId: "s-res-3",
      referenceCode: "DA-2003",
      source: "WEB",
      customerFirstName: "Liam",
      customerLastName: "Neeson",
      customerEmail: "liam@example.com",
      reservationStatus: "CHECKED_IN",
      checkInState: "CHECKED_IN",
      workspaceInstanceId: "ws-2",
      workspaceDisplayName: "Hot Desk 02",
      workspaceInstanceCode: "HD-02",
      workspaceTemplateName: "Hot Desk",
      floorName: "Floor 1",
      bookingStartAt: "2026-09-20T13:00:00Z",
      bookingEndAt: "2026-09-20T17:00:00Z",
      confirmedAt: "2026-09-20T11:00:00Z",
      checkedInAt: "2026-09-20T13:05:00Z",
      checkedOutAt: null,
      qrIssuedAt: "2026-09-20T11:00:00Z",
    },
    // 4. In-Session Active Confirmed (Active Operations Tab)
    {
      reservationId: "s-res-4",
      referenceCode: "DA-2004",
      source: "WEB",
      customerFirstName: "Mia",
      customerLastName: "Farrow",
      customerEmail: "mia@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-3",
      workspaceDisplayName: "Hot Desk 03",
      workspaceInstanceCode: "HD-03",
      workspaceTemplateName: "Hot Desk",
      floorName: "Floor 1",
      bookingStartAt: "2026-09-20T13:30:00Z",
      bookingEndAt: "2026-09-20T16:30:00Z",
      confirmedAt: "2026-09-20T12:00:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-20T12:00:00Z",
    },
    // 5. Completed / Checked Out (Completed Tab)
    {
      reservationId: "s-res-5",
      referenceCode: "DA-2005",
      source: "WEB",
      customerFirstName: "Noah",
      customerLastName: "Centineo",
      customerEmail: "noah@example.com",
      reservationStatus: "COMPLETED",
      checkInState: "CHECKED_OUT",
      workspaceInstanceId: "ws-4",
      workspaceDisplayName: "Meeting Room A",
      workspaceInstanceCode: "MR-A",
      workspaceTemplateName: "Meeting Room",
      floorName: "Floor 2",
      bookingStartAt: "2026-09-20T09:00:00Z",
      bookingEndAt: "2026-09-20T12:00:00Z",
      confirmedAt: "2026-09-20T08:30:00Z",
      checkedInAt: "2026-09-20T09:01:00Z",
      checkedOutAt: "2026-09-20T11:58:00Z",
      qrIssuedAt: "2026-09-20T08:30:00Z",
    },
    // 6. Expired (Expired Tab)
    {
      reservationId: "s-res-6",
      referenceCode: "DA-2006",
      source: "WEB",
      customerFirstName: "Olivia",
      customerLastName: "Wilde",
      customerEmail: "olivia@example.com",
      reservationStatus: "EXPIRED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-5",
      workspaceDisplayName: "Hot Desk 05",
      workspaceInstanceCode: "HD-05",
      workspaceTemplateName: "Hot Desk",
      floorName: "Floor 1",
      bookingStartAt: "2026-09-20T08:00:00Z",
      bookingEndAt: "2026-09-20T11:00:00Z",
      confirmedAt: "2026-09-20T07:00:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-20T07:00:00Z",
    },
  ];

  describe("Filter Presets & Sub-Filter Definitions", () => {
    it("defines Admin 4-tab sub-filters correctly", () => {
      expect(ADMIN_RESERVATIONS_TAB_FILTERS).toEqual([
        { label: "All", filter: "all" },
        { label: "Upcoming", filter: "upcoming" },
        { label: "Awaiting Proof", filter: "awaiting_proof" },
        { label: "Counter Queue", filter: "counter_queue" },
        { label: "Cancelled", filter: "cancelled" },
      ]);

      expect(ADMIN_OPERATIONS_TAB_FILTERS).toEqual([
        { label: "All", filter: "all" },
        { label: "Active", filter: "active" },
        { label: "Checked In", filter: "checked_in" },
      ]);

      expect(ADMIN_COMPLETED_TAB_FILTERS).toEqual([
        { label: "All", filter: "all" },
        { label: "Completed", filter: "completed" },
      ]);

      expect(ADMIN_EXPIRED_TAB_FILTERS).toEqual([
        { label: "All", filter: "all" },
        { label: "Expired", filter: "expired" },
        { label: "Rejected", filter: "rejected" },
        { label: "Cancelled", filter: "cancelled" },
      ]);
    });

    it("defines Staff 4-tab sub-filters correctly", () => {
      expect(STAFF_RESERVATIONS_TAB_FILTERS).toEqual([
        { label: "All", filter: "all" },
        { label: "Upcoming", filter: "upcoming" },
        { label: "Counter Queue", filter: "counter_queue" },
        { label: "Cancelled", filter: "cancelled" },
      ]);

      expect(STAFF_OPERATIONS_TAB_FILTERS).toEqual([
        { label: "All", filter: "all" },
        { label: "Active", filter: "active" },
        { label: "Checked In", filter: "checked_in" },
      ]);

      expect(STAFF_COMPLETED_TAB_FILTERS).toEqual([
        { label: "All", filter: "all" },
        { label: "Completed", filter: "completed" },
      ]);

      expect(STAFF_EXPIRED_TAB_FILTERS).toEqual([
        { label: "All", filter: "all" },
        { label: "Expired", filter: "expired" },
        { label: "Cancelled", filter: "cancelled" },
      ]);
    });
  });

  describe("Admin 4-Way Tab Segregation", () => {
    it("correctly classifies booking management vs operational vs completed vs expired reservations", () => {
      // Booking Management: res-1, res-2, res-3, res-4
      expect(isAdminBookingManagementReservation(sampleAdminReservations[0], fixedNow)).toBe(true);
      expect(isAdminBookingManagementReservation(sampleAdminReservations[1], fixedNow)).toBe(true);
      expect(isAdminBookingManagementReservation(sampleAdminReservations[2], fixedNow)).toBe(true);
      expect(isAdminBookingManagementReservation(sampleAdminReservations[3], fixedNow)).toBe(true);

      // Expired: res-5 (Expired), res-6 (Rejected)
      expect(isAdminExpiredReservation(sampleAdminReservations[4], fixedNow)).toBe(true);
      expect(isAdminExpiredReservation(sampleAdminReservations[5], fixedNow)).toBe(true);

      // Active Operations: res-7 (Checked In), res-8 (In-Session Active)
      expect(isAdminOperationsReservation(sampleAdminReservations[6], fixedNow)).toBe(true);
      expect(isAdminOperationsReservation(sampleAdminReservations[7], fixedNow)).toBe(true);
      expect(isAdminOperationsReservation(sampleAdminReservations[8], fixedNow)).toBe(false); // Completed is not Active Ops

      // Completed: res-9
      expect(isAdminCompletedReservation(sampleAdminReservations[8])).toBe(true);
    });

    it("filters Admin 'Reservations' tab to include active pipeline bookings", () => {
      const results = filterAdminReservationsByTab(sampleAdminReservations, "reservations", "all", fixedNow);
      expect(results.map((r) => r.referenceCode)).toEqual([
        "DA-1001",
        "DA-1002",
        "DA-1003",
        "DA-1004",
      ]);
    });

    it("filters Admin 'Active Operations' tab to include live occupying/active records ONLY", () => {
      const results = filterAdminReservationsByTab(sampleAdminReservations, "operations", "all", fixedNow);
      expect(results.map((r) => r.referenceCode)).toEqual([
        "DA-1007",
        "DA-1008",
      ]);
    });

    it("filters Admin 'Completed' tab to include completed records ONLY", () => {
      const results = filterAdminReservationsByTab(sampleAdminReservations, "completed", "all", fixedNow);
      expect(results.map((r) => r.referenceCode)).toEqual([
        "DA-1009",
      ]);
    });

    it("filters Admin 'Expired' tab to include expired and rejected records", () => {
      const results = filterAdminReservationsByTab(sampleAdminReservations, "expired", "all", fixedNow);
      expect(results.map((r) => r.referenceCode)).toEqual([
        "DA-1005",
        "DA-1006",
      ]);
    });

    it("calculates Admin badge counts for all 4 tabs accurately", () => {
      const counts = getAdminReservationTabCounts(sampleAdminReservations, fixedNow);

      // Reservations badge: pending (DA-1001, DA-1002, DA-1004) + upcoming confirmed (DA-1003) = 4
      expect(counts.reservationsBadgeCount).toBe(4);

      // Operations badge: checked in (DA-1007) + active in session (DA-1008) = 2
      expect(counts.operationsBadgeCount).toBe(2);

      // Completed badge: DA-1009 = 1
      expect(counts.completedBadgeCount).toBe(1);

      // Expired badge: expired (DA-1005) + rejected (DA-1006) = 2
      expect(counts.expiredBadgeCount).toBe(2);
    });
  });

  describe("Staff 4-Way Tab Segregation", () => {
    it("correctly classifies Staff booking management vs operational vs completed vs expired reservations", () => {
      // Booking Management: s-res-1 (Upcoming Confirmed), s-res-2 (Counter Queue)
      expect(isStaffBookingManagementReservation(sampleStaffReservations[0], fixedNow)).toBe(true);
      expect(isStaffBookingManagementReservation(sampleStaffReservations[1], fixedNow)).toBe(true);

      // Active Operations: s-res-3 (Checked In), s-res-4 (In-Session Active)
      expect(isStaffOperationsReservation(sampleStaffReservations[2], fixedNow)).toBe(true);
      expect(isStaffOperationsReservation(sampleStaffReservations[3], fixedNow)).toBe(true);
      expect(isStaffOperationsReservation(sampleStaffReservations[4], fixedNow)).toBe(false); // Completed not in Active Ops

      // Completed: s-res-5
      expect(isStaffCompletedReservation(sampleStaffReservations[4])).toBe(true);

      // Expired: s-res-6 (Expired)
      expect(isStaffExpiredReservation(sampleStaffReservations[5], fixedNow)).toBe(true);
    });

    it("filters Staff 'Reservations' tab to include booking records", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "reservations", "all", fixedNow);
      expect(results.map((r) => r.referenceCode)).toEqual(["DA-2001", "DA-2002"]);
    });

    it("filters Staff 'Active Operations' tab to include active occupying records ONLY", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "operations", "all", fixedNow);
      expect(results.map((r) => r.referenceCode)).toEqual(["DA-2003", "DA-2004"]);
    });

    it("filters Staff 'Completed' tab to include completed records ONLY", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "completed", "all", fixedNow);
      expect(results.map((r) => r.referenceCode)).toEqual(["DA-2005"]);
    });

    it("filters Staff 'Expired' tab to include expired records", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "expired", "all", fixedNow);
      expect(results.map((r) => r.referenceCode)).toEqual(["DA-2006"]);
    });

    it("calculates Staff badge counts for all 4 tabs accurately", () => {
      const counts = getStaffReservationTabCounts(sampleStaffReservations, fixedNow);

      // Reservations badge: upcoming confirmed (s-res-1) + counter queue (s-res-2) = 2
      expect(counts.reservationsBadgeCount).toBe(2);

      // Operations badge: checked in (s-res-3) + in-session active (s-res-4) = 2
      expect(counts.operationsBadgeCount).toBe(2);

      // Completed badge: completed (s-res-5) = 1
      expect(counts.completedBadgeCount).toBe(1);

      // Expired badge: expired (s-res-6) = 1
      expect(counts.expiredBadgeCount).toBe(1);
    });
  });
});
