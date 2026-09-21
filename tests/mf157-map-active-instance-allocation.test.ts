import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createAdminReservationService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  createWorkspaceService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("MF-157: Map-Active Instance Constraint for Allocation and Reallocation", () => {
  it("excludes instances not on published map from automatic allocation even if ACTIVE and conflict-free", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const reservationRepo = new ReservationMemoryRepository(() => new Date("2026-09-01T09:00:00.000Z"), workspaceRepo);
    let now = new Date("2026-09-01T09:00:00.000Z");
    const nowProvider = () => now;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Design Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "desk",
      defaultColor: "#009689",
      isActive: true,
    });

    // Desk 6: ACTIVE, but NOT placed on map
    const desk6 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DD-06",
      displayName: "Design Desk 6",
      operationalStatus: "ACTIVE",
    });

    // Desk 1: ACTIVE, PLACED on published map
    const desk1 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DD-01",
      displayName: "Design Desk 1",
      operationalStatus: "ACTIVE",
    });

    // Only Desk 1 is on published map
    workspaceRepo.setMapPlacedInstanceIds([desk1.id]);

    // Customer submits reservation with Main = Desk 6 (not on map), Alt 1 = Desk 1 (on map)
    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "Walker",
        customerEmail: "alice@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: desk6.id,
            startAt: "2026-09-02T10:00:00.000Z",
            endAt: "2026-09-02T12:00:00.000Z",
          },
          {
            rank: 1,
            workspaceInstanceId: desk1.id,
            startAt: "2026-09-02T10:00:00.000Z",
            endAt: "2026-09-02T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/alice.png",
    });

    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);

    // Admin approves payment -> Desk 6 is bypassed because it's not on published map; Desk 1 is allocated!
    const decision = await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" as const },
      decision: "APPROVE",
    });

    assert.equal(decision.reservationStatus, "CONFIRMED");
    assert.equal(decision.paymentStatus, "APPROVED");
    assert.equal(decision.assignedCandidateRank, 1);
    assert.equal(decision.assignedCandidate?.workspaceInstanceId, desk1.id);
  });

  it("escalates to NEEDS_MANUAL_RESOLUTION if all candidate instances are not on published map", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const reservationRepo = new ReservationMemoryRepository(() => new Date("2026-09-01T09:00:00.000Z"), workspaceRepo);
    let now = new Date("2026-09-01T09:00:00.000Z");
    const nowProvider = () => now;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Design Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "desk",
      defaultColor: "#009689",
      isActive: true,
    });

    const desk6 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DD-06",
      displayName: "Design Desk 6",
      operationalStatus: "ACTIVE",
    });

    // Map has NO placed instances (empty published map)
    workspaceRepo.setMapPlacedInstanceIds([]);

    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Bob",
        customerLastName: "Builder",
        customerEmail: "bob@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: desk6.id,
            startAt: "2026-09-02T10:00:00.000Z",
            endAt: "2026-09-02T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/bob.png",
    });

    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);

    const decision = await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" as const },
      decision: "APPROVE",
    });

    assert.equal(decision.reservationStatus, "NEEDS_MANUAL_RESOLUTION");
    assert.equal(decision.paymentStatus, "APPROVED");
    assert.equal(decision.assignedCandidate, null);
    assert.equal(decision.assignedCandidateRank, null);
  });

  it("excludes instances on published map but in MAINTENANCE from allocation", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const reservationRepo = new ReservationMemoryRepository(() => new Date("2026-09-01T09:00:00.000Z"), workspaceRepo);
    let now = new Date("2026-09-01T09:00:00.000Z");
    const nowProvider = () => now;

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Design Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "desk",
      defaultColor: "#009689",
      isActive: true,
    });

    const desk1 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DD-01",
      displayName: "Design Desk 1",
      operationalStatus: "MAINTENANCE",
      maintenanceNote: "Broken leg",
    });

    const desk2 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DD-02",
      displayName: "Design Desk 2",
      operationalStatus: "ACTIVE",
    });

    // Both are on published map
    workspaceRepo.setMapPlacedInstanceIds([desk1.id, desk2.id]);

    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Charlie",
        customerLastName: "Brown",
        customerEmail: "charlie@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: desk1.id, // MAINTENANCE
            startAt: "2026-09-02T10:00:00.000Z",
            endAt: "2026-09-02T12:00:00.000Z",
          },
          {
            rank: 1,
            workspaceInstanceId: desk2.id, // ACTIVE
            startAt: "2026-09-02T10:00:00.000Z",
            endAt: "2026-09-02T12:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/charlie.png",
    });

    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);

    const decision = await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" as const },
      decision: "APPROVE",
    });

    assert.equal(decision.reservationStatus, "CONFIRMED");
    assert.equal(decision.assignedCandidateRank, 1);
    assert.equal(decision.assignedCandidate?.workspaceInstanceId, desk2.id);
  });

  it("listAvailableRelocationSpots only returns instances that are on the published map", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const reservationRepo = new ReservationMemoryRepository(() => new Date("2026-09-01T09:00:00.000Z"), workspaceRepo);
    const adminReservationService = createAdminReservationService(reservationRepo);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Design Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "desk",
      defaultColor: "#009689",
      isActive: true,
    });

    const desk1 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DD-01",
      displayName: "Design Desk 1",
      operationalStatus: "ACTIVE",
    });

    const desk2 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DD-02",
      displayName: "Design Desk 2",
      operationalStatus: "ACTIVE",
    });

    const desk6 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DD-06",
      displayName: "Design Desk 6",
      operationalStatus: "ACTIVE",
    });

    // Only Desk 1 and Desk 2 are placed on map; Desk 6 is NOT on map
    workspaceRepo.setMapPlacedInstanceIds([desk1.id, desk2.id]);

    // Create a confirmed reservation on Desk 1
    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "David",
      customerLastName: "Miller",
      customerEmail: "david@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: desk1.id,
          startAt: "2026-09-02T10:00:00.000Z",
          endAt: "2026-09-02T12:00:00.000Z",
        },
      ],
    });

    // Manually mark confirmed and assigned
    const stored = reservationRepo.getStoredReservation(res.id)!;
    stored.status = "CONFIRMED";
    stored.candidates![0].isAssigned = true;

    const spots = await adminReservationService.listAvailableRelocationSpots(res.id);

    // Should include Desk 2, but MUST NOT include Desk 6
    assert.equal(spots.length, 1);
    assert.equal(spots[0].id, desk2.id);
    assert.equal(spots.some((s) => s.id === desk6.id), false);
  });

  it("relocating to an unmapped instance is rejected", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const reservationRepo = new ReservationMemoryRepository(() => new Date("2026-09-01T09:00:00.000Z"), workspaceRepo);
    const adminReservationService = createAdminReservationService(reservationRepo);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Design Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "desk",
      defaultColor: "#009689",
      isActive: true,
    });

    const desk1 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DD-01",
      displayName: "Design Desk 1",
      operationalStatus: "ACTIVE",
    });

    const desk6 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "DD-06",
      displayName: "Design Desk 6",
      operationalStatus: "ACTIVE",
    });

    // Only Desk 1 is on map
    workspaceRepo.setMapPlacedInstanceIds([desk1.id]);

    const res = await reservationRepo.createReservation({
      source: "WEB",
      customerFirstName: "Eve",
      customerLastName: "Adams",
      customerEmail: "eve@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: desk1.id,
          startAt: "2026-09-02T10:00:00.000Z",
          endAt: "2026-09-02T12:00:00.000Z",
        },
      ],
    });

    const stored = reservationRepo.getStoredReservation(res.id)!;
    stored.status = "CONFIRMED";
    stored.candidates![0].isAssigned = true;

    await assert.rejects(
      () =>
        adminReservationService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk6.id,
          reason: "Request",
          actorUserId: "admin-1",
          actorRole: "ADMIN" as const,
        }),
      /Cannot relocate to a workspace spot that is not on the published map/
    );
  });

  it("confirms kiosk payment and allocates only to map-active instances", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const reservationRepo = new ReservationMemoryRepository(() => new Date("2026-09-01T09:00:00.000Z"), workspaceRepo);
    const now = new Date("2026-09-01T09:00:00.000Z");

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "desk",
      defaultColor: "#009689",
      isActive: true,
    });

    const deskUnmapped = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "D-UNMAPPED",
      displayName: "Unmapped Desk",
      operationalStatus: "ACTIVE",
    });

    const deskMapped = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "D-MAPPED",
      displayName: "Mapped Desk",
      operationalStatus: "ACTIVE",
    });

    workspaceRepo.setMapPlacedInstanceIds([deskMapped.id]);

    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo
    );

    // Kiosk 1: Unmapped desk -> should escalate to manual resolution
    const kioskUnmapped = await reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Frank",
      customerLastName: "Castle",
      customerEmail: "frank@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: deskUnmapped.id,
          startAt: "2026-09-01T10:00:00.000Z",
          endAt: "2026-09-01T11:00:00.000Z",
        },
      ],
    });

    const unmappedResult = await reservationRepo.confirmCounterPaymentAndAllocate({
      paymentAttemptId: kioskUnmapped.counterPaymentAttemptId!,
      actorUserId: "staff-1",
      processedAt: now.toISOString(),
    });

    assert.equal(unmappedResult.reservationStatus, "NEEDS_MANUAL_RESOLUTION");
    assert.equal(unmappedResult.assignedCandidate, null);

    // Kiosk 2: Mapped desk -> should allocate and CHECK_IN
    const kioskMapped = await reservationService.createReservation({
      source: "KIOSK",
      customerFirstName: "Grace",
      customerLastName: "Hopper",
      customerEmail: "grace@example.com",
      paymentMethodId: "pm-cash",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: deskMapped.id,
          startAt: "2026-09-01T10:00:00.000Z",
          endAt: "2026-09-01T11:00:00.000Z",
        },
      ],
    });

    const mappedResult = await reservationRepo.confirmCounterPaymentAndAllocate({
      paymentAttemptId: kioskMapped.counterPaymentAttemptId!,
      actorUserId: "staff-1",
      processedAt: now.toISOString(),
    });

    assert.equal(mappedResult.reservationStatus, "CHECKED_IN");
    assert.equal(mappedResult.assignedCandidateRank, 0);
    assert.equal(mappedResult.assignedCandidate?.workspaceInstanceId, deskMapped.id);
  });

  it("workspaceService exposes getMapPlacedInstanceIds helper", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(workspaceRepo);

    const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
    const template = await workspaceRepo.createTemplate({
      name: "Desk",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
      defaultShape: "desk",
      defaultColor: "#009689",
      isActive: true,
    });

    const desk1 = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "D-01",
      displayName: "Desk 1",
    });

    workspaceRepo.setMapPlacedInstanceIds([desk1.id]);

    const placedIds = await service.getMapPlacedInstanceIds();
    assert.equal(placedIds.has(desk1.id), true);
    assert.equal(placedIds.size, 1);
  });
});
