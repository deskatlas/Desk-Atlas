import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CandidateValidationError,
  ReservationError,
  validateCandidates,
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  createReservationService,
  createPaymentSessionService,
  type CandidateSubmissionDTO,
  type CandidateValidationContext,
} from "@deskatlas/domain";
import type { WorkspaceInstance, WorkspaceTemplate } from "@deskatlas/domain";

describe("t04: Reservation Validation & Candidate Rules", () => {
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

  const template2: WorkspaceTemplate = {
    id: "tpl-2",
    name: "Premium Pod",
    description: null,
    photoPath: null,
    capacity: 1,
    rateAmount: 200,
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

  const instance2: WorkspaceInstance = {
    id: "inst-2",
    templateId: "tpl-1",
    floorId: "floor-1",
    instanceCode: "D2",
    displayName: "Desk 2",
    operationalStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const instanceOtherTier: WorkspaceInstance = {
    id: "inst-3",
    templateId: "tpl-2",
    floorId: "floor-1",
    instanceCode: "P1",
    displayName: "Pod 1",
    operationalStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const context: CandidateValidationContext = {
    instances: [instance1, instance2, instanceOtherTier],
    templates: [template, template2],
  };

  it("validates ranked candidates: Main + Alt 1 + Alt 2 (M06)", () => {
    const validCandidates: CandidateSubmissionDTO[] = [
      {
        rank: 0,
        workspaceInstanceId: instance1.id,
        startAt: "2026-09-01T09:00:00Z",
        endAt: "2026-09-01T11:00:00Z",
      },
      {
        rank: 1,
        workspaceInstanceId: instance2.id,
        startAt: "2026-09-01T09:00:00Z",
        endAt: "2026-09-01T11:00:00Z",
      },
    ];

    validateCandidates(validCandidates, context);

    // Reject missing Main (rank 0)
    assert.throws(
      () =>
        validateCandidates(
          [
            {
              rank: 1,
              workspaceInstanceId: instance2.id,
              startAt: "2026-09-01T09:00:00Z",
              endAt: "2026-09-01T11:00:00Z",
            },
          ],
          context
        ),
      CandidateValidationError
    );

    // Reject different tier
    assert.throws(
      () =>
        validateCandidates(
          [
            validCandidates[0],
            {
              rank: 1,
              workspaceInstanceId: instanceOtherTier.id,
              startAt: "2026-09-01T09:00:00Z",
              endAt: "2026-09-01T11:00:00Z",
            },
          ],
          context
        ),
      CandidateValidationError
    );

    // Reject different duration
    assert.throws(
      () =>
        validateCandidates(
          [
            validCandidates[0],
            {
              rank: 1,
              workspaceInstanceId: instance2.id,
              startAt: "2026-09-01T09:00:00Z",
              endAt: "2026-09-01T12:00:00Z",
            },
          ],
          context
        ),
      CandidateValidationError
    );
  });

  it("creates No-Hold guest reservation with ranked candidates (M07)", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const paymentSessionService = createPaymentSessionService(reservationRepo);
    const service = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const tpl = await workspaceRepo.createTemplate({
      name: "Standard Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#000",
      isActive: true,
    });
    const ws1 = await workspaceRepo.createInstance({
      templateId: tpl.id,
      floorId: floor.id,
      instanceCode: "T1",
      displayName: "Desk 1",
    });
    const ws2 = await workspaceRepo.createInstance({
      templateId: tpl.id,
      floorId: floor.id,
      instanceCode: "T2",
      displayName: "Desk 2",
    });

    const res = await service.createReservation(
      {
        source: "WEB",
        customerFirstName: "Juan",
        customerLastName: "Dela Cruz",
        customerEmail: "juan@example.com",
        customerPhone: "09171234567",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ws1.id,
            startAt: "2027-01-01T09:00:00Z",
            endAt: "2027-01-01T11:00:00Z",
          },
          {
            rank: 1,
            workspaceInstanceId: ws2.id,
            startAt: "2027-01-01T09:00:00Z",
            endAt: "2027-01-01T11:00:00Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    assert.ok(res.id);
    assert.ok(res.referenceCode);
    assert.equal(res.status, "PENDING_PAYMENT");
    assert.equal(res.candidates?.length, 2);

    // Reject missing customer info
    await assert.rejects(
      () =>
        service.createReservation(
          {
            source: "WEB",
            customerFirstName: "",
            customerLastName: "Dela Cruz",
            customerEmail: "juan@example.com",
            candidates: [
              {
                rank: 0,
                workspaceInstanceId: ws1.id,
                startAt: "2027-01-01T09:00:00Z",
                endAt: "2027-01-01T11:00:00Z",
              },
            ],
          },
          { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
        ),
      ReservationError
    );
  });

  it("supports same physical instance with different backup start time (MF34)", () => {
    // Valid: same instance, different start time
    const sameInstanceDifferentTime: CandidateSubmissionDTO[] = [
      {
        rank: 0,
        workspaceInstanceId: instance1.id,
        startAt: "2026-09-01T09:00:00Z",
        endAt: "2026-09-01T11:00:00Z",
      },
      {
        rank: 1,
        workspaceInstanceId: instance1.id, // Same instance!
        startAt: "2026-09-01T13:00:00Z",   // Different start time!
        endAt: "2026-09-01T15:00:00Z",
      },
    ];

    validateCandidates(sameInstanceDifferentTime, context);

    // Invalid: duplicate instance AND identical start time
    const duplicateExactSlot: CandidateSubmissionDTO[] = [
      sameInstanceDifferentTime[0],
      {
        ...sameInstanceDifferentTime[0],
        rank: 1,
      },
    ];

    assert.throws(
      () => validateCandidates(duplicateExactSlot, context),
      CandidateValidationError
    );
  });
});
