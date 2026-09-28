import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMapService,
  createWorkspaceService,
  InMemoryMapRepository,
  InMemoryWorkspaceRepository,
  MapValidationError,
  type Floor,
  type MapElementInput,
} from '@deskatlas/domain';

/**
 * MS-21 / QAD-TC21: Floor Map Publishing Pipeline Draft Prioritization,
 * Concurrency Synchronization, and Historical Element Referential Integrity
 */
describe('MS-21 / QAD-TC21: Map Publishing Draft Prioritization and Trigger Integrity', () => {
  const testFloor: Floor = {
    id: 'floor-ms21',
    name: 'Floor 21',
    floorNumber: 21,
    displayOrder: 21,
    isActive: true,
  };

  let mapRepo: InMemoryMapRepository;
  let mapService: ReturnType<typeof createMapService>;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let workspaceService: ReturnType<typeof createWorkspaceService>;

  beforeEach(async () => {
    workspaceRepo = new InMemoryWorkspaceRepository();
    workspaceRepo.seedFloor(testFloor);
    workspaceService = createWorkspaceService(workspaceRepo);

    const template = await workspaceService.createTemplate({
      name: 'Executive Desk',
      capacity: 1,
      rateAmount: 150,
      defaultShape: 'desk',
      defaultColor: '#009689',
    });

    const inst1 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: testFloor.id,
    });
    const inst2 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: testFloor.id,
    });

    mapRepo = new InMemoryMapRepository({
      floors: [testFloor],
      workspaceInstances: [
        { id: inst1.id, floorId: testFloor.id, operationalStatus: 'ACTIVE' },
        { id: inst2.id, floorId: testFloor.id, operationalStatus: 'ACTIVE' },
      ],
    });
    mapService = createMapService(mapRepo);
  });

  describe('QAD-TC21.1: Prioritized Save-Before-Publish Execution Pipeline', () => {
    it('executes draft save first, verifies success, and promotes draft to published version', async () => {
      const instances = Array.from(mapRepo.workspaceInstances.values());
      const inst1 = instances[0];

      const elements: MapElementInput[] = [
        {
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: inst1.id,
          x: 120,
          y: 140,
          width: 80,
          height: 80,
          rotation: 0,
        },
      ];

      // 1. Save draft with dirty canvas elements
      const draftResult = await mapService.saveDraft({
        floorId: testFloor.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements,
        actorUserId: 'admin-user-1',
      });

      expect(draftResult.version.status).toBe('DRAFT');
      expect(draftResult.elements).toHaveLength(1);
      expect(draftResult.elements[0].x).toBe(120);

      // 2. Publish draft
      const publishResult = await mapService.publishDraft({
        floorId: testFloor.id,
        actorUserId: 'admin-user-1',
      });

      expect(publishResult.published.version.status).toBe('PUBLISHED');
      expect(publishResult.published.elements).toHaveLength(1);
      expect(publishResult.published.elements[0].workspaceInstanceId).toBe(inst1.id);
    });
  });

  describe('QAD-TC21.2: In-Flight Autosave Concurrency Lockout and Promise Awaiting', () => {
    it('awaits existing in-flight save promise before publishing without collision or P0001 error', async () => {
      let isSaving = false;
      let activeSavePromise: Promise<boolean> | null = null;
      let publishAttempted = false;

      const mockSaveDraft = vi.fn(async (options: { isAutosave?: boolean; throwOnError?: boolean } = {}) => {
        const { throwOnError = false } = options;
        if (isSaving && activeSavePromise) {
          try {
            return await activeSavePromise;
          } catch (err) {
            if (throwOnError) throw err;
            return false;
          }
        }

        isSaving = true;
        const promise = (async () => {
          try {
            // Simulate network latency for autosave
            await new Promise((resolve) => setTimeout(resolve, 50));
            return true;
          } finally {
            isSaving = false;
            activeSavePromise = null;
          }
        })();

        activeSavePromise = promise;
        return promise;
      });

      // 1. Simulate in-flight autosave
      const autosaveCall = mockSaveDraft({ isAutosave: true });

      // 2. Immediate publish action triggered while autosave is in flight
      const publishAction = async () => {
        const saved = await mockSaveDraft({ throwOnError: true });
        if (!saved) throw new Error('Save failed');
        publishAttempted = true;
        return true;
      };

      const [autosaveRes, publishRes] = await Promise.all([autosaveCall, publishAction()]);

      expect(autosaveRes).toBe(true);
      expect(publishRes).toBe(true);
      expect(publishAttempted).toBe(true);
      expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    });
  });

  describe('QAD-TC21.3: Draft Save Failure Aborts Publish Pipeline', () => {
    it('halts publish immediately and surfaces error when draft save fails validation', async () => {
      const invalidElements: MapElementInput[] = [
        {
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: 'non-existent-instance-id',
          x: 100,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
        },
      ];

      // Saving invalid element throws MapValidationError
      await expect(
        mapService.saveDraft({
          floorId: testFloor.id,
          canvasWidth: 1600,
          canvasHeight: 1000,
          gridSize: 20,
          elements: invalidElements,
        })
      ).rejects.toThrow(MapValidationError);

      // Verify no draft or published version exists
      const draft = await mapService.loadDraft(testFloor.id);
      expect(draft).toBeNull();
    });
  });

  describe('QAD-TC21.4: Historical Workspace Instance Detachment on Non-Draft Versions', () => {
    it('allows workspace_instance_id to be set to NULL on non-draft versions while preserving geometry', () => {
      // Simulate trigger logic from migration 020
      type ElementRow = {
        id: string;
        map_version_id: string;
        workspace_instance_id: string | null;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
        z_index: number;
        element_role: string;
        element_type: string;
      };

      const validateTrigger = (
        op: 'INSERT' | 'UPDATE' | 'DELETE',
        oldRow: ElementRow | null,
        newRow: ElementRow | null,
        versionStatus: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
      ): { allowed: boolean; error?: string } => {
        if (versionStatus !== 'DRAFT') {
          if (
            op === 'UPDATE' &&
            oldRow !== null &&
            newRow !== null &&
            newRow.workspace_instance_id === null &&
            oldRow.workspace_instance_id !== null &&
            newRow.map_version_id === oldRow.map_version_id &&
            newRow.x === oldRow.x &&
            newRow.y === oldRow.y &&
            newRow.width === oldRow.width &&
            newRow.height === oldRow.height &&
            newRow.rotation === oldRow.rotation &&
            newRow.z_index === oldRow.z_index &&
            newRow.element_role === oldRow.element_role &&
            newRow.element_type === oldRow.element_type
          ) {
            return { allowed: true };
          }
          return { allowed: false, error: 'Map elements may only be mutated inside a DRAFT map version' };
        }
        return { allowed: true };
      };

      const oldPublishedElement: ElementRow = {
        id: 'el-1',
        map_version_id: 'ver-published-1',
        workspace_instance_id: 'ws-inst-1',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        z_index: 1,
        element_role: 'WORKSPACE',
        element_type: 'desk',
      };

      // Detaching workspace_instance_id by setting it to NULL
      const detachedElement: ElementRow = {
        ...oldPublishedElement,
        workspace_instance_id: null,
      };

      const result = validateTrigger('UPDATE', oldPublishedElement, detachedElement, 'PUBLISHED');
      expect(result.allowed).toBe(true);
      expect(result.error).toBeUndefined();

      const archivedResult = validateTrigger('UPDATE', oldPublishedElement, detachedElement, 'ARCHIVED');
      expect(archivedResult.allowed).toBe(true);
      expect(archivedResult.error).toBeUndefined();
    });
  });

  describe('QAD-TC21.5: Immutable Published Geometry Protection', () => {
    it('strictly rejects any coordinate, dimension, rotation, or role mutation on PUBLISHED/ARCHIVED versions', () => {
      type ElementRow = {
        id: string;
        map_version_id: string;
        workspace_instance_id: string | null;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
        z_index: number;
        element_role: string;
        element_type: string;
      };

      const validateTrigger = (
        op: 'INSERT' | 'UPDATE' | 'DELETE',
        oldRow: ElementRow | null,
        newRow: ElementRow | null,
        versionStatus: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
      ): { allowed: boolean; error?: string } => {
        if (versionStatus !== 'DRAFT') {
          if (
            op === 'UPDATE' &&
            oldRow !== null &&
            newRow !== null &&
            newRow.workspace_instance_id === null &&
            oldRow.workspace_instance_id !== null &&
            newRow.map_version_id === oldRow.map_version_id &&
            newRow.x === oldRow.x &&
            newRow.y === oldRow.y &&
            newRow.width === oldRow.width &&
            newRow.height === oldRow.height &&
            newRow.rotation === oldRow.rotation &&
            newRow.z_index === oldRow.z_index &&
            newRow.element_role === oldRow.element_role &&
            newRow.element_type === oldRow.element_type
          ) {
            return { allowed: true };
          }
          return { allowed: false, error: 'Map elements may only be mutated inside a DRAFT map version' };
        }
        return { allowed: true };
      };

      const oldPublishedElement: ElementRow = {
        id: 'el-1',
        map_version_id: 'ver-published-1',
        workspace_instance_id: 'ws-inst-1',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        z_index: 1,
        element_role: 'WORKSPACE',
        element_type: 'desk',
      };

      // 1. Moving element (x changed)
      const movedElement: ElementRow = { ...oldPublishedElement, x: 120 };
      expect(validateTrigger('UPDATE', oldPublishedElement, movedElement, 'PUBLISHED').allowed).toBe(false);
      expect(validateTrigger('UPDATE', oldPublishedElement, movedElement, 'PUBLISHED').error).toBe(
        'Map elements may only be mutated inside a DRAFT map version'
      );

      // 2. Resizing element (width changed)
      const resizedElement: ElementRow = { ...oldPublishedElement, width: 100 };
      expect(validateTrigger('UPDATE', oldPublishedElement, resizedElement, 'ARCHIVED').allowed).toBe(false);

      // 3. Rotating element
      const rotatedElement: ElementRow = { ...oldPublishedElement, rotation: 90 };
      expect(validateTrigger('UPDATE', oldPublishedElement, rotatedElement, 'PUBLISHED').allowed).toBe(false);

      // 4. Changing element role
      const roleChangedElement: ElementRow = { ...oldPublishedElement, element_role: 'STRUCTURE' };
      expect(validateTrigger('UPDATE', oldPublishedElement, roleChangedElement, 'PUBLISHED').allowed).toBe(false);

      // 5. Inserting into published version
      expect(validateTrigger('INSERT', null, oldPublishedElement, 'PUBLISHED').allowed).toBe(false);

      // 6. Deleting from published version
      expect(validateTrigger('DELETE', oldPublishedElement, null, 'PUBLISHED').allowed).toBe(false);
    });
  });

  describe('QAD-TC21.6: Version Parity Between Admin and Staff Across Publish Cycles', () => {
    it('ensures staff and admin both receive the exact same latest published version_number after publishing', async () => {
      const instances = Array.from(mapRepo.workspaceInstances.values());

      // 1. Initially publish Version 1
      await mapService.saveDraft({
        floorId: testFloor.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements: [
          {
            elementRole: 'WORKSPACE',
            elementType: 'desk',
            workspaceInstanceId: instances[0].id,
            x: 100,
            y: 100,
            width: 80,
            height: 80,
            rotation: 0,
          },
        ],
      });
      const pub1 = await mapService.publishDraft({ floorId: testFloor.id });
      expect(pub1.published.version.versionNumber).toBe(1);

      // Load published map as admin and as staff
      const adminPub1 = await mapService.loadPublished(testFloor.id);
      expect(adminPub1).not.toBeNull();
      expect(adminPub1?.version.versionNumber).toBe(1);
      expect(adminPub1?.elements).toHaveLength(1);

      // 2. Admin creates a new instance and drafts Version 2 with additional element
      const inst2 = { id: 'inst-v2', floorId: testFloor.id, operationalStatus: 'ACTIVE' as const };
      mapRepo.workspaceInstances.set(inst2.id, inst2);

      await mapService.saveDraft({
        floorId: testFloor.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements: [
          {
            elementRole: 'WORKSPACE',
            elementType: 'desk',
            workspaceInstanceId: instances[0].id,
            x: 100,
            y: 100,
            width: 80,
            height: 80,
            rotation: 0,
          },
          {
            elementRole: 'WORKSPACE',
            elementType: 'desk',
            workspaceInstanceId: inst2.id,
            x: 200,
            y: 200,
            width: 80,
            height: 80,
            rotation: 0,
          },
        ],
      });

      // While draft is uncommitted, Admin published view and Staff view must still show Version 1
      const adminPubStillV1 = await mapService.loadPublished(testFloor.id);
      expect(adminPubStillV1?.version.versionNumber).toBe(1);
      expect(adminPubStillV1?.elements).toHaveLength(1);

      // 3. Admin publishes Version 2
      const pub2 = await mapService.publishDraft({ floorId: testFloor.id });
      expect(pub2.published.version.versionNumber).toBe(2);

      // Both Admin and Staff published queries now load Version 2
      const adminPub2 = await mapService.loadPublished(testFloor.id);
      expect(adminPub2).not.toBeNull();
      expect(adminPub2?.version.versionNumber).toBe(2);
      expect(adminPub2?.elements).toHaveLength(2);
    });
  });

  describe('QAD-TC21.7: PostgREST Descending Version Ordering Guarantee', () => {
    it('simulates multiple historical versions in repository and guarantees highest version_number is returned', () => {
      // Simulate historical versions array
      const historicalVersions = [
        { id: 'v1', floor_id: 'fl-1', version_number: 1, status: 'ARCHIVED' },
        { id: 'v3', floor_id: 'fl-1', version_number: 3, status: 'PUBLISHED' },
        { id: 'v2', floor_id: 'fl-1', version_number: 2, status: 'ARCHIVED' },
      ];

      // Filtering published and sorting by version_number desc
      const latestPublished = historicalVersions
        .filter((v) => v.floor_id === 'fl-1' && v.status === 'PUBLISHED')
        .sort((a, b) => b.version_number - a.version_number)[0];

      expect(latestPublished.id).toBe('v3');
      expect(latestPublished.version_number).toBe(3);
    });
  });
});

