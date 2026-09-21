import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ReservationError,
  ReservationMemoryRepository,
  createReservationService,
  createPaymentSessionService,
  type WorkspaceInstance,
  type WorkspaceTemplate,
  type WorkspaceRepository,
} from "@deskatlas/domain";

describe("MF-150: Customer Contact Number Collection for Reservations", () => {
  const template: WorkspaceTemplate = {
    id: "tpl-1",
    name: "Standard Desk",
    description: null,
    photoPath: null,
    capacity: 1,
    rateAmount: 100,
    pricingUnit: "HOURLY",
    defaultShape: "rectangle",
    defaultColor: "#000",
    defaultStyle: {},
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const instance1: WorkspaceInstance = {
    id: "inst-1",
    templateId: "tpl-1",
    floorId: "floor-1",
    instanceCode: "D1",
    displayName: "Desk 1",
    operationalStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const setupService = () => {
    const resRepo = new ReservationMemoryRepository();
    const wsRepo: WorkspaceRepository = {
      listCatalog: async () => ({
        templates: [template],
        instances: [instance1 as any],
        floors: [],
      }),
    } as any;
    const paySessionService = createPaymentSessionService(resRepo);
    const service = createReservationService(resRepo, wsRepo, resRepo, paySessionService);
    return { resRepo, wsRepo, service };
  };

  it("stores and retrieves customer contact number when provided for web reservation", async () => {
    const { service, resRepo } = setupService();

    const reservation = await service.createReservation(
      {
        source: "WEB",
        customerFirstName: "Maria",
        customerLastName: "Santos",
        customerEmail: "maria.santos@example.com",
        customerContactNumber: "+63 917 123 4567",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "inst-1",
            startAt: "2026-10-01T09:00:00.000Z",
            endAt: "2026-10-01T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    assert.equal(reservation.customerContactNumber, "+63 917 123 4567");

    // Check admin list
    const adminList = await resRepo.listAdminReservations();
    const adminSummary = adminList.find((r) => r.id === reservation.id);
    assert.ok(adminSummary);
    assert.equal(adminSummary.customerContactNumber, "+63 917 123 4567");

    // Check admin detail
    const adminDetail = await resRepo.getAdminReservationDetail(reservation.id);
    assert.ok(adminDetail);
    assert.equal(adminDetail.customerContactNumber, "+63 917 123 4567");
  });

  it("handles optional contact number when omitted (null / undefined)", async () => {
    const { service, resRepo } = setupService();

    const reservation = await service.createReservation(
      {
        source: "WEB",
        customerFirstName: "Juan",
        customerLastName: "Dela Cruz",
        customerEmail: "juan@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "inst-1",
            startAt: "2026-10-01T09:00:00.000Z",
            endAt: "2026-10-01T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    assert.equal(reservation.customerContactNumber, null);

    const adminSummary = (await resRepo.listAdminReservations()).find((r) => r.id === reservation.id);
    assert.ok(adminSummary);
    assert.equal(adminSummary.customerContactNumber, null);

    const adminDetail = await resRepo.getAdminReservationDetail(reservation.id);
    assert.ok(adminDetail);
    assert.equal(adminDetail.customerContactNumber, null);
  });

  it("stores and retrieves customer contact number for kiosk reservation", async () => {
    const { service, resRepo } = setupService();

    const reservation = await service.createReservation({
      source: "KIOSK",
      customerFirstName: "Ana",
      customerLastName: "Reyes",
      customerEmail: "ana@example.com",
      customerContactNumber: "09181234567",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: "inst-1",
          startAt: "2026-10-01T09:00:00.000Z",
          endAt: "2026-10-01T11:00:00.000Z",
        },
      ],
    });

    assert.equal(reservation.customerContactNumber, "09181234567");

    // Check staff operational reservation
    const staffList = await resRepo.listOperationalReservations("2026-10-01T09:00:00.000Z");
    const staffSummary = staffList.find((r) => r.reservationId === reservation.id);
    assert.ok(staffSummary);
    assert.equal(staffSummary.customerContactNumber, "09181234567");
  });

  it("accepts valid contact number formats", async () => {
    const validFormats = [
      "09171234567",
      "+639171234567",
      "+63 917 123 4567",
      "(02) 8123-4567",
      "0917-123-4567",
      "+1 (555) 123-4567",
    ];

    for (const contact of validFormats) {
      const { service } = setupService();
      const reservation = await service.createReservation({
        source: "KIOSK",
        customerFirstName: "Test",
        customerLastName: "User",
        customerEmail: "test@example.com",
        customerContactNumber: contact,
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "inst-1",
            startAt: "2026-10-01T09:00:00.000Z",
            endAt: "2026-10-01T11:00:00.000Z",
          },
        ],
      });
      assert.equal(reservation.customerContactNumber, contact);
    }
  });

  it("rejects invalid contact number format (letters or invalid symbols)", async () => {
    const { service } = setupService();

    await assert.rejects(
      async () => {
        await service.createReservation({
          source: "KIOSK",
          customerFirstName: "Test",
          customerLastName: "User",
          customerEmail: "test@example.com",
          customerContactNumber: "0917-CALL-ME",
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: "inst-1",
              startAt: "2026-10-01T09:00:00.000Z",
              endAt: "2026-10-01T11:00:00.000Z",
            },
          ],
        });
      },
      (err: any) => {
        assert.ok(err instanceof ReservationError);
        assert.match(err.message, /Invalid contact number format/i);
        return true;
      }
    );
  });

  it("rejects contact number exceeding 30 characters", async () => {
    const { service } = setupService();

    await assert.rejects(
      async () => {
        await service.createReservation({
          source: "KIOSK",
          customerFirstName: "Test",
          customerLastName: "User",
          customerEmail: "test@example.com",
          customerContactNumber: "12345678901234567890123456789012",
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: "inst-1",
              startAt: "2026-10-01T09:00:00.000Z",
              endAt: "2026-10-01T11:00:00.000Z",
            },
          ],
        });
      },
      (err: any) => {
        assert.ok(err instanceof ReservationError);
        assert.match(err.message, /Invalid contact number format/i);
        return true;
      }
    );
  });
});
