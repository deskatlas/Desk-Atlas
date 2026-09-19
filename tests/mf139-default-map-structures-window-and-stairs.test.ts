import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import {
  InMemoryMapRepository,
  InMemoryPublishedMapRepository,
  MapValidationError,
  createMapService,
  createPublishedMapService,
  type Floor,
  type MapElementInput,
  type PublishedFloorMap,
} from '@deskatlas/domain';

describe('MF-139: Default Map Structures: Window and Stairs in Map Builder', () => {
  const floor1: Floor = {
    id: 'floor-139',
    name: 'Main Level',
    floorNumber: 1,
    displayOrder: 0,
    isActive: true,
  };

  describe('1. Map Service Geometry Normalization for Window & Stairs', () => {
    it('normalizes window with width 160 (same width/length as glass) and height 20', async () => {
      const mapRepo = new InMemoryMapRepository({
        floors: [floor1],
        workspaceInstances: [],
      });
      const mapService = createMapService(mapRepo);

      const elements: MapElementInput[] = [
        {
          id: 'elem-win-1',
          elementRole: 'STRUCTURE',
          elementType: 'window',
          x: 40,
          y: 60,
          width: 160,
          height: 20,
          rotation: 0,
          zIndex: 1,
        },
      ];

      const draft = await mapService.saveDraft({
        floorId: floor1.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements,
      });

      assert.equal(draft.elements.length, 1);
      const savedWin = draft.elements[0];
      assert.equal(savedWin.id, 'elem-win-1');
      assert.equal(savedWin.elementType, 'window');
      assert.equal(savedWin.width, 160, 'Window width/length must match glass (160px)');
      assert.equal(savedWin.height, 20, 'Window height must default to 20px matching wall/glass thickness');
    });

    it('preserves custom window profile thickness (e.g. 14px) without snapping to 20px grid', async () => {
      const mapRepo = new InMemoryMapRepository({
        floors: [floor1],
        workspaceInstances: [],
      });
      const mapService = createMapService(mapRepo);

      const elements: MapElementInput[] = [
        {
          id: 'elem-win-thin',
          elementRole: 'STRUCTURE',
          elementType: 'window',
          x: 40,
          y: 60,
          width: 160,
          height: 14,
          rotation: 0,
          zIndex: 1,
        },
      ];

      const draft = await mapService.saveDraft({
        floorId: floor1.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements,
      });

      assert.equal(draft.elements.length, 1);
      const savedWin = draft.elements[0];
      assert.equal(savedWin.width, 160);
      assert.equal(savedWin.height, 14, 'Custom window height must stay 14px');
    });

    it('normalizes stairs element with width 80 and height 120', async () => {
      const mapRepo = new InMemoryMapRepository({
        floors: [floor1],
        workspaceInstances: [],
      });
      const mapService = createMapService(mapRepo);

      const elements: MapElementInput[] = [
        {
          id: 'elem-stairs-1',
          elementRole: 'STRUCTURE',
          elementType: 'stairs',
          x: 100,
          y: 100,
          width: 80,
          height: 120,
          rotation: 0,
          zIndex: 1,
        },
      ];

      const draft = await mapService.saveDraft({
        floorId: floor1.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements,
      });

      assert.equal(draft.elements.length, 1);
      const savedStairs = draft.elements[0];
      assert.equal(savedStairs.id, 'elem-stairs-1');
      assert.equal(savedStairs.elementType, 'stairs');
      assert.equal(savedStairs.width, 80);
      assert.equal(savedStairs.height, 120);
    });

    it('rejects window with invalid negative or zero dimensions', async () => {
      const mapRepo = new InMemoryMapRepository({
        floors: [floor1],
        workspaceInstances: [],
      });
      const mapService = createMapService(mapRepo);

      await assert.rejects(
        async () => {
          await mapService.saveDraft({
            floorId: floor1.id,
            canvasWidth: 1600,
            canvasHeight: 1000,
            gridSize: 20,
            elements: [
              {
                id: 'elem-win-invalid',
                elementRole: 'STRUCTURE',
                elementType: 'window',
                x: 40,
                y: 60,
                width: -10,
                height: 14,
              },
            ],
          });
        },
        (err: any) => err instanceof MapValidationError,
      );
    });
  });

  describe('2. Draft Publishing and Multi-Audience Projection', () => {
    it('publishes and exposes Window and Stairs to Customer and Kiosk viewers', async () => {
      const pubRepo = new InMemoryPublishedMapRepository();
      const publishedFloorMap: PublishedFloorMap = {
        floor: floor1,
        version: {
          id: 'ver-139',
          floorId: floor1.id,
          versionNumber: 1,
          canvasWidth: 1600,
          canvasHeight: 1000,
          gridSize: 20,
          publishedAt: '2026-09-19T00:00:00.000Z',
        },
        elements: [
          {
            id: 'elem-win-pub',
            elementRole: 'WALL',
            elementType: 'window',
            x: 200,
            y: 40,
            width: 120,
            height: 14,
            rotation: 0,
            zIndex: 1,
            label: 'Window',
            properties: null,
            style: {
              color: 'rgba(56, 189, 248, 0.25)',
              borderColor: '#38BDF8',
            },
            workspace: null,
          },
          {
            id: 'elem-stairs-pub',
            elementRole: 'WALL',
            elementType: 'stairs',
            x: 400,
            y: 200,
            width: 80,
            height: 120,
            rotation: 0,
            zIndex: 1,
            label: 'Stairs',
            properties: null,
            style: {
              color: '#E2E8F0',
              borderColor: '#94A3B8',
            },
            workspace: null,
          },
        ],
      };

      pubRepo.seedPublishedFloorMap(publishedFloorMap);
      const pubService = createPublishedMapService(pubRepo);

      // Customer Audience projection
      const customerMap = await pubService.loadPublishedFloorMap(floor1.id, { audience: 'CUSTOMER' });
      assert.ok(customerMap);
      assert.equal(customerMap?.elements.length, 2);
      const custWin = customerMap?.elements.find((e) => e.id === 'elem-win-pub');
      const custStairs = customerMap?.elements.find((e) => e.id === 'elem-stairs-pub');
      assert.ok(custWin);
      assert.equal(custWin.height, 14);
      assert.equal(custWin.workspace, null, 'Window must not be bookable');
      assert.ok(custStairs);
      assert.equal(custStairs.width, 80);
      assert.equal(custStairs.height, 120);
      assert.equal(custStairs.workspace, null, 'Stairs must not be bookable');

      // Kiosk Audience projection
      const kioskMap = await pubService.loadPublishedFloorMap(floor1.id, { audience: 'KIOSK' });
      assert.ok(kioskMap);
      assert.equal(kioskMap?.elements.length, 2);
    });
  });

  describe('3. Map Builder UI Architecture Verification', () => {
    it('verifies Window and Stairs are declared in MapEditor paletteStructure', () => {
      const editorFilePath = path.join(
        process.cwd(),
        'apps/admin-portal/src/features/map-builder/components/MapEditor.tsx',
      );
      const content = fs.readFileSync(editorFilePath, 'utf8');

      // Check palette structure list
      assert.ok(
        content.includes("'Window'") || content.includes('"Window"'),
        'MapEditor must include Window in paletteStructure',
      );
      assert.ok(
        content.includes("'Stairs'") || content.includes('"Stairs"'),
        'MapEditor must include Stairs in paletteStructure',
      );

      // Check default instantiation values
      assert.ok(
        (content.includes("name.toLowerCase() === 'window'") || content.includes("isWindow")) && content.includes('160'),
        'MapEditor must instantiate Window with 160px width/length matching glass',
      );
      assert.ok(
        (content.includes("name.toLowerCase() === 'stairs'") || content.includes("isStairs")) && content.includes('80') && content.includes('120'),
        'MapEditor must instantiate Stairs with 80x120px default dimensions',
      );

      // Check color specifications
      assert.ok(
        content.includes('rgba(56, 189, 248, 0.25)'),
        'MapEditor must use sky blue fill for Window',
      );
      assert.ok(
        content.includes('#38BDF8'),
        'MapEditor must use border #38BDF8 for Window',
      );
      assert.ok(
        content.includes('#E2E8F0'),
        'MapEditor must use slate #E2E8F0 for Stairs',
      );
      assert.ok(
        content.includes('#94A3B8'),
        'MapEditor must use border #94A3B8 for Stairs',
      );
    });

    it('verifies dedicated SVG icons and rendering patterns across viewer pages', () => {
      const filesToCheck = [
        'apps/admin-portal/src/features/map-builder/components/MapEditor.tsx',
        'apps/admin-portal/src/app/manage/workspace-map/page.tsx',
        'apps/staff-dashboard/src/app/manage/workspace-map/page.tsx',
        'apps/customer-website/src/features/reservation/components/ReservationPage.tsx',
        'apps/kiosk/src/app/kiosk/reserve/page.tsx',
      ];

      for (const relPath of filesToCheck) {
        const filePath = path.join(process.cwd(), relPath);
        const content = fs.readFileSync(filePath, 'utf8');

        // Check Window glazing line references or window detection
        assert.ok(
          content.includes('rgba(56, 189, 248'),
          `${relPath} must support Window cyan/sky blue glazing accents`,
        );

        // Check Stairs tread pattern or svg pattern
        assert.ok(
          content.includes('stairs-pattern') || content.includes('19 5h-4v4h-4v4H7v4H3v2h18V5z'),
          `${relPath} must support Stairs tread pattern or step icon`,
        );
      }
    });
  });
});
