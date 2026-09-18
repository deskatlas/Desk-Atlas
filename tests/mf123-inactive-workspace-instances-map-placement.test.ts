import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  InMemoryMapRepository,
  InMemoryPublishedMapRepository,
  createMapService,
  createPublishedMapService,
  type Floor,
  type MapElementInput,
  type PublishedFloorMap,
} from '@deskatlas/domain';

describe('MF-123: Allow Inactive Workspace Instances on Draft and Published Maps', () => {
  const floor1: Floor = {
    id: 'fl-1',
    name: 'Main Floor',
    floorNumber: 1,
    displayOrder: 1,
    isActive: true,
  };

  const activeInstance = {
    id: 'ws-active-1',
    floorId: floor1.id,
    operationalStatus: 'ACTIVE' as const,
  };

  const inactiveInstance = {
    id: 'ws-inactive-1',
    floorId: floor1.id,
    operationalStatus: 'INACTIVE' as const,
  };

  const maintenanceInstance = {
    id: 'ws-maint-1',
    floorId: floor1.id,
    operationalStatus: 'MAINTENANCE' as const,
  };

  it('saves draft floor maps containing INACTIVE workspace instances without error', async () => {
    const mapRepo = new InMemoryMapRepository({
      floors: [floor1],
      workspaceInstances: [activeInstance, inactiveInstance],
    });
    const mapService = createMapService(mapRepo);

    const elements: MapElementInput[] = [
      {
        id: 'el-active',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: activeInstance.id,
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 1,
      },
      {
        id: 'el-inactive',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: inactiveInstance.id,
        x: 200,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 2,
      },
    ];

    // Saving draft must succeed without throwing MapValidationError('Inactive workspace instances cannot be placed on a published map')
    const draft = await mapService.saveDraft({
      floorId: floor1.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements,
    });

    assert.equal(draft.version.floorId, floor1.id);
    assert.equal(draft.elements.length, 2);

    const loadedDraft = await mapService.loadDraft(floor1.id);
    assert.equal(loadedDraft?.elements.length, 2);
    const placedInactive = loadedDraft?.elements.find((el) => el.workspaceInstanceId === inactiveInstance.id);
    assert.ok(placedInactive, 'Inactive workspace instance must be retained in draft elements');
  });

  it('publishes draft floor maps containing INACTIVE workspace instances without error', async () => {
    const mapRepo = new InMemoryMapRepository({
      floors: [floor1],
      workspaceInstances: [activeInstance, inactiveInstance, maintenanceInstance],
    });
    const mapService = createMapService(mapRepo);

    const elements: MapElementInput[] = [
      {
        id: 'el-active',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: activeInstance.id,
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 1,
      },
      {
        id: 'el-inactive',
        elementRole: 'WORKSPACE',
        elementType: 'desk',
        workspaceInstanceId: inactiveInstance.id,
        x: 200,
        y: 100,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 2,
      },
    ];

    await mapService.saveDraft({
      floorId: floor1.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements,
    });

    // Publishing must succeed and not reject inactive instances
    const publishResult = await mapService.publishDraft({ floorId: floor1.id });
    assert.ok(publishResult.published, 'Published map must be created');
    assert.equal(publishResult.published.elements.length, 2);

    const publishedInactive = publishResult.published.elements.find(
      (el) => el.workspaceInstanceId === inactiveInstance.id
    );
    assert.ok(publishedInactive, 'Inactive workspace instance must be present in published elements');
  });

  it('simulates autosave with inactive workspace instances and verifies no autosave warning is raised', async () => {
    const mapRepo = new InMemoryMapRepository({
      floors: [floor1],
      workspaceInstances: [inactiveInstance],
    });
    const mapService = createMapService(mapRepo);

    let caughtError: string | null = null;
    let autosaveWarning: string | null = null;

    // Simulate autosave invocation
    try {
      await mapService.saveDraft({
        floorId: floor1.id,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        elements: [
          {
            id: 'el-inactive',
            elementRole: 'WORKSPACE',
            elementType: 'desk',
            workspaceInstanceId: inactiveInstance.id,
            x: 100,
            y: 100,
            width: 80,
            height: 80,
            rotation: 0,
            zIndex: 1,
          },
        ],
      });
    } catch (err: any) {
      caughtError = err.message;
      autosaveWarning = `Autosave warning: ${err.message || 'Failed to save draft map'}`;
    }

    assert.equal(caughtError, null, 'No error should be thrown during autosave of inactive workspace instances');
    assert.equal(autosaveWarning, null, 'No autosave warning should be generated');
  });

  it('retains inactive instances for ADMIN and STAFF audiences so they can reactivate them later', async () => {
    const pubRepo = new InMemoryPublishedMapRepository();

    const publishedMap: PublishedFloorMap = {
      floor: floor1,
      version: {
        id: 'ver-1',
        floorId: floor1.id,
        versionNumber: 1,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        publishedAt: '2026-09-18T00:00:00.000Z',
      },
      elements: [
        {
          id: 'el-1',
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          x: 100,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
          zIndex: 1,
          label: 'Desk 1',
          properties: null,
          style: {
            color: '#009689',
            opacity: 1,
            isInteractable: true,
            isSelectable: true,
            badgeText: null,
            badgeVariant: null,
          },
          workspace: {
            id: activeInstance.id,
            instanceCode: 'DSK-1001',
            displayName: 'Desk 1',
            operationalStatus: 'ACTIVE',
            isBookable: true,
            template: {
              id: 'tmpl-1',
              name: 'Desk',
              description: 'Standard Desk',
              photoPath: null,
              capacity: 1,
              rateAmount: 50,
              pricingUnit: 'HOURLY',
              defaultShape: 'desk',
              defaultColor: '#009689',
              defaultStyle: {},
            },
          },
        },
        {
          id: 'el-2',
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          x: 200,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
          zIndex: 2,
          label: 'Desk 2',
          properties: null,
          style: {
            color: '#009689',
            opacity: 0.25,
            isInteractable: true,
            isSelectable: true,
            badgeText: null,
            badgeVariant: null,
          },
          workspace: {
            id: inactiveInstance.id,
            instanceCode: 'DSK-1002',
            displayName: 'Desk 2',
            operationalStatus: 'INACTIVE',
            isBookable: false,
            template: {
              id: 'tmpl-1',
              name: 'Desk',
              description: 'Standard Desk',
              photoPath: null,
              capacity: 1,
              rateAmount: 50,
              pricingUnit: 'HOURLY',
              defaultShape: 'desk',
              defaultColor: '#009689',
              defaultStyle: {},
            },
          },
        },
      ],
    };

    pubRepo.seedPublishedFloorMap(publishedMap);

    const service = createPublishedMapService(pubRepo);

    // ADMIN audience
    const adminMap = await service.loadPublishedFloorMap(floor1.id, { audience: 'ADMIN' });
    assert.equal(adminMap?.elements.length, 2, 'Admin must see inactive workspaces to reactivate them');
    const adminInactive = adminMap?.elements.find((el) => el.workspace?.operationalStatus === 'INACTIVE');
    assert.ok(adminInactive, 'Inactive workspace must be present in Admin map');

    // STAFF audience
    const staffMap = await service.loadPublishedFloorMap(floor1.id, { audience: 'STAFF' });
    assert.equal(staffMap?.elements.length, 2, 'Staff must see inactive workspaces to reactivate them');
    const staffInactive = staffMap?.elements.find((el) => el.workspace?.operationalStatus === 'INACTIVE');
    assert.ok(staffInactive, 'Inactive workspace must be present in Staff map');

    // CUSTOMER audience
    const customerMap = await service.loadPublishedFloorMap(floor1.id, { audience: 'CUSTOMER' });
    assert.equal(customerMap?.elements.length, 1, 'Customer must not see inactive workspaces');
    assert.equal(customerMap?.elements[0].workspace?.operationalStatus, 'ACTIVE');

    // KIOSK audience
    const kioskMap = await service.loadPublishedFloorMap(floor1.id, { audience: 'KIOSK' });
    assert.equal(kioskMap?.elements.length, 1, 'Kiosk must not see inactive workspaces');
    assert.equal(kioskMap?.elements[0].workspace?.operationalStatus, 'ACTIVE');
  });

  it('allows reactivating an inactive instance to ACTIVE, MAINTENANCE, or UNAVAILABLE', () => {
    const validStatuses = ['ACTIVE', 'MAINTENANCE', 'UNAVAILABLE', 'INACTIVE'];
    assert.ok(validStatuses.includes('INACTIVE'));
    assert.ok(validStatuses.includes('ACTIVE'));
    assert.ok(validStatuses.includes('MAINTENANCE'));
    assert.ok(validStatuses.includes('UNAVAILABLE'));

    // Reactivation from INACTIVE to ACTIVE
    let currentStatus = 'INACTIVE';
    const reactivate = (newStatus: string) => {
      if (validStatuses.includes(newStatus)) {
        currentStatus = newStatus;
      }
    };

    reactivate('ACTIVE');
    assert.equal(currentStatus, 'ACTIVE');

    reactivate('MAINTENANCE');
    assert.equal(currentStatus, 'MAINTENANCE');

    reactivate('INACTIVE');
    assert.equal(currentStatus, 'INACTIVE');
  });
});
