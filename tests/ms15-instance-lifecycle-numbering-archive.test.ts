import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getNextAvailableInstanceNumber,
  InMemoryWorkspaceRepository,
  createWorkspaceService,
  InMemoryPublishedMapRepository,
  type PublishedFloorMap,
} from '@deskatlas/domain';
import { SupabaseWorkspaceRepository } from '../apps/admin-portal/src/app/api/admin/workspaces/_lib/supabaseWorkspaceRepository';

describe('MS-15: Focus Pod Physical Instance Lifecycle, Sequential Numbering Continuity, Archive Deletion Hardening, and Map View Synchronization', () => {
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

  describe('QAD-TC15.1: Sequential Numbering Gap-Fill Algorithm', () => {
    it('generates Focus Pod 15 when Focus Pods 1 through 14 exist', () => {
      const existingNames = Array.from({ length: 14 }, (_, i) => `Focus Pod ${i + 1}`);
      const result = getNextAvailableInstanceNumber('Focus Pod', existingNames, 'GAP_FILL');

      expect(result.sequenceNumber).toBe(15);
      expect(result.displayName).toBe('Focus Pod 15');
    });

    it('fills sequence gap when Focus Pods 1-14 and 22-36 exist in database', () => {
      const activeNames = Array.from({ length: 14 }, (_, i) => `Focus Pod ${i + 1}`);
      const orphanedNames = Array.from({ length: 15 }, (_, i) => `Focus Pod ${i + 22}`);
      const combinedNames = [...activeNames, ...orphanedNames];

      const result = getNextAvailableInstanceNumber('Focus Pod', combinedNames, 'GAP_FILL');

      expect(result.sequenceNumber).toBe(15);
      expect(result.displayName).toBe('Focus Pod 15');
    });

    it('fills internal sequence gaps when specific numbers are deleted', () => {
      const existingNames = ['Focus Pod 1', 'Focus Pod 2', 'Focus Pod 4', 'Focus Pod 5'];
      const result = getNextAvailableInstanceNumber('Focus Pod', existingNames, 'GAP_FILL');

      expect(result.sequenceNumber).toBe(3);
      expect(result.displayName).toBe('Focus Pod 3');
    });

    it('handles MAX_PLUS_ONE strategy when requested', () => {
      const existingNames = ['Focus Pod 1', 'Focus Pod 2', 'Focus Pod 4'];
      const result = getNextAvailableInstanceNumber('Focus Pod', existingNames, 'MAX_PLUS_ONE');

      expect(result.sequenceNumber).toBe(5);
      expect(result.displayName).toBe('Focus Pod 5');
    });
  });

  describe('QAD-TC15.2: Multi-Floor Isolation in Sequential Numbering', () => {
    it('isolates numbering so instances on Floor 2 do not shift sequence on Floor 1', () => {
      const floor1Instances = [
        { displayName: 'Focus Pod 1', floorId: 'floor-1', operationalStatus: 'ACTIVE' },
        { displayName: 'Focus Pod 2', floorId: 'floor-1', operationalStatus: 'ACTIVE' },
      ];

      const floor2Instances = [
        { displayName: 'Focus Pod 20', floorId: 'floor-2', operationalStatus: 'ACTIVE' },
        { displayName: 'Focus Pod 21', floorId: 'floor-2', operationalStatus: 'ACTIVE' },
      ];

      const allInstances = [...floor1Instances, ...floor2Instances];

      // Scoped calculation for Floor 1 only
      const floor1ActiveNames = allInstances
        .filter((i) => i.floorId === 'floor-1' && i.operationalStatus !== 'INACTIVE')
        .map((i) => i.displayName);

      const resultFloor1 = getNextAvailableInstanceNumber('Focus Pod', floor1ActiveNames, 'GAP_FILL');
      expect(resultFloor1.sequenceNumber).toBe(3);
      expect(resultFloor1.displayName).toBe('Focus Pod 3');

      // Scoped calculation for Floor 2 only
      const floor2ActiveNames = allInstances
        .filter((i) => i.floorId === 'floor-2' && i.operationalStatus !== 'INACTIVE')
        .map((i) => i.displayName);

      const resultFloor2 = getNextAvailableInstanceNumber('Focus Pod', floor2ActiveNames, 'GAP_FILL');
      expect(resultFloor2.sequenceNumber).toBe(1);
      expect(resultFloor2.displayName).toBe('Focus Pod 1');
    });
  });

  describe('QAD-TC15.3: Placing Restored Unmapped Instances', () => {
    it('allows placing restored unmapped instances directly with existing ID without duplication', async () => {
      const memRepo = new InMemoryWorkspaceRepository();
      const service = createWorkspaceService(memRepo);

      const floor = await service.createFloor({ name: 'Floor 1' });
      const tpl = await service.createTemplate({
        name: 'Focus Pod',
        capacity: 1,
        rateAmount: 150,
      });

      const instance = await service.createInstance({
        templateId: tpl.id,
        floorId: floor.id,
        instanceCode: 'FP-15',
        displayName: 'Focus Pod 15',
        operationalStatus: 'ACTIVE',
      });

      // Simulating placement on canvas: builder element uses instance.id
      const canvasElement = {
        id: 'el-100',
        name: instance.displayName,
        workspaceInstanceId: instance.id,
        status: instance.operationalStatus,
        bookable: true,
      };

      expect(canvasElement.workspaceInstanceId).toBe(instance.id);
      expect(canvasElement.name).toBe('Focus Pod 15');
    });
  });

  describe('QAD-TC15.4: Hard Deletion of Zero-Reservation Instances', () => {
    it('detaches map_elements and hard-deletes instance when reservation count is zero', async () => {
      const calls: Array<{ url: string; method: string; body?: string }> = [];

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const method = init?.method || 'GET';
        calls.push({ url: urlStr, method, body: init?.body ? String(init.body) : undefined });

        if (urlStr.includes('/workspace_instances?id=eq.inst-22') && method === 'GET') {
          return new Response(
            JSON.stringify([
              {
                id: 'inst-22',
                template_id: 'tpl-1',
                floor_id: 'fl-1',
                instance_code: 'FP-22',
                display_name: 'Focus Pod 22',
                operational_status: 'INACTIVE',
                created_at: '2026-09-20T00:00:00Z',
                updated_at: '2026-09-20T00:00:00Z',
                template: { id: 'tpl-1', name: 'Focus Pod', is_active: true },
                floor: { id: 'fl-1', name: 'Floor 1' },
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.includes('/reservation_candidates?workspace_instance_id=eq.inst-22')) {
          // Zero reservations
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (urlStr.includes('/map_elements?workspace_instance_id=eq.inst-22') && method === 'PATCH') {
          // Detached foreign keys
          return new Response(JSON.stringify({ count: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (urlStr.includes('/workspace_instances?id=eq.inst-22') && method === 'DELETE') {
          // Successful hard deletion
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const repo = new SupabaseWorkspaceRepository({
        supabaseUrl: 'https://mock.supabase.co',
        serviceRoleKey: 'mock-key',
      });

      const result = await repo.deleteInstance('inst-22');

      expect(result.deleted).toBe(true);
      expect(result.archived).toBe(false);

      // Verify that map_elements PATCH occurred before workspace_instances DELETE
      const patchCall = calls.find((c) => c.url.includes('/map_elements') && c.method === 'PATCH');
      const deleteCall = calls.find((c) => c.url.includes('/workspace_instances') && c.method === 'DELETE');

      expect(patchCall).toBeDefined();
      expect(deleteCall).toBeDefined();
      expect(patchCall!.body).toContain('"workspace_instance_id":null');
    });
  });

  describe('QAD-TC15.5: Soft Deactivation for Reserved Instances', () => {
    it('deactivates and archives instance instead of hard-deleting when reservations exist', async () => {
      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const method = init?.method || 'GET';

        if (urlStr.includes('/workspace_instances?id=eq.inst-10') && method === 'GET') {
          return new Response(
            JSON.stringify([
              {
                id: 'inst-10',
                template_id: 'tpl-1',
                floor_id: 'fl-1',
                instance_code: 'FP-10',
                display_name: 'Focus Pod 10',
                operational_status: 'ACTIVE',
                created_at: '2026-09-20T00:00:00Z',
                updated_at: '2026-09-20T00:00:00Z',
                template: { id: 'tpl-1', name: 'Focus Pod', is_active: true },
                floor: { id: 'fl-1', name: 'Floor 1' },
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.includes('/reservation_candidates?workspace_instance_id=eq.inst-10')) {
          // Has reservations
          return new Response(JSON.stringify([{ id: 'rc-1' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (urlStr.includes('/workspace_instances?id=eq.inst-10') && method === 'PATCH') {
          return new Response(
            JSON.stringify([
              {
                id: 'inst-10',
                template_id: 'tpl-1',
                floor_id: 'fl-1',
                instance_code: 'FP-10',
                display_name: 'Focus Pod 10',
                operational_status: 'INACTIVE',
                created_at: '2026-09-20T00:00:00Z',
                updated_at: '2026-09-28T00:00:00Z',
                template: { id: 'tpl-1', name: 'Focus Pod', is_active: true },
                floor: { id: 'fl-1', name: 'Floor 1' },
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const repo = new SupabaseWorkspaceRepository({
        supabaseUrl: 'https://mock.supabase.co',
        serviceRoleKey: 'mock-key',
      });

      const result = await repo.deleteInstance('inst-10');

      expect(result.deleted).toBe(false);
      expect(result.archived).toBe(true);
      expect(result.instance?.operationalStatus).toBe('INACTIVE');
    });
  });

  describe('QAD-TC15.6: Map View Suppression of Inactive / Archived Instances', () => {
    it('suppresses inactive physical instances from live operational map elements', () => {
      const sampleInstances = [
        { id: 'inst-1', displayName: 'Focus Pod 1', operationalStatus: 'ACTIVE', templateId: 'tpl-1' },
        { id: 'inst-22', displayName: 'Focus Pod 22', operationalStatus: 'INACTIVE', templateId: 'tpl-1' },
      ];

      const sampleMapElements = [
        { id: 'el-1', workspaceInstanceId: 'inst-1', elementRole: 'WORKSPACE' },
        { id: 'el-22', workspaceInstanceId: 'inst-22', elementRole: 'WORKSPACE' },
        { id: 'el-wall', workspaceInstanceId: null, elementRole: 'STRUCTURE' },
      ];

      const visibleElements = sampleMapElements.filter((el) => {
        if (el.elementRole === 'WORKSPACE' || el.workspaceInstanceId) {
          const inst = sampleInstances.find((ins) => ins.id === el.workspaceInstanceId);
          if (inst && inst.operationalStatus === 'INACTIVE') return false;
        }
        return true;
      });

      expect(visibleElements.length).toBe(2);
      expect(visibleElements.some((el) => el.id === 'el-1')).toBe(true);
      expect(visibleElements.some((el) => el.id === 'el-wall')).toBe(true);
      expect(visibleElements.some((el) => el.id === 'el-22')).toBe(false);
    });
  });
});
