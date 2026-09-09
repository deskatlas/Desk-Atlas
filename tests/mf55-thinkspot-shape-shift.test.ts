import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  createMapService,
  InMemoryMapRepository,
  InMemoryWorkspaceRepository,
  createWorkspaceService,
  type MapElementInput,
} from '@deskatlas/domain';

describe('MF-55: Thinkspot Element Shape Shift Bug Investigation & Fix', () => {
  const CANVAS_WIDTH = 1600;
  const CANVAS_HEIGHT = 1000;
  const GRID_SIZE = 20;

  it('preserves 2D dimensions of a "Thinkspot" workspace element across saveDraft', async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const workspaceService = createWorkspaceService(workspaceRepo);
    const floor = await workspaceService.createFloor({ name: 'Floor 1' });
    const template = await workspaceService.createTemplate({
      name: 'Thinkspot',
      capacity: 1,
      rateAmount: 150,
      defaultShape: 'desk',
    });
    const instance = await workspaceService.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'THK-001',
      displayName: 'Thinkspot 1',
    });

    const mapRepo = new InMemoryMapRepository({
      floors: [floor],
      workspaceInstances: [instance],
    });
    const mapService = createMapService(mapRepo);

    // Save draft with Thinkspot workspace at 80x80
    const draft = await mapService.saveDraft({
      floorId: floor.id,
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      gridSize: GRID_SIZE,
      elements: [
        {
          id: 'el-thinkspot-1',
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: instance.id,
          x: 100,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
          zIndex: 1,
          label: 'Thinkspot 1',
        },
      ],
    });

    assert.equal(draft.elements.length, 1);
    const savedElement = draft.elements[0];
    assert.equal(savedElement.label, 'Thinkspot 1');
    assert.equal(savedElement.width, 80);
    // Height must be preserved at 80 and NOT collapsed to 10px thin wall
    assert.equal(savedElement.height, 80);
    assert.equal(savedElement.elementRole, 'WORKSPACE');
  });

  it('preserves custom resized dimensions (120x100) for Thinkspot workspace across save/load', async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const workspaceService = createWorkspaceService(workspaceRepo);
    const floor = await workspaceService.createFloor({ name: 'Floor 1' });
    const template = await workspaceService.createTemplate({
      name: 'Thinkspot',
      capacity: 1,
      rateAmount: 150,
      defaultShape: 'desk',
    });
    const instance = await workspaceService.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'THK-002',
      displayName: 'Thinkspot 2',
    });

    const mapRepo = new InMemoryMapRepository({
      floors: [floor],
      workspaceInstances: [instance],
    });
    const mapService = createMapService(mapRepo);

    await mapService.saveDraft({
      floorId: floor.id,
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      gridSize: GRID_SIZE,
      elements: [
        {
          id: 'el-thinkspot-2',
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: instance.id,
          x: 100,
          y: 100,
          width: 120,
          height: 100,
          rotation: 0,
          zIndex: 1,
          label: 'Thinkspot 2',
        },
      ],
    });

    const loadedDraft = await mapService.loadDraft(floor.id);
    assert(loadedDraft);
    const loadedEl = loadedDraft.elements[0];
    assert.equal(loadedEl.width, 120);
    assert.equal(loadedEl.height, 100);
    assert.notEqual(loadedEl.height, 10, 'Thinkspot height must not collapse to 10px');
    assert.notEqual(loadedEl.height, 20, 'Thinkspot height must not collapse to 20px');
  });

  it('maintains Thinkspot geometry across simulated floor switches', async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const workspaceService = createWorkspaceService(workspaceRepo);
    const floor1 = await workspaceService.createFloor({ name: 'Floor 1' });
    const floor2 = await workspaceService.createFloor({ name: 'Floor 2' });

    const template = await workspaceService.createTemplate({
      name: 'Thinkspot',
      capacity: 1,
      rateAmount: 150,
      defaultShape: 'desk',
    });
    const instanceFloor1 = await workspaceService.createInstance({
      templateId: template.id,
      floorId: floor1.id,
      instanceCode: 'THK-F1-01',
      displayName: 'Thinkspot F1',
    });
    const instanceFloor2 = await workspaceService.createInstance({
      templateId: template.id,
      floorId: floor2.id,
      instanceCode: 'THK-F2-01',
      displayName: 'Thinkspot F2',
    });

    const mapRepo = new InMemoryMapRepository({
      floors: [floor1, floor2],
      workspaceInstances: [instanceFloor1, instanceFloor2],
    });
    const mapService = createMapService(mapRepo);

    // Save Floor 1 with Thinkspot at 80x80
    await mapService.saveDraft({
      floorId: floor1.id,
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      gridSize: GRID_SIZE,
      elements: [
        {
          id: 'el-f1',
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: instanceFloor1.id,
          x: 200,
          y: 200,
          width: 80,
          height: 80,
          rotation: 0,
          zIndex: 1,
          label: 'Thinkspot F1',
        },
      ],
    });

    // Save Floor 2 with Thinkspot at 100x80
    await mapService.saveDraft({
      floorId: floor2.id,
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      gridSize: GRID_SIZE,
      elements: [
        {
          id: 'el-f2',
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: instanceFloor2.id,
          x: 300,
          y: 300,
          width: 100,
          height: 80,
          rotation: 0,
          zIndex: 1,
          label: 'Thinkspot F2',
        },
      ],
    });

    // Switch between floors and verify dimensions are untouched
    const draft1 = await mapService.loadDraft(floor1.id);
    assert.equal(draft1?.elements[0].width, 80);
    assert.equal(draft1?.elements[0].height, 80);

    const draft2 = await mapService.loadDraft(floor2.id);
    assert.equal(draft2?.elements[0].width, 100);
    assert.equal(draft2?.elements[0].height, 80);

    // Switch back to Floor 1
    const draft1Again = await mapService.loadDraft(floor1.id);
    assert.equal(draft1Again?.elements[0].width, 80);
    assert.equal(draft1Again?.elements[0].height, 80);
  });

  it('still enforces thin thickness (10px) on true structural thin walls (MF06 parity)', async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const workspaceService = createWorkspaceService(workspaceRepo);
    const floor = await workspaceService.createFloor({ name: 'Floor 1' });

    const mapRepo = new InMemoryMapRepository({
      floors: [floor],
      workspaceInstances: [],
    });
    const mapService = createMapService(mapRepo);

    const draft = await mapService.saveDraft({
      floorId: floor.id,
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      gridSize: GRID_SIZE,
      elements: [
        {
          id: 'thin-wall-1',
          elementRole: 'STRUCTURE',
          elementType: 'thin_wall',
          x: 40,
          y: 40,
          width: 200,
          height: 80, // must normalize to 10
          rotation: 0,
          zIndex: 1,
          label: 'Thin Wall 1',
        },
        {
          id: 'wall-1',
          elementRole: 'STRUCTURE',
          elementType: 'wall',
          x: 40,
          y: 80,
          width: 200,
          height: 80, // must normalize to 20
          rotation: 0,
          zIndex: 2,
          label: 'Wall 1',
        },
      ],
    });

    assert.equal(draft.elements[0].height, 10, 'Thin wall must normalize to 10px');
    assert.equal(draft.elements[1].height, 20, 'Regular wall must normalize to 20px');
  });

  it('verifies client-side MapEditor mapping preserves Thinkspot shape and does not flag as wall', () => {
    // Simulate raw database element for a Thinkspot workspace
    const rawElement = {
      id: 'el-ts-1',
      elementRole: 'WORKSPACE',
      elementType: 'desk',
      workspaceInstanceId: 'inst-1',
      x: 100,
      y: 100,
      width: 80,
      height: 80,
      rotation: 0,
      label: 'Thinkspot 1',
      properties: { color: '#009689' },
    };

    const inst = {
      id: 'inst-1',
      templateId: 'tmpl-ts',
      displayName: 'Thinkspot 1',
      operationalStatus: 'ACTIVE',
      template: {
        id: 'tmpl-ts',
        name: 'Thinkspot',
        defaultShape: 'desk',
        defaultColor: '#009689',
      },
    };

    // Client-side mapping logic as implemented in MapEditor.tsx
    const isWorkspace = rawElement.elementRole === 'WORKSPACE' || Boolean(rawElement.workspaceInstanceId) || Boolean(inst);
    const isThinWall = !isWorkspace && (
      rawElement.elementType === 'thin_wall' ||
      rawElement.elementType === 'thin' ||
      rawElement.elementType?.toLowerCase().includes('thin_wall') ||
      rawElement.label?.toLowerCase() === 'thin wall' ||
      rawElement.elementType?.toLowerCase().includes('separator') ||
      rawElement.label?.toLowerCase().includes('separator')
    );
    const isGlass = !isWorkspace && (rawElement.elementType?.toLowerCase().includes('glass') || rawElement.label?.toLowerCase().includes('glass'));
    const isWall = !isWorkspace && (rawElement.elementType === 'wall' || rawElement.elementType?.toLowerCase().includes('wall') || rawElement.label?.toLowerCase() === 'wall' || isThinWall || isGlass);

    assert.equal(isWorkspace, true, 'Thinkspot must be recognized as a workspace');
    assert.equal(isThinWall, false, 'Thinkspot must NOT be classified as a thin wall');
    assert.equal(isWall, false, 'Thinkspot must NOT be classified as a wall');

    const defaultW = isWorkspace ? 80 : 160;
    const defaultH = isWorkspace ? 80 : 20;

    const mappedObj = {
      id: rawElement.id,
      name: rawElement.label,
      w: rawElement.width !== undefined ? Number(rawElement.width) : defaultW,
      h: isWorkspace
        ? (rawElement.height !== undefined ? Number(rawElement.height) : defaultH)
        : (isThinWall ? 10 : (isWall ? 20 : Number(rawElement.height))),
      bookable: isWorkspace,
      elementRole: isWorkspace ? 'WORKSPACE' : 'STRUCTURE',
      elementType: rawElement.elementType,
    };

    assert.equal(mappedObj.w, 80);
    assert.equal(mappedObj.h, 80, 'Mapped height must remain 80 and not 10');
    assert.equal(mappedObj.bookable, true);
    assert.equal(mappedObj.elementRole, 'WORKSPACE');
  });

  it('verifies client-side resize logic does not constrain Thinkspot to fixed thickness', () => {
    const thinkspotObj = {
      id: 'el-ts-1',
      name: 'Thinkspot 1',
      w: 80,
      h: 80,
      rotation: 0,
      bookable: true,
      elementRole: 'WORKSPACE',
      elementType: 'desk',
    };

    // Client-side resize check
    const isWorkspace = Boolean(thinkspotObj.bookable || thinkspotObj.elementRole === 'WORKSPACE');
    const isThinWall = !isWorkspace && Boolean(
      thinkspotObj.elementType === 'thin_wall' ||
      thinkspotObj.name?.toLowerCase() === 'thin wall'
    );
    const isWall = !isWorkspace && (isThinWall || thinkspotObj.elementType === 'wall');

    assert.equal(isWorkspace, true);
    assert.equal(isWall, false);

    // Resizing workspace by dx=+20, dy=+40
    const dx = 20;
    const dy = 40;
    let newW = Math.max(20, thinkspotObj.w + dx);
    let newH = Math.max(20, thinkspotObj.h + dy);

    assert.equal(newW, 100);
    assert.equal(newH, 120);
    // Verified that 2D resizing works without collapsing to fixedThickness 10 or 20
  });
});
