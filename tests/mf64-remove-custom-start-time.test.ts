import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import {
  InMemoryAvailabilityRepository,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  createAvailabilityService,
  createPaymentSessionService,
  createReservationService,
  validateCandidates,
  type CandidateSubmissionDTO,
  type CandidateValidationContext,
  type WorkspaceInstance,
  type WorkspaceTemplate,
} from "@deskatlas/domain";

describe("MF-64: Remove Custom Start Time (Minute Precision) Feature", () => {
  const templateHotDesk: WorkspaceTemplate = {
    id: "tpl-desk-mf64",
    name: "Hot Desk Regular",
    description: "Standard coworking desk",
    photoPath: "/photos/hot-desk.jpg",
    capacity: 1,
    rateAmount: 50,
    pricingUnit: "HOURLY",
    defaultShape: "rectangle",
    defaultColor: "#E0EFE4",
    defaultStyle: {},
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const instance1: WorkspaceInstance = {
    id: "inst-desk-mf64-1",
    templateId: "tpl-desk-mf64",
    floorId: "floor-1",
    instanceCode: "HD01",
    displayName: "Desk 01",
    operationalStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const context: CandidateValidationContext = {
    instances: [instance1],
    templates: [templateHotDesk],
  };

  it("offers only fixed time slots from availability service based on booking interval", async () => {
    const repository = new InMemoryAvailabilityRepository();
    repository.setBusinessSettings({
      timezone: "Asia/Manila",
      bookingIntervalMinutes: 60,
    });

    repository.seedWorkspaceInstance({
      id: instance1.id,
      templateId: templateHotDesk.id,
      floorId: "floor-1",
      instanceCode: instance1.instanceCode,
      displayName: instance1.displayName,
      operationalStatus: "ACTIVE",
    });

    // 09:00 to 18:00
    for (let day = 1; day <= 5; day++) {
      repository.seedOperatingHours(day, [{ opensAt: "09:00:00", closesAt: "18:00:00" }]);
    }

    const service = createAvailabilityService(repository);

    const result = await service.listTimeAvailability({
      workspaceInstanceId: instance1.id,
      date: "2026-09-15",
      durationMinutes: 60,
      nowIso: "2026-09-01T00:00:00.000Z",
    });

    // Expect standard 60m fixed slots: 09:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00
    const startTimes = result.slots.map((s) => s.startTime);
    assert.deepEqual(startTimes, [
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
    ]);

    // All slots must end at exact 60m intervals
    for (const slot of result.slots) {
      assert.match(slot.startTime, /^\d{2}:00$/);
      assert.match(slot.endTime, /^\d{2}:00$/);
    }
  });

  it("creates customer reservation with fixed slots successfully", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const paymentSessionService = createPaymentSessionService(reservationRepo);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );

    const floor = await workspaceRepo.createFloor({ name: "Main Floor" });
    const tpl = await workspaceRepo.createTemplate({
      name: "Desk",
      capacity: 1,
      rateAmount: 50,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#E0EFE4",
      isActive: true,
    });
    const ws = await workspaceRepo.createInstance({
      templateId: tpl.id,
      floorId: floor.id,
      instanceCode: "HD01",
      displayName: "Desk 01",
    });

    const reservation = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "Smith",
        customerEmail: "alice@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ws.id,
            startAt: "2026-09-15T09:00:00.000Z",
            endAt: "2026-09-15T11:00:00.000Z",
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    assert.ok(reservation.id);
    assert.equal(reservation.status, "PENDING_PAYMENT");
    assert.equal(reservation.amountDue, 100);
  });

  it("preserves validity of existing legacy minute-precision reservations", () => {
    // Existing reservations in DB with minute-precision start/end times remain valid for validation and audit
    const legacyCandidates: CandidateSubmissionDTO[] = [
      {
        rank: 0,
        workspaceInstanceId: instance1.id,
        startAt: "2026-09-15T09:15:00.000Z",
        endAt: "2026-09-15T10:15:00.000Z",
      },
    ];

    // Candidate validation accepts non-hour aligned timestamps for legacy or manual records
    validateCandidates(legacyCandidates, context);
  });

  it("verifies customer website components contain no custom start time / apply time code", () => {
    const rootDir = process.cwd();
    const customerSchedulePath = path.join(
      rootDir,
      "apps/customer-website/src/features/reservation/components/ScheduleCalendarStep.tsx"
    );
    const customerReservationPagePath = path.join(
      rootDir,
      "apps/customer-website/src/features/reservation/components/ReservationPage.tsx"
    );
    const customerAvailabilityApiPath = path.join(
      rootDir,
      "apps/customer-website/src/app/lib/availabilityApi.ts"
    );
    const customerAvailabilityRoutePath = path.join(
      rootDir,
      "apps/customer-website/src/app/api/availability/route.ts"
    );

    const filesToCheck = [
      customerSchedulePath,
      customerReservationPagePath,
      customerAvailabilityApiPath,
      customerAvailabilityRoutePath,
    ];

    const forbiddenTerms = [
      "Apply Time",
      "Apply time",
      "applyTime",
      "customStartTime",
      "customTimeInput",
      "customTimeStatus",
      "handleApplyCustomTime",
      "handleApplyCustomCatTime",
      "Minute Precision",
    ];

    for (const filePath of filesToCheck) {
      assert.ok(fs.existsSync(filePath), `File exists: ${filePath}`);
      const content = fs.readFileSync(filePath, "utf-8");
      for (const term of forbiddenTerms) {
        assert.equal(
          content.includes(term),
          false,
          `Forbidden term "${term}" found in ${filePath}`
        );
      }
    }
  });

  it("verifies kiosk flow remains functional and clean", () => {
    const rootDir = process.cwd();
    const kioskSchedulePath = path.join(
      rootDir,
      "apps/kiosk/src/app/features/reservation/ScheduleCalendarStep.tsx"
    );
    const kioskAvailabilityApiPath = path.join(
      rootDir,
      "apps/kiosk/src/app/lib/availabilityApi.ts"
    );

    const forbiddenTerms = [
      "customStartTime",
      "customTimeInput",
      "handleApplyCustomTime",
    ];

    for (const filePath of [kioskSchedulePath, kioskAvailabilityApiPath]) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        for (const term of forbiddenTerms) {
          assert.equal(
            content.includes(term),
            false,
            `Forbidden term "${term}" found in kiosk file ${filePath}`
          );
        }
      }
    }
  });
});
