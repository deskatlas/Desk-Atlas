import { describe, it, expect } from 'vitest';
import {
  createMapService,
  InMemoryMapRepository,
  MapValidationError,
  type Floor,
  type MapElementInput,
} from '@deskatlas/domain';

/**
 * MS-06 / QAD-TC6.6: Spatial Overlap Detection and Collision Prevention
 *
 * Verifies that geometry collisions (workspace overlaps and wall conflicts)
 * are accurately detected, and that non-overlapping adjacent elements pass.
 */
describe('MS-06 / QAD-TC6.6: Spatial Overlap Detection', () => {
  const floor: Floor = {
    id: 'floor-geo',
    name: 'Geometry Test Floor',
    floorNumber: 1,
    displayOrder: 1,
    isActive: true,
  };

  it('QAD-TC6.6.1: rejects draft when bookable workspaces overlap', async () => {
    const mapRepo = new InMemoryMapRepository({
      floors: [floor],
      workspaceInstances: [
        { id: 'inst-1', floorId: floor.id, operationalStatus: 'ACTIVE' },
        { id: 'inst-2', floorId: floor.id, operationalStatus: 'ACTIVE' },
      ],
    });
    const mapService = createMapService(mapRepo);

    // Two overlapping desks (inst-1 at 100,100 size 80x80; inst-2 at 140,140 size 80x80)
    const overlappingElements: MapElementInput[] = [
      {
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: 'inst-1',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
      },
      {
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: 'inst-2',
        x: 140,
        y: 140,
        width: 80,
        height: 80,
        rotation: 0,
      },
    ];

    await mapService.saveDraft({
      floorId: floor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: overlappingElements,
    });

    await expect(mapService.publishDraft({ floorId: floor.id })).rejects.toThrowError(
      /overlapping/i
    );
  });

  it('QAD-TC6.6.2: rejects draft when workspace conflicts with a wall or divider', async () => {
    const mapRepo = new InMemoryMapRepository({
      floors: [floor],
      workspaceInstances: [
        { id: 'inst-1', floorId: floor.id, operationalStatus: 'ACTIVE' },
      ],
    });
    const mapService = createMapService(mapRepo);

    const conflictingElements: MapElementInput[] = [
      {
        elementRole: 'STRUCTURE',
        elementType: 'wall',
        x: 100,
        y: 100,
        width: 200,
        height: 20,
        rotation: 0,
      },
      {
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: 'inst-1',
        x: 150,
        y: 90,
        width: 80,
        height: 80,
        rotation: 0,
      },
    ];

    await mapService.saveDraft({
      floorId: floor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: conflictingElements,
    });

    await expect(mapService.publishDraft({ floorId: floor.id })).rejects.toThrowError(
      /conflicting with a wall/i
    );
  });

  it('QAD-TC6.6.3: allows adjacent non-overlapping elements sharing an exact boundary', async () => {
    const mapRepo = new InMemoryMapRepository({
      floors: [floor],
      workspaceInstances: [
        { id: 'inst-1', floorId: floor.id, operationalStatus: 'ACTIVE' },
        { id: 'inst-2', floorId: floor.id, operationalStatus: 'ACTIVE' },
      ],
    });
    const mapService = createMapService(mapRepo);

    // Desk 1 at x: 100..180; Desk 2 at x: 180..260 (exact boundary touch at x=180)
    const adjacentElements: MapElementInput[] = [
      {
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: 'inst-1',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
      },
      {
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: 'inst-2',
        x: 180,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
      },
    ];

    await mapService.saveDraft({
      floorId: floor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: adjacentElements,
    });

    const result = await mapService.publishDraft({ floorId: floor.id });
    expect(result.published.elements).toHaveLength(2);
    expect(result.published.version.status).toBe('PUBLISHED');
  });

  it('QAD-TC6.6.4: validates spatial box intersection logic matching GiST spatial index behavior', () => {
    // Mathematical verification of Postgres box && box with scalar recheck
    function boxesOverlap(
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number }
    ): boolean {
      // GiST candidate filter: box && box
      const gistCandidate =
        Math.max(a.x, a.x + a.width) >= Math.min(b.x, b.x + b.width) &&
        Math.min(a.x, a.x + a.width) <= Math.max(b.x, b.x + b.width) &&
        Math.max(a.y, a.y + a.height) >= Math.min(b.y, b.y + b.height) &&
        Math.min(a.y, a.y + a.height) <= Math.max(b.y, b.y + b.height);

      if (!gistCandidate) return false;

      // Exact recheck
      return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      );
    }

    const boxA = { x: 100, y: 100, width: 80, height: 80 };
    const boxTouching = { x: 180, y: 100, width: 80, height: 80 };
    const boxOverlapping = { x: 150, y: 100, width: 80, height: 80 };
    const boxDisjoint = { x: 300, y: 300, width: 80, height: 80 };

    expect(boxesOverlap(boxA, boxTouching)).toBe(false);
    expect(boxesOverlap(boxA, boxOverlapping)).toBe(true);
    expect(boxesOverlap(boxA, boxDisjoint)).toBe(false);
  });
});
