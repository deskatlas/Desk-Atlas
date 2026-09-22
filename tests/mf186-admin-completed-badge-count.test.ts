import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AdminReservationService,
  filterAdminReservationsByTab,
  getAdminReservationTabCounts,
  getStaffReservationTabCounts,
  isAdminCompletedReservation,
  isAdminExpiredReservation,
  isStaffCompletedReservation,
  isStaffExpiredReservation,
  ReservationMemoryRepository,
  type AdminReservationSummary,
  type ReservationResponseDTO,
  type StaffOperationalReservation,
} from "@deskatlas/domain";

function createMockReservation(overrides: Partial<ReservationResponseDTO> = {}): ReservationResponseDTO {
  return {
    id: "res-completed-1",
    referenceCode: "DA-2026-CMP01",
    source: "CUSTOMER_WEB",
    customerFirstName: "John",
    customerLastName: "Doe",
    customerEmail: "john.doe@example.com",
    customerPhone: "+639171234567",
    status: "COMPLETED",
    amountDue: 500,
    currency: "PHP",
    checkedInAt: "2026-09-20T08:00:00.000Z",
    checkedOutAt: "2026-09-20T12:00:00.000Z",
    createdAt: "2026-09-20T07:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
    candidates: [
      {
        rank: 0,
        tier: "Dedicated Desk",
        workspaceInstanceId: "desk-01",
        workspaceDisplayName: "Desk 01",
        startAt: "2026-09-20T08:00:00.000Z",
        endAt: "2026-09-20T12:00:00.000Z",
        isAssigned: true,
      },
    ],
    ...overrides,
  };
}

