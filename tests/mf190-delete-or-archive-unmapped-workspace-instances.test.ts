import { describe, it, expect, beforeEach } from 'vitest';
import {
  createWorkspaceService,
  InMemoryWorkspaceRepository,
  createMapService,
  InMemoryMapRepository,
} from '@deskatlas/domain';

describe('MF-190: Delete or Archive Physical Workspace Instances Removed from Floor Map', () => {
  let workspaceRepo: InMemoryWorkspaceRepository;
  let workspaceService: ReturnType<typeof createWorkspaceService>;
  let mapRepo: InMemoryMapRepository;
  let mapService: ReturnType<typeof createMapService>;

  beforeEach(async () => {
    workspaceRepo = new InMemoryWorkspaceRepository();
    workspaceService = createWorkspaceService(workspaceRepo);

    // Create a template
    await workspaceService.createTemplate({
      name: 'Design Desk',
      capacity: 1,
      rateAmount: 150,
      defaultShape: 'desk',
      defaultColor: '#009689',
    });

    const catalog = await workspaceService.listCatalog();
    const floor = catalog.floors[0];

    mapRepo = new InMemoryMapRepository({
      floors: catalog.floors,
    });
    mapService = createMapService(mapRepo);
  });

  it('1. Creates physical instances with smart sequential numbering', async () => {
    const catalog = await workspaceService.listCatalog();
    const template = catalog.templates[0];
    const floor = catalog.floors[0];

    // Create instances 1, 2, 3
    const inst1 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    const inst2 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    const inst3 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });

    expect(inst1.displayName).toBe('Design Desk 1');
    expect(inst2.displayName).toBe('Design Desk 2');
    expect(inst3.displayName).toBe('Design Desk 3');
  });

  it('2. Hard deletes instance when it has zero reservations and reclaims sequence number', async () => {
    const catalog = await workspaceService.listCatalog();
    const template = catalog.templates[0];
    const floor = catalog.floors[0];

    const inst1 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    const inst2 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });

    expect(inst1.displayName).toBe('Design Desk 1');
    expect(inst2.displayName).toBe('Design Desk 2');

    // Delete instance 2 (zero reservations)
    const deleteResult = await workspaceService.deleteInstance(inst2.id);
    expect(deleteResult.deleted).toBe(true);
    expect(deleteResult.archived).toBe(false);

    // Verify instance 2 is no longer in catalog
    const updatedCatalog = await workspaceService.listCatalog();
    expect(updatedCatalog.instances.find((i) => i.id === inst2.id)).toBeUndefined();

    // Adding next instance should reclaim "Design Desk 2" instead of skipping to 3
    const newInst = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    expect(newInst.displayName).toBe('Design Desk 2');
  });

  it('3. Soft-archives instance if historical reservations exist', async () => {
    const catalog = await workspaceService.listCatalog();
    const template = catalog.templates[0];
    const floor = catalog.floors[0];

    const inst1 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });

    // Seed reservation impact for inst1
    workspaceRepo.seedFutureConfirmedReservation(inst1.id, {
      reservationId: 'res-hist-1',
      reservationReferenceCode: 'REF-HIST-1',
      startAt: '2026-09-24T10:00:00.000Z',
      endAt: '2026-09-24T12:00:00.000Z',
    });

    // Delete instance 1
    const deleteResult = await workspaceService.deleteInstance(inst1.id);
    expect(deleteResult.deleted).toBe(false);
    expect(deleteResult.archived).toBe(true);
    expect(deleteResult.instance?.operationalStatus).toBe('INACTIVE');

    // Verify it is marked INACTIVE in catalog
    const updatedCatalog = await workspaceService.listCatalog();
    const found = updatedCatalog.instances.find((i) => i.id === inst1.id);
    expect(found?.operationalStatus).toBe('INACTIVE');

    // Admin active spaces list excludes inactive instances
    const activeSpaces = await workspaceService.listAdminSpaces();
    expect(activeSpaces.find((s) => s.id === inst1.id)).toBeUndefined();
  });

  it('4. Reclaims sequence number when highest placed instance is removed', async () => {
    const catalog = await workspaceService.listCatalog();
    const template = catalog.templates[0];
    const floor = catalog.floors[0];

    const inst1 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    const inst2 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    const inst3 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });

    expect(inst1.displayName).toBe('Design Desk 1');
    expect(inst2.displayName).toBe('Design Desk 2');
    expect(inst3.displayName).toBe('Design Desk 3');

    // Remove / delete instance 3 (leaving 1 and 2)
    await workspaceService.deleteInstance(inst3.id);

    // Next created instance reuses sequence 3 rather than skipping to 4
    const nextInst = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    expect(nextInst.displayName).toBe('Design Desk 3');

    // Subsequent created instance picks 4
    const nextInst4 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });
    expect(nextInst4.displayName).toBe('Design Desk 4');
  });

  it('5. Map publish reconciles unmapped workspace instances on the floor', async () => {
    const catalog = await workspaceService.listCatalog();
    const template = catalog.templates[0];
    const floor = catalog.floors[0];

    const inst1 = await workspaceService.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'DD-001',
      displayName: 'Design Desk 1',
      operationalStatus: 'ACTIVE',
    });
    const inst2 = await workspaceService.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'DD-002',
      displayName: 'Design Desk 2',
      operationalStatus: 'ACTIVE',
    });

    // Seed instances into memory map repository
    const mapRepoWithInstances = new InMemoryMapRepository({
      floors: catalog.floors,
      workspaceInstances: [
        { id: inst1.id, floorId: floor.id, operationalStatus: 'ACTIVE' },
        { id: inst2.id, floorId: floor.id, operationalStatus: 'ACTIVE' },
      ],
    });
    const customMapService = createMapService(mapRepoWithInstances);

    // Save draft containing only inst1 (inst2 is omitted / removed)
    await customMapService.saveDraft({
      floorId: floor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: [
        {
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: inst1.id,
          x: 100,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
        },
      ],
    });

    // Publish the draft
    const publishResult = await customMapService.publishDraft({
      floorId: floor.id,
    });

    expect(publishResult.published.elements).toHaveLength(1);
    expect(publishResult.published.elements[0].workspaceInstanceId).toBe(inst1.id);

    // Unmapped inst2 was reconciled and removed from map repository instances
    const checkInst2 = await mapRepoWithInstances.getWorkspaceInstance(inst2.id);
    expect(checkInst2).toBeNull();
  });
});
