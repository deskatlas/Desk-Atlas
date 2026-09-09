import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  matchesReservationSearch,
  filterReservationsBySearch,
  AdminReservationService,
  AdminReservationRepository,
  AdminReservationSummary,
  StaffOperationsService,
  StaffOperationsRepository,
  StaffOperationalReservation,
} from "@deskatlas/domain";

describe("MF-51: Search Bar Functionality (PRD-F9, PRD-F13)", () => {
  const sampleAdminReservations: AdminReservationSummary[] = [
    {
      id: "res-001-uuid",
      referenceCode: "REF-1001",
      source: "WEB",
      customerFirstName: "John",
      customerLastName: "Doe",
      customerName: "John Doe",
      customerInitials: "JD",
      customerEmail: "john.doe@example.com",
      workspaceDisplayName: "Desk 101",
      schedule: "9:00 AM - 1:00 PM",
      paymentStatus: "Paid",
      paymentColor: "#22c55e",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "#dcfce7", color: "#166534" },
      mark: "✓",
      amountDue: 500,
      currency: "PHP",
      createdAt: "2026-09-08T08:00:00.000Z",
    },
    {
      id: "res-002-uuid",
      referenceCode: "REF-1002",
      source: "WEB",
      customerFirstName: "Ana",
      customerLastName: "Lim",
      customerName: "Ana Lim",
      customerInitials: "AL",
      customerEmail: "ana.lim@example.com",
      workspaceDisplayName: "Skypod 2",
      schedule: "10:00 AM - 2:00 PM",
      paymentStatus: "Pending",
      paymentColor: "#f59e0b",
      reservationStatus: "PENDING_PAYMENT",
      status: "Awaiting Proof",
      statusStyle: { background: "#fef3c7", color: "#92400e" },
      mark: "⏳",
      amountDue: 800,
      currency: "PHP",
      createdAt: "2026-09-08T08:30:00.000Z",
    },
    {
      id: "res-003-uuid",
      referenceCode: "REF-2003",
      source: "KIOSK",
      customerFirstName: "Carlos",
      customerLastName: "Santana",
      customerName: "Carlos Santana",
      customerInitials: "CS",
      customerEmail: "carlos@example.com",
      workspaceDisplayName: "Conference Room A",
      schedule: "1:00 PM - 5:00 PM",
      paymentStatus: "Paid",
      paymentColor: "#22c55e",
      reservationStatus: "CHECKED_IN",
      status: "Checked In",
      statusStyle: { background: "#dbeafe", color: "#1e40af" },
      mark: "●",
      amountDue: 1500,
      currency: "PHP",
      createdAt: "2026-09-08T09:00:00.000Z",
    },
  ];

  const sampleStaffReservations: StaffOperationalReservation[] = [
    {
      reservationId: "res-001-uuid",
      referenceCode: "REF-1001",
      source: "WEB",
      customerFirstName: "John",
      customerLastName: "Doe",
      customerEmail: "john.doe@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "PENDING",
      workspaceInstanceId: "ws-01",
      workspaceDisplayName: "Desk 101",
      workspaceInstanceCode: "D-101",
      workspaceTemplateName: "Dedicated Desk",
      floorName: "1st Floor",
      bookingStartAt: "2026-09-08T09:00:00.000Z",
      bookingEndAt: "2026-09-08T13:00:00.000Z",
      confirmedAt: "2026-09-08T08:05:00.000Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-08T08:05:00.000Z",
    },
    {
      reservationId: "res-002-uuid",
      referenceCode: "REF-1002",
      source: "WEB",
      customerFirstName: "Ana",
      customerLastName: "Lim",
      customerEmail: "ana.lim@example.com",
      reservationStatus: "CONFIRMED",
      checkInState: "PENDING",
      workspaceInstanceId: "ws-02",
      workspaceDisplayName: "Skypod 2",
      workspaceInstanceCode: "SP-02",
      workspaceTemplateName: "Skypod",
      floorName: "2nd Floor",
      bookingStartAt: "2026-09-08T10:00:00.000Z",
      bookingEndAt: "2026-09-08T14:00:00.000Z",
      confirmedAt: "2026-09-08T08:35:00.000Z",
      checkedInAt: null,
      checkedOutAt: null,
      qrIssuedAt: "2026-09-08T08:35:00.000Z",
    },
  ];

  describe("Unit: matchesReservationSearch", () => {
    it("matches guest first name (partial, case-insensitive)", () => {
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "john"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "JOH"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[1], "ana"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[1], "Ana"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "carlos"), false);
    });

    it("matches guest last name (partial, case-insensitive)", () => {
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "doe"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "DOE"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[1], "lim"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[2], "santana"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[2], "tan"), true);
    });

    it("matches guest full name (partial, e.g. 'John D' matches 'John Doe')", () => {
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "John D"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "john d"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[1], "ana l"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[2], "carlos san"), true);
    });

    it("matches reference ID / reference code (exact or partial)", () => {
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "REF-1001"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "ref-1001"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "1001"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[1], "REF-1002"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[2], "2003"), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "9999"), false);
    });

    it("matches reservation UUID / ID", () => {
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "res-001"), true);
      assert.equal(matchesReservationSearch(sampleStaffReservations[1], "res-002"), true);
    });

    it("empty or whitespace-only query returns true for all", () => {
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], ""), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "   "), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], null), true);
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], undefined), true);
    });

    it("no-match query returns false", () => {
      assert.equal(matchesReservationSearch(sampleAdminReservations[0], "NonExistentGuest"), false);
      assert.equal(matchesReservationSearch(sampleAdminReservations[1], "REF-999999"), false);
    });
  });

  describe("Unit: filterReservationsBySearch", () => {
    it("filters list accurately by guest name", () => {
      const results = filterReservationsBySearch(sampleAdminReservations, "John");
      assert.equal(results.length, 1);
      assert.equal(results[0].referenceCode, "REF-1001");
    });

    it("filters list accurately by reference ID", () => {
      const results = filterReservationsBySearch(sampleAdminReservations, "REF-1002");
      assert.equal(results.length, 1);
      assert.equal(results[0].customerName, "Ana Lim");
    });

    it("returns all items when query is empty or whitespace", () => {
      const emptyResults = filterReservationsBySearch(sampleAdminReservations, "");
      assert.equal(emptyResults.length, 3);

      const wsResults = filterReservationsBySearch(sampleAdminReservations, "   ");
      assert.equal(wsResults.length, 3);
    });

    it("returns empty array when no matches are found", () => {
      const results = filterReservationsBySearch(sampleAdminReservations, "XYZ-DOES-NOT-EXIST");
      assert.equal(results.length, 0);
    });
  });

  describe("Integration: AdminReservationService search", () => {
    const mockRepo: AdminReservationRepository = {
      listAdminReservations: async () => sampleAdminReservations,
      getAdminReservationDetail: async (id) => null,
      assignAlternativeCandidate: async () => { throw new Error("not implemented"); },
      cancelReservation: async () => { throw new Error("not implemented"); },
    };

    const fixedNow = new Date("2026-09-08T08:45:00.000Z");
    const service = new AdminReservationService(mockRepo, () => fixedNow);

    it("filters by guest first name via listReservations", async () => {
      const result = await service.listReservations("all", "John");
      assert.equal(result.total, 1);
      assert.equal(result.reservations[0].customerFirstName, "John");
    });

    it("filters by reference ID via listReservations", async () => {
      const result = await service.listReservations("all", "REF-2003");
      assert.equal(result.total, 1);
      assert.equal(result.reservations[0].referenceCode, "REF-2003");
    });

    it("returns empty array and total 0 when no match", async () => {
      const result = await service.listReservations("all", "UnknownGuest");
      assert.equal(result.total, 0);
      assert.equal(result.reservations.length, 0);
    });

    it("clearing search restores full list", async () => {
      const result = await service.listReservations("all", "");
      assert.equal(result.total, 3);
      assert.equal(result.reservations.length, 3);
    });
  });

  describe("Integration: StaffOperationsService search", () => {
    const mockRepo: StaffOperationsRepository = {
      listOperationalReservations: async () => sampleStaffReservations,
      getOperationalReservation: async () => null,
      recordOperationalAction: async () => { throw new Error("not implemented"); },
      listOccupancyStatus: async () => [],
      listOperationalActivities: async () => [],
    };

    const service = new StaffOperationsService(mockRepo);

    it("filters operational reservations by guest name", async () => {
      const result = await service.listOperationalReservations("John D");
      assert.equal(result.length, 1);
      assert.equal(result[0].customerFirstName, "John");
    });

    it("filters operational reservations by reference code", async () => {
      const result = await service.listOperationalReservations("REF-1002");
      assert.equal(result.length, 1);
      assert.equal(result[0].customerLastName, "Lim");
    });

    it("returns empty list when no matches are found", async () => {
      const result = await service.listOperationalReservations("Nobody");
      assert.equal(result.length, 0);
    });

    it("returns all when search is empty or undefined", async () => {
      const result = await service.listOperationalReservations();
      assert.equal(result.length, 2);
    });
  });
});
