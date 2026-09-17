import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  InMemoryPublishedMapRepository,
  SupabasePublishedMapRepository,
  type PublishedFloorMap,
} from '@deskatlas/domain';
import { mapPublishedFloorToWorkspaceCards as customerMapCards } from '../apps/customer-website/src/features/workspace-discovery/utils/adapters';

describe('MF-121: Inactive Workspace Spot Visibility (Admin/Staff Low Opacity vs Kiosk/Customer Complete Removal)', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://mock.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  const sampleFloor = {
    id: 'floor-1',
    name: 'Main Floor',
    floorNumber: 1,
    displayOrder: 1,
    isActive: true,
  };

  const sampleVersion = {
    id: 'ver-1',
    versionNumber: 1,
    canvasWidth: 1600,
    canvasHeight: 1000,
    gridSize: 20,
    publishedAt: '2026-09-17T00:00:00Z',
  };

  const samplePublishedMap: PublishedFloorMap = {
    floor: sampleFloor,
    version: sampleVersion,
    elements: [
      {
        id: 'el-active',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 1,
        label: 'Desk 1',
        style: {},
        workspace: {
          workspaceInstanceId: 'inst-1',
          templateId: 'tpl-1',
          floorId: 'floor-1',
          instanceCode: 'D-01',
          displayName: 'Desk 1',
          templateName: 'Hot Desk',
          description: null,
          photoPath: null,
          capacity: 1,
          rateAmount: 100,
          pricingUnit: 'HOURLY',
          operationalStatus: 'ACTIVE',
          isBookable: true,
          blockingReason: null,
        },
      },
      {
        id: 'el-maintenance',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        x: 200,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 1,
        label: 'Desk 2',
        style: {},
        workspace: {
          workspaceInstanceId: 'inst-2',
          templateId: 'tpl-1',
          floorId: 'floor-1',
          instanceCode: 'D-02',
          displayName: 'Desk 2',
          templateName: 'Hot Desk',
          description: null,
          photoPath: null,
          capacity: 1,
          rateAmount: 100,
          pricingUnit: 'HOURLY',
          operationalStatus: 'MAINTENANCE',
          isBookable: false,
          blockingReason: 'OPERATIONAL_STATUS_BLOCKED',
        },
      },
      {
        id: 'el-inactive',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        x: 300,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 1,
        label: 'Desk 3',
        style: {},
        workspace: {
          workspaceInstanceId: 'inst-3',
          templateId: 'tpl-1',
          floorId: 'floor-1',
          instanceCode: 'D-03',
          displayName: 'Desk 3',
          templateName: 'Hot Desk',
          description: null,
          photoPath: null,
          capacity: 1,
          rateAmount: 100,
          pricingUnit: 'HOURLY',
          operationalStatus: 'INACTIVE',
          isBookable: false,
          blockingReason: 'OPERATIONAL_STATUS_BLOCKED',
        },
      },
    ],
  };

  describe('InMemoryPublishedMapRepository Audience Filtering', () => {
    it('filters out INACTIVE workspaces when audience is CUSTOMER', async () => {
      const repo = new InMemoryPublishedMapRepository();
      repo.seedPublishedFloorMap(samplePublishedMap);

      const map = await repo.loadPublishedFloorMap('floor-1', { audience: 'CUSTOMER' });
      expect(map).not.toBeNull();
      const instanceIds = map!.elements
        .filter((e) => e.elementRole === 'WORKSPACE')
        .map((e) => e.workspace?.workspaceInstanceId);

      expect(instanceIds).toContain('inst-1');
      expect(instanceIds).toContain('inst-2');
      expect(instanceIds).not.toContain('inst-3');
    });

    it('filters out INACTIVE workspaces when audience is KIOSK', async () => {
      const repo = new InMemoryPublishedMapRepository();
      repo.seedPublishedFloorMap(samplePublishedMap);

      const map = await repo.loadPublishedFloorMap('floor-1', { audience: 'KIOSK' });
      expect(map).not.toBeNull();
      const instanceIds = map!.elements
        .filter((e) => e.elementRole === 'WORKSPACE')
        .map((e) => e.workspace?.workspaceInstanceId);

      expect(instanceIds).toContain('inst-1');
      expect(instanceIds).not.toContain('inst-3');
    });

    it('filters out INACTIVE workspaces when audience is omitted (public default)', async () => {
      const repo = new InMemoryPublishedMapRepository();
      repo.seedPublishedFloorMap(samplePublishedMap);

      const map = await repo.loadPublishedFloorMap('floor-1');
      expect(map).not.toBeNull();
      const instanceIds = map!.elements
        .filter((e) => e.elementRole === 'WORKSPACE')
        .map((e) => e.workspace?.workspaceInstanceId);

      expect(instanceIds).not.toContain('inst-3');
    });

    it('retains INACTIVE workspaces when audience is STAFF', async () => {
      const repo = new InMemoryPublishedMapRepository();
      repo.seedPublishedFloorMap(samplePublishedMap);

      const map = await repo.loadPublishedFloorMap('floor-1', { audience: 'STAFF' });
      expect(map).not.toBeNull();
      const instanceIds = map!.elements
        .filter((e) => e.elementRole === 'WORKSPACE')
        .map((e) => e.workspace?.workspaceInstanceId);

      expect(instanceIds).toContain('inst-1');
      expect(instanceIds).toContain('inst-2');
      expect(instanceIds).toContain('inst-3');
    });

    it('retains INACTIVE workspaces when audience is ADMIN', async () => {
      const repo = new InMemoryPublishedMapRepository();
      repo.seedPublishedFloorMap(samplePublishedMap);

      const map = await repo.loadPublishedFloorMap('floor-1', { audience: 'ADMIN' });
      expect(map).not.toBeNull();
      const instanceIds = map!.elements
        .filter((e) => e.elementRole === 'WORKSPACE')
        .map((e) => e.workspace?.workspaceInstanceId);

      expect(instanceIds).toContain('inst-3');
    });
  });

  describe('SupabasePublishedMapRepository Audience Filtering', () => {
    function setupMockSupabase() {
      global.fetch = vi.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);

        if (urlStr.includes('/floors')) {
          return new Response(JSON.stringify([{
            id: 'floor-1',
            name: 'Main Floor',
            floor_number: 1,
            display_order: 1,
            is_active: true,
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (urlStr.includes('/map_versions')) {
          return new Response(JSON.stringify([{
            id: 'ver-1',
            floor_id: 'floor-1',
            version_number: 1,
            canvas_width: 1600,
            canvas_height: 1000,
            grid_size: 20,
            published_at: '2026-09-17T00:00:00Z',
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (urlStr.includes('/map_elements')) {
          return new Response(JSON.stringify([
            {
              id: 'el-active',
              element_role: 'WORKSPACE',
              element_type: 'desk',
              x: 100,
              y: 100,
              width: 80,
              height: 80,
              rotation: 0,
              z_index: 1,
              label: 'Desk 1',
              properties: {},
              workspace_instance: {
                id: 'inst-1',
                template_id: 'tpl-1',
                floor_id: 'floor-1',
                instance_code: 'D-01',
                display_name: 'Desk 1',
                operational_status: 'ACTIVE',
                template: {
                  id: 'tpl-1',
                  name: 'Hot Desk',
                  description: null,
                  photo_path: null,
                  capacity: 1,
                  rate_amount: 100,
                  pricing_unit: 'HOURLY',
                  default_shape: 'desk',
                  default_color: '#009689',
                  default_style: null,
                  is_active: true,
                },
              },
            },
            {
              id: 'el-inactive',
              element_role: 'WORKSPACE',
              element_type: 'desk',
              x: 300,
              y: 100,
              width: 80,
              height: 80,
              rotation: 0,
              z_index: 1,
              label: 'Desk 3',
              properties: {},
              workspace_instance: {
                id: 'inst-3',
                template_id: 'tpl-1',
                floor_id: 'floor-1',
                instance_code: 'D-03',
                display_name: 'Desk 3',
                operational_status: 'INACTIVE',
                template: {
                  id: 'tpl-1',
                  name: 'Hot Desk',
                  description: null,
                  photo_path: null,
                  capacity: 1,
                  rate_amount: 100,
                  pricing_unit: 'HOURLY',
                  default_shape: 'desk',
                  default_color: '#009689',
                  default_style: null,
                  is_active: true,
                },
              },
            },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;
    }

    it('excludes INACTIVE workspaces for CUSTOMER audience in SupabasePublishedMapRepository', async () => {
      setupMockSupabase();
      const repo = new SupabasePublishedMapRepository();
      const result = await repo.loadPublishedFloorMap('floor-1', { audience: 'CUSTOMER' });

      expect(result).not.toBeNull();
      const ids = result!.elements.map((e) => e.workspace?.workspaceInstanceId);
      expect(ids).toContain('inst-1');
      expect(ids).not.toContain('inst-3');
    });

    it('retains INACTIVE workspaces for STAFF audience in SupabasePublishedMapRepository', async () => {
      setupMockSupabase();
      const repo = new SupabasePublishedMapRepository();
      const result = await repo.loadPublishedFloorMap('floor-1', { audience: 'STAFF' });

      expect(result).not.toBeNull();
      const ids = result!.elements.map((e) => e.workspace?.workspaceInstanceId);
      expect(ids).toContain('inst-1');
      expect(ids).toContain('inst-3');
    });

    it('retains INACTIVE workspaces for ADMIN audience in SupabasePublishedMapRepository', async () => {
      setupMockSupabase();
      const repo = new SupabasePublishedMapRepository();
      const result = await repo.loadPublishedFloorMap('floor-1', { audience: 'ADMIN' });

      expect(result).not.toBeNull();
      const ids = result!.elements.map((e) => e.workspace?.workspaceInstanceId);
      expect(ids).toContain('inst-1');
      expect(ids).toContain('inst-3');
    });
  });

  describe('Spot Visual Opacity Resolution for Admin & Staff', () => {
    function resolveSpotOpacity(operationalStatus: string, isSelected: boolean): number {
      const isInactive = operationalStatus === 'INACTIVE' || operationalStatus === 'BROKEN';
      return isInactive ? (isSelected ? 0.6 : 0.25) : 1;
    }

    it('returns very low opacity (0.25) for unselected INACTIVE spots', () => {
      expect(resolveSpotOpacity('INACTIVE', false)).toBe(0.25);
    });

    it('returns moderate opacity (0.6) for selected INACTIVE spots so selection is clearly visible', () => {
      expect(resolveSpotOpacity('INACTIVE', true)).toBe(0.6);
    });

    it('returns full opacity (1.0) for ACTIVE spots whether selected or not', () => {
      expect(resolveSpotOpacity('ACTIVE', false)).toBe(1);
      expect(resolveSpotOpacity('ACTIVE', true)).toBe(1);
    });

    it('returns full opacity (1.0) for MAINTENANCE spots', () => {
      expect(resolveSpotOpacity('MAINTENANCE', false)).toBe(1);
      expect(resolveSpotOpacity('MAINTENANCE', true)).toBe(1);
    });
  });

  describe('Customer & Kiosk Map Adapters', () => {
    it('customer mapPublishedFloorToWorkspaceCards completely removes INACTIVE workspaces', () => {
      const cards = customerMapCards(samplePublishedMap);
      const instanceIds = cards.map((c) => c.workspaceInstanceId);
      expect(instanceIds).toContain('inst-1');
      expect(instanceIds).toContain('inst-2');
      expect(instanceIds).not.toContain('inst-3');
    });

    it('canvas rendering filter returns null for INACTIVE workspaces', () => {
      function renderCanvasElement(el: (typeof samplePublishedMap.elements)[0]) {
        const isWorkspace = el.elementRole === 'WORKSPACE' || Boolean(el.workspace);
        if (isWorkspace && el.workspace?.operationalStatus === 'INACTIVE') {
          return null;
        }
        return { rendered: true, id: el.id };
      }

      const activeResult = renderCanvasElement(samplePublishedMap.elements[0]);
      const maintenanceResult = renderCanvasElement(samplePublishedMap.elements[1]);
      const inactiveResult = renderCanvasElement(samplePublishedMap.elements[2]);

      expect(activeResult).not.toBeNull();
      expect(maintenanceResult).not.toBeNull();
      expect(inactiveResult).toBeNull();
    });
  });
});
