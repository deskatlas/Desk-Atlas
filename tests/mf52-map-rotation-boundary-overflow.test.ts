import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  computeRotatedElementCorners,
  computeRotatedAABB,
  computeRotatedElementGeometry,
  isRotatedElementWithinBounds,
  clampRotatedElementToBounds,
  createMapService,
  InMemoryMapRepository,
  MapValidationError,
  type Floor,
  type MapElementInput,
} from '@deskatlas/domain';

describe('MF-52: Rotated Element Map Boundary Overflow', () => {
  const CANVAS_WIDTH = 1600;
  const CANVAS_HEIGHT = 1000;

  describe('Trigonometric Corner Projection & AABB Computation', () => {
    it('computes exact AABB for 0° rotation', () => {
      const aabb = computeRotatedAABB(100, 200, 160, 20, 0);
      assert.equal(aabb.minX, 100);
      assert.equal(aabb.minY, 200);
      assert.equal(aabb.maxX, 260);
      assert.equal(aabb.maxY, 220);
      assert.equal(aabb.width, 160);
      assert.equal(aabb.height, 20);
    });

    it('computes exact AABB for 90° rotation (dimensions swap around center)', () => {
      // Element at x=100, y=200, w=160, h=20. Center is (180, 210).
      // Rotated 90°: visual halfW is 10, visual halfH is 80.
      // Visual bounds: X in [170, 190], Y in [130, 290].
      const aabb = computeRotatedAABB(100, 200, 160, 20, 90);
      assert.equal(aabb.minX, 170);
      assert.equal(aabb.maxX, 190);
      assert.equal(aabb.minY, 130);
      assert.equal(aabb.maxY, 290);
      assert.equal(aabb.width, 20);
      assert.equal(aabb.height, 160);
    });

    it('computes exact AABB for 180° rotation', () => {
      // Center is (180, 210).
      // Rotated 180°: visual bounds same as 0° (X in [100, 260], Y in [200, 220]).
      const aabb = computeRotatedAABB(100, 200, 160, 20, 180);
      assert.equal(aabb.minX, 100);
      assert.equal(aabb.maxX, 260);
      assert.equal(aabb.minY, 200);
      assert.equal(aabb.maxY, 220);
      assert.equal(aabb.width, 160);
      assert.equal(aabb.height, 20);
    });

    it('computes exact AABB for 270° rotation', () => {
      const aabb = computeRotatedAABB(100, 200, 160, 20, 270);
      assert.equal(aabb.minX, 170);
      assert.equal(aabb.maxX, 190);
      assert.equal(aabb.minY, 130);
      assert.equal(aabb.maxY, 290);
      assert.equal(aabb.width, 20);
      assert.equal(aabb.height, 160);
    });

    it('computes exact AABB for 45° and 135° diagonal rotations', () => {
      // For square 80x80 at x=100, y=100. Center is (140, 140).
      // At 45°: halfW = halfH = 80 * sqrt(2) / 2 = 40 * sqrt(2) ≈ 56.5685
      const aabb45 = computeRotatedAABB(100, 100, 80, 80, 45);
      const expectedHalf = 40 * Math.SQRT2;
      assert(Math.abs(aabb45.minX - (140 - expectedHalf)) < 0.01);
      assert(Math.abs(aabb45.maxX - (140 + expectedHalf)) < 0.01);
      assert(Math.abs(aabb45.minY - (140 - expectedHalf)) < 0.01);
      assert(Math.abs(aabb45.maxY - (140 + expectedHalf)) < 0.01);

      const aabb135 = computeRotatedAABB(100, 100, 80, 80, 135);
      assert(Math.abs(aabb135.minX - (140 - expectedHalf)) < 0.01);
      assert(Math.abs(aabb135.maxX - (140 + expectedHalf)) < 0.01);
    });

    it('projects all four corners with trigonometric precision', () => {
      const corners = computeRotatedElementCorners(100, 200, 160, 20, 90);
      assert.equal(corners.length, 4);
      // Center is (180, 210).
      // Relative corners TL(-80, -10), TR(80, -10), BR(80, 10), BL(-80, 10)
      // Rotated 90° clockwise:
      // (dx, dy) -> (-dy, dx)
      // TL: (10, -80) -> (190, 130)
      // TR: (10, 80) -> (190, 290)
      // BR: (-10, 80) -> (170, 290)
      // BL: (-10, -80) -> (170, 130)
      assert.deepEqual(corners[0], { x: 190, y: 130 });
      assert.deepEqual(corners[1], { x: 190, y: 290 });
      assert.deepEqual(corners[2], { x: 170, y: 290 });
      assert.deepEqual(corners[3], { x: 170, y: 130 });
    });
  });

  describe('Center-Pivot In-Place Rotation', () => {
    it('pivots purely in place without position shift when away from edges', () => {
      // Element in center: x=720, y=490, w=160, h=20. Center is (800, 500).
      const clamped0 = clampRotatedElementToBounds(
        { x: 720, y: 490, width: 160, height: 20, rotation: 0 },
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      assert.equal(clamped0.wasAdjusted, false);
      assert.equal(clamped0.x, 720);
      assert.equal(clamped0.y, 490);
      assert.equal(clamped0.cx, 800);
      assert.equal(clamped0.cy, 500);

      // Rotate to 90°
      const clamped90 = clampRotatedElementToBounds(
        { x: 720, y: 490, width: 160, height: 20, rotation: 90 },
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      assert.equal(clamped90.wasAdjusted, false);
      assert.equal(clamped90.x, 720);
      assert.equal(clamped90.y, 490);
      assert.equal(clamped90.cx, 800);
      assert.equal(clamped90.cy, 500);

      // Rotate to 180°
      const clamped180 = clampRotatedElementToBounds(
        { x: 720, y: 490, width: 160, height: 20, rotation: 180 },
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      assert.equal(clamped180.wasAdjusted, false);
      assert.equal(clamped180.x, 720);
      assert.equal(clamped180.y, 490);

      // Rotate to 270°
      const clamped270 = clampRotatedElementToBounds(
        { x: 720, y: 490, width: 160, height: 20, rotation: 270 },
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      assert.equal(clamped270.wasAdjusted, false);
      assert.equal(clamped270.x, 720);
      assert.equal(clamped270.y, 490);
    });
  });

  describe('Edge-Adjacent Element Clamping', () => {
    it('pushes long horizontal element inward when rotated 90° near top boundary', () => {
      // Long wall of width 160, height 20 at y=0 (top edge).
      // Center cy = 10.
      // Rotated 90°: visual halfH is 80.
      // Without clamping, visual top is 10 - 80 = -70 (overflows by 70px).
      const unclampedAABB = computeRotatedAABB(100, 0, 160, 20, 90);
      assert.equal(unclampedAABB.minY, -70);
      assert(unclampedAABB.minY < 0, 'Unclamped element overflows top boundary');

      // Clamped
      const clamped = clampRotatedElementToBounds(
        { x: 100, y: 0, width: 160, height: 20, rotation: 90 },
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      assert.equal(clamped.wasAdjusted, true);
      assert.equal(clamped.overflow.top, 70);
      // Pushed inward so cy = 80, y = 80 - 10 = 70
      assert.equal(clamped.y, 70);
      assert.equal(clamped.x, 100);

      // Verify clamped rotated AABB stays strictly inside bounds
      const clampedAABB = computeRotatedAABB(clamped.x, clamped.y, 160, 20, 90);
      assert.equal(clampedAABB.minY, 0, 'Visual top is flush with canvas top');
      assert.equal(clampedAABB.maxY, 160);
      assert(isRotatedElementWithinBounds({ x: clamped.x, y: clamped.y, width: 160, height: 20, rotation: 90 }, CANVAS_WIDTH, CANVAS_HEIGHT));
    });

    it('pushes long horizontal element inward when rotated 90° near bottom boundary', () => {
      // Long wall at y = 980 (bottom edge of 1000px canvas). Center cy = 990.
      // Rotated 90°: visual halfH is 80.
      // Without clamping, visual bottom is 990 + 80 = 1070 (overflows by 70px).
      const unclampedAABB = computeRotatedAABB(100, 980, 160, 20, 90);
      assert.equal(unclampedAABB.maxY, 1070);

      const clamped = clampRotatedElementToBounds(
        { x: 100, y: 980, width: 160, height: 20, rotation: 90 },
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      assert.equal(clamped.wasAdjusted, true);
      assert.equal(clamped.overflow.bottom, 70);
      // cy clamped to 920, y = 920 - 10 = 910
      assert.equal(clamped.y, 910);

      const clampedAABB = computeRotatedAABB(clamped.x, clamped.y, 160, 20, 90);
      assert.equal(clampedAABB.maxY, 1000, 'Visual bottom is flush with canvas bottom');
      assert(clampedAABB.minY >= 0);
      assert(isRotatedElementWithinBounds({ x: clamped.x, y: clamped.y, width: 160, height: 20, rotation: 90 }, CANVAS_WIDTH, CANVAS_HEIGHT));
    });

    it('pushes long element inward near right boundary', () => {
      // Wall of width 160 at x = 1440 (right edge of 1600px canvas).
      // Center cx = 1520.
      // If rotated 0° or 180°, visual halfW is 80. MaxX = 1600.
      const clamped0 = clampRotatedElementToBounds(
        { x: 1440, y: 200, width: 160, height: 20, rotation: 0 },
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      assert.equal(clamped0.wasAdjusted, false);

      // If at x = 1500 (would overflow by 60px):
      const clampedOver = clampRotatedElementToBounds(
        { x: 1500, y: 200, width: 160, height: 20, rotation: 0 },
        CANVAS_WIDTH,
        CANVAS_HEIGHT
      );
      assert.equal(clampedOver.wasAdjusted, true);
      assert.equal(clampedOver.x, 1440);
    });
  });

  describe('Corner-Adjacent Element Clamping', () => {
    it('clamps corner element (0, 0) across 0°, 45°, 90°, 135°, 180°', () => {
      const w = 120;
      const h = 80;

      for (const rot of [0, 45, 90, 135, 180, 270]) {
        const clamped = clampRotatedElementToBounds(
          { x: 0, y: 0, width: w, height: h, rotation: rot },
          CANVAS_WIDTH,
          CANVAS_HEIGHT
        );

        const aabb = computeRotatedAABB(clamped.x, clamped.y, w, h, rot);
        assert(aabb.minX >= -1e-4, `Angle ${rot}°: minX ${aabb.minX} must be >= 0`);
        assert(aabb.maxX <= CANVAS_WIDTH + 1e-4, `Angle ${rot}°: maxX ${aabb.maxX} must be <= ${CANVAS_WIDTH}`);
        assert(aabb.minY >= -1e-4, `Angle ${rot}°: minY ${aabb.minY} must be >= 0`);
        assert(aabb.maxY <= CANVAS_HEIGHT + 1e-4, `Angle ${rot}°: maxY ${aabb.maxY} must be <= ${CANVAS_HEIGHT}`);
        assert(clamped.x >= 0, `Angle ${rot}°: x ${clamped.x} must be >= 0`);
        assert(clamped.y >= 0, `Angle ${rot}°: y ${clamped.y} must be >= 0`);
      }
    });

    it('clamps bottom-right corner element across multiple angles', () => {
      const w = 160;
      const h = 20;

      for (const rot of [0, 45, 90, 135, 180, 270]) {
        const clamped = clampRotatedElementToBounds(
          { x: CANVAS_WIDTH - w, y: CANVAS_HEIGHT - h, width: w, height: h, rotation: rot },
          CANVAS_WIDTH,
          CANVAS_HEIGHT
        );

        const aabb = computeRotatedAABB(clamped.x, clamped.y, w, h, rot);
        assert(aabb.minX >= -1e-4, `Angle ${rot}°: minX ${aabb.minX} must be >= 0`);
        assert(aabb.maxX <= CANVAS_WIDTH + 1e-4, `Angle ${rot}°: maxX ${aabb.maxX} must be <= ${CANVAS_WIDTH}`);
        assert(aabb.minY >= -1e-4, `Angle ${rot}°: minY ${aabb.minY} must be >= 0`);
        assert(aabb.maxY <= CANVAS_HEIGHT + 1e-4, `Angle ${rot}°: maxY ${aabb.maxY} must be <= ${CANVAS_HEIGHT}`);
      }
    });
  });

  describe('Short and Long Elements Parity', () => {
    it('handles short square desk (80x80) and long wall (200x20) equally', () => {
      // Short square desk
      const shortDesk = { x: 10, y: 10, width: 80, height: 80, rotation: 45 };
      const clampedShort = clampRotatedElementToBounds(shortDesk, CANVAS_WIDTH, CANVAS_HEIGHT);
      assert(isRotatedElementWithinBounds({ ...shortDesk, x: clampedShort.x, y: clampedShort.y }, CANVAS_WIDTH, CANVAS_HEIGHT));

      // Long wall (200x20)
      const longWall = { x: 10, y: 10, width: 200, height: 20, rotation: 90 };
      const clampedLong = clampRotatedElementToBounds(longWall, CANVAS_WIDTH, CANVAS_HEIGHT);
      assert(isRotatedElementWithinBounds({ ...longWall, x: clampedLong.x, y: clampedLong.y }, CANVAS_WIDTH, CANVAS_HEIGHT));
      assert(clampedLong.y >= 90, 'Long wall pushed inward so 100px half-height fits');
    });
  });

  describe('Map Service Draft Validation & Historical Maps Preservation', () => {
    const floor: Floor = {
      id: 'floor-test',
      name: 'Main Floor',
      floorNumber: 1,
      displayOrder: 0,
      isActive: true,
    };

    it('accepts properly clamped rotated element in saveDraft', async () => {
      const repo = new InMemoryMapRepository({
        floors: [floor],
        workspaceInstances: [],
      });
      const service = createMapService(repo);

      // Long wall rotated 90° with clamped position (y=70 so rotated bounds fit [0, 160])
      const element: MapElementInput = {
        id: 'wall-1',
        elementRole: 'STRUCTURE',
        elementType: 'wall',
        x: 100,
        y: 80,
        width: 160,
        height: 20,
        rotation: 90,
        zIndex: 1,
      };

      const draft = await service.saveDraft({
        floorId: floor.id,
        canvasWidth: CANVAS_WIDTH,
        canvasHeight: CANVAS_HEIGHT,
        gridSize: 20,
        elements: [element],
      });

      assert.equal(draft.elements.length, 1);
      assert.equal(draft.elements[0].rotation, 90);
      assert.equal(draft.elements[0].y, 80);
    });

    it('rejects draft with rotated element that overflows canvas boundary', async () => {
      const repo = new InMemoryMapRepository({
        floors: [floor],
        workspaceInstances: [],
      });
      const service = createMapService(repo);

      // Long wall rotated 90° at y=0 (unclamped: rotated top is -70px)
      const overflowingElement: MapElementInput = {
        id: 'wall-overflow',
        elementRole: 'STRUCTURE',
        elementType: 'wall',
        x: 100,
        y: 0,
        width: 160,
        height: 20,
        rotation: 90,
        zIndex: 1,
      };

      await assert.rejects(
        async () => {
          await service.saveDraft({
            floorId: floor.id,
            canvasWidth: CANVAS_WIDTH,
            canvasHeight: CANVAS_HEIGHT,
            gridSize: 20,
            elements: [overflowingElement],
          });
        },
        (err: any) => {
          assert(err instanceof MapValidationError);
          assert(err.message.includes('must stay within the canvas bounds'));
          return true;
        }
      );
    });

    it('uses actual instance name / label in boundary overflow error message', async () => {
      const repo = new InMemoryMapRepository({
        floors: [floor],
        workspaceInstances: [{ id: 'inst-sky-2', floorId: floor.id, operationalStatus: 'ACTIVE' }],
      });
      const service = createMapService(repo);

      const overflowingElement: MapElementInput = {
        id: 'ws-16',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: 'inst-sky-2',
        label: 'Sky Circle 2',
        x: 1550,
        y: 100,
        width: 120,
        height: 80,
        rotation: 0,
        zIndex: 16,
      };

      await assert.rejects(
        async () => {
          await service.saveDraft({
            floorId: floor.id,
            canvasWidth: CANVAS_WIDTH,
            canvasHeight: CANVAS_HEIGHT,
            gridSize: 20,
            elements: [overflowingElement],
          });
        },
        (err: any) => {
          assert(err instanceof MapValidationError);
          assert.equal(err.message, 'Sky Circle 2 must stay within the canvas bounds');
          return true;
        }
      );
    });

    it('loads existing published maps without retroactively modifying stored coordinates', async () => {
      // Simulate historical published map version with existing element
      const historicalElement = {
        id: 'hist-1',
        mapVersionId: 'ver-hist',
        elementRole: 'STRUCTURE' as const,
        elementType: 'wall',
        workspaceInstanceId: null,
        x: 100,
        y: 20,
        width: 160,
        height: 20,
        rotation: 90 as const,
        zIndex: 1,
        label: 'Historical Wall',
        properties: {},
        isLocked: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const repo = new InMemoryMapRepository({
        floors: [floor],
        workspaceInstances: [],
      });

      // Seed historical published map into repository
      (repo as any).versions.set('ver-hist', {
        id: 'ver-hist',
        floorId: floor.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        canvasWidth: CANVAS_WIDTH,
        canvasHeight: CANVAS_HEIGHT,
        gridSize: 20,
        publishedByUserId: null,
        publishedAt: '2026-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      (repo as any).elements.set('ver-hist', [historicalElement]);

      const service = createMapService(repo);
      const published = await service.loadPublished(floor.id);

      assert(published !== null);
      assert.equal(published.elements[0].x, 100);
      assert.equal(published.elements[0].y, 20); // Not retroactively mutated!
      assert.equal(published.elements[0].rotation, 90);
    });
  });

  describe('Rotated Width-Only Structure Resize & Boundary Constraints', () => {
    it('resizing wall rotated 90° downward keeps visual left static and visual top static', () => {
      // Wall of 160x20 at x=200, y=100. Rotated 90°.
      // Visual bounds:
      // Center: cx = 200 + 80 = 280, cy = 100 + 10 = 110.
      // Rotated: visual width = 20, visual height = 160.
      // Visual left: 280 - 10 = 270. Visual right: 280 + 10 = 290.
      // Visual top: 110 - 80 = 30. Visual bottom: 110 + 80 = 190.
      const startObjW = 160;
      const startObjH = 20;
      const startObjX = 200;
      const startObjY = 100;
      const rot = 90;

      // User drags downward by 40px
      const dy = 40;
      const newW = startObjW + dy; // 200
      const dw = newW - startObjW; // 40
      const newX = startObjX - dw / 2; // 180
      const newY = startObjY + dw / 2; // 120

      // New center:
      // cx = 180 + 100 = 280 (unchanged!)
      // cy = 120 + 10 = 130
      // Rotated visual bounds:
      // Visual left: 280 - 10 = 270 (unchanged!)
      // Visual right: 280 + 10 = 290 (unchanged!)
      // Visual top: 130 - 100 = 30 (unchanged!)
      // Visual bottom: 130 + 100 = 230 (extended downward by exactly 40px!)
      const aabb = computeRotatedAABB(newX, newY, newW, startObjH, rot);
      assert.equal(aabb.minX, 270);
      assert.equal(aabb.maxX, 290);
      assert.equal(aabb.minY, 30);
      assert.equal(aabb.maxY, 230);
      assert.equal(aabb.width, 20);
      assert.equal(aabb.height, 200);

      // Must remain within bounds
      assert(isRotatedElementWithinBounds({ x: newX, y: newY, width: newW, height: startObjH, rotation: rot }, CANVAS_WIDTH, CANVAS_HEIGHT));
    });

    it('clamps newW so that 90° rotated element never produces negative x or exceeds canvas width', () => {
      const canvasW = 800;
      const canvasH = 600;
      const startObjW = 100;
      const thickness = 20;
      const rot = 90;

      // Element close to left boundary: startObjX = 20
      const startObjX = 20;
      const startObjY = 100;

      // Without clamping, dy = 100 would make newX = 20 - 50 = -30 (< 0, out of bounds)
      const maxW_left = startObjW + 2 * startObjX; // 100 + 40 = 140
      const maxW_right = startObjW + 2 * (canvasW - startObjW - startObjX);
      const visualTop = startObjY + (thickness - startObjW) / 2;
      const maxW_bottom = canvasH - visualTop;
      const maxW = Math.min(maxW_bottom, Math.max(20, maxW_left), Math.max(20, maxW_right));

      assert.equal(maxW, 140);

      // Clamp newW to maxW
      const clampedW = Math.min(100 + 100, maxW);
      assert.equal(clampedW, 140);

      const dw = clampedW - startObjW;
      const newX = startObjX - dw / 2;
      const newY = startObjY + dw / 2;

      assert.equal(newX, 0, 'newX is clamped to >= 0');
      assert(newX >= 0);
      assert(newX + clampedW <= canvasW);

      assert(isRotatedElementWithinBounds({ x: newX, y: newY, width: clampedW, height: thickness, rotation: rot }, canvasW, canvasH));
    });
  });
});

