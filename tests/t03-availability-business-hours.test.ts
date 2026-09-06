import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  AvailabilityValidationError,
  InMemoryAvailabilityRepository,
  createAvailabilityService,
  InMemorySettingsRepository,
  createAdminSettingsService,
  SettingsValidationError,
} from "@deskatlas/domain";

describe("t03: Availability, Business Hours & Closures", () => {
  it("calculates time availability and date ranges (M05)", async () => {
    const repository = new InMemoryAvailabilityRepository();
    repository.setBusinessSettings({
      timezone: "Asia/Manila",
      bookingIntervalMinutes: 60,
    });
    repository.seedWorkspaceInstance({
      id: "workspace-a1",
      templateId: "template-desk",
      floorId: "floor-a",
      instanceCode: "A1",
      displayName: "Desk A1",
      operationalStatus: "ACTIVE",
    });
    for (let day = 1; day <= 5; day++) {
      repository.seedOperatingHours(day, [{ opensAt: "09:00:00", closesAt: "17:00:00" }]);
    }

    const service = createAvailabilityService(repository);

    const normalDay = await service.listTimeAvailability({
      workspaceInstanceId: "workspace-a1",
      date: "2099-08-27",
      durationMinutes: 120,
      nowIso: "2099-08-26T00:00:00.000Z",
    });
    assert.equal(normalDay.workspaceIsBookable, true);
    assert.equal(normalDay.slots[0]?.startTime, "09:00");
    assert.equal(normalDay.slots[0]?.isAvailable, true);

    const closedDay = await service.listDateAvailability({
      workspaceInstanceId: "workspace-a1",
      startDate: "2099-08-29",
      endDate: "2099-08-29",
      durationMinutes: 60,
      nowIso: "2099-08-26T00:00:00.000Z",
    });
    assert.equal(closedDay.dates[0]?.isAvailable, false);
    assert.equal(closedDay.dates[0]?.reason, "BUSINESS_CLOSED");
  });

  it("manages business hours and business profile settings (MF10)", async () => {
    const repository = new InMemorySettingsRepository();
    const service = createAdminSettingsService(repository);

    const overview = await service.getSettingsOverview();
    assert.ok(overview.businessSettings);
    assert.ok(overview.operatingHoursConfig);
    assert.ok(Array.isArray(overview.paymentMethods));

    const updatedProfile = await service.updateBusinessSettings({
      businessName: "DeskAtlas Global HQ",
      timezone: "Asia/Manila",
      contactEmail: "admin@deskatlas.ph",
      contactPhone: "+63 2 8123 4567",
      bookingIntervalMinutes: 60,
      paymentExpiryMinutes: 45,
      kioskTimeoutMinutes: 3,
    });
    assert.equal(updatedProfile.businessName, "DeskAtlas Global HQ");
    assert.equal(updatedProfile.bookingIntervalMinutes, 60);

    await assert.rejects(
      () =>
        service.updateBusinessSettings({
          businessName: "",
          timezone: "Asia/Manila",
          bookingIntervalMinutes: 60,
          paymentExpiryMinutes: 60,
        }),
      (err) => err instanceof SettingsValidationError
    );
  });

  it("manages closures and holidays calendar (MF11)", async () => {
    const settingsRepo = new InMemorySettingsRepository();
    const settingsService = createAdminSettingsService(settingsRepo);

    const initialClosures = await settingsService.listClosures();
    assert.equal(initialClosures.length, 0);

    const christmasClosure = await settingsService.createClosure({
      date: "2099-12-25",
      closureType: "FULL_DAY",
      reason: "Christmas Day",
    });
    assert.equal(christmasClosure.date, "2099-12-25");

    const closures = await settingsService.listClosures();
    assert.equal(closures.length, 1);
    assert.equal(closures[0].reason, "Christmas Day");

    await settingsService.deleteClosure([christmasClosure.id]);
    assert.equal((await settingsService.listClosures()).length, 0);
  });

  it("handles calendar duration and start-time calculations with blocking reservations (MF20)", async () => {
    const repository = new InMemoryAvailabilityRepository();
    repository.setBusinessSettings({
      timezone: "Asia/Manila",
      bookingIntervalMinutes: 60,
    });

    repository.seedWorkspaceInstance({
      id: "workspace-main-1",
      templateId: "template-dedicated-desk",
      floorId: "floor-1",
      instanceCode: "D101",
      displayName: "Dedicated Desk 101",
      operationalStatus: "ACTIVE",
    });

    for (let day = 1; day <= 5; day++) {
      repository.seedOperatingHours(day, [{ opensAt: "08:00:00", closesAt: "18:00:00" }]);
    }

    repository.seedBlockingReservation("workspace-main-1", {
      reservationId: "res-confirmed-11am",
      reservationStatus: "CONFIRMED",
      startAt: "2099-09-01T03:00:00.000Z", // 11:00 AM Manila
      endAt: "2099-09-01T04:00:00.000Z",   // 12:00 PM Manila
    });

    const service = createAvailabilityService(repository);

    const fourHourSlots = await service.listTimeAvailability({
      workspaceInstanceId: "workspace-main-1",
      date: "2099-09-01",
      durationMinutes: 240, // 4 hours
      nowIso: "2099-08-31T00:00:00.000Z",
    });

    // 08:00-12:00 overlaps 11:00-12:00 -> false
    const slot8 = fourHourSlots.slots.find((s) => s.startTime === "08:00");
    assert.equal(slot8?.isAvailable, false);

    // 12:00-16:00 starts after 12:00 PM -> true
    const slot12 = fourHourSlots.slots.find((s) => s.startTime === "12:00");
    assert.equal(slot12?.isAvailable, true);
  });

  it("enforces minute precision and booking interval alignment (MF21)", async () => {
    const repository = new InMemoryAvailabilityRepository();
    repository.setBusinessSettings({
      timezone: "Asia/Manila",
      bookingIntervalMinutes: 60,
    });

    repository.seedWorkspaceInstance({
      id: "workspace-mf21-1",
      templateId: "template-desk-std",
      floorId: "floor-1",
      instanceCode: "D201",
      displayName: "Dedicated Desk 201",
      operationalStatus: "ACTIVE",
    });

    for (let day = 1; day <= 5; day++) {
      repository.seedOperatingHours(day, [{ opensAt: "08:00:00", closesAt: "18:00:00" }]);
    }

    const service = createAvailabilityService(repository);

    const slot910 = await service.listTimeAvailability({
      workspaceInstanceId: "workspace-mf21-1",
      date: "2099-09-01",
      durationMinutes: 60,
      customStartTime: "09:10",
      nowIso: "2099-08-31T00:00:00.000Z",
    });

    const found910 = slot910.slots.find((s) => s.startTime === "09:10");
    assert.ok(found910);
    assert.equal(found910.endTime, "10:10");
    assert.equal(found910.isAvailable, true);
  });
});
