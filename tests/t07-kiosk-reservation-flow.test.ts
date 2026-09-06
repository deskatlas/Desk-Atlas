import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CounterPaymentConflictError,
  ReservationError,
  ReservationMemoryRepository,
  createBookingAccessService,
  createCounterPaymentService,
  createReservationService,
  createMapService,
  InMemoryWorkspaceRepository,
  InMemoryMapRepository,
  MapValidationError,
  type MapElementInput,
  type Floor,
} from "@deskatlas/domain";

describe("t07: Kiosk Reservation Flow & In-Person Experience", () => {
  it("handles kiosk reservation creation and counter payment confirmation (M11)", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    let now = new Date("2026-08-27T09:00:00.000Z");
    const nowProvider = () => now;
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo
    );
    const counterPaymentService = createCounterPaymentService(reservationRepo, nowProvider);
    const bookingAccessService = createBookingAccessService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Ground Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Skypod",
      capacity: 1,
      rateAmount: 150,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#0f172a",
      isActive: true,
    });

    const instanceA = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "SP-01",
      displayName: "Skypod 1",
    });

    // Create Kiosk reservation
    const reservation = await reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Walk-in",
      customerLastName: "Customer",
      customerEmail: "walkin@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: instanceA.id,
          startAt: "2026-08-27T10:00:00.000Z",
          endAt: "2026-08-27T12:00:00.000Z",
        },
      ],
    });

    assert.equal(reservation.status, "PENDING_COUNTER_CONFIRMATION");
    assert.equal(reservation.paymentSession, undefined); // No emailed link for kiosk
    assert.ok(reservation.counterPaymentAttemptId);

    // Staff confirms counter payment
    const staffActor = { userId: "staff-1", role: "STAFF" as const };
    const paymentResult = await counterPaymentService.confirmPayment({
      paymentAttemptId: reservation.counterPaymentAttemptId!,
      actor: staffActor,
    });

    assert.ok(
      paymentResult.reservationStatus === "CONFIRMED" ||
        paymentResult.reservationStatus === "CHECKED_IN"
    );
    assert.equal(paymentResult.assignedCandidateRank, 0);
  });

  it("validates Kiosk 'You Are Here' marker and enforces single-marker rule per floor (M16)", async () => {
    const floor: Floor = {
      id: "floor-default",
      name: "Ground Floor",
      floorNumber: 1,
      displayOrder: 0,
      isActive: true,
    };

    const mapRepo = new InMemoryMapRepository({
      floors: [floor],
      workspaceInstances: [],
    });
    const mapService = createMapService(mapRepo);

    // Save draft with one You-Are-Here marker
    const draft = await mapService.saveDraft({
      floorId: floor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: [
        {
          id: "marker-1",
          elementRole: "INFORMATION",
          elementType: "KIOSK_YOU_ARE_HERE",
          x: 200,
          y: 200,
          width: 80,
          height: 80,
          rotation: 0,
          zIndex: 10,
        },
      ],
    });

    assert.equal(draft.elements.length, 1);
    assert.equal(draft.elements[0].elementType, "KIOSK_YOU_ARE_HERE");

    // Reject second You-Are-Here marker on same floor
    await assert.rejects(
      () =>
        mapService.saveDraft({
          floorId: floor.id,
          canvasWidth: 1600,
          canvasHeight: 1000,
          gridSize: 20,
          elements: [
            {
              id: "marker-1",
              elementRole: "INFORMATION",
              elementType: "KIOSK_YOU_ARE_HERE",
              x: 200,
              y: 200,
              width: 80,
              height: 80,
              rotation: 0,
              zIndex: 10,
            },
            {
              id: "marker-2",
              elementRole: "INFORMATION",
              elementType: "KIOSK_YOU_ARE_HERE",
              x: 400,
              y: 400,
              width: 80,
              height: 80,
              rotation: 0,
              zIndex: 11,
            },
          ],
        }),
      MapValidationError
    );
  });
});
