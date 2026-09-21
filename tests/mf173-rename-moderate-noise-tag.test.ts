import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_AMENITY_CATEGORIES,
  ALL_WORKSPACE_RECOMMENDATION_TAGS,
  getAmenityCategoryForTag,
  groupTagsByCategory,
  normalizeAmenityTag,
  mapPublishedElement,
  mapInstanceToAdminSpace,
  createWorkspaceService,
  InMemoryWorkspaceRepository,
} from '@deskatlas/domain';

describe('MF-173: Rename Workspace Tag "Moderate" to "Moderate Noise"', () => {
  describe('1. Taxonomy Definition & Standard Tag List', () => {
    it('contains "Moderate Noise" in the Noise & Activity category', () => {
      const noiseCategory = WORKSPACE_AMENITY_CATEGORIES.find((cat) => cat.id === 'noise_activity');
      expect(noiseCategory).toBeDefined();
      expect(noiseCategory?.name).toBe('Noise & Activity');
      expect(noiseCategory?.tags).toContain('Moderate Noise');
      expect(noiseCategory?.tags).toEqual(['Quiet', 'Moderate Noise', 'Busy', 'Crowded', 'Low Traffic', 'High Traffic']);
    });

    it('does not contain bare "Moderate" tag in any category', () => {
      for (const category of WORKSPACE_AMENITY_CATEGORIES) {
        expect(category.tags).not.toContain('Moderate');
      }
      expect(ALL_WORKSPACE_RECOMMENDATION_TAGS).not.toContain('Moderate');
      expect(ALL_WORKSPACE_RECOMMENDATION_TAGS).toContain('Moderate Noise');
    });

    it('preserves all other standard categories and tags intact', () => {
      expect(WORKSPACE_AMENITY_CATEGORIES).toHaveLength(5);
      expect(ALL_WORKSPACE_RECOMMENDATION_TAGS).toHaveLength(27);

      const [environment, noise, lighting, space, deskFeatures] = WORKSPACE_AMENITY_CATEGORIES;
      expect(environment.tags).toEqual(['Cool', 'Warm', 'Hot', 'Cold', 'Sun-Exposed', 'Shaded']);
      expect(noise.tags).toEqual(['Quiet', 'Moderate Noise', 'Busy', 'Crowded', 'Low Traffic', 'High Traffic']);
      expect(lighting.tags).toEqual(['Bright', 'Dim', 'Natural Light', 'Good View', 'Near Window']);
      expect(space.tags).toEqual(['Spacious', 'Private', 'Open', 'Collaborative']);
      expect(deskFeatures.tags).toEqual(['Wi-Fi', 'Power Outlet', 'Ergonomic', 'Adjustable', 'Standing Desk', 'Monitor Available']);
    });
  });

  describe('2. Normalization & Category Resolution', () => {
    it('normalizes "Moderate" (case-insensitive) to "Moderate Noise"', () => {
      expect(normalizeAmenityTag('Moderate')).toBe('Moderate Noise');
      expect(normalizeAmenityTag('moderate')).toBe('Moderate Noise');
      expect(normalizeAmenityTag(' MODERATE ')).toBe('Moderate Noise');
      expect(normalizeAmenityTag('Moderate Noise')).toBe('Moderate Noise');
      expect(normalizeAmenityTag('Quiet')).toBe('Quiet');
    });

    it('resolves category for "Moderate Noise" as Noise & Activity', () => {
      const category = getAmenityCategoryForTag('Moderate Noise');
      expect(category).toBeDefined();
      expect(category?.id).toBe('noise_activity');
      expect(category?.name).toBe('Noise & Activity');
    });

    it('resolves category for legacy "Moderate" tag as Noise & Activity', () => {
      const category = getAmenityCategoryForTag('Moderate');
      expect(category).toBeDefined();
      expect(category?.id).toBe('noise_activity');
      expect(category?.name).toBe('Noise & Activity');
    });

    it('groups tags containing "Moderate" into Noise & Activity with "Moderate Noise"', () => {
      const selected = ['Moderate', 'Near Window', 'Wi-Fi'];
      const grouped = groupTagsByCategory(selected);

      expect(grouped).toHaveLength(3);
      const noiseGroup = grouped.find((g) => g.category.id === 'noise_activity');
      expect(noiseGroup).toBeDefined();
      expect(noiseGroup?.tags).toEqual(['Moderate Noise']);
      expect(noiseGroup?.tags).not.toContain('Moderate');
    });
  });

  describe('3. Published Map Element Tag Adapter', () => {
    it('transforms legacy "Moderate" tag in properties to "Moderate Noise" on mapped published element', () => {
      const floor = {
        id: 'floor-1',
        name: 'Main Floor',
        floor_number: 1,
        display_order: 0,
        is_active: true,
      };

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
        default_style: {},
        is_active: true,
      };

      const elementWithLegacyTag = {
        id: 'el-1',
        element_role: 'WORKSPACE' as const,
        element_type: 'desk',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0 as const,
        z_index: 1,
        label: 'Desk A1',
        properties: {
          color: '#009689',
          recommendationTags: ['Near Window', 'Moderate', 'Natural Light'],
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

      const mapped = mapPublishedElement(elementWithLegacyTag as any, floor as any);
      expect(mapped.workspace?.tags).toEqual(['Near Window', 'Moderate Noise', 'Natural Light']);
      expect(mapped.workspace?.tags).not.toContain('Moderate');
    });
  });

  describe('4. Workspace Service Tag Extraction', () => {
    it('normalizes legacy "Moderate" in template defaultStyle when mapping to admin spaces', async () => {
      const repo = new InMemoryWorkspaceRepository();
      const floor = await repo.createFloor({
        name: 'Floor 1',
        floorNumber: 1,
        displayOrder: 1,
      });

      const template = await repo.createTemplate({
        name: 'Quiet Pod',
        capacity: 1,
        rateAmount: 100,
        pricingUnit: 'HOURLY',
        defaultShape: 'pod',
        defaultColor: '#10b981',
        defaultStyle: {
          recommendationTags: ['Moderate', 'Quiet'],
        },
      });

      const instance = await repo.createInstance({
        templateId: template.id,
        floorId: floor.id,
        displayName: 'Pod 1',
        operationalStatus: 'ACTIVE',
      });

      const catalog = await repo.listCatalog();
      const instanceDetails = catalog.instances.find((i) => i.id === instance.id);
      expect(instanceDetails).toBeDefined();

      const adminSpace = mapInstanceToAdminSpace(instanceDetails!);
      expect(adminSpace.recommendations).toEqual(['Moderate Noise', 'Quiet']);
      expect(adminSpace.recommendations).not.toContain('Moderate');
    });
  });
});
