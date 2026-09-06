import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CandidateValidationError,
  InMemoryAvailabilityRepository,
  InMemoryWorkspaceRepository,
  InMemorySettingsRepository,
  createAdminSettingsService,
  ReservationMemoryRepository,
  createAvailabilityService,
  createPaymentSessionService,
  createReservationService,
  validateCandidates,
  type CandidateSubmissionDTO,
  type CandidateValidationContext,
} from "@deskatlas/domain";
import type { WorkspaceInstance, WorkspaceTemplate } from "@deskatlas/domain";

describe("t12: Customer Reservation & Landing Integration", () => {
  const templateDesk: WorkspaceTemplate = {
    id: "tpl-desk",
    name: "Dedicated Hot Desk",
    description: "High speed WiFi desk",
    photoPath: "/photos/hot-desk.jpg",
    capacity: 1,
    rateAmount: 60,
    pricingUnit: "HOURLY",
    defaultShape: "rectangle",
    defaultColor: "#E0EFE4",
    defaultStyle: {},
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const instanceDesk1: WorkspaceInstance = {
    id: "inst-desk-01",
    templateId: "tpl-desk",
    floorId: "floor-1",
    instanceCode: "HD01",
    displayName: "Desk 01",
    operationalStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const instanceDesk2: WorkspaceInstance = {
    id: "inst-desk-02",
    templateId: "tpl-desk",
    floorId: "floor-1",
    instanceCode: "HD02",
    displayName: "Desk 02",
    operationalStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const context: CandidateValidationContext = {
    instances: [instanceDesk1, instanceDesk2],
    templates: [templateDesk],
  };

  it("handles template-wide candidate validation and backup choices (MF41)", () => {
    // 1. Valid Main + Backup candidate
    const candidates: CandidateSubmissionDTO[] = [
      {
        rank: 0,
        workspaceInstanceId: instanceDesk1.id,
        startAt: "2026-09-01T10:00:00.000Z",
        endAt: "2026-09-01T12:00:00.000Z",
      },
      {
        rank: 1,
        workspaceInstanceId: instanceDesk2.id,
        startAt: "2026-09-01T10:00:00.000Z",
        endAt: "2026-09-01T12:00:00.000Z",
      },
    ];

    validateCandidates(candidates, context);

    // 2. Reject duplicate instance with identical start time
    const duplicate: CandidateSubmissionDTO[] = [
      candidates[0],
      {
        ...candidates[0],
        rank: 1,
      },
    ];
    assert.throws(() => validateCandidates(duplicate, context), CandidateValidationError);
  });

  it("creates customer reservation with template-first candidates (MF41)", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const paymentSessionService = createPaymentSessionService(reservationRepo);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const tpl = await workspaceRepo.createTemplate({
      name: "Hot Desk",
      capacity: 1,
      rateAmount: 60,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#E0EFE4",
      isActive: true,
    });
    const ws1 = await workspaceRepo.createInstance({
      templateId: tpl.id,
      floorId: floor.id,
      instanceCode: "HD01",
      displayName: "Desk 01",
    });

    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Customer",
        customerLastName: "One",
        customerEmail: "customer1@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ws1.id,
            startAt: "2026-09-01T10:00:00.000Z",
            endAt: "2026-09-01T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    assert.ok(res.id);
    assert.equal(res.status, "PENDING_PAYMENT");
    assert.equal(res.amountDue, 120); // 2 hours @ 60/hr
  });

  it("serves public landing preview photos with position coordinates (MF29)", async () => {
    const settingsRepo = new InMemorySettingsRepository();
    const settingsService = createAdminSettingsService(settingsRepo);

    await settingsService.updateBusinessSettings({
      businessName: "DeskAtlas",
      timezone: "Asia/Manila",
      bookingIntervalMinutes: 60,
      paymentExpiryMinutes: 60,
      landingPreviewPhotos: [
        { id: "p1", url: "https://img.test/p1.webp", position: { x: 30, y: 40 }, displayOrder: 0 },
        { id: "p2", url: "https://img.test/p2.webp", position: { x: 50, y: 50 }, displayOrder: 1 },
      ],
    });

    const publicPhotos = await settingsService.getPublicLandingPreviewPhotos();
    assert.equal(publicPhotos.length, 2);
    assert.equal(publicPhotos[0].position.x, 30);
    assert.equal(publicPhotos[0].position.y, 40);
    assert.equal(publicPhotos[1].position.x, 50);
    assert.equal(publicPhotos[1].position.y, 50);
  });
});
