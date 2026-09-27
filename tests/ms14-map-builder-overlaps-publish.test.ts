import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMapService,
  InMemoryMapRepository,
  createWorkspaceService,
  InMemoryWorkspaceRepository,
  MapValidationError,
  findCollidingElements,
  type Floor,
  type MapElementInput,
} from '@deskatlas/domain';

describe('MS-14 / QAD-TC14: Interactive Map Builder Layout Flexibility, Overlaps, and FK Integrity', () => {
  let createdFloor: Floor;
  let mapRepo: InMemoryMapRepository;
  let mapService: ReturnType<typeof createMapService>;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let workspaceService: ReturnType<typeof createWorkspaceService>;

  beforeEach(async () => {
    workspaceRepo = new InMemoryWorkspaceRepository();
    workspaceService = createWorkspaceService(workspaceRepo);

    createdFloor = await workspaceService.createFloor({ name: 'Floor MS14' });
    const tpl = await workspaceService.createTemplate({
      name: 'FlowRow Desk',
      capacity: 1,
      rateAmount: 100,
      defaultShape: 'desk',
      defaultColor: '#009689',
    });

    const inst1 = await workspaceService.createInstanceFromTemplate({
      templateId: tpl.id,
      floorId: createdFloor.id,
    });
    const inst2 = await workspaceService.createInstanceFromTemplate({
      templateId: tpl.id,
      floorId: createdFloor.id,
    });

    mapRepo = new InMemoryMapRepository({
      floors: [createdFloor],
      workspaceInstances: [
        { id: inst1.id, floorId: createdFloor.id, operationalStatus: 'ACTIVE' },
        { id: inst2.id, floorId: createdFloor.id, operationalStatus: 'ACTIVE' },
      ],
    });
    mapService = createMapService(mapRepo);
  });

  it('QAD-TC14.1: Accurately identifies overlapping workspace and wall elements', () => {
    const elements = [
      {
        id: 'ws-1',
        x: 100,
        y: 100,
        w: 80,
        h: 80,
        bookable: true,
        elementRole: 'WORKSPACE',
        elementType: 'desk',
      },
      {
        id: 'ws-2',
        x: 150, // overlaps ws-1 (100 to 180)
        y: 120, // overlaps ws-1 (100 to 180)
        w: 80,
        h: 80,
        bookable: true,
        elementRole: 'WORKSPACE',
        elementType: 'desk',
      },
      {
        id: 'ws-3',
        x: 300, // separate, no overlap
        y: 300,
        w: 80,
        h: 80,
        bookable: true,
        elementRole: 'WORKSPACE',
        elementType: 'desk',
      },
      {
        id: 'wall-1',
        x: 290, // overlaps ws-3 (300 to 380)
        y: 320,
        w: 100,
        h: 20,
        bookable: false,
        elementRole: 'STRUCTURE',
        elementType: 'wall',
      },
    ];

    const colliding = findCollidingElements(elements);
    expect(colliding.has('ws-1')).toBe(true);
    expect(colliding.has('ws-2')).toBe(true);
    expect(colliding.has('ws-3')).toBe(true);
    expect(colliding.has('wall-1')).toBe(true);

    // Non-overlapping element
    const standalone = [
      {
        id: 'ws-solo',
        x: 500,
        y: 500,
        w: 80,
        h: 80,
        bookable: true,
        elementRole: 'WORKSPACE',
      },
      {
        id: 'wall-far',
        x: 700,
        y: 700,
        w: 120,
        h: 20,
        bookable: false,
        elementRole: 'STRUCTURE',
        elementType: 'wall',
      },
    ];
    const noCollisions = findCollidingElements(standalone);
    expect(noCollisions.size).toBe(0);
  });

  it('QAD-TC14.2: Domain service returns collision identifiers in exception string on publish', async () => {
    const catalog = await workspaceService.listCatalog();
    const inst1 = catalog.instances[0];
    const inst2 = catalog.instances[1];

    const overlappingElements: MapElementInput[] = [
      {
        id: 'elem-ws-1',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: inst1.id,
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
      },
      {
        id: 'elem-ws-2',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: inst2.id,
        x: 140,
        y: 120,
        width: 80,
        height: 80,
        rotation: 0,
      },
    ];

    await mapService.saveDraft({
      floorId: createdFloor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: overlappingElements,
    });

    let errorThrown: Error | null = null;
    try {
      await mapService.publishDraft({ floorId: createdFloor.id });
    } catch (err: unknown) {
      errorThrown = err as Error;
    }

    expect(errorThrown).toBeInstanceOf(MapValidationError);
    expect(errorThrown?.message).toMatch(/COLLISION_OVERLAP/);
    expect(errorThrown?.message).toMatch(/elem-ws-1/);
    expect(errorThrown?.message).toMatch(/elem-ws-2/);
  });

  it('QAD-TC14.3: Free placement preserves non-grid-quantized pixel coordinates', async () => {
    const catalog = await workspaceService.listCatalog();
    const inst1 = catalog.instances[0];

    // Arbitrary pixel coordinates (e.g. wall at x=12, y=15; desk at x=85, y=95)
    const freeElements: MapElementInput[] = [
      {
        id: 'wall-free',
        elementRole: 'STRUCTURE',
        elementType: 'wall',
        x: 12,
        y: 15,
        width: 150,
        height: 20,
        rotation: 0,
      },
      {
        id: 'desk-free',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: inst1.id,
        x: 85,
        y: 95,
        width: 80,
        height: 80,
        rotation: 0,
      },
    ];

    const draft = await mapService.saveDraft({
      floorId: createdFloor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: freeElements,
    });

    expect(draft.elements[0].x).toBe(12);
    expect(draft.elements[0].y).toBe(15);
    expect(draft.elements[1].x).toBe(85);
    expect(draft.elements[1].y).toBe(95);
  });

  it('QAD-TC14.4: Removed canvas elements immediately update placed state', async () => {
    const catalog = await workspaceService.listCatalog();
    const inst1 = catalog.instances[0];
    const inst2 = catalog.instances[1];

    // Seed placed instances in repository
    workspaceRepo.addMapPlacedInstanceId(inst1.id);
    workspaceRepo.addMapPlacedInstanceId(inst2.id);

    let placed = await workspaceRepo.getMapPlacedInstanceIds();
    expect(placed.has(inst1.id)).toBe(true);
    expect(placed.has(inst2.id)).toBe(true);

    // Remove inst2 from map
    workspaceRepo.removeMapPlacedInstanceId(inst2.id);

    placed = await workspaceRepo.getMapPlacedInstanceIds();
    expect(placed.has(inst1.id)).toBe(true);
    expect(placed.has(inst2.id)).toBe(false);

    // Can now safely delete unmapped inst2
    const deleteResult = await workspaceService.deleteInstance(inst2.id);
    expect(deleteResult.deleted).toBe(true);
  });

  it('QAD-TC14.5: Publishing floor draft with removed instances cleans up unmapped records', async () => {
    const catalog = await workspaceService.listCatalog();
    const inst1 = catalog.instances[0];
    const inst2 = catalog.instances[1];

    // Map draft only includes inst1 (inst2 was removed from layout)
    await mapService.saveDraft({
      floorId: createdFloor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: [
        {
          id: 'elem-1',
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

    const publishResult = await mapService.publishDraft({ floorId: createdFloor.id });
    expect(publishResult.published.elements).toHaveLength(1);
    expect(publishResult.published.elements[0].workspaceInstanceId).toBe(inst1.id);

    // Unmapped instance 2 has been cleaned up from active map instances
    const remainingInst2 = await mapRepo.getWorkspaceInstance(inst2.id);
    expect(remainingInst2).toBeNull();
  });
});
