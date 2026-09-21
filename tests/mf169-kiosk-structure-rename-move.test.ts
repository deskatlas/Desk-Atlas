import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  InMemoryMapRepository,
  InMemoryPublishedMapRepository,
  MapValidationError,
  createMapService,
  createPublishedMapService,
  type Floor,
  type MapElementInput,
} from '@deskatlas/domain';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('MF-169: Rename and Move Kiosk Orientation Structure in Map Builder', () => {
  const floor1: Floor = {
    id: 'floor-ground',
    name: 'Ground Floor',
    floorNumber: 1,
    displayOrder: 0,
    isActive: true,
  };

  describe('1. Map Editor Source Code Verification (Palette and Naming)', () => {
    const mapEditorPath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/map-builder/components/MapEditor.tsx'
    );
    const mapEditorContent = fs.readFileSync(mapEditorPath, 'utf-8');

    it('contains "Kiosk" in paletteStructure array', () => {
      assert.match(
        mapEditorContent,
        /const paletteStructure = \[[^\]]*['"]Kiosk['"][^\]]*\]/s,
        'paletteStructure should include "Kiosk"'
      );
    });

    it('does not contain separate KIOSK ORIENTATION header or standalone "You Are Here" palette item', () => {
      assert.doesNotMatch(
        mapEditorContent,
        /KIOSK ORIENTATION/i,
        'MapEditor sidebar should not contain a separate KIOSK ORIENTATION header'
      );
      assert.doesNotMatch(
        mapEditorContent,
        /<span>📍<\/span>\s*You Are Here/i,
        'MapEditor sidebar should not contain legacy "📍 You Are Here" label'
      );
    });

    it('handles "Kiosk" in handleAddStructure delegating to kiosk marker creation with name "Kiosk"', () => {
      assert.match(
        mapEditorContent,
        /handleAddStructure[\s\S]*?kiosk[\s\S]*?handleAddKioskMarker/,
        'handleAddStructure should handle Kiosk'
      );
      assert.match(
        mapEditorContent,
        /name:\s*['"]Kiosk['"]/,
        'Kiosk element object should have name "Kiosk"'
      );
    });

    it('provides Kiosk icon in getStructureIcon', () => {
      assert.match(
        mapEditorContent,
        /function getStructureIcon[\s\S]*?norm\.includes\(['"]kiosk['"]\)/,
        'getStructureIcon should provide an icon for kiosk'
      );
    });
  });

  describe('2. Optional Placement & Map Service Lifecycle', () => {
    it('allows saving and publishing a floor map WITHOUT a Kiosk marker (optional)', async () => {
      const mapRepo = new InMemoryMapRepository({
        floors: [floor1],
        workspaceInstances: [],
      });
      const publishedRepo = new InMemoryPublishedMapRepository();
      const mapService = createMapService(mapRepo, publishedRepo);

      // Save draft with only structural walls and no kiosk marker
      const draft = await mapService.saveDraft({
        floorId: floor1.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements: [
          {
            id: 'wall-1',
            elementRole: 'STRUCTURE',
            elementType: 'wall',
            x: 100,
            y: 100,
            width: 200,
            height: 20,
            rotation: 0,
            zIndex: 1,
            label: 'Wall',
          },
        ],
      });

      assert.equal(draft.elements.length, 1);
      assert.equal(draft.elements[0].elementType, 'wall');

      // Publishing succeeds without any kiosk marker requirement
      const result = await mapService.publishDraft({
        floorId: floor1.id,
      });

      assert.ok(result.published);
      assert.equal(result.published.floor.id, floor1.id);
      assert.equal(result.published.elements.length, 1);
    });

    it('allows saving and publishing a floor map WITH a Kiosk marker', async () => {
      const mapRepo = new InMemoryMapRepository({
        floors: [floor1],
        workspaceInstances: [],
      });
      const mapService = createMapService(mapRepo);

      const draft = await mapService.saveDraft({
        floorId: floor1.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements: [
          {
            id: 'kiosk-1',
            elementRole: 'INFORMATION',
            elementType: 'KIOSK_YOU_ARE_HERE',
            x: 200,
            y: 200,
            width: 80,
            height: 80,
            rotation: 0,
            zIndex: 10,
            label: 'Kiosk',
            properties: {
              color: '#DC2626',
              markerType: 'KIOSK_YOU_ARE_HERE',
            },
          },
        ],
      });

      assert.equal(draft.elements.length, 1);
      assert.equal(draft.elements[0].elementType, 'KIOSK_YOU_ARE_HERE');
      assert.equal(draft.elements[0].label, 'Kiosk');

      const result = await mapService.publishDraft({
        floorId: floor1.id,
      });

      assert.ok(result.published);
      assert.equal(result.published.elements.length, 1);
      assert.equal(result.published.elements[0].elementType, 'KIOSK_YOU_ARE_HERE');
      assert.equal(result.published.elements[0].label, 'Kiosk');
    });

    it('enforces at most one Kiosk marker per floor map', async () => {
      const mapRepo = new InMemoryMapRepository({
        floors: [floor1],
        workspaceInstances: [],
      });
      const mapService = createMapService(mapRepo);

      await assert.rejects(
        () =>
          mapService.saveDraft({
            floorId: floor1.id,
            canvasWidth: 1600,
            canvasHeight: 1000,
            gridSize: 20,
            elements: [
              {
                id: 'kiosk-1',
                elementRole: 'INFORMATION',
                elementType: 'KIOSK_YOU_ARE_HERE',
                x: 100,
                y: 100,
                width: 80,
                height: 80,
                rotation: 0,
                zIndex: 1,
                label: 'Kiosk 1',
              },
              {
                id: 'kiosk-2',
                elementRole: 'INFORMATION',
                elementType: 'KIOSK_YOU_ARE_HERE',
                x: 300,
                y: 300,
                width: 80,
                height: 80,
                rotation: 0,
                zIndex: 2,
                label: 'Kiosk 2',
              },
            ],
          }),
        MapValidationError
      );
    });

    it('maintains backward compatibility with legacy "You Are Here" labeled elements', async () => {
      const mapRepo = new InMemoryMapRepository({
        floors: [floor1],
        workspaceInstances: [],
      });
      const publishedRepo = new InMemoryPublishedMapRepository();
      const mapService = createMapService(mapRepo, publishedRepo);

      const draft = await mapService.saveDraft({
        floorId: floor1.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements: [
          {
            id: 'legacy-marker',
            elementRole: 'INFORMATION',
            elementType: 'KIOSK_YOU_ARE_HERE',
            x: 150,
            y: 150,
            width: 80,
            height: 80,
            rotation: 0,
            zIndex: 5,
            label: 'You Are Here',
            properties: {
              markerType: 'KIOSK_YOU_ARE_HERE',
            },
          },
        ],
      });

      assert.equal(draft.elements.length, 1);
      assert.equal(draft.elements[0].elementType, 'KIOSK_YOU_ARE_HERE');
      assert.equal(draft.elements[0].label, 'You Are Here');
    });
  });
});
