import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AdminReservationService,
  mapStatusPresentation,
  filterAdminReservationsByTab,
  getAdminReservationTabCounts,
  generateReservationsCsv,
  ReservationMemoryRepository,
  type AdminReservationSummary,
  type ReservationResponseDTO,
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

describe("MF-185: Admin Completed Reservations Status Display Fix", () => {
  const simulatedNow = new Date("2026-09-23T10:00:00.000Z");

  it("retains COMPLETED status and Completed badge presentation for past completed reservations in listReservations", async () => {
    const memoryRepo = new ReservationMemoryRepository(() => simulatedNow);
    const completedBooking = createMockReservation({
      id: "res-past-completed",
      referenceCode: "DA-2026-CMP99",
      status: "COMPLETED",
      checkedInAt: "2026-09-20T08:00:00.000Z",
      checkedOutAt: "2026-09-20T12:00:00.000Z",
    });
    (memoryRepo as any).reservations = [completedBooking];

    const service = new AdminReservationService(memoryRepo, () => simulatedNow);
    const result = await service.listReservations("all");

    assert.equal(result.reservations.length, 1);
    const item = result.reservations[0];
    assert.equal(item.reservationStatus, "COMPLETED");
    assert.equal(item.status, "Completed");
    assert.equal(item.mark, "✓");
    assert.deepEqual(item.statusStyle, { background: "#DCFCE7", color: "#166534" });
    assert.equal(item.paymentStatus, "Paid");
  });

  it("retains Completed status for checked-out reservations even if reservationStatus was CHECKED_IN in database", async () => {
    const memoryRepo = new ReservationMemoryRepository(() => simulatedNow);
    const checkedOutBooking = createMockReservation({
      id: "res-checkedout",
      referenceCode: "DA-2026-CO01",
      status: "CHECKED_IN",
      checkedInAt: "2026-09-20T08:00:00.000Z",
      checkedOutAt: "2026-09-20T12:00:00.000Z",
    });
    (memoryRepo as any).reservations = [checkedOutBooking];

    const service = new AdminReservationService(memoryRepo, () => simulatedNow);
    const result = await service.listReservations("all");

    assert.equal(result.reservations.length, 1);
    const item = result.reservations[0];
    assert.equal(item.reservationStatus, "COMPLETED");
    assert.equal(item.status, "Completed");
    assert.equal(item.mark, "✓");
    assert.deepEqual(item.statusStyle, { background: "#DCFCE7", color: "#166534" });
  });

  it("getReservationDetail returns Completed status and does not mutate completed bookings to Expired", async () => {
    const memoryRepo = new ReservationMemoryRepository(() => simulatedNow);
    const completedBooking = createMockReservation({
      id: "res-detail-completed",
      referenceCode: "DA-2026-DET01",
      status: "COMPLETED",
      checkedInAt: "2026-09-20T08:00:00.000Z",
      checkedOutAt: "2026-09-20T12:00:00.000Z",
    });
    (memoryRepo as any).reservations = [completedBooking];

    const service = new AdminReservationService(memoryRepo, () => simulatedNow);
    const detail = await service.getReservationDetail("DA-2026-DET01");

    assert(detail);
    assert.equal(detail.reservationStatus, "COMPLETED");
    assert.equal(detail.status, "Completed");
    assert.equal(detail.mark, "✓");
    assert.deepEqual(detail.statusStyle, { background: "#DCFCE7", color: "#166534" });
    assert(!detail.timeline.some((t) => t.toLowerCase().includes("expired")));
  });

  it("preserves EXPIRED status for truly expired un-checked-in bookings whose end time passed", async () => {
    const memoryRepo = new ReservationMemoryRepository(() => simulatedNow);
    const expiredBooking = createMockReservation({
      id: "res-unattended",
      referenceCode: "DA-2026-EXP01",
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
    (memoryRepo as any).reservations = [expiredBooking];

    const service = new AdminReservationService(memoryRepo, () => simulatedNow);
    const result = await service.listReservations("all");

    assert.equal(result.reservations.length, 1);
    const item = result.reservations[0];
    assert.equal(item.reservationStatus, "EXPIRED");
    assert.equal(item.status, "Expired");
    assert.equal(item.mark, "✕");
  });

  it("filters correctly in filterAdminReservationsByTab and counts accurately in getAdminReservationTabCounts", async () => {
    const memoryRepo = new ReservationMemoryRepository(() => simulatedNow);
    const completedBooking = createMockReservation({
      id: "res-c1",
      referenceCode: "DA-2026-C1",
      status: "COMPLETED",
      checkedInAt: "2026-09-20T08:00:00.000Z",
      checkedOutAt: "2026-09-20T12:00:00.000Z",
    });
    const expiredBooking = createMockReservation({
      id: "res-e1",
      referenceCode: "DA-2026-E1",
      status: "CONFIRMED",
      checkedInAt: null,
      checkedOutAt: null,
      candidates: [
        {
          rank: 0,
          tier: "Dedicated Desk",
          workspaceInstanceId: "desk-03",
          workspaceDisplayName: "Desk 03",
          startAt: "2026-09-20T08:00:00.000Z",
          endAt: "2026-09-20T12:00:00.000Z",
          isAssigned: true,
        },
      ],
    });
    (memoryRepo as any).reservations = [completedBooking, expiredBooking];

    const service = new AdminReservationService(memoryRepo, () => simulatedNow);
    const { reservations } = await service.listReservations("all");

    // Completed tab
    const completedTabItems = filterAdminReservationsByTab(reservations, "completed", "all", simulatedNow);
    assert.equal(completedTabItems.length, 1);
    assert.equal(completedTabItems[0].referenceCode, "DA-2026-C1");
    assert.equal(completedTabItems[0].status, "Completed");

    // Expired tab
    const expiredTabItems = filterAdminReservationsByTab(reservations, "expired", "all", simulatedNow);
    assert.equal(expiredTabItems.length, 1);
    assert.equal(expiredTabItems[0].referenceCode, "DA-2026-E1");
    assert.equal(expiredTabItems[0].status, "Expired");

    // Tab counts
    const tabCounts = getAdminReservationTabCounts(reservations, simulatedNow);
    assert.equal(tabCounts.completedBadgeCount, 1);
    assert.equal(tabCounts.expiredBadgeCount, 1);
  });

  it("generateReservationsCsv outputs COMPLETED and APPROVED for completed reservations", async () => {
    const memoryRepo = new ReservationMemoryRepository(() => simulatedNow);
    const completedBooking = createMockReservation({
      id: "res-csv-1",
      referenceCode: "DA-2026-CSV1",
      status: "COMPLETED",
      checkedInAt: "2026-09-20T08:00:00.000Z",
      checkedOutAt: "2026-09-20T12:00:00.000Z",
    });
    (memoryRepo as any).reservations = [completedBooking];

    const service = new AdminReservationService(memoryRepo, () => simulatedNow);
    const { reservations } = await service.listReservations("all");

    const csv = generateReservationsCsv(reservations);
    assert(csv.includes("DA-2026-CSV1"));
    assert(csv.includes("COMPLETED"));
    assert(csv.includes("APPROVED"));
    assert(!csv.includes("EXPIRED"));
  });
});
