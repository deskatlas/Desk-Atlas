import { describe, it, expect } from 'vitest';
import {
  SupabasePublishedMapRepository,
  createPublishedMapService,
  type Floor,
  type PublishedFloorMap,
} from '@deskatlas/domain';

/**
 * MS-06 / QAD-TC6.7: Pre-Compiled Map Cache Parity & Fallback
 *
 * Verifies that loading from map_versions.compiled_map_cache produces 100%
 * data contract parity with legacy dynamic query mapping, handles audience filtering,
 * and falls back gracefully when compiled_map_cache is null.
 */
describe('MS-06 / QAD-TC6.7: Pre-Compiled Map Cache Parity', () => {
  const mockFloor: Floor = {
    id: 'fl-1',
    name: 'Ground Floor',
    floorNumber: 1,
    displayOrder: 1,
    isActive: true,
  };

  const mockCompiledMap: PublishedFloorMap = {
    floor: mockFloor,
    version: {
      id: 'v-published-1',
      versionNumber: 1,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      publishedAt: '2026-09-23T12:00:00.000Z',
    },
    elements: [
      {
        id: 'elem-active',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 1,
        label: 'Desk 1',
        style: { color: '#009689' },
        workspace: {
          workspaceInstanceId: 'inst-active',
          templateId: 'tpl-1',
          floorId: 'fl-1',
          instanceCode: 'D-01',
          displayName: 'Desk 1',
          templateName: 'Standard Desk',
          description: 'A comfortable work station',
          photoPath: '/photos/desk.jpg',
          photoPosition: { x: 10, y: 10 },
          capacity: 1,
          rateAmount: 120,
          pricingUnit: 'HOURLY',
          operationalStatus: 'ACTIVE',
          maintenanceNote: null,
          isBookable: true,
          blockingReason: null,
          tags: ['quiet', 'window'],
        },
      },
      {
        id: 'elem-inactive',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        x: 200,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 2,
        label: 'Desk 2',
        style: { color: '#94A3B8' },
        workspace: {
          workspaceInstanceId: 'inst-inactive',
          templateId: 'tpl-1',
          floorId: 'fl-1',
          instanceCode: 'D-02',
          displayName: 'Desk 2',
          templateName: 'Standard Desk',
          description: 'Under maintenance',
          photoPath: '/photos/desk.jpg',
          capacity: 1,
          rateAmount: 120,
          pricingUnit: 'HOURLY',
          operationalStatus: 'INACTIVE',
          maintenanceNote: 'Hardware upgrade in progress',
          isBookable: false,
          blockingReason: 'OPERATIONAL_STATUS_BLOCKED',
          tags: ['quiet'],
        },
      },
    ],
  };

  it('QAD-TC6.7.1: loads directly from compiled_map_cache in a single point lookup', async () => {
    const requestedUrls: string[] = [];

    // Subclass repository to inspect network calls and mock PostgREST response
    class TestRepo extends SupabasePublishedMapRepository {
      constructor() {
        super({
          supabaseUrl: 'https://mock.supabase.co',
          serviceRoleKey: 'mock-key',
        });
      }

      // @ts-expect-error protected override for unit testing
      protected override async request<T>(path: string): Promise<T> {
        requestedUrls.push(path);
        if (path.includes('select=compiled_map_cache')) {
          return [{ compiled_map_cache: mockCompiledMap }] as unknown as T;
        }
        return [] as unknown as T;
      }
    }

    const repo = new TestRepo();
    const service = createPublishedMapService(repo);

    const map = await service.loadPublishedFloorMap('fl-1', { audience: 'ADMIN' });

    expect(map).toBeDefined();
    expect(map.floor.id).toBe('fl-1');
    expect(map.version.id).toBe('v-published-1');
    expect(map.elements).toHaveLength(2);

    // Verified: exactly 1 request to map_versions with select=compiled_map_cache
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain('/map_versions?select=compiled_map_cache');
    expect(requestedUrls[0]).toContain('floor_id=eq.fl-1');
  });

  it('QAD-TC6.7.2: applies audience filtering (CUSTOMER excludes INACTIVE, ADMIN retains INACTIVE)', async () => {
    class TestRepo extends SupabasePublishedMapRepository {
      constructor() {
        super({
          supabaseUrl: 'https://mock.supabase.co',
          serviceRoleKey: 'mock-key',
        });
      }

      // @ts-expect-error protected override for unit testing
      protected override async request<T>(path: string): Promise<T> {
        if (path.includes('select=compiled_map_cache')) {
          return [{ compiled_map_cache: mockCompiledMap }] as unknown as T;
        }
        return [] as unknown as T;
      }
    }

    const repo = new TestRepo();

    // CUSTOMER audience
    const customerMap = await repo.loadPublishedFloorMap('fl-1', { audience: 'CUSTOMER' });
    expect(customerMap?.elements).toHaveLength(1);
    expect(customerMap?.elements[0].id).toBe('elem-active');

    // KIOSK audience
    const kioskMap = await repo.loadPublishedFloorMap('fl-1', { audience: 'KIOSK' });
    expect(kioskMap?.elements).toHaveLength(1);
    expect(kioskMap?.elements[0].id).toBe('elem-active');

    // STAFF audience
    const staffMap = await repo.loadPublishedFloorMap('fl-1', { audience: 'STAFF' });
    expect(staffMap?.elements).toHaveLength(2);

    // ADMIN audience
    const adminMap = await repo.loadPublishedFloorMap('fl-1', { audience: 'ADMIN' });
    expect(adminMap?.elements).toHaveLength(2);
  });

  it('QAD-TC6.7.3: falls back gracefully to relational joins when compiled_map_cache is null', async () => {
    const requestedUrls: string[] = [];

    class TestFallbackRepo extends SupabasePublishedMapRepository {
      constructor() {
        super({
          supabaseUrl: 'https://mock.supabase.co',
          serviceRoleKey: 'mock-key',
        });
      }

      // @ts-expect-error protected override for unit testing
      protected override async request<T>(path: string): Promise<T> {
        requestedUrls.push(path);
        if (path.includes('select=compiled_map_cache')) {
          // Legacy row with null compiled_map_cache
          return [{ compiled_map_cache: null }] as unknown as T;
        }
        if (path.includes('/floors?select=*')) {
          return [
            {
              id: 'fl-1',
              name: 'Ground Floor',
              floor_number: 1,
              display_order: 1,
              is_active: true,
            },
          ] as unknown as T;
        }
        if (path.includes('/map_versions?select=id,floor_id')) {
          return [
            {
              id: 'v-legacy',
              floor_id: 'fl-1',
              version_number: 1,
              canvas_width: 1600,
              canvas_height: 1000,
              grid_size: 20,
              published_at: '2026-09-23T10:00:00Z',
            },
          ] as unknown as T;
        }
        if (path.includes('/map_elements?select=')) {
          return [
            {
              id: 'elem-1',
              element_role: 'STRUCTURE',
              element_type: 'wall',
              x: 0,
              y: 0,
              width: 100,
              height: 20,
              rotation: 0,
              z_index: 1,
              label: 'Wall 1',
              properties: {},
              workspace_instance: null,
            },
          ] as unknown as T;
        }
        return [] as unknown as T;
      }
    }

    const repo = new TestFallbackRepo();
    const map = await repo.loadPublishedFloorMap('fl-1', { audience: 'CUSTOMER' });

    expect(map).toBeDefined();
    expect(map?.version.id).toBe('v-legacy');
    expect(map?.elements).toHaveLength(1);
    // Verified fallback executed subsequent relational queries
    expect(requestedUrls.some((u) => u.includes('/floors?select=*'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/map_elements?select='))).toBe(true);
  });

  it('QAD-TC6.7.4: loadAllPublishedFloorMaps consolidates all published floors in a single query', async () => {
    class TestRepo extends SupabasePublishedMapRepository {
      constructor() {
        super({
          supabaseUrl: 'https://mock.supabase.co',
          serviceRoleKey: 'mock-key',
        });
      }

      // @ts-expect-error protected override for unit testing
      protected override async request<T>(path: string): Promise<T> {
        if (path.includes('/map_versions?select=compiled_map_cache')) {
          return [
            { compiled_map_cache: mockCompiledMap, floor_id: 'fl-1' },
          ] as unknown as T;
        }
        return [] as unknown as T;
      }
    }

    const repo = new TestRepo();
    const allMaps = await repo.loadAllPublishedFloorMaps({ audience: 'CUSTOMER' });

    expect(allMaps).toHaveLength(1);
    expect(allMaps[0].floor.id).toBe('fl-1');
    expect(allMaps[0].elements).toHaveLength(1); // Filtered INACTIVE for CUSTOMER
  });
});
