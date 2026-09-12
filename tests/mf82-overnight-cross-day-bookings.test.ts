import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  InMemoryAvailabilityRepository,
  createAvailabilityService,
  validateCandidates,
  ReservationMemoryRepository,
  type CandidateSubmissionDTO,
  type CandidateValidationContext,
  type WorkspaceInstance,
  type WorkspaceTemplate,
} from "@deskatlas/domain";

describe("MF-82: Overnight / Cross-Day Bookings", () => {
  it("generates slots across midnight (e.g. 11pm to 3am) when 24/7", async () => {
    const repository = new InMemoryAvailabilityRepository();
    repository.setBusinessSettings({
      timezone: "Asia/Manila",
      bookingIntervalMinutes: 60,
    });
    repository.seedWorkspaceInstance({
      id: "desk-overnight-1",
      templateId: "template-standard",
      floorId: "floor-1",
      instanceCode: "D-ON-1",
      displayName: "Overnight Desk 1",
      operationalStatus: "ACTIVE",
    });

    // Seed 24/7 operating hours for all 7 days
    for (let day = 0; day <= 6; day++) {
      repository.seedOperatingHours(day, [{ opensAt: "00:00:00", closesAt: "24:00:00" }]);
    }

    const service = createAvailabilityService(repository);

    // Book 4 hours (240 minutes) on 2026-09-12
    const availability = await service.listTimeAvailability({
      workspaceInstanceId: "desk-overnight-1",
      date: "2026-09-12",
      durationMinutes: 240,
      nowIso: "2026-09-12T00:00:00.000Z",
    });

    assert.equal(availability.workspaceIsBookable, true);
    assert.ok(availability.slots.length > 0);

    // Find 11:00 PM (23:00) slot
    const slot23 = availability.slots.find((s) => s.startTime === "23:00");
    assert.ok(slot23, "23:00 slot must be generated for 4-hour duration");
    assert.equal(slot23.startTime, "23:00");
    assert.equal(slot23.endTime, "03:00");
    assert.equal(slot23.isAvailable, true);
    assert.equal(slot23.blockingReason, null);

    // Verify slots at 20:00, 21:00, 22:00
    const slot20 = availability.slots.find((s) => s.startTime === "20:00");
    assert.ok(slot20);
    assert.equal(slot20.endTime, "24:00");
    assert.equal(slot20.isAvailable, true);

    const slot21 = availability.slots.find((s) => s.startTime === "21:00");
    assert.ok(slot21);
    assert.equal(slot21.endTime, "01:00");
    assert.equal(slot21.isAvailable, true);

    const slot22 = availability.slots.find((s) => s.startTime === "22:00");
    assert.ok(slot22);
    assert.equal(slot22.endTime, "02:00");
    assert.equal(slot22.isAvailable, true);
  });

  it("marks overnight slot as BUSINESS_CLOSED if next day is closed", async () => {
    const repository = new InMemoryAvailabilityRepository();
    repository.setBusinessSettings({
      timezone: "Asia/Manila",
      bookingIntervalMinutes: 60,
    });
    repository.seedWorkspaceInstance({
      id: "desk-overnight-2",
      templateId: "template-standard",
      floorId: "floor-1",
      instanceCode: "D-ON-2",
      displayName: "Overnight Desk 2",
      operationalStatus: "ACTIVE",
    });

    // 2026-09-12 is Saturday (day 6). Open 00:00 to 24:00.
    repository.seedOperatingHours(6, [{ opensAt: "00:00:00", closesAt: "24:00:00" }]);
    // 2026-09-13 is Sunday (day 0). Closed (no intervals seeded).

    const service = createAvailabilityService(repository);

    const availability = await service.listTimeAvailability({
      workspaceInstanceId: "desk-overnight-2",
      date: "2026-09-12",
      durationMinutes: 240,
      nowIso: "2026-09-12T00:00:00.000Z",
    });

    // 20:00 slot ends at 24:00 (completely within Saturday) -> available
    const slot20 = availability.slots.find((s) => s.startTime === "20:00");
    assert.ok(slot20);
    assert.equal(slot20.isAvailable, true);

    // 23:00 slot ends at 03:00 Sunday -> business is closed on Sunday -> blocked
    const slot23 = availability.slots.find((s) => s.startTime === "23:00");
    assert.ok(slot23);
    assert.equal(slot23.isAvailable, false);
    assert.equal(slot23.blockingReason, "BUSINESS_CLOSED");
  });

  it("detects reservation conflict occurring on the next day during overnight hours", async () => {
    const repository = new InMemoryAvailabilityRepository();
    repository.setBusinessSettings({
      timezone: "Asia/Manila",
      bookingIntervalMinutes: 60,
    });
    repository.seedWorkspaceInstance({
      id: "desk-overnight-3",
      templateId: "template-standard",
      floorId: "floor-1",
      instanceCode: "D-ON-3",
      displayName: "Overnight Desk 3",
      operationalStatus: "ACTIVE",
    });

    // Seed 24/7 operating hours
    for (let day = 0; day <= 6; day++) {
      repository.seedOperatingHours(day, [{ opensAt: "00:00:00", closesAt: "24:00:00" }]);
    }

    // Seed a blocking reservation on Sunday 2026-09-13 from 01:00 to 04:00 (Asia/Manila: UTC+8 -> 17:00Z to 20:00Z on Sept 12)
    repository.seedBlockingReservation("desk-overnight-3", {
      reservationId: "existing-res-1",
      reservationStatus: "CONFIRMED",
      startAt: "2026-09-12T17:00:00.000Z", // 01:00 AM Manila on Sept 13
      endAt: "2026-09-12T20:00:00.000Z",   // 04:00 AM Manila on Sept 13
    });

    const service = createAvailabilityService(repository);

    const availability = await service.listTimeAvailability({
      workspaceInstanceId: "desk-overnight-3",
      date: "2026-09-12",
      durationMinutes: 240, // 11pm (Sept 12) to 3am (Sept 13)
      nowIso: "2026-09-12T00:00:00.000Z",
    });

    const slot23 = availability.slots.find((s) => s.startTime === "23:00");
    assert.ok(slot23);
    assert.equal(slot23.isAvailable, false);
    assert.equal(slot23.blockingReason, "RESERVATION_CONFLICT");

    // Earlier slot at 18:00 ends at 22:00 on Sept 12 -> unaffected by Sept 13 conflict
    const slot18 = availability.slots.find((s) => s.startTime === "18:00");
    assert.ok(slot18);
    assert.equal(slot18.isAvailable, true);
  });

  it("validates candidates and creates reservation crossing midnight without error", async () => {
    const template: WorkspaceTemplate = {
      id: "tpl-overnight",
      name: "Dedicated Pod",
      description: null,
      photoPath: null,
      capacity: 1,
      rateAmount: 150,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#000",
      defaultStyle: {},
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const instance: WorkspaceInstance = {
      id: "inst-overnight-1",
      templateId: "tpl-overnight",
      floorId: "floor-1",
      instanceCode: "POD-1",
      displayName: "Pod 1",
      operationalStatus: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const context: CandidateValidationContext = {
      instances: [instance],
      templates: [template],
    };

    // Candidate: 2026-09-12 23:00 Manila (15:00 UTC) to 2026-09-13 03:00 Manila (19:00 UTC) -> 4 hours
    const candidates: CandidateSubmissionDTO[] = [
      {
        rank: 0,
        workspaceInstanceId: instance.id,
        startAt: "2026-09-12T15:00:00.000Z",
        endAt: "2026-09-12T19:00:00.000Z",
      },
    ];

    // validateCandidates must succeed without throwing
    validateCandidates(candidates, context);

    // Repository must successfully create reservation
    const memoryRepo = new ReservationMemoryRepository();
    const reservation = await memoryRepo.createReservation(
      {
        source: "WEB",
        customerFirstName: "Reyna",
        customerLastName: "Test",
        customerEmail: "reyna@example.com",
        candidates,
      },
      150,
      600
    );

    assert.ok(reservation.id);
    assert.equal(reservation.status, "PENDING_PAYMENT");
    assert.equal(reservation.candidates.length, 1);
    assert.equal(reservation.candidates[0].startAt, "2026-09-12T15:00:00.000Z");
    assert.equal(reservation.candidates[0].endAt, "2026-09-12T19:00:00.000Z");
  });
});