describe("MF-186: Accurate Completed Reservations Count Badge in Admin Reservations Filter", () => {
  const simulatedNow = new Date("2026-09-23T10:00:00.000Z");

  it("getAdminReservationTabCounts calculates the exact number of completed reservations in completedBadgeCount", async () => {
    const memoryRepo = new ReservationMemoryRepository(() => simulatedNow);
    const completed1 = createMockReservation({
      id: "res-c1",
      referenceCode: "DA-2026-C1",
      status: "COMPLETED",
      checkedInAt: "2026-09-20T08:00:00.000Z",
      checkedOutAt: "2026-09-20T12:00:00.000Z",
    });
    const completed2 = createMockReservation({
      id: "res-c2",
      referenceCode: "DA-2026-C2",
      status: "CHECKED_IN",
      checkedInAt: "2026-09-20T08:00:00.000Z",
      checkedOutAt: "2026-09-20T10:00:00.000Z",
    });
    const completed3 = createMockReservation({
      id: "res-c3",
      referenceCode: "DA-2026-C3",
      status: "COMPLETED",
      checkedInAt: null,
      checkedOutAt: null,
    });
    (memoryRepo as any).reservations = [completed1, completed2, completed3];

    const service = new AdminReservationService(memoryRepo, () => simulatedNow);
    const { reservations } = await service.listReservations("all");

    const tabCounts = getAdminReservationTabCounts(reservations, simulatedNow);
    assert.equal(tabCounts.completedBadgeCount, 3);
    assert.equal(tabCounts.expiredBadgeCount, 0);

    const completedRows = filterAdminReservationsByTab(reservations, "completed", "all", simulatedNow);
    assert.equal(completedRows.length, tabCounts.completedBadgeCount);
  });

  it("completed reservations with past endAt are counted in completedBadgeCount and NOT expiredBadgeCount", async () => {
    const memoryRepo = new ReservationMemoryRepository(() => simulatedNow);
    const completedPastEnd = createMockReservation({
      id: "res-past-end",
      referenceCode: "DA-2026-PE01",
      status: "COMPLETED",
      checkedInAt: "2026-09-20T08:00:00.000Z",
      checkedOutAt: "2026-09-20T12:00:00.000Z",
      candidates: [
        {
          rank: 0,
          tier: "Dedicated Desk",
          workspaceInstanceId: "desk-01",
          workspaceDisplayName: "Desk 01",
          startAt: "2026-09-20T08:00:00.000Z",
          endAt: "2026-09-20T12:00:00.000Z",
          isAssigned: true,
        },
      ],
    });
    const trueExpired = createMockReservation({
      id: "res-true-exp",
      referenceCode: "DA-2026-TE01",
      status: "CONFIRMED",
      checkedInAt: null,
      checkedOutAt: null,
      candidates: [
        {
          rank: 0,
          tier: "Dedicated Desk",
          workspaceInstanceId: "desk-02",
          workspaceDisplayName: "Desk 02",
          startAt: "2026-09-20T08:00:00.000Z",
          endAt: "2026-09-20T12:00:00.000Z",
          isAssigned: true,
        },
      ],
    });
    (memoryRepo as any).reservations = [completedPastEnd, trueExpired];

    const service = new AdminReservationService(memoryRepo, () => simulatedNow);
    const { reservations } = await service.listReservations("all");

    const tabCounts = getAdminReservationTabCounts(reservations, simulatedNow);
    assert.equal(tabCounts.completedBadgeCount, 1);
    assert.equal(tabCounts.expiredBadgeCount, 1);

    const completedList = filterAdminReservationsByTab(reservations, "completed", "all", simulatedNow);
    assert.equal(completedList.length, 1);
    assert.equal(completedList[0].referenceCode, "DA-2026-PE01");

    const expiredList = filterAdminReservationsByTab(reservations, "expired", "all", simulatedNow);
    assert.equal(expiredList.length, 1);
    assert.equal(expiredList[0].referenceCode, "DA-2026-TE01");
  });

  it("isAdminExpiredReservation returns false for any completed reservation summary", () => {
    const completedSummary1: AdminReservationSummary = {
      id: "res-1",
      referenceCode: "DA-2026-S1",
      customerName: "Jane Doe",
      customerInitials: "JD",
      workspaceDisplayName: "Desk 01",
      workspaceTemplateName: "Desk",
      schedule: "Sep 20, 8:00 AM - 12:00 PM",
      status: "Completed",
      statusStyle: { background: "#DCFCE7", color: "#166534" },
      mark: "✓",
      paymentStatus: "Paid",
      paymentColor: "var(--da-success)",
      reservationStatus: "COMPLETED",
      startAt: "2026-09-20T08:00:00.000Z",
      endAt: "2026-09-20T12:00:00.000Z",
      checkedInAt: "2026-09-20T08:00:00.000Z",
      checkedOutAt: "2026-09-20T12:00:00.000Z",
      amountDue: 500,
      currency: "PHP",
    };

    assert.equal(isAdminCompletedReservation(completedSummary1), true);
    assert.equal(isAdminExpiredReservation(completedSummary1, simulatedNow), false);
  });

  it("maintains accurate badge counts across all 4 admin tabs simultaneously", async () => {
    const memoryRepo = new ReservationMemoryRepository(() => simulatedNow);

    // 1. Upcoming Reservation (Reservations tab)
    const upcoming = createMockReservation({
      id: "res-upcoming",
      referenceCode: "DA-2026-UP01",
      status: "CONFIRMED",
      checkedInAt: null,
      checkedOutAt: null,
      candidates: [
        {
          rank: 0,
          tier: "Dedicated Desk",
          workspaceInstanceId: "desk-01",
          workspaceDisplayName: "Desk 01",
          startAt: "2026-09-24T08:00:00.000Z",
          endAt: "2026-09-24T12:00:00.000Z",
          isAssigned: true,
        },
      ],
    });

    // 2. Active Operation (Operations tab)
    const active = createMockReservation({
      id: "res-active",
      referenceCode: "DA-2026-ACT01",
      status: "CHECKED_IN",
      checkedInAt: "2026-09-23T09:00:00.000Z",
      checkedOutAt: null,
      candidates: [
        {
          rank: 0,
          tier: "Dedicated Desk",
          workspaceInstanceId: "desk-02",
          workspaceDisplayName: "Desk 02",
          startAt: "2026-09-23T09:00:00.000Z",
          endAt: "2026-09-23T13:00:00.000Z",
          isAssigned: true,
        },
      ],
    });

    // 3. Completed (Completed tab)
    const completed = createMockReservation({
      id: "res-comp",
      referenceCode: "DA-2026-CMP01",
      status: "COMPLETED",
      checkedInAt: "2026-09-22T08:00:00.000Z",
      checkedOutAt: "2026-09-22T12:00:00.000Z",
    });

    // 4. Expired (Expired tab)
    const expired = createMockReservation({
      id: "res-exp",
      referenceCode: "DA-2026-EXP01",
      status: "CONFIRMED",
      checkedInAt: null,
      checkedOutAt: null,
      candidates: [
        {
          rank: 0,
          tier: "Dedicated Desk",
          workspaceInstanceId: "desk-04",
          workspaceDisplayName: "Desk 04",
          startAt: "2026-09-21T08:00:00.000Z",
          endAt: "2026-09-21T12:00:00.000Z",
          isAssigned: true,
        },
      ],
    });

    (memoryRepo as any).reservations = [upcoming, active, completed, expired];

    const service = new AdminReservationService(memoryRepo, () => simulatedNow);
    const { reservations } = await service.listReservations("all");

    const counts = getAdminReservationTabCounts(reservations, simulatedNow);
    assert.equal(counts.reservationsBadgeCount, 1);
    assert.equal(counts.operationsBadgeCount, 1);
    assert.equal(counts.completedBadgeCount, 1);
    assert.equal(counts.expiredBadgeCount, 1);

    const resList = filterAdminReservationsByTab(reservations, "reservations", "all", simulatedNow);
    const opsList = filterAdminReservationsByTab(reservations, "operations", "all", simulatedNow);
    const cmpList = filterAdminReservationsByTab(reservations, "completed", "all", simulatedNow);
    const expList = filterAdminReservationsByTab(reservations, "expired", "all", simulatedNow);

    assert.equal(resList.length, counts.reservationsBadgeCount);
    assert.equal(opsList.length, counts.operationsBadgeCount);
    assert.equal(cmpList.length, counts.completedBadgeCount);
    assert.equal(expList.length, counts.expiredBadgeCount);
  });

  it("getStaffReservationTabCounts also correctly segregates completed counts", () => {
    const staffReservations: StaffOperationalReservation[] = [
      {
        reservationId: "res-s-comp",
        referenceCode: "DA-STAFF-C1",
        customerFirstName: "Alice",
        customerLastName: "Smith",
        customerEmail: "alice@example.com",
        workspaceDisplayName: "Desk 1",
        workspaceInstanceCode: "D1",
        bookingStartAt: "2026-09-20T08:00:00.000Z",
        bookingEndAt: "2026-09-20T12:00:00.000Z",
        reservationStatus: "COMPLETED",
        checkInState: "CHECKED_OUT",
        checkedInAt: "2026-09-20T08:00:00.000Z",
        checkedOutAt: "2026-09-20T12:00:00.000Z",
        paymentStatus: "PAID",
      },
      {
        reservationId: "res-s-exp",
        referenceCode: "DA-STAFF-E1",
        customerFirstName: "Bob",
        customerLastName: "Jones",
        customerEmail: "bob@example.com",
        workspaceDisplayName: "Desk 2",
        workspaceInstanceCode: "D2",
        bookingStartAt: "2026-09-20T08:00:00.000Z",
        bookingEndAt: "2026-09-20T12:00:00.000Z",
        reservationStatus: "CONFIRMED",
        checkInState: "NOT_CHECKED_IN",
        checkedInAt: null,
        checkedOutAt: null,
        paymentStatus: "PAID",
      },
    ];

    assert.equal(isStaffCompletedReservation(staffReservations[0]), true);
    assert.equal(isStaffExpiredReservation(staffReservations[0], simulatedNow), false);

    const counts = getStaffReservationTabCounts(staffReservations, simulatedNow);
    assert.equal(counts.completedBadgeCount, 1);
    assert.equal(counts.expiredBadgeCount, 1);
  });
});
