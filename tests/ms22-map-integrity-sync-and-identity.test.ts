import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMapService,
  createWorkspaceService,
  InMemoryMapRepository,
  InMemoryWorkspaceRepository,
  InMemoryPublishedMapRepository,
  SupabasePublishedMapRepository,
  ReservationMemoryRepository,
  MapValidationError,
  validateMapForPublish,
  clampMapCanvasDimensions,
  sanitizeManualResolutionNotes,
  type Floor,
  type FloorMap,
  type MapElementInput,
  type PublishedFloorMap,
} from '@deskatlas/domain';

/**
 * MS-22 / QAD-TC22: Interactive Map Builder Draft Referential Integrity,
 * Cross-Map Operational Status Synchronization, Administrative Resolution Identity,
 * and Canvas Mutation Feedback
 */
describe('MS-22 / QAD-TC22: Map Draft Integrity, Live Status Sync, Resolution Identity, & Canvas Feedback', () => {
  const testFloor: Floor = {
    id: 'floor-ms22',
    name: 'Floor 22',
    floorNumber: 22,
    displayOrder: 22,
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
      name: 'Focus Pod',
      capacity: 1,
      rateAmount: 120,
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

  describe('QAD-TC22.1: Draft Save on Instance Deletion (Self-Healing Orphaned Elements)', () => {
    it('gracefully converts orphaned or unlinked workspace elements to structures during draft save without throwing MapValidationError', async () => {
      const instances = Array.from(mapRepo.workspaceInstances.values());
      const inst1 = instances[0];

      // Draft payload contains one linked workspace element and one unlinked/orphaned workspace element
      const draftElements: MapElementInput[] = [
        {
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: inst1.id,
          x: 100,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
          label: 'Focus Pod 1',
        },
        {
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: null, // Orphaned element whose physical instance was deleted
          x: 220,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
          label: 'Focus Pod 2 (Deleted)',
        },
      ];

      // Saving draft must not throw MapValidationError
      const draftResult = await mapService.saveDraft({
        floorId: testFloor.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements: draftElements,
        actorUserId: 'admin-user-1',
      });

      expect(draftResult.version.status).toBe('DRAFT');
      expect(draftResult.elements).toHaveLength(2);

      // Bookable element retains WORKSPACE role and instance link
      const validElement = draftResult.elements.find((el) => el.workspaceInstanceId === inst1.id);
      expect(validElement).toBeDefined();
      expect(validElement?.elementRole).toBe('WORKSPACE');

      // Orphaned element is safely downgraded to STRUCTURE to preserve geometry without bricking draft
      const convertedElement = draftResult.elements.find((el) => el.x === 220);
      expect(convertedElement).toBeDefined();
      expect(convertedElement?.elementRole).toBe('STRUCTURE');
      expect(convertedElement?.workspaceInstanceId).toBeNull();
    });

    it('gracefully handles elements pointing to deleted instance UUIDs by sanitizing them to structures before draft save', async () => {
      // Physical instance was deleted, so instances roster only contains inst1
      const instances = Array.from(mapRepo.workspaceInstances.values());
      const loadedInstances = [instances[0]];

      const rawElements: Array<{
        elementRole: 'WORKSPACE' | 'STRUCTURE';
        elementType: string;
        workspaceInstanceId: string | null;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: 0 | 90 | 180 | 270;
        label: string;
      }> = [
        {
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: 'non-existent-deleted-uuid-999',
          x: 340,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
          label: 'Focus Pod Deleted',
        },
      ];

      // MapEditor pre-save sanitization
      const sanitizedElements: MapElementInput[] = rawElements.map((el) => {
        if (el.elementRole === 'WORKSPACE') {
          const isMissingInstance =
            !el.workspaceInstanceId ||
            (loadedInstances.length > 0 &&
              !loadedInstances.some((i) => i.id === el.workspaceInstanceId));
          if (isMissingInstance) {
            return {
              ...el,
              elementRole: 'STRUCTURE' as const,
              elementType: 'desk',
              workspaceInstanceId: null,
            };
          }
        }
        return el;
      });

      const draftResult = await mapService.saveDraft({
        floorId: testFloor.id,
        elements: sanitizedElements,
      });

      expect(draftResult.elements).toHaveLength(1);
      expect(draftResult.elements[0].elementRole).toBe('STRUCTURE');
      expect(draftResult.elements[0].workspaceInstanceId).toBeNull();
    });
  });

  describe('QAD-TC22.2: Re-Created Instance Association and Auto-Numbering Resilience', () => {
    it('automatically re-associates matching unplaced instance with matching element label during editor pre-save sanitization', () => {
      const reCreatedInstance = {
        id: 'new-uuid-focus-pod-22',
        displayName: 'Focus Pod 22',
        name: 'Focus Pod 22',
      };
      const loadedInstances = [reCreatedInstance];

      // Element payload currently has null workspaceInstanceId after physical deletion
      const rawElementsPayload: Array<{
        elementRole: 'WORKSPACE' | 'STRUCTURE';
        elementType: string;
        workspaceInstanceId: string | null;
        label: string;
      }> = [
        {
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: null,
          label: 'Focus Pod 22',
        },
      ];

      // Re-linking sanitization algorithm from MapEditor.tsx
      const sanitizedPayload = rawElementsPayload.map((el) => {
        if (el.elementRole === 'WORKSPACE') {
          const isMissingInstance =
            !el.workspaceInstanceId ||
            (loadedInstances.length > 0 &&
              !loadedInstances.some((i) => i.id === el.workspaceInstanceId));
          if (isMissingInstance) {
            const matchingUnmapped = loadedInstances.find(
              (i) =>
                (i.displayName === el.label || i.name === el.label) &&
                !rawElementsPayload.some((e) => e.workspaceInstanceId === i.id)
            );
            if (matchingUnmapped) {
              return { ...el, workspaceInstanceId: matchingUnmapped.id };
            }
            return {
              ...el,
              elementRole: 'STRUCTURE' as const,
              elementType: 'desk',
              workspaceInstanceId: null,
            };
          }
        }
        return el;
      });

      expect(sanitizedPayload[0].workspaceInstanceId).toBe('new-uuid-focus-pod-22');
      expect(sanitizedPayload[0].elementRole).toBe('WORKSPACE');
    });
  });

  describe('QAD-TC22.3: Live Operational Status Hydration Across Published Maps', () => {
    const mockFloor: Floor = {
      id: 'fl-published-22',
      name: 'Published Floor 22',
      floorNumber: 22,
      displayOrder: 22,
      isActive: true,
    };

    const mockCompiledMap: PublishedFloorMap = {
      floor: mockFloor,
      version: {
        id: 'ver-pub-22',
        versionNumber: 1,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        publishedAt: '2026-09-23T12:00:00.000Z',
      },
      elements: [
        {
          id: 'el-desk-1',
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          x: 100,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
          zIndex: 1,
          label: 'Desk 1',
          style: { color: '#009689', operationalStatus: 'ACTIVE' },
          workspace: {
            workspaceInstanceId: 'inst-live-1',
            templateId: 'tpl-1',
            floorId: 'fl-published-22',
            instanceCode: 'D-01',
            displayName: 'Desk 1',
            templateName: 'Standard Desk',
            description: null,
            photoPath: null,
            capacity: 1,
            rateAmount: 100,
            pricingUnit: 'HOURLY',
            operationalStatus: 'ACTIVE',
            maintenanceNote: null,
            isBookable: true,
            blockingReason: null,
          },
        },
      ],
    };

    it('immediately reflects live operational status changes in InMemoryPublishedMapRepository without re-publishing', async () => {
      const repo = new InMemoryPublishedMapRepository();
      repo.seedPublishedFloorMap(mockCompiledMap);

      // 1. Initial state is ACTIVE
      const initialMap = await repo.loadPublishedFloorMap(mockFloor.id, { audience: 'CUSTOMER' });
      expect(initialMap?.elements[0].workspace?.operationalStatus).toBe('ACTIVE');

      // 2. Admin alters operational status to MAINTENANCE
      repo.setInstanceStatus('inst-live-1', 'MAINTENANCE');

      // 3. Next fetch immediately returns updated MAINTENANCE status
      const updatedMap = await repo.loadPublishedFloorMap(mockFloor.id, { audience: 'CUSTOMER' });
      expect(updatedMap?.elements[0].workspace?.operationalStatus).toBe('MAINTENANCE');
      expect(updatedMap?.elements[0].style.operationalStatus).toBe('MAINTENANCE');
    });

    it('filters out dynamically INACTIVE instances for customer audience but preserves them for staff/admin audience', async () => {
      const repo = new InMemoryPublishedMapRepository();
      repo.seedPublishedFloorMap(mockCompiledMap);

      repo.setInstanceStatus('inst-live-1', 'INACTIVE');

      const customerMap = await repo.loadPublishedFloorMap(mockFloor.id, { audience: 'CUSTOMER' });
      expect(customerMap?.elements).toHaveLength(0);

      const staffMap = await repo.loadPublishedFloorMap(mockFloor.id, { audience: 'STAFF' });
      expect(staffMap?.elements).toHaveLength(1);
      expect(staffMap?.elements[0].workspace?.operationalStatus).toBe('INACTIVE');
    });

    it('dynamically queries and hydrates live operational status in SupabasePublishedMapRepository', async () => {
      class TestSupabasePublishedRepo extends SupabasePublishedMapRepository {
        constructor() {
          super({
            supabaseUrl: 'https://mock.supabase.co',
            serviceRoleKey: 'mock-key',
          });
        }

        // @ts-expect-error protected override for unit test inspection
        protected override async request<T>(path: string): Promise<T> {
          if (path.includes('select=compiled_map_cache')) {
            return [{ compiled_map_cache: mockCompiledMap }] as unknown as T;
          }
          if (path.includes('/workspace_instances?select=id,operational_status,maintenance_note')) {
            return [
              {
                id: 'inst-live-1',
                operational_status: 'MAINTENANCE',
                maintenance_note: 'Desk lamp replacement',
              },
            ] as unknown as T;
          }
          return [] as unknown as T;
        }
      }

      const repo = new TestSupabasePublishedRepo();
      const loaded = await repo.loadPublishedFloorMap(mockFloor.id, { audience: 'ADMIN' });

      expect(loaded).not.toBeNull();
      expect(loaded?.elements[0].workspace?.operationalStatus).toBe('MAINTENANCE');
      expect(loaded?.elements[0].workspace?.maintenanceNote).toBe('Desk lamp replacement');
      expect(loaded?.elements[0].style.operationalStatus).toBe('MAINTENANCE');
    });
  });

  describe('QAD-TC22.4: Real Human Name in Manual Resolution Audit Notes', () => {
    it('records actual admin name from database and never generic admin (ADMIN) or fictional hardcoded names', async () => {
      const resRepo = new ReservationMemoryRepository(() => new Date('2026-09-29T10:00:00.000Z'), workspaceRepo);

      const testReservation = {
        id: 'res-ms22-1',
        referenceCode: 'RES-MS22-001',
        guestFirstName: 'Jane',
        guestLastName: 'Doe',
        guestEmail: 'jane.doe@example.com',
        guestPhone: '+639171234567',
        status: 'CONFIRMED' as const,
        closureImpactStatus: 'NONE' as const,
        paymentStatus: 'PAID' as const,
        totalAmount: 240,
        amountDue: 240,
        rateSnapshot: 120,
        bookedRatePerHour: 120,
        pricingUnit: 'HOURLY' as const,
        startAt: '2026-09-29T11:00:00.000Z',
        endAt: '2026-09-29T13:00:00.000Z',
        floorId: testFloor.id,
        createdAt: '2026-09-29T09:00:00.000Z',
        updatedAt: '2026-09-29T09:00:00.000Z',
      };

      // Seed reservation into memory repository
      // @ts-expect-error private property access for test seed
      resRepo.reservations.push(testReservation);

      // 1. Submit with explicit real human name
      const res1 = await resRepo.flagClosureManualResolution({
        reservationId: testReservation.id,
        actorUserId: '28f07bd0-0372-447b-8c31-e1b562eafa3c',
        actorRole: 'ADMIN',
        actorName: 'DeskAtlas',
        notes: 'Outreached to customer regarding HVAC maintenance.',
      });

      expect(res1.reservation.manualResolutionNotes).toContain(
        'Flagged for Manual Resolution by DeskAtlas (ADMIN): Outreached to customer regarding HVAC maintenance.'
      );
      expect(res1.reservation.manualResolutionNotes).not.toContain('by admin (ADMIN)');
      expect(res1.reservation.manualResolutionNotes).not.toContain('Admin Edward');

      // 2. Submit with generic string admin - system falls back without fictional hardcoding
      const res2 = await resRepo.flagClosureManualResolution({
        reservationId: testReservation.id,
        actorUserId: 'admin-uuid',
        actorRole: 'ADMIN',
        actorName: 'admin',
        notes: 'Follow up required on backup spot.',
      });

      expect(res2.reservation.manualResolutionNotes).toContain(
        'Flagged for Manual Resolution by DeskAtlas (ADMIN): Follow up required on backup spot.'
      );
      expect(res2.reservation.manualResolutionNotes).not.toContain('by Admin (ADMIN)');
      expect(res2.reservation.manualResolutionNotes).not.toContain('by admin (ADMIN)');
      expect(res2.reservation.manualResolutionNotes).not.toContain('Admin Edward');

      // 3. Submit with actorRole SUPERADMIN and generic name admin - sanitizes to Super Admin
      const res3 = await resRepo.flagClosureManualResolution({
        reservationId: testReservation.id,
        actorUserId: 'superadmin-uuid',
        actorRole: 'SUPERADMIN',
        actorName: 'admin',
        notes: 'Elevated override.',
      });

      expect(res3.reservation.manualResolutionNotes).toContain(
        'Flagged for Manual Resolution by Super Admin (SUPERADMIN): Elevated override.'
      );
      expect(res3.reservation.manualResolutionNotes).not.toContain('Admin Edward');

      // 4. Outreach phone call logging: does not print raw staff user UUID in parentheses
      const callRes = await resRepo.logClosurePhoneCall({
        reservationId: testReservation.id,
        staffUserId: 'ea3d3ab3-b6a8-4e7e-b281-9a7087038ba0',
        staffName: 'Angelie Barrientos',
        outreachStatus: 'SPOKE_WITH_CUSTOMER',
        notes: 'Confirmed relocation preference with guest.',
      });

      expect(callRes.reservation.manualResolutionNotes).toContain(
        'Call by Angelie Barrientos - Status: SPOKE_WITH_CUSTOMER. Notes: Confirmed relocation preference with guest.'
      );
      // Raw user UUID in parentheses must NOT be displayed
      expect(callRes.reservation.manualResolutionNotes).not.toContain('(ea3d3ab3-b6a8-4e7e-b281-9a7087038ba0)');

      // 5. Historical notes sanitization: strips UUIDs and replaces generic Admin (ADMIN) with actual database admin DeskAtlas
      const historicalNotes =
        '[2026-09-28T16:40:57.304Z] Flagged for Manual Resolution by Admin (ADMIN): Breakfast\n' +
        '[2026-09-28T17:11:19.285Z] Call by barrientosangeliea (ea3d3ab3-b6a8-4e7e-b281-9a7087038ba0) - Status: NO_ANSWER. Notes: cannot be reached';

      const cleanedNotes = sanitizeManualResolutionNotes(historicalNotes);
      expect(cleanedNotes).toContain('Flagged for Manual Resolution by DeskAtlas (ADMIN): Breakfast');
      expect(cleanedNotes).toContain('Call by Angelie - Status: NO_ANSWER. Notes: cannot be reached');
      expect(cleanedNotes).not.toContain('(ea3d3ab3-b6a8-4e7e-b281-9a7087038ba0)');
      expect(cleanedNotes).not.toContain('by Admin (ADMIN)');
      expect(cleanedNotes).not.toContain('Admin Edward');
    });
  });

  describe('QAD-TC22.5: Canvas Resize Toast Notification State and Auto-Clear', () => {
    it('computes correct resolution string and triggers transient toast upon canvas dimension mutation', () => {
      const initialDimensions = { width: 1600, height: 1000 };
      let toastMessage: string | null = null;
      let isDirty = false;

      const applyCanvasDimensions = (newW: number, newH: number) => {
        const { width: clampedW, height: clampedH } = clampMapCanvasDimensions(newW, newH);
        if (clampedW === initialDimensions.width && clampedH === initialDimensions.height) {
          return;
        }
        isDirty = true;
        toastMessage = `Canvas resized to ${clampedW} x ${clampedH} px`;
      };

      // 1. Alter to 2000 x 1200
      applyCanvasDimensions(2000, 1200);
      expect(isDirty).toBe(true);
      expect(toastMessage).toBe('Canvas resized to 2000 x 1200 px');

      // 2. Unchanged dimensions do not alter toast
      toastMessage = null;
      applyCanvasDimensions(1600, 1000); // Equal to initial
      expect(toastMessage).toBeNull();
    });

    it('auto-clears canvas toast after 3500ms timeout', () => {
      vi.useFakeTimers();
      let canvasToast: string | null = null;

      const triggerToast = (msg: string) => {
        canvasToast = msg;
        setTimeout(() => {
          if (canvasToast === msg) {
            canvasToast = null;
          }
        }, 3500);
      };

      triggerToast('Canvas resized to 1800 x 1200 px');
      expect(canvasToast).toBe('Canvas resized to 1800 x 1200 px');

      vi.advanceTimersByTime(3499);
      expect(canvasToast).toBe('Canvas resized to 1800 x 1200 px');

      vi.advanceTimersByTime(1);
      expect(canvasToast).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('QAD-TC22.6: Map Publish Pipeline Referential Integrity', () => {
    it('publishes successfully with intact referential integrity when detached draft elements are converted to structures', async () => {
      const instances = Array.from(mapRepo.workspaceInstances.values());
      const inst1 = instances[0];

      // Save draft with one active workspace and one detached element
      await mapService.saveDraft({
        floorId: testFloor.id,
        elements: [
          {
            elementRole: 'WORKSPACE',
            elementType: 'desk',
            workspaceInstanceId: inst1.id,
            x: 100,
            y: 100,
            width: 80,
            height: 80,
            rotation: 0,
            label: 'Valid Desk',
          },
          {
            elementRole: 'WORKSPACE',
            elementType: 'desk',
            workspaceInstanceId: null, // Detached element
            x: 220,
            y: 100,
            width: 80,
            height: 80,
            rotation: 0,
            label: 'Detached Desk',
          },
        ],
      });

      // Publishing must succeed because detached element was converted to STRUCTURE
      const publishResult = await mapService.publishDraft({
        floorId: testFloor.id,
      });

      expect(publishResult.published.version.status).toBe('PUBLISHED');
      expect(publishResult.published.elements).toHaveLength(2);

      const publishedBookable = publishResult.published.elements.find((el) => el.elementRole === 'WORKSPACE');
      expect(publishedBookable).toBeDefined();
      expect(publishedBookable?.workspaceInstanceId).toBe(inst1.id);

      const publishedStructure = publishResult.published.elements.find((el) => el.elementRole === 'STRUCTURE');
      expect(publishedStructure).toBeDefined();
      expect(publishedStructure?.workspaceInstanceId).toBeNull();
    });

    it('rejects publishing if a bookable workspace element somehow lacks a workspaceInstanceId', async () => {
      const corruptDraft: FloorMap = {
        floor: testFloor,
        version: {
          id: 'draft-ver',
          floorId: testFloor.id,
          versionNumber: 1,
          status: 'DRAFT',
          canvasWidth: 1600,
          canvasHeight: 1000,
          gridSize: 20,
          actorUserId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedAt: null,
        },
        elements: [
          {
            id: 'el-corrupt',
            floorId: testFloor.id,
            elementRole: 'WORKSPACE',
            elementType: 'desk',
            workspaceInstanceId: null,
            x: 100,
            y: 100,
            width: 80,
            height: 80,
            rotation: 0,
            zIndex: 1,
            label: 'Unlinked Spot',
            properties: {},
            isLocked: false,
          },
        ],
      };

      await expect(
        validateMapForPublish(mapRepo, corruptDraft)
      ).rejects.toThrow(MapValidationError);
    });
  });
});
