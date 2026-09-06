import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  InMemoryMapRepository,
  InMemoryWorkspaceRepository,
  InMemoryPublishedMapRepository,
  MapConflictError,
  MapValidationError,
  PublishedMapNotFoundError,
  createMapService,
  createWorkspaceService,
  createPublishedMapService,
  computeFitViewZoom,
  clampMapZoom,
  getSavedMapZoom,
  saveMapZoom,
  getMapViewportBounds,
  DEFAULT_MAP_CANVAS_WIDTH,
  DEFAULT_MAP_CANVAS_HEIGHT,
  DEFAULT_MAP_GRID_SIZE,
  MIN_MAP_ZOOM,
  MAX_MAP_ZOOM,
  type Floor,
  type MapElementInput,
  type PublishedFloorMap,
  type PublishedWorkspaceSummary,
} from "@deskatlas/domain";

describe("t02: Map Persistence, Geometry & Viewport", () => {
  const floorA: Floor = {
    id: "floor-a",
    name: "Floor A",
    floorNumber: 1,
    displayOrder: 0,
    isActive: true,
  };

  const floorB: Floor = {
    id: "floor-b",
    name: "Floor B",
    floorNumber: 2,
    displayOrder: 1,
    isActive: true,
  };

  it("saves, validates, and publishes draft floor maps (M02)", async () => {
    const mapRepository = new InMemoryMapRepository({
      floors: [floorA, floorB],
      workspaceInstances: [
        { id: "ws-a1", floorId: floorA.id, operationalStatus: "ACTIVE" },
        { id: "ws-a2", floorId: floorA.id, operationalStatus: "ACTIVE" },
        { id: "ws-b1", floorId: floorB.id, operationalStatus: "ACTIVE" },
      ],
    });

    const mapService = createMapService(mapRepository);

    const validElements: MapElementInput[] = [
      {
        id: "wall-1",
        elementRole: "STRUCTURE",
        elementType: "wall",
        x: 40,
        y: 40,
        width: 200,
        height: 20,
        rotation: 0,
        zIndex: 1,
      },
      {
        id: "spot-1",
        elementRole: "WORKSPACE",
        elementType: "desk",
        workspaceInstanceId: "ws-a1",
        x: 80,
        y: 80,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 2,
      },
    ];

    const draft = await mapService.saveDraft({
      floorId: floorA.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: validElements,
    });

    assert.equal(draft.version.floorId, floorA.id);
    assert.equal(draft.elements.length, 2);

    const loadedDraft = await mapService.loadDraft(floorA.id);
    assert.equal(loadedDraft?.version.floorId, floorA.id);

    const published = await mapService.publishDraft({ floorId: floorA.id });
    assert.equal(published.published.version.floorId, floorA.id);
    assert.equal(published.published.version.versionNumber, 1);
    assert.equal(published.published.elements.length, 2);
  });

  it("serves published map data and projection (M04)", async () => {
    const publishedMapRepository = new InMemoryPublishedMapRepository();
    const service = createPublishedMapService(publishedMapRepository);

    const publishedFloor: PublishedFloorMap = {
      floor: {
        id: "floor-1",
        name: "First Floor",
        floorNumber: 1,
        displayOrder: 1,
        isActive: true,
      },
      version: {
        id: "v-1",
        versionNumber: 1,
        canvasWidth: 1600,
        canvasHeight: 1000,
        gridSize: 20,
        publishedAt: "2026-08-25T09:00:00.000Z",
      },
      elements: [
        {
          id: "structure-1",
          elementRole: "STRUCTURE",
          elementType: "zone",
          x: 50,
          y: 50,
          width: 200,
          height: 120,
          rotation: 0,
          zIndex: 1,
          label: "Zone 1",
          style: {},
          workspace: null,
        },
        {
          id: "desk-elem-1",
          elementRole: "WORKSPACE",
          elementType: "desk",
          workspaceInstanceId: "ws-1",
          x: 100,
          y: 100,
          width: 80,
          height: 80,
          rotation: 0,
          zIndex: 2,
          label: "Desk 1",
          style: {},
          workspace: {
            workspaceInstanceId: "ws-1",
            templateId: "tpl-1",
            floorId: "floor-1",
            instanceCode: "D1",
            displayName: "Desk 1",
            templateName: "Hot Desk",
            capacity: 1,
            rateAmount: 100,
            pricingUnit: "HOURLY",
            operationalStatus: "ACTIVE",
            isBookable: true,
            blockingReason: null,
          },
        },
      ],
    };

    publishedMapRepository.seedPublishedFloorMap(publishedFloor);

    const result = await service.loadPublishedFloorMap("floor-1");
    assert.equal(result.floor.id, "floor-1");
    assert.equal(result.elements.length, 2);
    assert.equal(result.elements[1].workspace?.displayName, "Desk 1");

    await assert.rejects(
      () => service.loadPublishedFloorMap("non-existent"),
      PublishedMapNotFoundError
    );
  });

  it("handles rectangle workspace dimensions and geometry (MF05)", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const workspaceService = createWorkspaceService(workspaceRepo);
    const floor = await workspaceService.createFloor({ name: "Floor 1" });

    const rectTemplate = await workspaceService.createTemplate({
      name: "Conference Room Alpha",
      capacity: 10,
      rateAmount: 800,
      defaultShape: "rectangle",
      defaultColor: "#009689",
    });
    assert.equal(rectTemplate.defaultShape, "rectangle");

    const rectInstance = await workspaceService.createInstanceFromTemplate({
      templateId: rectTemplate.id,
      floorId: floor.id,
    });
    assert.equal(rectInstance.template.defaultShape, "rectangle");

    const mapRepo = new InMemoryMapRepository({
      floors: [floor],
      workspaceInstances: [
        { id: rectInstance.id, floorId: floor.id, operationalStatus: "ACTIVE" },
      ],
    });
    const mapService = createMapService(mapRepo);

    const draft = await mapService.saveDraft({
      floorId: floor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: [
        {
          id: "rect-1",
          elementRole: "WORKSPACE",
          elementType: "rectangle",
          workspaceInstanceId: rectInstance.id,
          x: 100,
          y: 100,
          width: 120,
          height: 80,
          rotation: 0,
          zIndex: 1,
        },
      ],
    });

    assert.equal(draft.elements[0].width, 120);
    assert.equal(draft.elements[0].height, 80);
  });

  it("enforces wall structure sizing and thin thickness rules (MF06)", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const workspaceService = createWorkspaceService(workspaceRepo);
    const floor = await workspaceService.createFloor({ name: "Floor 1" });

    const mapRepo = new InMemoryMapRepository({
      floors: [floor],
      workspaceInstances: [],
    });
    const mapService = createMapService(mapRepo);

    const draft = await mapService.saveDraft({
      floorId: floor.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements: [
        {
          id: "wall-1",
          elementRole: "STRUCTURE",
          elementType: "wall",
          x: 40,
          y: 40,
          width: 200,
          height: 80, // Wall height should normalize to fixed 20
          rotation: 0,
          zIndex: 1,
        },
      ],
    });

    assert.equal(draft.elements[0].height, 20);
  });

  it("preserves amenity colors and custom icons across drafts and published maps (MF07)", async () => {
    const mapRepo = new InMemoryMapRepository({
      floors: [floorA],
      workspaceInstances: [],
    });
    const mapService = createMapService(mapRepo);

    const elements: MapElementInput[] = [
      {
        id: "elem-restroom",
        elementRole: "AMENITY",
        elementType: "restroom",
        x: 60,
        y: 60,
        width: 100,
        height: 80,
        rotation: 0,
        zIndex: 1,
        label: "Restroom",
        properties: { color: "#E0F2FE", icon: "restroom" },
      },
      {
        id: "elem-pantry",
        elementRole: "AMENITY",
        elementType: "pantry",
        x: 180,
        y: 60,
        width: 100,
        height: 80,
        rotation: 0,
        zIndex: 2,
        label: "Pantry",
        properties: { color: "#FEF3C7", icon: "pantry" },
      },
    ];

    const draft = await mapService.saveDraft({
      floorId: floorA.id,
      canvasWidth: 1600,
      canvasHeight: 1000,
      gridSize: 20,
      elements,
    });

    assert.equal(draft.elements[0].properties?.color, "#E0F2FE");
    assert.equal(draft.elements[1].properties?.icon, "pantry");
  });

  it("computes zoom bounds, clamping, and viewport bounds parity (MF26)", () => {
    assert.equal(clampMapZoom(0.05), 0.2);
    assert.equal(clampMapZoom(0.2), 0.2);
    assert.equal(clampMapZoom(1.0), 1.0);
    assert.equal(clampMapZoom(1.5), 1.5);
    assert.equal(clampMapZoom(2.0), 2.0);
    assert.equal(clampMapZoom(3.5), 2.0);

    const bounds = getMapViewportBounds(1600, 1000, 1.0);
    assert.equal(bounds.canvasWidth, 1600);
    assert.equal(bounds.canvasHeight, 1000);
    assert.equal(bounds.zoom, 1.0);

    const zoom = computeFitViewZoom(800, 500, 1600, 1000, 0);
    assert.ok(zoom > 0 && zoom <= 1.0);
  });
});
