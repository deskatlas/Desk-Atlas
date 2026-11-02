import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMapService,
  InMemoryMapRepository,
  createWorkspaceService,
  InMemoryWorkspaceRepository,
  MapValidationError,
  findCollidingElements,
  checkElementsOverlap,
  computeRotatedAABB,
  clampRotatedElementToBounds,
  isRotatedElementWithinBounds,
  type Floor,
  type MapElementInput,
} from '@deskatlas/domain';
import { findCollidingElements as mapEditorFindCollidingElements } from '../apps/admin-portal/src/features/map-builder/components/MapEditor';

describe('MS-101 / QAD-TC31: Interactive Map Builder Rotated Element Collision Detection', () => {
  let createdFloor: Floor;
  let mapRepo: InMemoryMapRepository;
  let mapService: ReturnType<typeof createMapService>;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let workspaceService: ReturnType<typeof createWorkspaceService>;

  beforeEach(async () => {
    workspaceRepo = new InMemoryWorkspaceRepository();
    workspaceService = createWorkspaceService(workspaceRepo);

    createdFloor = await workspaceService.createFloor({ name: 'Floor MS101' });
    const tpl = await workspaceService.createTemplate({
      name: 'Standard Pod',
      capacity: 1,
      rateAmount: 120,
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

  it('MS101-TC01: 90-degree rotated wall clears horizontal desks without phantom overlap conflict', () => {
    // Horizontal wall: width 200, height 16 at x=100, y=20.
    // When rotated 90 degrees around center (200, 28):
    // Visual AABB: minX=192, maxX=208, minY=-72, maxY=128 (width 16, height 200).
    // Desk at (100, 100, 80, 80) occupies X: [100, 180], Y: [100, 180].
    // Since desk maxX (180) <= wall minX (192), they do NOT intersect in rotated canvas space.
    const elements = [
      {
        id: 'desk-power-bar-4',
        x: 100,
        y: 100,
        w: 80,
        h: 80,
        rotation: 0,
        bookable: true,
        elementRole: 'WORKSPACE',
        elementType: 'desk',
      },
      {
        id: 'vertical-wall-1',
        x: 100,
        y: 20,
        w: 200,
        h: 16,
        rotation: 90,
        bookable: false,
        elementRole: 'STRUCTURE',
        elementType: 'wall',
      },
    ];

    const colliding = findCollidingElements(elements);
    expect(colliding.size).toBe(0);
    expect(colliding.has('desk-power-bar-4')).toBe(false);
    expect(colliding.has('vertical-wall-1')).toBe(false);

    // Also test with a desk positioned directly under the unrotated footprint of the wall
    // Unrotated footprint of wall is X: [100, 300], Y: [20, 36].
    // Desk at x=120, y=25, w=50, h=50 would falsely collide if unrotated AABB was used.
    const unrotatedSpanDesk = {
      id: 'desk-under-unrotated-span',
      x: 120,
      y: 25,
      w: 50,
      h: 50,
      rotation: 0,
      bookable: true,
      elementRole: 'WORKSPACE',
      elementType: 'desk',
    };
    const collidingWithUnrotatedSpan = findCollidingElements([unrotatedSpanDesk, elements[1]]);
    expect(collidingWithUnrotatedSpan.size).toBe(0);
  });

  it('MS101-TC02: 90-degree rotated wall detects true physical intersection with desk', () => {
    // Rotated wall visual AABB: X in [192, 208], Y in [-72, 128].
    // Desk at x=180, y=100, w=80, h=80 occupies X: [180, 260], Y: [100, 180].
    // X overlap: [192, 208] inside [180, 260].
    // Y overlap: [100, 128] is common to both.
    // True physical collision must be detected.
    const elements = [
      {
        id: 'desk-colliding',
        x: 180,
        y: 100,
        w: 80,
        h: 80,
        rotation: 0,
        bookable: true,
        elementRole: 'WORKSPACE',
        elementType: 'desk',
      },
      {
        id: 'wall-rotated',
        x: 100,
        y: 20,
        w: 200,
        h: 16,
        rotation: 90,
        bookable: false,
        elementRole: 'STRUCTURE',
        elementType: 'wall',
      },
    ];

    const colliding = findCollidingElements(elements);
    expect(colliding.size).toBe(2);
    expect(colliding.has('desk-colliding')).toBe(true);
    expect(colliding.has('wall-rotated')).toBe(true);
  });

  it('MS101-TC03: 270-degree rotated desk vs desk overlap detection', () => {
    // Desk A: x=100, y=100, w=100, h=40. Center is (150, 120).
    // Rotated 270 degrees: visual AABB is X in [130, 170], Y in [70, 170].
    // Desk B: x=110, y=105, w=15, h=20, rotation=0. Occupies X: [110, 125], Y: [105, 125].
    // Unrotated Desk A [100, 200] overlaps Desk B [110, 125].
    // But 270-degree rotated Desk A [130, 170] does NOT overlap Desk B [110, 125]!
    const deskA = {
      id: 'desk-a',
      x: 100,
      y: 100,
      w: 100,
      h: 40,
      rotation: 270,
      bookable: true,
      elementRole: 'WORKSPACE',
    };
    const deskBCleared = {
      id: 'desk-b-cleared',
      x: 110,
      y: 105,
      w: 15,
      h: 20,
      rotation: 0,
      bookable: true,
      elementRole: 'WORKSPACE',
    };
    expect(checkElementsOverlap(deskA, deskBCleared)).toBe(false);

    // Desk C positioned at x=140, y=105, w=20, h=20 (inside X: [130, 170] and Y: [70, 170])
    const deskCOverlapping = {
      id: 'desk-c-overlapping',
      x: 140,
      y: 105,
      w: 20,
      h: 20,
      rotation: 0,
      bookable: true,
      elementRole: 'WORKSPACE',
    };
    expect(checkElementsOverlap(deskA, deskCOverlapping)).toBe(true);

    const colliding = findCollidingElements([deskA, deskCOverlapping]);
    expect(colliding.has('desk-a')).toBe(true);
    expect(colliding.has('desk-c-overlapping')).toBe(true);
  });

  it('MS101-TC04: Map service publishing accepts rotated layout when no visual overlap exists', async () => {
    const catalog = await workspaceService.listCatalog();
    const inst1 = catalog.instances[0];

    // Place a workspace and a 90-degree rotated wall that would have collided under unrotated check,
    // but cleanly clears under rotated AABB check.
    // Unrotated wall at x=100, y=200, width=200, height=20 would span [100, 300]x[200, 220].
    // Workspace at x=250, y=200, width=80, height=80 overlaps unrotated wall in [250, 300]x[200, 220].
    // Rotated 90 degrees around center (200, 210):
    // Rotated wall visual AABB is X: [190, 210], Y: [110, 310].
    // Workspace at x=250, y=200, width=80, height=80 is at X: [250, 330], which completely clears X: [190, 210]!
    const validElements: MapElementInput[] = [
      {
        id: 'ws-elem-1',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: inst1.id,
        x: 250,
        y: 200,
        width: 80,
        height: 80,
        rotation: 0,
      },
      {
        id: 'wall-elem-1',
        elementRole: 'STRUCTURE',
        elementType: 'wall',
        x: 100,
        y: 200,
        width: 200,
        height: 20,
        rotation: 90,
      },
    ];

    await mapService.saveDraft({
      floorId: createdFloor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      elements: validElements,
    });

    const publishResult = await mapService.publishDraft({
      floorId: createdFloor.id,
    });

    expect(publishResult.published.version.status).toBe('PUBLISHED');
    expect(publishResult.published.elements).toHaveLength(2);
  });

  it('MS101-TC05: Map service publishing rejects real rotated collision with COLLISION_WALL', async () => {
    const catalog = await workspaceService.listCatalog();
    const inst1 = catalog.instances[0];

    // Rotated wall visual AABB: X in [190, 210], Y in [110, 310].
    // Workspace at x=180, y=150, width=80, height=80 covers X: [180, 260], Y: [150, 230].
    // Truly intersects rotated wall.
    const collidingElements: MapElementInput[] = [
      {
        id: 'ws-elem-colliding',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: inst1.id,
        x: 180,
        y: 150,
        width: 80,
        height: 80,
        rotation: 0,
      },
      {
        id: 'wall-elem-colliding',
        elementRole: 'STRUCTURE',
        elementType: 'wall',
        x: 100,
        y: 200,
        width: 200,
        height: 20,
        rotation: 90,
      },
    ];

    await mapService.saveDraft({
      floorId: createdFloor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      elements: collidingElements,
    });

    await expect(
      mapService.publishDraft({ floorId: createdFloor.id })
    ).rejects.toThrow(MapValidationError);

    await expect(
      mapService.publishDraft({ floorId: createdFloor.id })
    ).rejects.toThrow('COLLISION_WALL');
  });

  it('MS101-TC06: Backward compatibility with 0-degree unrotated elements', () => {
    const elements = [
      {
        id: 'ws-1',
        x: 100,
        y: 100,
        w: 80,
        h: 80,
        rotation: 0,
        bookable: true,
        elementRole: 'WORKSPACE',
        elementType: 'desk',
      },
      {
        id: 'ws-2',
        x: 150,
        y: 120,
        w: 80,
        h: 80,
        rotation: 0,
        bookable: true,
        elementRole: 'WORKSPACE',
        elementType: 'desk',
      },
      {
        id: 'ws-3',
        x: 500,
        y: 500,
        w: 80,
        h: 80,
        bookable: true,
        elementRole: 'WORKSPACE',
        elementType: 'desk',
      },
    ];

    const colliding = findCollidingElements(elements);
    expect(colliding.has('ws-1')).toBe(true);
    expect(colliding.has('ws-2')).toBe(true);
    expect(colliding.has('ws-3')).toBe(false);
  });

  it('MS101-TC07: Map editor collision synchronization and rotation clearance', () => {
    // Initial state: wall is horizontal (rotation = 0) and collides with desk
    // Wall: x=100, y=100, w=200, h=20, rotation=0 -> occupies [100, 300]x[100, 120]
    // Desk: x=220, y=100, w=80, h=80, rotation=0 -> occupies [220, 300]x[100, 180]
    const desk = {
      id: 'desk-target',
      x: 220,
      y: 100,
      w: 80,
      h: 80,
      rotation: 0,
      bookable: true,
      elementRole: 'WORKSPACE',
      elementType: 'desk',
    };
    const wallUnrotated = {
      id: 'wall-rotatable',
      x: 100,
      y: 100,
      w: 200,
      h: 20,
      rotation: 0,
      bookable: false,
      elementRole: 'STRUCTURE',
      elementType: 'wall',
    };

    // When wall is unrotated (0 degrees), collision is detected by map editor wrapper
    const initialCollisions = mapEditorFindCollidingElements([desk, wallUnrotated]);
    expect(initialCollisions.has('desk-target')).toBe(true);
    expect(initialCollisions.has('wall-rotatable')).toBe(true);

    // Wall rotates 90 degrees around center (200, 110)
    // Rotated visual AABB: X in [190, 210], Y in [10, 210].
    // Desk at x=220, y=100 occupies X: [220, 300].
    // Since desk minX (220) > wall maxX (210), they no longer overlap!
    const wallRotated = {
      ...wallUnrotated,
      rotation: 90,
    };
    const rotatedCollisions = mapEditorFindCollidingElements([desk, wallRotated]);
    expect(rotatedCollisions.size).toBe(0);
    expect(rotatedCollisions.has('desk-target')).toBe(false);
    expect(rotatedCollisions.has('wall-rotatable')).toBe(false);
  });

  it('MS101-TC08: Thin wall, glass divider, and window structures support rotated collision detection', () => {
    const glassDivider = {
      id: 'glass-1',
      x: 200,
      y: 200,
      w: 150,
      h: 12,
      rotation: 90,
      bookable: false,
      elementRole: 'STRUCTURE',
      elementType: 'glass',
    };

    // Glass center: (275, 206). Visual AABB: X: [269, 281], Y: [131, 281].
    // Desk overlapping the rotated glass
    const deskIntersecting = {
      id: 'desk-glass-intersect',
      x: 250,
      y: 200,
      w: 60,
      h: 60,
      rotation: 0,
      bookable: true,
      elementRole: 'WORKSPACE',
    };
    expect(checkElementsOverlap(glassDivider, deskIntersecting)).toBe(true);

    // Desk clearing the rotated glass
    const deskClearing = {
      id: 'desk-glass-clear',
      x: 200,
      y: 200,
      w: 50,
      h: 50,
      rotation: 0,
      bookable: true,
      elementRole: 'WORKSPACE',
    };
    expect(checkElementsOverlap(glassDivider, deskClearing)).toBe(false);
  });

  it('MS101-TC10: Vertical element moves flush to canvas edge and auto-shifts inward when rotated to horizontal', () => {
    const canvasWidth = 1600;
    const canvasHeight = 1000;
    const wallLength = 400;
    const wallThickness = 20;

    // 1. Move vertical element (rot = 90) all the way to the left edge
    // Visual width is wallThickness (20), so visual AABB minX should touch 0
    const clampedAtLeft = clampRotatedElementToBounds(
      { x: -500, y: 200, width: wallLength, height: wallThickness, rotation: 90 },
      canvasWidth,
      canvasHeight
    );

    const aabbLeft = computeRotatedAABB(clampedAtLeft.x, clampedAtLeft.y, wallLength, wallThickness, 90);
    expect(aabbLeft.minX).toBe(0);
    expect(aabbLeft.maxX).toBe(wallThickness);
    expect(clampedAtLeft.cx).toBe(wallThickness / 2);
    expect(isRotatedElementWithinBounds(
      { x: clampedAtLeft.x, y: clampedAtLeft.y, width: wallLength, height: wallThickness, rotation: 90 },
      canvasWidth,
      canvasHeight
    )).toBe(true);

    // 2. Rotate to horizontal (rot = 180 or 0) while touching the left edge
    // The element must automatically move inward so that its left edge touches 0
    const clampedRotatedToHorizontal = clampRotatedElementToBounds(
      { x: clampedAtLeft.x, y: clampedAtLeft.y, width: wallLength, height: wallThickness, rotation: 180 },
      canvasWidth,
      canvasHeight
    );

    const aabbHorizontal = computeRotatedAABB(
      clampedRotatedToHorizontal.x,
      clampedRotatedToHorizontal.y,
      wallLength,
      wallThickness,
      180
    );
    expect(aabbHorizontal.minX).toBe(0);
    expect(aabbHorizontal.maxX).toBe(wallLength);
    expect(clampedRotatedToHorizontal.cx).toBe(wallLength / 2);
    expect(isRotatedElementWithinBounds(
      {
        x: clampedRotatedToHorizontal.x,
        y: clampedRotatedToHorizontal.y,
        width: wallLength,
        height: wallThickness,
        rotation: 180,
      },
      canvasWidth,
      canvasHeight
    )).toBe(true);

    // 3. Move vertical element all the way to the right edge
    const clampedAtRight = clampRotatedElementToBounds(
      { x: 2000, y: 200, width: wallLength, height: wallThickness, rotation: 90 },
      canvasWidth,
      canvasHeight
    );

    const aabbRight = computeRotatedAABB(clampedAtRight.x, clampedAtRight.y, wallLength, wallThickness, 90);
    expect(aabbRight.maxX).toBe(canvasWidth);
    expect(aabbRight.minX).toBe(canvasWidth - wallThickness);

    // 4. Rotate horizontal while touching right edge: automatically touches right boundary
    const clampedRotatedRightHorizontal = clampRotatedElementToBounds(
      { x: clampedAtRight.x, y: clampedAtRight.y, width: wallLength, height: wallThickness, rotation: 0 },
      canvasWidth,
      canvasHeight
    );

    const aabbRightHorizontal = computeRotatedAABB(
      clampedRotatedRightHorizontal.x,
      clampedRotatedRightHorizontal.y,
      wallLength,
      wallThickness,
      0
    );
    expect(aabbRightHorizontal.maxX).toBe(canvasWidth);
    expect(aabbRightHorizontal.minX).toBe(canvasWidth - wallLength);
  });

  it('MS101-TC11: Map service publishes vertical wall flush against canvas perimeter', async () => {
    const wallLength = 400;
    const wallThickness = 20;

    // Vertical wall touching left canvas edge: visual AABB minX = 0, maxX = 20
    // Center cx = 10, cy = 300
    // x = cx - wallLength / 2 = 10 - 200 = -190
    // y = cy - wallThickness / 2 = 300 - 10 = 290
    const edgeWall: MapElementInput = {
      id: 'edge-wall-left',
      elementRole: 'STRUCTURE',
      elementType: 'wall',
      x: -190,
      y: 290,
      width: wallLength,
      height: wallThickness,
      rotation: 90,
    };

    await mapService.saveDraft({
      floorId: createdFloor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      elements: [edgeWall],
    });

    const publishResult = await mapService.publishDraft({
      floorId: createdFloor.id,
    });

    expect(publishResult.published.version.status).toBe('PUBLISHED');
    expect(publishResult.published.elements).toHaveLength(1);
    expect(publishResult.published.elements[0].rotation).toBe(90);
  });

  it('MS101-TC09: Zero em-dash formatting invariant across modified files and test suite', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const filesToCheck = [
      path.resolve(__dirname, '../packages/domain/src/services/mapGeometryService.ts'),
      path.resolve(__dirname, '../packages/domain/src/services/mapService.ts'),
      path.resolve(__dirname, '../apps/admin-portal/src/features/map-builder/components/MapEditor.tsx'),
      path.resolve(__dirname, 'ms101-map-builder-rotated-collision-detection.test.ts'),
      path.resolve(__dirname, '../docs/milestone/ms101.md'),
    ];

    for (const filePath of filesToCheck) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content.includes('\u2014')).toBe(false);
      }
    }
  });
});
