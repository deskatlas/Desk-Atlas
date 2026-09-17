import { describe, it, expect } from "vitest";
import {
  matchesStaffReservationFilter,
  filterStaffReservationsByStatus,
  STAFF_RESERVATION_FILTERS,
  AdminReservationService,
  type StaffOperationalReservation,
  type AdminReservationRepository,
  type AdminReservationSummary,
} from "@deskatlas/domain";

describe("MF-120: Reservations Counter Queue Filter Pill", () => {
  const fixedNow = new Date("2026-09-17T10:00:00Z");

  describe("Staff Dashboard Reservations Counter Queue Filter", () => {
    const staffReservations: StaffOperationalReservation[] = [
      {
        reservationId: "res-confirmed",
        referenceCode: "DA-101",
        source: "WEB",
        customerFirstName: "Jane",
        customerLastName: "Doe",
        customerEmail: "jane@example.com",
        reservationStatus: "CONFIRMED",
        checkInState: "NOT_CHECKED_IN",
        workspaceInstanceId: "ws-1",
        workspaceDisplayName: "Hot Desk 1",
        workspaceInstanceCode: "HD-1",
        workspaceTemplateName: "Hot Desk",
        floorName: "1st Floor",
        bookingStartAt: "2026-09-17T09:00:00Z",
        bookingEndAt: "2026-09-17T12:00:00Z",
        confirmedAt: "2026-09-17T08:30:00Z",
        checkedInAt: null,
        checkedOutAt: null,
        qrIssuedAt: "2026-09-17T08:30:00Z",
      },
      {
        reservationId: "res-counter",
        referenceCode: "DA-102",
        source: "KIOSK",
        customerFirstName: "Mark",
        customerLastName: "Counter",
        customerEmail: "mark@example.com",
        reservationStatus: "PENDING_COUNTER_CONFIRMATION",
        checkInState: "NOT_CHECKED_IN",
        workspaceInstanceId: null,
        workspaceDisplayName: "Dedicated Desk",
        workspaceInstanceCode: null,
        workspaceTemplateName: "Dedicated Desk",
        floorName: null,
        bookingStartAt: "2026-09-17T10:30:00Z",
        bookingEndAt: "2026-09-17T14:30:00Z",
        confirmedAt: null,
        checkedInAt: null,
        checkedOutAt: null,
        qrIssuedAt: null,
      },
      {
        reservationId: "res-checkedin",
        referenceCode: "DA-103",
        source: "WEB",
        customerFirstName: "Sarah",
        customerLastName: "Connor",
        customerEmail: "sarah@example.com",
        reservationStatus: "CHECKED_IN",
        checkInState: "CHECKED_IN",
        workspaceInstanceId: "ws-2",
        workspaceDisplayName: "Hot Desk 2",
        workspaceInstanceCode: "HD-2",
        workspaceTemplateName: "Hot Desk",
        floorName: "1st Floor",
        bookingStartAt: "2026-09-17T09:30:00Z",
        bookingEndAt: "2026-09-17T13:30:00Z",
        confirmedAt: "2026-09-17T09:00:00Z",
        checkedInAt: "2026-09-17T09:35:00Z",
        checkedOutAt: null,
        qrIssuedAt: "2026-09-17T09:00:00Z",
      },
    ];

    it("includes 'Counter Queue' in STAFF_RESERVATION_FILTERS", () => {
      const counterFilter = STAFF_RESERVATION_FILTERS.find((f) => f.filter === "counter_queue");
      expect(counterFilter).toBeDefined();
      expect(counterFilter?.label).toBe("Counter Queue");
    });

    it("matchesStaffReservationFilter identifies counter queue reservations", () => {
      expect(matchesStaffReservationFilter(staffReservations[0], "counter_queue", fixedNow)).toBe(false);
      expect(matchesStaffReservationFilter(staffReservations[1], "counter_queue", fixedNow)).toBe(true);
      expect(matchesStaffReservationFilter(staffReservations[2], "counter_queue", fixedNow)).toBe(false);
    });

    it("filterStaffReservationsByStatus isolates counter queue reservations", () => {
      const filtered = filterStaffReservationsByStatus(staffReservations, "counter_queue", fixedNow);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].reservationId).toBe("res-counter");
      expect(filtered[0].customerFirstName).toBe("Mark");
    });
  });

  describe("Admin Portal Reservations Counter Queue Filter", () => {
    const adminReservations: AdminReservationSummary[] = [
      {
        id: "admin-res-1",
        referenceCode: "DA-201",
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "Online",
        customerName: "Alice Online",
        customerInitials: "AO",
        customerEmail: "alice@example.com",
        workspaceDisplayName: "Hot Desk 1",
        schedule: "10:00 AM - 12:00 PM",
        startAt: "2026-09-17T10:00:00Z",
        endAt: "2026-09-17T12:00:00Z",
        durationHours: 2,
        paymentStatus: "Paid",
        status: "Confirmed",
        statusStyle: { background: "#E0F2FE", color: "#0369A1" },
        mark: "✓",
        actions: [],
        reservationStatus: "CONFIRMED",
        createdAt: "2026-09-17T08:00:00Z",
      },
      {
        id: "admin-res-2",
        referenceCode: "DA-202",
        source: "KIOSK",
        customerFirstName: "Bob",
        customerLastName: "Kiosk",
        customerName: "Bob Kiosk",
        customerInitials: "BK",
        customerEmail: "bob@example.com",
        workspaceDisplayName: "Hot Desk 2",
        schedule: "11:00 AM - 1:00 PM",
        startAt: "2026-09-17T11:00:00Z",
        endAt: "2026-09-17T13:00:00Z",
        durationHours: 2,
        paymentStatus: "Counter",
        status: "Counter Confirmation",
        statusStyle: { background: "#FFF8E8", color: "#B45309" },
        mark: "!",
        actions: [],
        reservationStatus: "PENDING_COUNTER_CONFIRMATION",
        createdAt: "2026-09-17T09:50:00Z",
      },
    ];

    const mockRepo: AdminReservationRepository = {
      listAdminReservations: async () => adminReservations,
      getAdminReservationById: async () => null,
      getAdminReservationByReferenceCode: async () => null,
      rescheduleReservation: async () => { throw new Error("not implemented"); },
      cancelReservation: async () => { throw new Error("not implemented"); },
    };

    const service = new AdminReservationService(mockRepo, () => fixedNow);

    it("filters counter queue reservations in AdminReservationService", async () => {
      const result = await service.listReservations("counter_queue");
      expect(result.reservations).toHaveLength(1);
      expect(result.reservations[0].id).toBe("admin-res-2");
      expect(result.reservations[0].referenceCode).toBe("DA-202");
      expect(result.reservations[0].reservationStatus).toBe("PENDING_COUNTER_CONFIRMATION");
    });
  });
});
