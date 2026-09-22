import { describe, it, expect } from "vitest";
import {
  isStaffExpiredReservation,
  isStaffBookingManagementReservation,
  isStaffOperationsReservation,
  isStaffCompletedReservation,
  filterStaffReservationsByTab,
  getStaffReservationTabCounts,
  filterAdminReservationsByTab,
  getAdminReservationTabCounts,
  applyStaffOperationalDerivation,
  type StaffOperationalReservation,
  type AdminReservationSummary,
} from "@deskatlas/domain";

describe("MF-170 — Staff Reservations: Show Rejected Under Expired Tab", () => {
  const fixedNow = new Date("2026-09-20T15:00:00Z");

  const sampleStaffReservations: StaffOperationalReservation[] = [
    // 0: Upcoming Confirmed (Reservations Tab)
    {
      reservationId: "s-res-1",
      referenceCode: "DA-2001",
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Smith",
      customerEmail: "alice@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-1",
      workspaceDisplayName: "Desk 1",
      workspaceInstanceCode: "D1",
      workspaceTemplateName: "Dedicated Desk",
      floorName: "Floor 1",
      bookingStartAt: "2026-09-20T16:00:00Z",
      bookingEndAt: "2026-09-20T19:00:00Z",
      confirmedAt: "2026-09-20T12:00:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-20T12:00:00Z",
    },
    // 1: Counter Queue Pending (Reservations Tab)
    {
      reservationId: "s-res-2",
      referenceCode: "DA-2002",
      source: "KIOSK",
      customerFirstName: "Bob",
      customerLastName: "Jones",
      customerEmail: "bob@example.com",
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
    // 2: Active / Checked In (Operations Tab)
    {
      reservationId: "s-res-3",
      referenceCode: "DA-2003",
      source: "WEB",
      customerFirstName: "Charlie",
      customerLastName: "Day",
      customerEmail: "charlie@example.com",
      reservationStatus: "CHECKED_IN",
      checkInState: "CHECKED_IN",
      workspaceInstanceId: "ws-2",
      workspaceDisplayName: "Desk 2",
      workspaceInstanceCode: "D2",
      workspaceTemplateName: "Dedicated Desk",
      floorName: "Floor 1",
      bookingStartAt: "2026-09-20T13:00:00Z",
      bookingEndAt: "2026-09-20T17:00:00Z",
      confirmedAt: "2026-09-20T11:00:00Z",
      checkedInAt: "2026-09-20T13:05:00Z",
      checkedOutAt: null,
      qrIssuedAt: "2026-09-20T11:00:00Z",
    },
    // 3: Completed (Completed Tab)
    {
      reservationId: "s-res-4",
      referenceCode: "DA-2004",
      source: "WEB",
      customerFirstName: "Dana",
      customerLastName: "Scully",
      customerEmail: "dana@example.com",
      reservationStatus: "COMPLETED",
      checkInState: "CHECKED_OUT",
      workspaceInstanceId: "ws-3",
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
    // 4: Expired (Expired Tab)
    {
      reservationId: "s-res-5",
      referenceCode: "DA-2005",
      source: "WEB",
      customerFirstName: "Evan",
      customerLastName: "Wright",
      customerEmail: "evan@example.com",
      reservationStatus: "EXPIRED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: null,
      workspaceDisplayName: "Hot Desk",
      workspaceInstanceCode: null,
      workspaceTemplateName: "Hot Desk",
      floorName: null,
      bookingStartAt: "2026-09-20T09:00:00Z",
      bookingEndAt: "2026-09-20T13:00:00Z",
      confirmedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: null,
    },
    // 5: Rejected via reservationStatus (Expired Tab)
    {
      reservationId: "s-res-6",
      referenceCode: "DA-2006",
      source: "WEB",
      customerFirstName: "Fiona",
      customerLastName: "Gallagher",
      customerEmail: "fiona@example.com",
      reservationStatus: "REJECTED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: null,
      workspaceDisplayName: "Hot Desk",
      workspaceInstanceCode: null,
      workspaceTemplateName: "Hot Desk",
      floorName: null,
      bookingStartAt: "2026-09-20T14:00:00Z",
      bookingEndAt: "2026-09-20T18:00:00Z",
      confirmedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: null,
    },
    // 6: Rejected via paymentStatus / paymentAttemptStatus (Expired Tab)
    {
      reservationId: "s-res-7",
      referenceCode: "DA-2007",
      source: "WEB",
      customerFirstName: "George",
      customerLastName: "Costanza",
      customerEmail: "george@example.com",
      reservationStatus: "CANCELLED",
      status: "Rejected",
      paymentStatus: "REJECTED",
      paymentAttemptStatus: "REJECTED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: null,
      workspaceDisplayName: "Dedicated Desk",
      workspaceInstanceCode: null,
      workspaceTemplateName: "Dedicated Desk",
      floorName: null,
      bookingStartAt: "2026-09-20T10:00:00Z",
      bookingEndAt: "2026-09-20T14:00:00Z",
      confirmedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: null,
    },
    // 7: Plain Cancelled (Expired Tab - Cancelled subfilter)
    {
      reservationId: "s-res-8",
      referenceCode: "DA-2008",
      source: "WEB",
      customerFirstName: "Hank",
      customerLastName: "Hill",
      customerEmail: "hank@example.com",
      reservationStatus: "CANCELLED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: null,
      workspaceDisplayName: "Dedicated Desk",
      workspaceInstanceCode: null,
      workspaceTemplateName: "Dedicated Desk",
      floorName: null,
      bookingStartAt: "2026-09-20T10:00:00Z",
      bookingEndAt: "2026-09-20T14:00:00Z",
      confirmedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: null,
    },
  ];

  describe("isStaffExpiredReservation", () => {
    it("classifies EXPIRED reservations as expired", () => {
      expect(isStaffExpiredReservation(sampleStaffReservations[4], fixedNow)).toBe(true);
    });

    it("classifies REJECTED status reservations as expired", () => {
      expect(isStaffExpiredReservation(sampleStaffReservations[5], fixedNow)).toBe(true);
    });

    it("classifies reservations with REJECTED paymentStatus as expired", () => {
      expect(isStaffExpiredReservation(sampleStaffReservations[6], fixedNow)).toBe(true);
    });

    it("does not classify non-terminal active or upcoming reservations as expired", () => {
      expect(isStaffExpiredReservation(sampleStaffReservations[0], fixedNow)).toBe(false); // Upcoming Confirmed
      expect(isStaffExpiredReservation(sampleStaffReservations[1], fixedNow)).toBe(false); // Counter Queue
      expect(isStaffExpiredReservation(sampleStaffReservations[2], fixedNow)).toBe(false); // Checked In
      expect(isStaffExpiredReservation(sampleStaffReservations[3], fixedNow)).toBe(false); // Completed
    });
  });

  describe("filterStaffReservationsByTab", () => {
    it("surfaces both EXPIRED and REJECTED reservations under the 'expired' tab (all)", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "expired", "all", fixedNow);
      const codes = results.map((r) => r.referenceCode);
      expect(codes).toContain("DA-2005"); // EXPIRED
      expect(codes).toContain("DA-2006"); // REJECTED
      expect(codes).toContain("DA-2007"); // REJECTED via paymentStatus
      expect(codes).toContain("DA-2008"); // CANCELLED
    });

    it("surfaces strictly EXPIRED reservations under 'expired' tab with 'expired' sub-filter", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "expired", "expired", fixedNow);
      const codes = results.map((r) => r.referenceCode);
      expect(codes).toContain("DA-2005"); // EXPIRED
      expect(codes).not.toContain("DA-2006"); // REJECTED
      expect(codes).not.toContain("DA-2007"); // REJECTED via paymentStatus
      expect(codes).not.toContain("DA-2008"); // Plain CANCELLED is in cancelled subfilter
    });

    it("surfaces strictly REJECTED reservations under 'expired' tab with 'rejected' sub-filter", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "expired", "rejected", fixedNow);
      const codes = results.map((r) => r.referenceCode);
      expect(codes).not.toContain("DA-2005"); // EXPIRED
      expect(codes).toContain("DA-2006"); // REJECTED
      expect(codes).toContain("DA-2007"); // REJECTED via paymentStatus
      expect(codes).not.toContain("DA-2008"); // Plain CANCELLED
    });

    it("does not surface REJECTED reservations under 'reservations' tab", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "reservations", "all", fixedNow);
      const codes = results.map((r) => r.referenceCode);
      expect(codes).not.toContain("DA-2006");
      expect(codes).not.toContain("DA-2007");
      expect(codes).toEqual(["DA-2001", "DA-2002"]);
    });

    it("does not surface REJECTED reservations under 'operations' tab", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "operations", "all", fixedNow);
      const codes = results.map((r) => r.referenceCode);
      expect(codes).not.toContain("DA-2006");
      expect(codes).not.toContain("DA-2007");
      expect(codes).toEqual(["DA-2003"]);
    });

    it("does not surface REJECTED reservations under 'completed' tab", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "completed", "all", fixedNow);
      const codes = results.map((r) => r.referenceCode);
      expect(codes).not.toContain("DA-2006");
      expect(codes).not.toContain("DA-2007");
      expect(codes).toEqual(["DA-2004"]);
    });
  });

  describe("getStaffReservationTabCounts", () => {
    it("includes REJECTED reservations in expiredBadgeCount and excludes from reservationsBadgeCount", () => {
      const counts = getStaffReservationTabCounts(sampleStaffReservations, fixedNow);

      // Reservations badge: Upcoming Confirmed (DA-2001) + Counter Queue (DA-2002) = 2
      expect(counts.reservationsBadgeCount).toBe(2);

      // Operations badge: Checked In (DA-2003) = 1
      expect(counts.operationsBadgeCount).toBe(1);

      // Completed badge: Completed (DA-2004) = 1
      expect(counts.completedBadgeCount).toBe(1);

      // Expired badge: Expired (DA-2005) + Rejected (DA-2006) + Rejected (DA-2007) + Cancelled (DA-2008) = 4
      expect(counts.expiredBadgeCount).toBe(4);
    });
  });

  describe("Admin Expired Tab Regression Check", () => {
    const adminReservations: AdminReservationSummary[] = [
      {
        id: "a-res-1",
        referenceCode: "ADM-1001",
        customerName: "Ian Malcolm",
        customerFirstName: "Ian",
        customerLastName: "Malcolm",
        customerInitials: "IM",
        customerEmail: "ian@example.com",
        workspaceDisplayName: "Hot Desk 1",
        schedule: "10:00 AM - 1:00 PM",
        startAt: "2026-09-20T10:00:00Z",
        endAt: "2026-09-20T13:00:00Z",
        paymentStatus: "Expired",
        paymentColor: "var(--da-text-secondary)",
        reservationStatus: "EXPIRED",
        status: "Expired",
        statusStyle: { background: "#F3F4F6", color: "#4B5563" },
        mark: "✕",
        amountDue: 500,
        currency: "PHP",
        createdAt: "2026-09-20T08:00:00Z",
      },
      {
        id: "a-res-2",
        referenceCode: "ADM-1002",
        customerName: "Jane Doe",
        customerFirstName: "Jane",
        customerLastName: "Doe",
        customerInitials: "JD",
        customerEmail: "jane@example.com",
        workspaceDisplayName: "Hot Desk 2",
        schedule: "11:00 AM - 2:00 PM",
        startAt: "2026-09-20T11:00:00Z",
        endAt: "2026-09-20T14:00:00Z",
        paymentStatus: "Rejected",
        paymentColor: "var(--da-danger)",
        reservationStatus: "CANCELLED",
        status: "Rejected",
        statusStyle: { background: "#FEE2E2", color: "#DC2626" },
        mark: "✕",
        amountDue: 500,
        currency: "PHP",
        createdAt: "2026-09-20T09:00:00Z",
      },
    ];

    it("Admin expired tab continues to classify and filter expired/rejected reservations properly", () => {
      const expiredResults = filterAdminReservationsByTab(adminReservations, "expired", "all", fixedNow);
      expect(expiredResults.map((r) => r.referenceCode)).toEqual(["ADM-1001", "ADM-1002"]);

      const counts = getAdminReservationTabCounts(adminReservations, fixedNow);
      expect(counts.expiredBadgeCount).toBe(2);
    });
  });

  describe("applyStaffOperationalDerivation Parity with Admin", () => {
    it("derives REJECTED for reservations with PAYMENT_UNDER_REVIEW when payment attempt was REJECTED", () => {
      const res: StaffOperationalReservation = {
        reservationId: "res-rej-1",
        referenceCode: "DA-REJ1",
        source: "WEB",
        customerFirstName: "Test",
        customerLastName: "User",
        customerEmail: "test@example.com",
        reservationStatus: "PAYMENT_UNDER_REVIEW",
        checkInState: "NOT_CHECKED_IN",
        workspaceInstanceId: null,
        workspaceDisplayName: "Hot Desk",
        workspaceInstanceCode: null,
        workspaceTemplateName: "Hot Desk",
        floorName: null,
        bookingStartAt: "2026-09-20T16:00:00Z",
        bookingEndAt: "2026-09-20T18:00:00Z",
        confirmedAt: null,
        checkedInAt: null,
        checkedOutAt: null,
        qrIssuedAt: null,
        paymentAttemptStatus: "REJECTED",
        paymentAttempts: [{ id: "pa-1", channel: "WEB", status: "REJECTED" }],
      };

      const derived = applyStaffOperationalDerivation(res, fixedNow.getTime());
      expect(derived.reservationStatus).toBe("REJECTED");
      expect(derived.status).toBe("Rejected");
    });

    it("derives EXPIRED for reservations with PENDING_PAYMENT when payment window elapsed", () => {
      const res: StaffOperationalReservation = {
        reservationId: "res-exp-1",
        referenceCode: "DA-EXP1",
        source: "WEB",
        customerFirstName: "Test",
        customerLastName: "User",
        customerEmail: "test@example.com",
        reservationStatus: "PENDING_PAYMENT",
        checkInState: "NOT_CHECKED_IN",
        workspaceInstanceId: null,
        workspaceDisplayName: "Hot Desk",
        workspaceInstanceCode: null,
        workspaceTemplateName: "Hot Desk",
        floorName: null,
        bookingStartAt: "2026-09-20T16:00:00Z",
        bookingEndAt: "2026-09-20T18:00:00Z",
        confirmedAt: null,
        checkedInAt: null,
        checkedOutAt: null,
        qrIssuedAt: null,
        paymentExpiresAt: "2026-09-20T14:00:00Z", // 1 hour ago
      };

      const derived = applyStaffOperationalDerivation(res, fixedNow.getTime());
      expect(derived.reservationStatus).toBe("EXPIRED");
      expect(derived.status).toBe("Expired");
    });

    it("derives EXPIRED for reservations with NEEDS_MANUAL_RESOLUTION when booking end time elapsed", () => {
      const res: StaffOperationalReservation = {
        reservationId: "res-nmr-1",
        referenceCode: "DA-NMR1",
        source: "WEB",
        customerFirstName: "Test",
        customerLastName: "User",
        customerEmail: "test@example.com",
        reservationStatus: "NEEDS_MANUAL_RESOLUTION",
        checkInState: "NOT_CHECKED_IN",
        workspaceInstanceId: null,
        workspaceDisplayName: "Hot Desk",
        workspaceInstanceCode: null,
        workspaceTemplateName: "Hot Desk",
        floorName: null,
        bookingStartAt: "2026-09-20T10:00:00Z",
        bookingEndAt: "2026-09-20T14:00:00Z", // 1 hour ago
        confirmedAt: null,
        checkedInAt: null,
        checkedOutAt: null,
        qrIssuedAt: null,
      };

      const derived = applyStaffOperationalDerivation(res, fixedNow.getTime());
      expect(derived.reservationStatus).toBe("EXPIRED");
      expect(derived.status).toBe("Expired");
    });
  });
});
