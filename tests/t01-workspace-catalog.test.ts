import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  InMemoryWorkspaceRepository,
  InMemoryPublishedMapRepository,
  WorkspaceConflictError,
  WorkspaceValidationError,
  createWorkspaceService,
  createPublishedMapService,
  sortWorkspaceInstances,
} from "@deskatlas/domain";

describe("t01: Workspace Catalog & Operational Status", () => {
  it("manages workspace templates and instance CRUD (M01)", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const template = await service.createTemplate({
      name: "Skypod Table",
      description: "Shared skypod workspace tier",
      capacity: 1,
      rateAmount: 125,
      defaultColor: "#009689",
      defaultShape: "desk",
    });

    let catalog = await service.listCatalog();
    assert.equal(catalog.templates.length, 1);
    assert.equal(catalog.templates[0].id, template.id);
    assert.equal(catalog.templates[0].capacity, 1);

    const updatedTemplate = await service.updateTemplate(template.id, {
      name: "Skypod Table Updated",
      rateAmount: 150,
    });
    assert.equal(updatedTemplate.name, "Skypod Table Updated");
    assert.equal(updatedTemplate.rateAmount, 150);

    const floorId = "floor-default";
    const instances = await Promise.all([
      service.createInstance({
        templateId: template.id,
        floorId,
        instanceCode: "SP-01",
        displayName: "Skypod 01",
      }),
      service.createInstance({
        templateId: template.id,
        floorId,
        instanceCode: "SP-02",
        displayName: "Skypod 02",
      }),
      service.createInstance({
        templateId: template.id,
        floorId,
        instanceCode: "SP-03",
        displayName: "Skypod 03",
      }),
    ]);

    assert.deepEqual(
      instances.map((instance) => instance.templateId),
      [template.id, template.id, template.id]
    );

    const renamed = await service.updateInstance(instances[0].id, {
      displayName: "Skypod 01 Window",
    });
    assert.equal(renamed.displayName, "Skypod 01 Window");
    assert.equal(renamed.template.name, "Skypod Table Updated");

    const statusChanged = await service.updateInstance(instances[1].id, {
      operationalStatus: "MAINTENANCE",
    });
    assert.equal(statusChanged.operationalStatus, "MAINTENANCE");

    catalog = await service.listCatalog();
    assert.equal(
      catalog.instances.find((instance) => instance.id === instances[0].id)?.operationalStatus,
      "ACTIVE"
    );
    assert.equal(
      catalog.instances.find((instance) => instance.id === instances[2].id)?.operationalStatus,
      "ACTIVE"
    );

    await service.updateTemplate(template.id, { rateAmount: 175 });
    const adminSpacesAfterRateChange = await service.listAdminSpaces();
    assert.equal(adminSpacesAfterRateChange.length, 3);
    assert.ok(adminSpacesAfterRateChange.every((space) => space.hourlyRate === 175));

    await service.deactivateInstance(instances[2].id);
    catalog = await service.listCatalog();
    assert.equal(
      catalog.instances.find((instance) => instance.id === instances[2].id)?.operationalStatus,
      "INACTIVE"
    );
    assert.equal((await service.listAdminSpaces()).length, 2);

    await assert.rejects(
      () =>
        service.createInstance({
          templateId: template.id,
          floorId,
          instanceCode: "SP-01",
          displayName: "Duplicate Code",
        }),
      WorkspaceConflictError
    );

    await assert.rejects(
      () =>
        service.createTemplate({
          name: "Invalid Capacity",
          capacity: 0,
          rateAmount: 100,
        }),
      WorkspaceValidationError
    );

    await assert.rejects(
      () =>
        service.createTemplate({
          name: "Invalid Rate",
          capacity: 1,
          rateAmount: -1,
        }),
      WorkspaceValidationError
    );

    await assert.rejects(
      () =>
        service.updateInstance(instances[0].id, {
          operationalStatus: "RESERVED" as never,
        }),
      WorkspaceValidationError
    );
  });

  it("handles operational status transitions and blocking rules (M03)", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const template = await service.createTemplate({
      name: "Skypod Table",
      description: "Shared skypod workspace tier",
      capacity: 1,
      rateAmount: 125,
      defaultColor: "#009689",
      defaultShape: "desk",
    });

    const instance = await service.createInstance({
      templateId: template.id,
      floorId: "floor-default",
      instanceCode: "SP-10",
      displayName: "Skypod 10",
      operationalStatus: "ACTIVE",
    });

    repository.seedFutureConfirmedReservation(instance.id, {
      reservationId: "res-future",
      reservationReferenceCode: "RSV-FUTURE",
      startAt: "2099-08-26T09:00:00.000Z",
      endAt: "2099-08-26T12:00:00.000Z",
    });
    repository.seedFutureConfirmedReservation(instance.id, {
      reservationId: "res-history",
      reservationReferenceCode: "RSV-HISTORY",
      startAt: "2000-08-26T09:00:00.000Z",
      endAt: "2000-08-26T12:00:00.000Z",
    });

    for (const status of ["ACTIVE", "UNAVAILABLE", "MAINTENANCE", "BROKEN", "INACTIVE"] as const) {
      const result = await service.updateManagedInstance(instance.id, { operationalStatus: status });
      assert.equal(result.instance.operationalStatus, status);
      assert.equal(result.availability.isBookable, status === "ACTIVE");
    }

    const reactivated = await service.updateManagedInstance(instance.id, { operationalStatus: "ACTIVE" });
    assert.equal(reactivated.availability.isBookable, true);
    assert.equal(reactivated.availability.blockingReason, null);

    const blockedByMaintenance = await service.updateManagedInstance(instance.id, {
      operationalStatus: "MAINTENANCE",
    });
    assert.equal(blockedByMaintenance.availability.isBookable, false);
    assert.equal(blockedByMaintenance.availability.blockingReason, "OPERATIONAL_STATUS_BLOCKED");
    assert.equal(blockedByMaintenance.affectedFutureReservations.length, 1);
    assert.equal(blockedByMaintenance.affectedFutureReservations[0].reservationId, "res-future");
  });

  it("handles template photo upload, preview, and constraints (MF04)", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const workspaceService = createWorkspaceService(workspaceRepo);

    const created = await workspaceService.createTemplate({
      name: "Focus Pod",
      description: "Quiet individual workspace",
      capacity: 1,
      rateAmount: 120,
      pricingUnit: "HOURLY",
      defaultShape: "booth",
      defaultColor: "#009689",
      photoPath: "https://storage.deskatlas.test/workspace-images/templates/focus-pod.webp",
      isActive: true,
    });

    assert.equal(created.name, "Focus Pod");
    assert.equal(
      created.photoPath,
      "https://storage.deskatlas.test/workspace-images/templates/focus-pod.webp"
    );

    const updated = await workspaceService.updateTemplate(created.id, {
      photoPath: "https://storage.deskatlas.test/workspace-images/templates/focus-pod-v2.jpg",
    });
    assert.equal(
      updated.photoPath,
      "https://storage.deskatlas.test/workspace-images/templates/focus-pod-v2.jpg"
    );

    const cleared = await workspaceService.updateTemplate(created.id, {
      photoPath: null,
    });
    assert.equal(cleared.photoPath, null);
  });

  it("sorts workspace instances naturally by name (MF25)", async () => {
    const rawNames = [
      { displayName: "Skypod 10", instanceCode: "SP-10", id: "inst-10" },
      { displayName: "Skypod 2", instanceCode: "SP-02", id: "inst-2" },
      { displayName: "Skypod 1", instanceCode: "SP-01", id: "inst-1" },
      { displayName: "Skypod 20", instanceCode: "SP-20", id: "inst-20" },
      { displayName: "Desk A", instanceCode: "D-A", id: "inst-a" },
      { displayName: "Desk B", instanceCode: "D-B", id: "inst-b" },
    ];

    const sortedNames = sortWorkspaceInstances(rawNames);
    assert.deepEqual(
      sortedNames.map((x) => x.displayName),
      ["Desk A", "Desk B", "Skypod 1", "Skypod 2", "Skypod 10", "Skypod 20"]
    );

    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);
    const template = await service.createTemplate({
      name: "Skypod Tier",
      capacity: 1,
      rateAmount: 150,
    });

    const floorId = "floor-default";
    await service.createInstance({ templateId: template.id, floorId, instanceCode: "SP-10", displayName: "Skypod 10" });
    await service.createInstance({ templateId: template.id, floorId, instanceCode: "SP-01", displayName: "Skypod 1" });
    await service.createInstance({ templateId: template.id, floorId, instanceCode: "SP-20", displayName: "Skypod 20" });
    await service.createInstance({ templateId: template.id, floorId, instanceCode: "SP-02", displayName: "Skypod 2" });

    const adminSpaces = await service.listAdminSpaces();
    assert.deepEqual(
      adminSpaces.map((s) => s.name),
      ["Skypod 1", "Skypod 2", "Skypod 10", "Skypod 20"]
    );
  });
});
