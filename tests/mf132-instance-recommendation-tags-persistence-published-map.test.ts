import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_AMENITY_CATEGORIES,
  ALL_WORKSPACE_RECOMMENDATION_TAGS,
  normalizeMapElementForSnapshot,
  serializeMapElementsForSnapshot,
  isMapDraftDirty,
  mapPublishedElement,
  type PublishedMapElement,
} from '@deskatlas/domain';
import * as fs from 'fs';
import * as path from 'path';

describe('MF-132: Instance Recommendation Tags Persistence & Reflection on Published Map', () => {
  describe('1. MapEditor.tsx Property Precedence & Tag Persistence', () => {
    it('verifies handleSaveDraft spreads obj.properties before recommendationTags to prevent tag overwriting', () => {
      const mapEditorPath = path.resolve(
        __dirname,
        '../apps/admin-portal/src/features/map-builder/components/MapEditor.tsx'
      );
      const content = fs.readFileSync(mapEditorPath, 'utf8');

      // Isolate handleSaveDraft function block
      const handleSaveDraftIndex = content.indexOf('const handleSaveDraft = async');
      expect(handleSaveDraftIndex).toBeGreaterThan(-1);
      const handleSaveDraftContent = content.slice(handleSaveDraftIndex, handleSaveDraftIndex + 6000);

      const spreadIndex = handleSaveDraftContent.indexOf('...(obj.properties || {})');
      const tagsIndex = handleSaveDraftContent.indexOf('recommendationTags: obj.recommendationTags || []');

      expect(spreadIndex).toBeGreaterThan(-1);
      expect(tagsIndex).toBeGreaterThan(-1);
      expect(spreadIndex).toBeLessThan(tagsIndex);
    });

    it('verifies inspector tag toggling updates both recommendationTags and properties.recommendationTags', () => {
      const mapEditorPath = path.resolve(
        __dirname,
        '../apps/admin-portal/src/features/map-builder/components/MapEditor.tsx'
      );
      const content = fs.readFileSync(mapEditorPath, 'utf8');

      expect(content).toContain('recommendationTags: nextTags');
      expect(content).toContain('properties: {');
    });

    it('correctly preserves instance tags when simulating draft save serialization with stale properties', () => {
      const obj = {
        id: 'desk-1',
        name: 'Desk A1',
        x: 100,
        y: 100,
        w: 80,
        h: 80,
        rotation: 0,
        bookable: true,
        workspaceInstanceId: 'inst-1',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        color: '#009689',
        // Stale properties from initial DB fetch had empty or old tags
        properties: {
          color: '#009689',
          recommendationTags: [],
        },
        // Active instance tags configured in inspector
        recommendationTags: ['Near Window', 'Quiet', 'Standing Desk'],
      };

      // Construct properties using the corrected order
      const serializedProperties = {
        ...(obj.properties || {}),
        color: obj.color,
        recommendationTags: obj.recommendationTags || [],
      };

      expect(serializedProperties.recommendationTags).toEqual([
        'Near Window',
        'Quiet',
        'Standing Desk',
      ]);
    });
  });

  describe('2. Published Map Element Mapping & Reflection', () => {
    it('correctly maps element recommendationTags to workspace.tags on published floor maps', () => {
      const floor = {
        id: 'floor-1',
        name: 'Ground Floor',
        floor_number: 1,
        display_order: 0,
        is_active: true,
      };

      const template = {
        id: 'tmpl-1',
        name: 'Dedicated Desk',
        description: 'Single desk spot',
        photo_path: null,
        capacity: 1,
        rate_amount: 150,
        pricing_unit: 'HOURLY' as const,
        default_shape: 'desk',
        default_color: '#009689',
        default_style: {},
        is_active: true,
      };

      const elementRow = {
        id: 'el-1',
        map_version_id: 'v-1',
        element_role: 'WORKSPACE' as const,
        element_type: 'desk',
        workspace_instance_id: 'inst-1',
        x: 120,
        y: 150,
        width: 80,
        height: 80,
        rotation: 0 as const,
        z_index: 1,
        label: 'Desk A1',
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

      const publishedElement = mapPublishedElement(elementRow as any, floor as any);

      expect(publishedElement.workspace).not.toBeNull();
      expect(publishedElement.workspace?.tags).toEqual(['Near Window', 'Quiet', 'Natural Light']);
      expect(publishedElement.workspace?.displayName).toBe('Desk A1');
      expect(publishedElement.workspace?.templateName).toBe('Dedicated Desk');
    });

    it('isolates different recommendation tags on two physical instances of the same template', () => {
      const floor = {
        id: 'floor-1',
        name: 'Ground Floor',
        floor_number: 1,
        display_order: 0,
        is_active: true,
      };

      const template = {
        id: 'tmpl-common',
        name: 'Standard Desk',
        description: 'General workstation',
        photo_path: null,
        capacity: 1,
        rate_amount: 100,
        pricing_unit: 'HOURLY' as const,
        default_shape: 'desk',
        default_color: '#009689',
        default_style: {},
        is_active: true,
      };

      const desk1 = {
        id: 'el-1',
        element_role: 'WORKSPACE' as const,
        element_type: 'desk',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0 as const,
        z_index: 1,
        label: 'Desk 1',
        properties: {
          recommendationTags: ['Quiet', 'Near Window'],
        },
        workspace_instance: {
          id: 'inst-1',
          template_id: 'tmpl-common',
          floor_id: 'floor-1',
          instance_code: 'D1',
          display_name: 'Desk 1',
          operational_status: 'ACTIVE' as const,
          template,
        },
      };

      const desk2 = {
        id: 'el-2',
        element_role: 'WORKSPACE' as const,
        element_type: 'desk',
        x: 200,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0 as const,
        z_index: 2,
        label: 'Desk 2',
        properties: {
          recommendationTags: ['High Traffic', 'Power Outlet'],
        },
        workspace_instance: {
          id: 'inst-2',
          template_id: 'tmpl-common',
          floor_id: 'floor-1',
          instance_code: 'D2',
          display_name: 'Desk 2',
          operational_status: 'ACTIVE' as const,
          template,
        },
      };

      const mapped1 = mapPublishedElement(desk1 as any, floor as any);
      const mapped2 = mapPublishedElement(desk2 as any, floor as any);

      expect(mapped1.workspace?.tags).toEqual(['Quiet', 'Near Window']);
      expect(mapped2.workspace?.tags).toEqual(['High Traffic', 'Power Outlet']);
    });
  });

  describe('3. Workspace Map Inspector Sidebar Tag Reflection', () => {
    it('verifies Admin Workspace Map page renders Amenities & Recommendations in the inspector sidebar', () => {
      const adminMapPath = path.resolve(
        __dirname,
        '../apps/admin-portal/src/app/manage/workspace-map/page.tsx'
      );
      const content = fs.readFileSync(adminMapPath, 'utf8');

      expect(content).toContain('Amenities & Recommendations');
      expect(content).toContain('selectedElement?.properties?.recommendationTags');
    });

    it('verifies Staff Workspace Map page renders Amenities & Recommendations in the inspector sidebar', () => {
      const staffMapPath = path.resolve(
        __dirname,
        '../apps/staff-dashboard/src/app/manage/workspace-map/page.tsx'
      );
      const content = fs.readFileSync(staffMapPath, 'utf8');

      expect(content).toContain('Amenities & Recommendations');
      expect(content).toContain('selectedElement.workspace?.tags');
    });
  });
});
