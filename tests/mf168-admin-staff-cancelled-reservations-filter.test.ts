import { describe, it, expect } from "vitest";
import {
  createAdminReservationService,
  createStaffOperationsService,
  ReservationMemoryRepository,
  filterReservations,
  countActiveFilters,
  matchesReservationFilters,
  matchesStaffReservationFilter,
  filterStaffReservationsByStatus,
  filterAdminReservationsByTab,
  filterStaffReservationsByTab,
  ADMIN_RESERVATIONS_TAB_FILTERS,
  STAFF_RESERVATIONS_TAB_FILTERS,
  STAFF_EXPIRED_TAB_FILTERS,
  STAFF_RESERVATION_FILTERS,
  type AdminReservationSummary,
  type StaffOperationalReservation,
  type ReservationResponseDTO,
} from "@deskatlas/domain";

describe("MF-168: Admin and Staff Cancelled Reservations Filter", () => {
  const fixedNow = new Date("2026-09-21T12:00:00Z");

  const sampleAdminReservations: AdminReservationSummary[] = [
    {
      id: "res-confirmed-1",
      referenceCode: "REF-CONF-1",
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Smith",
      customerName: "Alice Smith",
      customerInitials: "AS",
      customerEmail: "alice@example.com",
      workspaceDisplayName: "Hot Desk 1",
      schedule: "Sep 21, 09:00 - 17:00",
      startAt: "2026-09-21T09:00:00Z",
      endAt: "2026-09-21T17:00:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-success)",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "var(--da-info)", color: "var(--da-brand-dark)" },
      mark: "✓",
      amountDue: 500,
      currency: "PHP",
      createdAt: "2026-09-21T08:00:00Z",
    },
    {
      id: "res-cancelled-1",
      referenceCode: "REF-CANC-1",
      source: "WEB",
      customerFirstName: "Bob",
      customerLastName: "Jones",
      customerName: "Bob Jones",
      customerInitials: "BJ",
      customerEmail: "bob@example.com",
      workspaceDisplayName: "Dedicated Desk 2",
      schedule: "Sep 21, 10:00 - 14:00",
      startAt: "2026-09-21T10:00:00Z",
      endAt: "2026-09-21T14:00:00Z",
      paymentStatus: "Cancelled",
      paymentColor: "var(--da-danger)",
      reservationStatus: "CANCELLED",
      status: "Cancelled",
      statusStyle: { background: "#FEE2E2", color: "#991B1B" },
      mark: "✕",
      amountDue: 800,
      currency: "PHP",
      createdAt: "2026-09-21T08:30:00Z",
      cancellationReason: "Customer requested cancellation",
      cancelledAt: "2026-09-21T09:00:00Z",
      cancelledByUserId: "admin-1",
    },
    {
      id: "res-cancelled-2",
      referenceCode: "REF-CANC-2",
      source: "KIOSK",
      customerFirstName: "Charlie",
      customerLastName: "Brown",
      customerName: "Charlie Brown",
      customerInitials: "CB",
      customerEmail: "charlie@example.com",
      workspaceDisplayName: "Meeting Room A",
      schedule: "Sep 21, 13:00 - 16:00",
      startAt: "2026-09-21T13:00:00Z",
      endAt: "2026-09-21T16:00:00Z",
      paymentStatus: "Cancelled",
      paymentColor: "var(--da-danger)",
      reservationStatus: "CANCELLED",
      status: "Cancelled",
      statusStyle: { background: "#FEE2E2", color: "#991B1B" },
      mark: "✕",
      amountDue: 1500,
      currency: "PHP",
      createdAt: "2026-09-21T09:00:00Z",
      cancellationReason: "Payment proof rejected by Admin",
      cancelledAt: "2026-09-21T09:30:00Z",
    },
    {
      id: "res-expired-1",
      referenceCode: "REF-EXP-1",
      source: "WEB",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerName: "Diana Prince",
      customerInitials: "DP",
      customerEmail: "diana@example.com",
      workspaceDisplayName: "Hot Desk 2",
      schedule: "Sep 20, 09:00 - 17:00",
      startAt: "2026-09-20T09:00:00Z",
      endAt: "2026-09-20T17:00:00Z",
      paymentStatus: "Expired",
      paymentColor: "var(--da-text-secondary)",
      reservationStatus: "EXPIRED",
      status: "Expired",
      statusStyle: { background: "#F1F5F9", color: "#64748B" },
      mark: "✕",
      amountDue: 500,
      currency: "PHP",
      createdAt: "2026-09-20T08:00:00Z",
    },
  ];

  const sampleStaffReservations: StaffOperationalReservation[] = [
    {
      reservationId: "staff-res-1",
      referenceCode: "STAFF-CONF-1",
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Smith",
      customerEmail: "alice@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-1",
      workspaceDisplayName: "Hot Desk 1",
      workspaceInstanceCode: "HD-01",
      workspaceTemplateName: "Hot Desk",
      floorName: "Main Floor",
      bookingStartAt: "2026-09-21T14:00:00Z",
      bookingEndAt: "2026-09-21T18:00:00Z",
      confirmedAt: "2026-09-21T08:00:00Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-21T08:00:00Z",
    },
    {
      reservationId: "staff-res-2",
      referenceCode: "STAFF-CANC-1",
      source: "WEB",
      customerFirstName: "Bob",
      customerLastName: "Jones",
      customerEmail: "bob@example.com",
      reservationStatus: "CANCELLED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-2",
      workspaceDisplayName: "Dedicated Desk 2",
      workspaceInstanceCode: "DD-02",
      workspaceTemplateName: "Dedicated Desk",
      floorName: "Main Floor",
      bookingStartAt: "2026-09-21T10:00:00Z",
      bookingEndAt: "2026-09-21T14:00:00Z",
      confirmedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: null,
      cancellationReason: "Customer requested cancellation",
      cancelledAt: "2026-09-21T09:00:00Z",
      cancelledByUserId: "admin-1",
    },
    {
      reservationId: "staff-res-3",
      referenceCode: "STAFF-EXP-1",
      source: "WEB",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerEmail: "diana@example.com",
      reservationStatus: "EXPIRED",
      checkInState: "NOT_CHECKED_IN",
      workspaceInstanceId: "ws-3",
      workspaceDisplayName: "Hot Desk 3",
      workspaceInstanceCode: "HD-03",
      workspaceTemplateName: "Hot Desk",
      floorName: "Main Floor",
      bookingStartAt: "2026-09-20T09:00:00Z",
      bookingEndAt: "2026-09-20T17:00:00Z",
      confirmedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: null,
    },
  ];

  describe("Admin Portal Cancelled Reservations Filter", () => {
    it("filters to only CANCELLED reservations using status = CANCELLED in advanced filters", () => {
      const results = filterReservations(sampleAdminReservations, { status: "CANCELLED" }, fixedNow);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.referenceCode)).toEqual(["REF-CANC-1", "REF-CANC-2"]);
      expect(results.every((r) => r.reservationStatus === "CANCELLED")).toBe(true);
    });

    it("excludes non-cancelled reservations (CONFIRMED, EXPIRED) when filtering for CANCELLED", () => {
      const results = filterReservations(sampleAdminReservations, { status: "CANCELLED" }, fixedNow);
      expect(results.find((r) => r.referenceCode === "REF-CONF-1")).toBeUndefined();
      expect(results.find((r) => r.referenceCode === "REF-EXP-1")).toBeUndefined();
    });

    it("supports mixed comma-separated status filtering (e.g., CONFIRMED,CANCELLED)", () => {
      const results = filterReservations(sampleAdminReservations, { status: "CONFIRMED,CANCELLED" }, fixedNow);
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.referenceCode)).toEqual(["REF-CONF-1", "REF-CANC-1", "REF-CANC-2"]);
    });

    it("increments active filter count when status is applied", () => {
      expect(countActiveFilters({ status: "all" })).toBe(0);
      expect(countActiveFilters({ status: "CANCELLED" })).toBe(1);
      expect(countActiveFilters({ status: "CANCELLED", datePreset: "today" })).toBe(2);
    });

    it("returns cancelled reservations when filtering by Cancelled subfilter in Reservations tab", () => {
      const results = filterAdminReservationsByTab(sampleAdminReservations, "reservations", "cancelled", fixedNow);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.referenceCode)).toEqual(["REF-CANC-1", "REF-CANC-2"]);
    });

    it("returns cancelled reservations when filtering by Cancelled subfilter in Expired tab", () => {
      const results = filterAdminReservationsByTab(sampleAdminReservations, "expired", "cancelled", fixedNow);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.referenceCode)).toEqual(["REF-CANC-1", "REF-CANC-2"]);
    });

    it("includes 'Cancelled' in ADMIN_RESERVATIONS_TAB_FILTERS list", () => {
      const option = ADMIN_RESERVATIONS_TAB_FILTERS.find((f) => f.filter === "cancelled");
      expect(option).toBeDefined();
      expect(option?.label).toBe("Cancelled");
    });
  });

  describe("Staff Dashboard Cancelled Reservations Filter", () => {
    it("includes 'Cancelled' in STAFF_RESERVATIONS_TAB_FILTERS and STAFF_EXPIRED_TAB_FILTERS", () => {
      const resOption = STAFF_RESERVATIONS_TAB_FILTERS.find((f) => f.filter === "cancelled");
      expect(resOption).toBeDefined();
      expect(resOption?.label).toBe("Cancelled");

      const expOption = STAFF_EXPIRED_TAB_FILTERS.find((f) => f.filter === "cancelled");
      expect(expOption).toBeDefined();
      expect(expOption?.label).toBe("Cancelled");
    });

    it("includes 'Cancelled' in STAFF_RESERVATION_FILTERS", () => {
      const option = STAFF_RESERVATION_FILTERS.find((f) => f.filter === "cancelled");
      expect(option).toBeDefined();
      expect(option?.label).toBe("Cancelled");
    });

    it("matches cancelled reservation with matchesStaffReservationFilter", () => {
      const cancelledRes = sampleStaffReservations[1];
      const confirmedRes = sampleStaffReservations[0];

      expect(matchesStaffReservationFilter(cancelledRes, "cancelled", fixedNow)).toBe(true);
      expect(matchesStaffReservationFilter(confirmedRes, "cancelled", fixedNow)).toBe(false);
    });

    it("filters to only CANCELLED reservations using filterStaffReservationsByStatus", () => {
      const results = filterStaffReservationsByStatus(sampleStaffReservations, "cancelled", fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("STAFF-CANC-1");
    });

    it("returns cancelled reservations in filterStaffReservationsByTab for reservations tab", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "reservations", "cancelled", fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("STAFF-CANC-1");
    });

    it("returns cancelled reservations in filterStaffReservationsByTab for expired tab", () => {
      const results = filterStaffReservationsByTab(sampleStaffReservations, "expired", "cancelled", fixedNow);
      expect(results).toHaveLength(1);
      expect(results[0].referenceCode).toBe("STAFF-CANC-1");
    });
  });

  describe("End-to-End Service Integration for Cancelled Reservations", () => {
    it("AdminReservationService filters cancelled reservations via filter = 'cancelled'", async () => {
      const memoryRepo = new ReservationMemoryRepository(() => fixedNow);

      // Add sample reservations to memory repository
      const createdRes1 = await memoryRepo.createReservation({
        source: "WEB",
        customerFirstName: "John",
        customerLastName: "Doe",
        customerEmail: "john@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "ws-1",
            startAt: "2026-09-21T09:00:00Z",
            endAt: "2026-09-21T17:00:00Z",
          },
        ],
      });

      const createdRes2 = await memoryRepo.createReservation({
        source: "WEB",
        customerFirstName: "Jane",
        customerLastName: "Doe",
        customerEmail: "jane@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "ws-2",
            startAt: "2026-09-21T10:00:00Z",
            endAt: "2026-09-21T14:00:00Z",
          },
        ],
      });

      // Cancel createdRes2
      await memoryRepo.cancelReservation({
        reservationId: createdRes2.id,
        reason: "User requested refund",
        actorRole: "ADMIN",
        actorUserId: "admin-1",
      });

      const service = createAdminReservationService(memoryRepo, () => fixedNow);

      // Query with filter = "cancelled"
      const cancelledList = await service.listReservations("cancelled");
      expect(cancelledList.reservations).toHaveLength(1);
      expect(cancelledList.reservations[0].id).toBe(createdRes2.id);
      expect(cancelledList.reservations[0].reservationStatus).toBe("CANCELLED");
      expect(cancelledList.reservations[0].cancellationReason).toBe("User requested refund");

      // Query with advancedFilters.status = "CANCELLED"
      const advancedList = await service.listReservations("all", undefined, {
        status: "CANCELLED",
      });
      expect(advancedList.reservations).toHaveLength(1);
      expect(advancedList.reservations[0].id).toBe(createdRes2.id);
    });

    it("StaffOperationsService lists operational reservations including cancelled records", async () => {
      const memoryRepo = new ReservationMemoryRepository(() => fixedNow);

      const res = await memoryRepo.createReservation({
        source: "WEB",
        customerFirstName: "Test",
        customerLastName: "Cancel",
        customerEmail: "cancel@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "ws-1",
            startAt: "2026-09-21T09:00:00Z",
            endAt: "2026-09-21T17:00:00Z",
          },
        ],
      });

      await memoryRepo.cancelReservation({
        reservationId: res.id,
        reason: "Cancelled by Admin",
        actorRole: "ADMIN",
      });

      const staffService = createStaffOperationsService(memoryRepo, () => fixedNow);
      const list = await staffService.listOperationalReservations();
      const cancelled = list.find((r) => r.reservationId === res.id);

      expect(cancelled).toBeDefined();
      expect(cancelled?.reservationStatus).toBe("CANCELLED");
      expect(cancelled?.cancellationReason).toBe("Cancelled by Admin");
    });
  });
});
