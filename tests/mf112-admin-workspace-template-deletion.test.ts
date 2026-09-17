import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  InMemoryWorkspaceRepository,
  WorkspaceConflictError,
  createWorkspaceService,
} from "@deskatlas/domain";

describe("MF-112: Admin Workspace Template Deletion & Referential Integrity", () => {
  it("hard deletes a workspace template when no physical instances exist", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const template = await service.createTemplate({
      name: "Temporary Booth",
      description: "Ephemeral workspace tier",
      capacity: 1,
      rateAmount: 100,
      pricingUnit: "HOURLY",
    });

    let catalog = await service.listCatalog();
    assert.equal(catalog.templates.length, 1);
    assert.equal(catalog.templates[0].id, template.id);

    const result = await service.deleteTemplate(template.id);
    assert.deepEqual(result, { deleted: true });

    catalog = await service.listCatalog();
    assert.equal(catalog.templates.length, 0);
  });

  it("rejects deletion with 409 Conflict when instances have active or upcoming confirmed reservations", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const template = await service.createTemplate({
      name: "Private Meeting Room",
      capacity: 4,
      rateAmount: 400,
      pricingUnit: "HOURLY",
    });

    const floor = await service.createFloor({ name: "Floor 2" });
    const instance = await service.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "PMR-01",
      displayName: "Boardroom A",
    });

    repository.seedFutureConfirmedReservation(instance.id, {
      reservationId: "res-future-booking",
      reservationReferenceCode: "RSV-PMR-001",
      startAt: "2099-12-01T10:00:00.000Z",
      endAt: "2099-12-01T12:00:00.000Z",
    });

    await assert.rejects(
      async () => {
        await service.deleteTemplate(template.id);
      },
      (err: any) => {
        assert.ok(err instanceof WorkspaceConflictError);
        assert.match(err.message, /Cannot delete template with active or upcoming reservations/i);
        return true;
      }
    );

    const catalog = await service.listCatalog();
    assert.equal(catalog.templates.length, 1);
    assert.equal(catalog.templates[0].isActive, true);
  });

  it("safely deactivates template and instances when instances exist with only past reservations or no reservations", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    const template = await service.createTemplate({
      name: "Legacy Hot Desk",
      capacity: 1,
      rateAmount: 150,
      pricingUnit: "HOURLY",
    });

    const floor = await service.createFloor({ name: "Ground Floor" });
    const instance1 = await service.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "LHD-01",
      displayName: "Legacy Desk 01",
    });
    const instance2 = await service.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "LHD-02",
      displayName: "Legacy Desk 02",
    });

    repository.seedFutureConfirmedReservation(instance1.id, {
      reservationId: "res-past-booking",
      reservationReferenceCode: "RSV-PAST-001",
      startAt: "2000-01-01T10:00:00.000Z",
      endAt: "2000-01-01T12:00:00.000Z",
    });

    const result = await service.deleteTemplate(template.id);
    assert.deepEqual(result, { deleted: false, deactivated: true });

    const catalog = await service.listCatalog();
    const deactivatedTemplate = catalog.templates.find((t) => t.id === template.id);
    assert.ok(deactivatedTemplate);
    assert.equal(deactivatedTemplate.isActive, false);

    const inst1 = catalog.instances.find((i) => i.id === instance1.id);
    const inst2 = catalog.instances.find((i) => i.id === instance2.id);
    assert.equal(inst1?.operationalStatus, "INACTIVE");
    assert.equal(inst2?.operationalStatus, "INACTIVE");
    assert.equal(inst1?.template.isActive, false);
    assert.equal(inst2?.template.isActive, false);
  });

  it("validates template id argument", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const service = createWorkspaceService(repository);

    await assert.rejects(async () => {
      await service.deleteTemplate("");
    }, /Template id is required/i);

    await assert.rejects(async () => {
      await service.deleteTemplate("non-existent-id");
    }, /Template not found/i);
  });

  it("removes inactive/archived template instances from published maps", async () => {
    const { InMemoryPublishedMapRepository } = await import("@deskatlas/domain");
    const mapRepo = new InMemoryPublishedMapRepository();

    const floor = {
      id: "floor-1",
      name: "Floor 1",
      floorNumber: 1,
      displayOrder: 1,
      isActive: true,
    };

    mapRepo.seedPublishedFloorMap({
      floor,
      version: {
        id: "ver-1",
        versionNumber: 1,
        canvasWidth: 1000,
        canvasHeight: 1000,
        gridSize: 20,
        publishedAt: "2026-01-01T00:00:00Z",
      },
      elements: [
        {
          id: "el-active",
          elementRole: "WORKSPACE",
          elementType: "desk",
          x: 10,
          y: 10,
          width: 80,
          height: 80,
          rotation: 0,
          zIndex: 1,
          label: "Desk 1",
          style: {},
          workspace: {
            workspaceInstanceId: "ins-active",
            templateId: "tpl-active",
            floorId: "floor-1",
            instanceCode: "D1",
            displayName: "Desk 1",
            templateName: "Active Template",
            description: null,
            photoPath: null,
            capacity: 1,
            rateAmount: 100,
            pricingUnit: "HOURLY",
            operationalStatus: "ACTIVE",
            isBookable: true,
            blockingReason: null,
          },
        },
        {
          id: "el-archived",
          elementRole: "WORKSPACE",
          elementType: "desk",
          x: 100,
          y: 10,
          width: 80,
          height: 80,
          rotation: 0,
          zIndex: 1,
          label: "Desk 2",
          style: {},
          workspace: {
            workspaceInstanceId: "ins-archived",
            templateId: "tpl-archived",
            floorId: "floor-1",
            instanceCode: "D2",
            displayName: "Desk 2",
            templateName: "Archived Template",
            description: null,
            photoPath: null,
            capacity: 1,
            rateAmount: 100,
            pricingUnit: "HOURLY",
            operationalStatus: "INACTIVE",
            isBookable: false,
            blockingReason: "OPERATIONAL_STATUS_BLOCKED",
          },
        },
      ],
    });

    const loaded = await mapRepo.loadPublishedFloorMap("floor-1");
    assert.ok(loaded);
    assert.equal(loaded.elements.length, 1);
    assert.equal(loaded.elements[0].id, "el-active");
  });
});
