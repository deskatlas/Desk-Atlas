import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createGuestReservationTrackingService,
  createReservationService,
  createPaymentSessionService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
} from "@deskatlas/domain";
import { mapReservationStatusDisplay } from "../apps/customer-website/src/features/tracking/utils/reservationStatusMap";

describe("MF-163: Track Reservation Expired Status Display", () => {
  async function setupFixture() {
    let currentTime = new Date("2026-09-21T08:00:00.000Z");
    const nowProvider = () => currentTime;
    const reservationRepo = new ReservationMemoryRepository(nowProvider);
    const workspaceRepo = new InMemoryWorkspaceRepository();

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const trackingService = createGuestReservationTrackingService(
      reservationRepo,
      undefined,
      nowProvider
    );

    const floor = await workspaceRepo.createFloor({ name: "Ground Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Focus Pod",
      capacity: 1,
      rateAmount: 150,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#3b82f6",
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "FP-01",
      displayName: "Focus Pod 1",
    });

    return {
      reservationRepo,
      workspaceRepo,
      instance,
      getTime: () => currentTime,
      setTime: (d: Date) => {
        currentTime = d;
      },
      reservationService,
      trackingService,
    };
  }

  it("returns status: 'EXPIRED' for an explicitly expired reservation in DB", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Ana",
        customerLastName: "Reyes",
        customerEmail: "ana.reyes@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instance.id,
            startAt: "2026-09-21T09:00:00.000Z",
            endAt: "2026-09-21T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const stored = ctx.reservationRepo.getStoredReservation(created.id)!;
    stored.status = "EXPIRED";

    const tracking = await ctx.trackingService.getReservationTracking({
      referenceCode: created.referenceCode,
      customerEmail: "ana.reyes@example.com",
    });

    assert.equal(tracking.status, "EXPIRED");
    assert.equal(tracking.canReschedule, false);
    assert.equal(tracking.isInSession, false);
    assert.equal(tracking.canRelocate, false);
  });

  it("returns status: 'EXPIRED' dynamically when reservation booking end time has passed", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Carlos",
        customerLastName: "Dizon",
        customerEmail: "carlos.dizon@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instance.id,
            startAt: "2026-09-21T09:00:00.000Z",
            endAt: "2026-09-21T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const stored = ctx.reservationRepo.getStoredReservation(created.id)!;
    stored.status = "CONFIRMED";
    stored.confirmedAt = "2026-09-21T08:30:00.000Z";
    stored.candidates![0].isAssigned = true;

    // During active booking window (10:00 AM)
    ctx.setTime(new Date("2026-09-21T10:00:00.000Z"));
    const activeTracking = await ctx.trackingService.getReservationTracking({
      referenceCode: created.referenceCode,
      customerEmail: "carlos.dizon@example.com",
    });
    assert.equal(activeTracking.status, "CONFIRMED");
    assert.equal(activeTracking.isInSession, true);

    // After booking end window (12:05 PM)
    ctx.setTime(new Date("2026-09-21T12:05:00.000Z"));
    const expiredTracking = await ctx.trackingService.getReservationTracking({
      referenceCode: created.referenceCode,
      customerEmail: "carlos.dizon@example.com",
    });
    assert.equal(expiredTracking.status, "EXPIRED");
    assert.equal(expiredTracking.canReschedule, false);
    assert.equal(expiredTracking.isInSession, false);
    assert.equal(expiredTracking.canRelocate, false);
  });

  it("maps EXPIRED status to distinct Expired label and badge class", () => {
    const expiredPresentation = mapReservationStatusDisplay("EXPIRED");
    assert.equal(expiredPresentation.label, "Expired");
    assert.ok(
      expiredPresentation.badgeClass.includes("text-gray-700") ||
        expiredPresentation.badgeClass.includes("bg-gray-100") ||
        expiredPresentation.badgeClass.includes("bg-orange-100")
    );

    const confirmedPresentation = mapReservationStatusDisplay("CONFIRMED");
    assert.equal(confirmedPresentation.label, "Confirmed");
    assert.notEqual(expiredPresentation.badgeClass, confirmedPresentation.badgeClass);

    const rejectedPresentation = mapReservationStatusDisplay("REJECTED");
    assert.equal(rejectedPresentation.label, "Rejected");
  });

  it("ensures expired tracking view logic correctly suppresses reschedule, passes, and displays notice", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Elena",
        customerLastName: "Cruz",
        customerEmail: "elena.cruz@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instance.id,
            startAt: "2026-09-21T09:00:00.000Z",
            endAt: "2026-09-21T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const stored = ctx.reservationRepo.getStoredReservation(created.id)!;
    stored.status = "EXPIRED";

    const trackingData = await ctx.trackingService.getReservationTracking({
      referenceCode: created.referenceCode,
      customerEmail: "elena.cruz@example.com",
    });

    const isRejected =
      trackingData.status === "REJECTED" ||
      trackingData.paymentStatus === "REJECTED" ||
      (trackingData.status === "CANCELLED" &&
        (!trackingData.confirmedAt || trackingData.paymentStatus === "REJECTED"));

    const isExpired = trackingData.status === "EXPIRED";
    const statusDisplay = mapReservationStatusDisplay(trackingData.status, trackingData.paymentStatus);

    assert.equal(isExpired, true);
    assert.equal(statusDisplay.label, "Expired");

    // Confirmed at displays Expired if never confirmed
    const confirmedAtValue = isRejected
      ? "Rejected"
      : isExpired && !trackingData.confirmedAt
      ? "Expired"
      : trackingData.confirmedAt
      ? trackingData.confirmedAt
      : "Pending";

    assert.equal(confirmedAtValue, "Expired");

    // Reschedule and spot relocation sections must not render
    const canRenderRescheduleSection = !isRejected && !isExpired && trackingData.status === "CONFIRMED";
    const canRenderRelocateSection = !isRejected && !isExpired && trackingData.status === "CONFIRMED";

    assert.equal(canRenderRescheduleSection, false);
    assert.equal(canRenderRelocateSection, false);
  });

  it("retains Confirmed status and display when reservation is active and confirmed (no regression)", async () => {
    const ctx = await setupFixture();

    const created = await ctx.reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Mateo",
        customerLastName: "Garcia",
        customerEmail: "mateo.garcia@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instance.id,
            startAt: "2026-09-21T14:00:00.000Z",
            endAt: "2026-09-21T17:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    const stored = ctx.reservationRepo.getStoredReservation(created.id)!;
    stored.status = "CONFIRMED";
    stored.confirmedAt = "2026-09-21T08:30:00.000Z";
    stored.candidates![0].isAssigned = true;

    // Time before cutoff
    ctx.setTime(new Date("2026-09-21T01:00:00.000Z"));

    const trackingData = await ctx.trackingService.getReservationTracking({
      referenceCode: created.referenceCode,
      customerEmail: "mateo.garcia@example.com",
    });

    assert.equal(trackingData.status, "CONFIRMED");
    assert.equal(trackingData.canReschedule, true);

    const statusDisplay = mapReservationStatusDisplay(trackingData.status, trackingData.paymentStatus);
    assert.equal(statusDisplay.label, "Confirmed");
  });
});
