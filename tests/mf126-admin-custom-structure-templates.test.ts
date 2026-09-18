import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  InMemoryMapRepository,
  InMemoryPublishedMapRepository,
  MapValidationError,
  createMapService,
  createPublishedMapService,
  normalizeCreateCustomStructureTemplateInput,
  normalizeUpdateCustomStructureTemplateInput,
  MapUndoRedoManager,
  type CustomStructureTemplate,
  type Floor,
  type MapElementInput,
  type PublishedFloorMap,
} from '@deskatlas/domain';

describe('MF-126: Admin Custom Structure Management and Map Placement', () => {
  const floor1: Floor = {
    id: 'floor-main',
    name: 'Main Floor',
    floorNumber: 1,
    displayOrder: 0,
    isActive: true,
  };

  const sampleCustomTemplate: CustomStructureTemplate = {
    id: 'cstr-reception',
    name: 'Reception Counter',
    description: 'Front desk and concierge check-in counter',
    defaultWidth: 140,
    defaultHeight: 70,
    defaultColor: '#CBD5E1',
    borderStyle: 'solid',
    category: 'FURNITURE',
    isActive: true,
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
  };

  describe('1. Input Validation & Normalization', () => {
    it('normalizes valid custom structure template input with default values', () => {
      const normalized = normalizeCreateCustomStructureTemplateInput({
        name: 'Acoustic Partition',
      });

      assert.equal(normalized.name, 'Acoustic Partition');
      assert.equal(normalized.defaultWidth, 120);
      assert.equal(normalized.defaultHeight, 60);
      assert.equal(normalized.defaultColor, '#CBD5E1');
      assert.equal(normalized.borderStyle, 'solid');
      assert.equal(normalized.category, 'ARCHITECTURAL');
      assert.equal(normalized.isActive, true);
    });

    it('normalizes custom width, height, border style, and category', () => {
      const normalized = normalizeCreateCustomStructureTemplateInput({
        name: 'Whiteboard Wall',
        description: 'Magnetic dry-erase dividing partition',
        defaultWidth: 200,
        defaultHeight: 30,
        defaultColor: '#F8FAFC',
        borderStyle: 'dashed',
        category: 'BARRIER',
        isActive: true,
      });

      assert.equal(normalized.name, 'Whiteboard Wall');
      assert.equal(normalized.description, 'Magnetic dry-erase dividing partition');
      assert.equal(normalized.defaultWidth, 200);
      assert.equal(normalized.defaultHeight, 30);
      assert.equal(normalized.defaultColor, '#F8FAFC');
      assert.equal(normalized.borderStyle, 'dashed');
      assert.equal(normalized.category, 'BARRIER');
    });

    it('rejects blank or missing structure name', () => {
      assert.throws(
        () => normalizeCreateCustomStructureTemplateInput({ name: '   ' }),
        /Custom structure template name is required/
      );
    });

    it('rejects invalid dimensions outside allowed bounds (20 to 2000 px)', () => {
      assert.throws(
        () => normalizeCreateCustomStructureTemplateInput({ name: 'Pillar', defaultWidth: 10 }),
        /Default width must be between 20 and 2000/
      );
      assert.throws(
        () => normalizeCreateCustomStructureTemplateInput({ name: 'Pillar', defaultHeight: 3000 }),
        /Default height must be between 20 and 2000/
      );
    });

    it('normalizes update inputs properly', () => {
      const updated = normalizeUpdateCustomStructureTemplateInput({
        name: 'Executive Concierge Desk',
        defaultWidth: 160,
        borderStyle: 'none',
      });

      assert.equal(updated.name, 'Executive Concierge Desk');
      assert.equal(updated.defaultWidth, 160);
      assert.equal(updated.borderStyle, 'none');
      assert.equal(updated.defaultHeight, undefined);
    });
  });

  describe('2. Custom Structure Template CRUD via MapService & Repository', () => {
    it('creates, lists, retrieves, updates, and deletes custom structure templates', async () => {
      const repo = new InMemoryMapRepository({
        floors: [floor1],
        customStructureTemplates: [sampleCustomTemplate],
      });
      const service = createMapService(repo);

      // List existing templates
      const list1 = await service.listCustomStructureTemplates();
      assert.equal(list1.length, 1);
      assert.equal(list1[0].name, 'Reception Counter');

      // Create new template
      const created = await service.createCustomStructureTemplate({
        name: 'Coffee Bar Island',
        description: 'Self-serve espresso and coffee station',
        defaultWidth: 100,
        defaultHeight: 80,
        defaultColor: '#FEF3C7',
        borderStyle: 'solid',
        category: 'FURNITURE',
      });
      assert.ok(created.id, 'Created template should have an ID');
      assert.equal(created.name, 'Coffee Bar Island');

      // List should now have 2 templates sorted alphabetically
      const list2 = await service.listCustomStructureTemplates();
      assert.equal(list2.length, 2);
      assert.equal(list2[0].name, 'Coffee Bar Island');
      assert.equal(list2[1].name, 'Reception Counter');

      // Get by ID
      const fetched = await service.getCustomStructureTemplate(created.id);
      assert.ok(fetched);
      assert.equal(fetched?.name, 'Coffee Bar Island');

      // Update template
      const updated = await service.updateCustomStructureTemplate(created.id, {
        name: 'Premium Espresso Bar',
        defaultWidth: 120,
      });
      assert.equal(updated.name, 'Premium Espresso Bar');
      assert.equal(updated.defaultWidth, 120);

      // Delete template
      await service.deleteCustomStructureTemplate(created.id);
      const list3 = await service.listCustomStructureTemplates();
      assert.equal(list3.length, 1);
      assert.equal(list3[0].name, 'Reception Counter');
    });
  });

  describe('3. Map Builder Placement, Draft Persistence & Geometry', () => {
    it('saves a draft with custom structures alongside standard structures', async () => {
      const repo = new InMemoryMapRepository({
        floors: [floor1],
        customStructureTemplates: [sampleCustomTemplate],
      });
      const service = createMapService(repo);

      const customStructureElement: MapElementInput = {
        id: 'el-reception',
        elementRole: 'STRUCTURE',
        elementType: 'reception_counter',
        x: 140,
        y: 140,
        width: 140,
        height: 70,
        rotation: 0,
        zIndex: 1,
        label: 'Reception Counter',
        properties: {
          color: '#CBD5E1',
          borderStyle: 'solid',
          isCustomStructure: true,
          templateId: sampleCustomTemplate.id,
          category: 'FURNITURE',
        },
      };

      const wallElement: MapElementInput = {
        id: 'el-wall',
        elementRole: 'STRUCTURE',
        elementType: 'wall',
        x: 0,
        y: 0,
        width: 400,
        height: 20,
        rotation: 0,
        zIndex: 2,
        label: 'Perimeter Wall',
        properties: {
          color: '#334155',
        },
      };

      const saveResult = await service.saveDraft({
        floorId: floor1.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements: [customStructureElement, wallElement],
      });

      assert.equal(saveResult.elements.length, 2);

      const savedReception = saveResult.elements.find((el) => el.id === 'el-reception');
      assert.ok(savedReception);
      assert.equal(savedReception.elementRole, 'STRUCTURE');
      assert.equal(savedReception.label, 'Reception Counter');
      assert.equal(savedReception.width, 140);
      assert.equal(savedReception.height, 80); // snapped to grid (70 -> 80)
      assert.equal(savedReception.properties.isCustomStructure, true);
      assert.equal(savedReception.properties.templateId, sampleCustomTemplate.id);
    });

    it('loads draft and verifies custom structures remain intact', async () => {
      const repo = new InMemoryMapRepository({
        floors: [floor1],
      });
      const service = createMapService(repo);

      await service.saveDraft({
        floorId: floor1.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements: [
          {
            id: 'el-custom-1',
            elementRole: 'STRUCTURE',
            elementType: 'pillar',
            x: 200,
            y: 200,
            width: 40,
            height: 40,
            rotation: 0,
            zIndex: 1,
            label: 'Support Pillar',
            properties: {
              color: '#94A3B8',
              isCustomStructure: true,
              borderStyle: 'solid',
              category: 'ARCHITECTURAL',
            },
          },
        ],
      });

      const draft = await service.loadDraft(floor1.id);
      assert.ok(draft);
      assert.equal(draft?.elements.length, 1);
      assert.equal(draft?.elements[0].label, 'Support Pillar');
      assert.equal(draft?.elements[0].properties.color, '#94A3B8');
    });
  });

  describe('4. Map Publishing & Multi-Audience Consistency', () => {
    it('publishes draft map containing custom structures and verifies published map elements', async () => {
      const repo = new InMemoryMapRepository({
        floors: [floor1],
      });
      const service = createMapService(repo);

      await service.saveDraft({
        floorId: floor1.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements: [
          {
            id: 'el-concierge',
            elementRole: 'STRUCTURE',
            elementType: 'concierge_desk',
            x: 300,
            y: 300,
            width: 120,
            height: 60,
            rotation: 90,
            zIndex: 1,
            label: 'Concierge Desk',
            properties: {
              color: '#E2E8F0',
              borderStyle: 'dashed',
              isCustomStructure: true,
              category: 'FURNITURE',
            },
          },
        ],
      });

      const pubResult = await service.publishDraft({ floorId: floor1.id });
      assert.ok(pubResult.published);
      assert.equal(pubResult.published.elements.length, 1);

      const publishedElem = pubResult.published.elements[0];
      assert.equal(publishedElem.label, 'Concierge Desk');
      assert.equal(publishedElem.elementRole, 'STRUCTURE');
      assert.equal(publishedElem.properties.color, '#E2E8F0');
      assert.equal(publishedElem.properties.isCustomStructure, true);
    });

    it('renders custom structures for customer and kiosk viewers as non-bookable architectural elements', async () => {
      const pubRepo = new InMemoryPublishedMapRepository();

      const publishedFloorMap: PublishedFloorMap = {
        floor: floor1,
        version: {
          id: 'ver-pub-1',
          floorId: floor1.id,
          versionNumber: 1,
          canvasWidth: 1600,
          canvasHeight: 1000,
          gridSize: 20,
          publishedAt: '2026-09-18T00:00:00.000Z',
        },
        elements: [
          {
            id: 'elem-reception',
            elementRole: 'STRUCTURE',
            elementType: 'reception_counter',
            x: 140,
            y: 140,
            width: 140,
            height: 80,
            rotation: 0,
            zIndex: 1,
            label: 'Reception Counter',
            properties: null,
            style: {
              color: '#CBD5E1',
              borderStyle: 'solid',
              isCustomStructure: true,
            },
            workspace: null,
          },
        ],
      };

      pubRepo.seedPublishedFloorMap(publishedFloorMap);
      const pubService = createPublishedMapService(pubRepo);

      // Customer map view
      const customerMap = await pubService.loadPublishedFloorMap(floor1.id, { audience: 'CUSTOMER' });
      assert.ok(customerMap);
      assert.equal(customerMap?.elements.length, 1);
      assert.equal(customerMap?.elements[0].label, 'Reception Counter');
      assert.equal(customerMap?.elements[0].workspace, null, 'Custom structures must be non-bookable');

      // Kiosk map view
      const kioskMap = await pubService.loadPublishedFloorMap(floor1.id, { audience: 'KIOSK' });
      assert.ok(kioskMap);
      assert.equal(kioskMap?.elements.length, 1);
      assert.equal(kioskMap?.elements[0].label, 'Reception Counter');
      assert.equal(kioskMap?.elements[0].workspace, null, 'Custom structures must be non-bookable on kiosk');
    });
  });

  describe('5. Undo/Redo with Custom Structure Elements', () => {
    it('supports undoing and redoing custom structure element addition', () => {
      const undoManager = new MapUndoRedoManager(50);
      const initialObjects: any[] = [];

      const customObj = {
        id: 'cstr-1',
        name: 'Acoustic Phone Booth Shell',
        x: 140,
        y: 140,
        w: 120,
        h: 100,
        rotation: 0,
        bookable: false,
        elementRole: 'STRUCTURE',
        elementType: 'phone_booth_shell',
        color: '#E0F2FE',
        borderStyle: 'solid',
      };

      undoManager.push(floor1.id, {
        type: 'ADD_OBJECT',
        object: customObj,
      });

      assert.equal(undoManager.canUndo(floor1.id), true);
      assert.equal(undoManager.canRedo(floor1.id), false);

      // Undo addition
      const undoRes = undoManager.undo(floor1.id, [customObj]);
      assert.equal(undoRes.updatedObjects.length, 0);
      assert.equal(undoRes.canUndo, false);
      assert.equal(undoRes.canRedo, true);

      // Redo addition
      const redoRes = undoManager.redo(floor1.id, undoRes.updatedObjects);
      assert.equal(redoRes.updatedObjects.length, 1);
      assert.equal(redoRes.updatedObjects[0].name, 'Acoustic Phone Booth Shell');
      assert.equal(redoRes.canUndo, true);
    });
  });
});
