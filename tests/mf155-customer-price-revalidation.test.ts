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

describe("MF-155: Customer Pre-Confirmation Price Revalidation & Immutability", () => {
  let templateRate = 120;
  const template: WorkspaceTemplate = {
    id: "tpl-desk-1",
    name: "Dedicated Desk",
    description: null,
    photoPath: null,
    capacity: 1,
    rateAmount: templateRate,
    pricingUnit: "HOURLY",
    defaultShape: "rectangle",
    defaultColor: "#10B981",
    defaultStyle: {},
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const instance1: WorkspaceInstance = {
    id: "inst-desk-1",
    templateId: "tpl-desk-1",
    floorId: "floor-1",
    instanceCode: "DD-01",
    displayName: "Dedicated Desk 01",
    operationalStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const setupService = () => {
    const resRepo = new ReservationMemoryRepository();
    const wsRepo: WorkspaceRepository = {
      listCatalog: async () => ({
        templates: [{ ...template, rateAmount: templateRate }],
        instances: [instance1 as any],
        floors: [],
      }),
    } as any;
    const paySessionService = createPaymentSessionService(resRepo);
    const service = createReservationService(resRepo, wsRepo, resRepo, paySessionService);
    return { resRepo, wsRepo, service };
  };

  it("revalidateWorkspacePrice returns the live workspace template rate and currency", async () => {
    templateRate = 150;
    const { service } = setupService();

    const priceInfo = await service.revalidateWorkspacePrice("tpl-desk-1");
    assert.equal(priceInfo.currentRate, 150);
    assert.equal(priceInfo.rateAmount, 150);
    assert.equal(priceInfo.currency, "PHP");
    assert.equal(priceInfo.templateId, "tpl-desk-1");
    assert.equal(priceInfo.templateName, "Dedicated Desk");
  });

  it("revalidateWorkspacePrice throws an error when template is not found", async () => {
    const { service } = setupService();

    await assert.rejects(
      async () => {
        await service.revalidateWorkspacePrice("non-existent-template-id");
      },
      (err: any) => {
        assert(err instanceof ReservationError);
        assert(err.message.includes("not found"));
        return true;
      }
    );
  });

  it("records the rate snapshot and amount due at reservation creation time", async () => {
    templateRate = 200;
    const { service, resRepo } = setupService();

    const startAt = new Date(Date.now() + 3600 * 1000 * 2).toISOString();
    const endAt = new Date(Date.now() + 3600 * 1000 * 5).toISOString(); // 3 hours

    const reservation = await service.createReservation(
      {
        source: "WEB",
        customerFirstName: "Ana",
        customerLastName: "Reyes",
        customerEmail: "ana.reyes@example.com",
        bookedRatePerHour: 200,
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "inst-desk-1",
            startAt,
            endAt,
          },
        ],
      },
      {
        paymentLinkBaseUrl: "https://deskatlas.test/pay",
      }
    );

    assert.equal(reservation.rateSnapshot, 200);
    assert.equal(reservation.amountDue, 600); // 200 * 3 hours
    assert.equal(reservation.bookedRatePerHour, 200);

    // Verify detail retrieval shows booked rate
    const adminDetail = await resRepo.getAdminReservationDetail(reservation.id);
    assert.equal(adminDetail?.rateSnapshot, 200);
    assert.equal(adminDetail?.bookedRatePerHour, 200);
    assert.equal(adminDetail?.amountDue, 600);
  });

  it("ensures booked reservation price remains immutable even after subsequent template price updates", async () => {
    // Initial rate
    templateRate = 180;
    const { service, resRepo } = setupService();

    const startAt = new Date(Date.now() + 3600 * 1000 * 2).toISOString();
    const endAt = new Date(Date.now() + 3600 * 1000 * 4).toISOString(); // 2 hours

    const reservation = await service.createReservation(
      {
        source: "WEB",
        customerFirstName: "Carlos",
        customerLastName: "Mendoza",
        customerEmail: "carlos.mendoza@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "inst-desk-1",
            startAt,
            endAt,
          },
        ],
      },
      {
        paymentLinkBaseUrl: "https://deskatlas.test/pay",
      }
    );

    assert.equal(reservation.rateSnapshot, 180);
    assert.equal(reservation.amountDue, 360);

    // Now admin updates the template price from 180 to 250
    templateRate = 250;

    // Live revalidation reflects the new rate
    const livePrice = await service.revalidateWorkspacePrice("tpl-desk-1");
    assert.equal(livePrice.currentRate, 250);

    // But existing reservation detail still preserves the original booked rate snapshot
    const adminDetail = await resRepo.getAdminReservationDetail(reservation.id);
    assert.equal(adminDetail?.rateSnapshot, 180);
    assert.equal(adminDetail?.bookedRatePerHour, 180);
    assert.equal(adminDetail?.amountDue, 360);

    const operationalList = await resRepo.listOperationalReservations(new Date().toISOString());
    const opRes = operationalList.find((r) => r.reservationId === reservation.id);
    // If present in operational list
    if (opRes) {
      assert.equal(opRes.rateSnapshot, 180);
      assert.equal(opRes.bookedRatePerHour, 180);
    }
  });

  it("detects price change between session displayed rate and live template rate", async () => {
    templateRate = 300;
    const { service } = setupService();

    const displayedRate = 250; // Started booking session at 250
    const livePrice = await service.revalidateWorkspacePrice("tpl-desk-1");

    const hasChanged = livePrice.currentRate !== displayedRate;
    assert.equal(hasChanged, true);
    assert.equal(livePrice.currentRate, 300);

    // If acknowledged and customer proceeds with new rate (300)
    const startAt = new Date(Date.now() + 3600 * 1000 * 2).toISOString();
    const endAt = new Date(Date.now() + 3600 * 1000 * 4).toISOString(); // 2 hours

    const reservation = await service.createReservation(
      {
        source: "WEB",
        customerFirstName: "Bea",
        customerLastName: "Cruz",
        customerEmail: "bea.cruz@example.com",
        bookedRatePerHour: livePrice.currentRate,
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "inst-desk-1",
            startAt,
            endAt,
          },
        ],
      },
      {
        paymentLinkBaseUrl: "https://deskatlas.test/pay",
      }
    );

    assert.equal(reservation.rateSnapshot, 300);
    assert.equal(reservation.amountDue, 600); // 300 * 2 hours
  });
});
