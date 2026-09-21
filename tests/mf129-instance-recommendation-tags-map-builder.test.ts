import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_AMENITY_CATEGORIES,
  ALL_WORKSPACE_RECOMMENDATION_TAGS,
  getAmenityCategoryForTag,
  groupTagsByCategory,
  normalizeMapElementForSnapshot,
  serializeMapElementsForSnapshot,
  isMapDraftDirty,
  MapUndoRedoManager,
  SupabasePublishedMapRepository,
  mapPublishedElement,
  createMapService,
  InMemoryMapRepository,
  type MapElement,
  type Floor,
} from '@deskatlas/domain';
import * as fs from 'fs';
import * as path from 'path';

describe('MF-129: Instance-Level Recommendation Tags in Map Builder (Airbnb-Style Amenities)', () => {
  describe('1. Airbnb-Style Categorized Amenities Taxonomy', () => {
    it('defines exactly 5 standardized categories with correct IDs and subtitles', () => {
      expect(WORKSPACE_AMENITY_CATEGORIES).toHaveLength(5);

      const [environment, noise, lighting, space, deskFeatures] = WORKSPACE_AMENITY_CATEGORIES;

      expect(environment.name).toBe('Environment');
      expect(environment.description).toBe(
        'Conditions may vary depending on the time of day, weather, and workspace activity.'
      );
      expect(environment.tags).toEqual(['Cool', 'Warm', 'Hot', 'Cold', 'Sun-Exposed', 'Shaded']);

      expect(noise.name).toBe('Noise & Activity');
      expect(noise.description).toBe('May change depending on the time and number of people present.');
      expect(noise.tags).toEqual(['Quiet', 'Moderate Noise', 'Busy', 'Crowded', 'Low Traffic', 'High Traffic']);

      expect(lighting.name).toBe('Lighting & View');
      expect(lighting.description).toBe(
        'May change depending on the time of day and surrounding conditions.'
      );
      expect(lighting.tags).toEqual(['Bright', 'Dim', 'Natural Light', 'Good View', 'Near Window']);

      expect(space.name).toBe('Space & Privacy');
      expect(space.description).toBe('May vary depending on nearby users and workspace activity.');
      expect(space.tags).toEqual(['Spacious', 'Private', 'Open', 'Collaborative']);

      expect(deskFeatures.name).toBe('Desk Features');
      expect(deskFeatures.description).toBe('May vary depending on the assigned desk and workspace setup.');
      expect(deskFeatures.tags).toEqual([
        'Wi-Fi',
        'Power Outlet',
        'Ergonomic',
        'Adjustable',
        'Standing Desk',
        'Monitor Available',
      ]);
    });

    it('contains all 27 standardized tags across the 5 categories', () => {
      expect(ALL_WORKSPACE_RECOMMENDATION_TAGS).toHaveLength(27);
      expect(ALL_WORKSPACE_RECOMMENDATION_TAGS).toContain('Near Window');
      expect(ALL_WORKSPACE_RECOMMENDATION_TAGS).toContain('Quiet');
      expect(ALL_WORKSPACE_RECOMMENDATION_TAGS).toContain('Sun-Exposed');
      expect(ALL_WORKSPACE_RECOMMENDATION_TAGS).toContain('Standing Desk');
      expect(ALL_WORKSPACE_RECOMMENDATION_TAGS).toContain('Private');
    });

    it('finds category for a given tag correctly', () => {
      expect(getAmenityCategoryForTag('Near Window')?.name).toBe('Lighting & View');
      expect(getAmenityCategoryForTag('quiet')?.name).toBe('Noise & Activity');
      expect(getAmenityCategoryForTag('Cool')?.name).toBe('Environment');
      expect(getAmenityCategoryForTag('Standing Desk')?.name).toBe('Desk Features');
      expect(getAmenityCategoryForTag('Collaborative')?.name).toBe('Space & Privacy');
      expect(getAmenityCategoryForTag('NonexistentTag')).toBeUndefined();
    });

    it('groups an arbitrary list of tags by category', () => {
      const selected = ['Quiet', 'Near Window', 'Wi-Fi', 'Cool', 'Ergonomic'];
      const grouped = groupTagsByCategory(selected);

      expect(grouped).toHaveLength(4);
      expect(grouped.find((g) => g.category.name === 'Environment')?.tags).toEqual(['Cool']);
      expect(grouped.find((g) => g.category.name === 'Noise & Activity')?.tags).toEqual(['Quiet']);
      expect(grouped.find((g) => g.category.name === 'Lighting & View')?.tags).toEqual(['Near Window']);
      expect(grouped.find((g) => g.category.name === 'Desk Features')?.tags).toEqual(['Wi-Fi', 'Ergonomic']);
    });
  });

  describe('2. Template Form Audit (WorkspaceList.tsx)', () => {
    it('verifies recommendation tags picker is removed from workspace template form', () => {
      const workspaceListPath = path.resolve(
        __dirname,
        '../apps/admin-portal/src/features/workspaces/components/WorkspaceList.tsx'
      );
      const content = fs.readFileSync(workspaceListPath, 'utf8');

      expect(content).not.toContain("const availableTags = [");
      expect(content).not.toContain("toggleRecommendation");
      expect(content).not.toContain("<label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '10px' }}>Recommendation Tags</label>");
    });
  });

  describe('3. Map Builder Inspector & Autosave Dirty Tracking', () => {
    it('serializes recommendationTags and detects dirty state when tags change', () => {
      const initialElements = [
        {
          id: 'desk-1',
          name: 'Desk A1',
          x: 100,
          y: 100,
          w: 80,
          h: 80,
          rotation: 0,
          bookable: true,
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          color: '#009689',
          recommendationTags: ['Near Window', 'Quiet'],
        },
      ];

      const snapshot = serializeMapElementsForSnapshot(initialElements);
      expect(isMapDraftDirty(snapshot, initialElements)).toBe(false);

      const modifiedElements = [
        {
          ...initialElements[0],
          recommendationTags: ['Near Window', 'Quiet', 'Standing Desk'],
        },
      ];

      expect(isMapDraftDirty(snapshot, modifiedElements)).toBe(true);
    });

    it('handles undo/redo of recommendationTags updates', () => {
      const undoManager = new MapUndoRedoManager();
      const floorId = 'floor-1';

      let objects = [
        {
          id: 'desk-1',
          name: 'Desk A1',
          x: 100,
          y: 100,
          w: 80,
          h: 80,
          rotation: 0,
          bookable: true,
          template: 'Solo Desk',
          status: 'ACTIVE',
          workspaceInstanceId: 'inst-1',
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          color: '#009689',
          recommendationTags: ['Near Window'],
        },
      ];

      // User adds 'Quiet' tag
      const updatedTags = ['Near Window', 'Quiet'];
      undoManager.push(floorId, {
        type: 'UPDATE_PROPERTIES',
        id: 'desk-1',
        before: { recommendationTags: ['Near Window'] },
        after: { recommendationTags: updatedTags },
      });
      objects = objects.map((o) => (o.id === 'desk-1' ? { ...o, recommendationTags: updatedTags } : o));

      expect(objects[0].recommendationTags).toEqual(['Near Window', 'Quiet']);
      expect(undoManager.canUndo(floorId)).toBe(true);

      // Undo
      const undoResult = undoManager.undo(floorId, objects);
      objects = undoResult.updatedObjects;
      expect(objects[0].recommendationTags).toEqual(['Near Window']);
      expect(undoManager.canRedo(floorId)).toBe(true);

      // Redo
      const redoResult = undoManager.redo(floorId, objects);
      objects = redoResult.updatedObjects;
      expect(objects[0].recommendationTags).toEqual(['Near Window', 'Quiet']);
    });
  });

  describe('4. Instance-Level Recommendation Tags Isolation on Published Maps', () => {
    it('allows different desks from the same template to possess completely distinct recommendation tags', () => {
      // Desk 1 and Desk 2 are instantiated from the exact same "Dedicated Desk" template
      const template = {
        id: 'tmpl-1',
        name: 'Dedicated Desk',
        description: 'Standard ergonomic desk',
        photo_path: null,
        capacity: 1,
        rate_amount: 150,
        pricing_unit: 'HOURLY' as const,
        default_shape: 'desk',
        default_color: '#009689',
        default_style: {}, // Template has NO tags
        is_active: true,
      };

      const floor = {
        id: 'floor-1',
        name: 'Ground Floor',
        floor_number: 1,
        display_order: 0,
        is_active: true,
      };

      const desk1Element = {
        id: 'el-1',
        element_role: 'WORKSPACE' as const,
        element_type: 'desk',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0 as const,
        z_index: 1,
        label: 'Desk A1 (Window Corner)',
        properties: {
          color: '#009689',
          recommendationTags: ['Near Window', 'Quiet', 'Natural Light'],
        },
        workspace_instance: {
          id: 'inst-1',
          template_id: 'tmpl-1',
          floor_id: 'floor-1',
          instance_code: 'A1',
          display_name: 'Desk A1',
          operational_status: 'ACTIVE' as const,
          template,
        },
      };

      const desk2Element = {
        id: 'el-2',
        element_role: 'WORKSPACE' as const,
        element_type: 'desk',
        x: 200,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0 as const,
        z_index: 2,
        label: 'Desk A2 (Center Isle)',
        properties: {
          color: '#009689',
          recommendationTags: ['High Traffic', 'Power Outlet', 'Monitor Available'],
        },
        workspace_instance: {
          id: 'inst-2',
          template_id: 'tmpl-1',
          floor_id: 'floor-1',
          instance_code: 'A2',
          display_name: 'Desk A2',
          operational_status: 'ACTIVE' as const,
          template,
        },
      };

      const mappedEl1 = mapPublishedElement(desk1Element as any, floor as any);
      const mappedEl2 = mapPublishedElement(desk2Element as any, floor as any);

      expect(mappedEl1.workspace?.tags).toEqual(['Near Window', 'Quiet', 'Natural Light']);
      expect(mappedEl2.workspace?.tags).toEqual(['High Traffic', 'Power Outlet', 'Monitor Available']);
      expect(mappedEl1.workspace?.templateName).toBe('Dedicated Desk');
      expect(mappedEl2.workspace?.templateName).toBe('Dedicated Desk');
    });
  });

  describe('5. MapEditor Inspector UI Structure Verification', () => {
    it('verifies MapEditor.tsx renders categorized amenity controls and saves recommendationTags', () => {
      const mapEditorPath = path.resolve(
        __dirname,
        '../apps/admin-portal/src/features/map-builder/components/MapEditor.tsx'
      );
      const content = fs.readFileSync(mapEditorPath, 'utf8');

      expect(content).toContain('WORKSPACE_AMENITY_CATEGORIES');
      expect(content).toContain('Workspace Amenities & Recommendations');
      expect(content).toContain('recommendationTags: obj.recommendationTags || []');
      expect(content).toContain('cat.tags.map((tag)');
    });
  });
});
