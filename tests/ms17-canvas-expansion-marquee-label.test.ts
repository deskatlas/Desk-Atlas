import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'vitest';
import {
  createMapService,
  InMemoryMapRepository,
  createWorkspaceService,
  InMemoryWorkspaceRepository,
  computeFitViewZoom,
  clampMapZoom,
  clampMapCanvasDimensions,
  isCanvasDimensionValid,
  CANVAS_SIZE_PRESETS,
  DEFAULT_MAP_CANVAS_WIDTH,
  DEFAULT_MAP_CANVAS_HEIGHT,
  MIN_MAP_CANVAS_WIDTH,
  MAX_MAP_CANVAS_WIDTH,
  MIN_MAP_CANVAS_HEIGHT,
  MAX_MAP_CANVAS_HEIGHT,
  type Floor,
  type MapElementInput,
  type WorkspaceInstance,
} from '@deskatlas/domain';
import {
  computeMarqueeState,
  getMarqueeKeyframesCss,
} from '@deskatlas/ui';

describe('MS-17 / QAD-TC17: Expandable Map Canvas Dimensions and Small Workspace Label Horizontal Marquee Animation', () => {
  let floor: Floor;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let workspaceService: ReturnType<typeof createWorkspaceService>;
  let mapRepo: InMemoryMapRepository;
  let mapService: ReturnType<typeof createMapService>;
  let instance1: WorkspaceInstance;

  beforeEach(async () => {
    workspaceRepo = new InMemoryWorkspaceRepository();
    workspaceService = createWorkspaceService(workspaceRepo);
    floor = await workspaceService.createFloor({ name: 'Floor MS-17 Suite' });

    const template = await workspaceService.createTemplate({
      name: 'Focus Pod Deluxe',
      capacity: 1,
      rateAmount: 120,
      defaultShape: 'desk',
      defaultColor: '#009689',
    });

    instance1 = await workspaceService.createInstanceFromTemplate({
      templateId: template.id,
      floorId: floor.id,
    });

    mapRepo = new InMemoryMapRepository({
      floors: [floor],
      workspaceInstances: [
        { id: instance1.id, floorId: floor.id, operationalStatus: 'ACTIVE' },
      ],
    });
    mapService = createMapService(mapRepo);
  });

  describe('QAD-TC17.1: Canvas Dimension Update and Persistence', () => {
    it('persists expanded canvas dimensions in draft floor maps and allows out-of-standard elements', async () => {
      const elements: MapElementInput[] = [
        {
          id: 'element-expanded-1',
          elementRole: 'WORKSPACE',
          elementType: 'desk',
          workspaceInstanceId: instance1.id,
          x: 2100,
          y: 1300,
          width: 80,
          height: 80,
          rotation: 0,
          zIndex: 1,
        },
      ];

      // Save draft with Large 2400 x 1600 canvas dimensions
      const draft = await mapService.saveDraft({
        floorId: floor.id,
        canvasWidth: 2400,
        canvasHeight: 1600,
        gridSize: 20,
        elements,
      });

      assert.equal(draft.version.canvasWidth, 2400);
      assert.equal(draft.version.canvasHeight, 1600);
      assert.equal(draft.elements.length, 1);
      assert.equal(draft.elements[0].x, 2100);
      assert.equal(draft.elements[0].y, 1300);

      // Verify loaded draft reflects exact expanded canvas width and height
      const loadedDraft = await mapService.loadDraft(floor.id);
      assert.ok(loadedDraft);
      assert.equal(loadedDraft.version.canvasWidth, 2400);
      assert.equal(loadedDraft.version.canvasHeight, 1600);
    });

    it('provides standard dimension presets matching MS-17 specifications', () => {
      assert.equal(CANVAS_SIZE_PRESETS.length, 4);

      const standard = CANVAS_SIZE_PRESETS.find((p) => p.id === 'standard');
      assert.ok(standard);
      assert.equal(standard.width, 1600);
      assert.equal(standard.height, 1000);

      const large = CANVAS_SIZE_PRESETS.find((p) => p.id === 'large');
      assert.ok(large);
      assert.equal(large.width, 2000);
      assert.equal(large.height, 1400);

      const extraLarge = CANVAS_SIZE_PRESETS.find((p) => p.id === 'extra-large');
      assert.ok(extraLarge);
      assert.equal(extraLarge.width, 2400);
      assert.equal(extraLarge.height, 1600);

      const ultraWide = CANVAS_SIZE_PRESETS.find((p) => p.id === 'ultra-wide');
      assert.ok(ultraWide);
      assert.equal(ultraWide.width, 3200);
      assert.equal(ultraWide.height, 2000);
    });
  });

  describe('QAD-TC17.2: Canvas Boundary Clamping and Validation', () => {
    it('clamps canvas dimensions below minimum (1200 x 800) to safe boundaries', () => {
      const clampedSmall = clampMapCanvasDimensions(800, 500);
      assert.equal(clampedSmall.width, MIN_MAP_CANVAS_WIDTH);
      assert.equal(clampedSmall.height, MIN_MAP_CANVAS_HEIGHT);
      assert.equal(clampedSmall.width, 1200);
      assert.equal(clampedSmall.height, 800);
    });

    it('clamps canvas dimensions exceeding maximum (4000 x 3000) to upper boundaries', () => {
      const clampedHuge = clampMapCanvasDimensions(5000, 4500);
      assert.equal(clampedHuge.width, MAX_MAP_CANVAS_WIDTH);
      assert.equal(clampedHuge.height, MAX_MAP_CANVAS_HEIGHT);
      assert.equal(clampedHuge.width, 4000);
      assert.equal(clampedHuge.height, 3000);
    });

    it('validates canvas boundaries accurately via isCanvasDimensionValid', () => {
      assert.equal(isCanvasDimensionValid(1600, 1000), true);
      assert.equal(isCanvasDimensionValid(2400, 1600), true);
      assert.equal(isCanvasDimensionValid(3200, 2000), true);
      assert.equal(isCanvasDimensionValid(1199, 1000), false);
      assert.equal(isCanvasDimensionValid(1600, 799), false);
      assert.equal(isCanvasDimensionValid(4001, 2000), false);
      assert.equal(isCanvasDimensionValid(2000, 3001), false);
    });
  });

  describe('QAD-TC17.3: Dynamic Fit Zoom Computation for Expanded Canvases', () => {
    it('calculates proportional fit zoom scale for standard 1600 x 1000 canvas', () => {
      const zoom = computeFitViewZoom(800, 500, 1600, 1000, 0);
      // scaleX = 800 / 1600 = 0.5, scaleY = 500 / 1000 = 0.5
      assert.equal(zoom, 0.5);
    });

    it('calculates optimal fit zoom scale for expanded 2400 x 1600 canvas', () => {
      const zoom = computeFitViewZoom(1200, 800, 2400, 1600, 0);
      // scaleX = 1200 / 2400 = 0.5, scaleY = 800 / 1600 = 0.5
      assert.equal(zoom, 0.5);
    });

    it('calculates optimal fit zoom scale for Ultra-Wide 3200 x 2000 canvas in compact container', () => {
      const zoom = computeFitViewZoom(800, 600, 3200, 2000, 0);
      // scaleX = 800 / 3200 = 0.25, scaleY = 600 / 2000 = 0.30 -> optimal = 0.25
      assert.equal(zoom, 0.25);
    });

    it('clamps zoom scale to supported minimum (0.2) when container is very small', () => {
      const zoom = computeFitViewZoom(100, 100, 3200, 2000, 0);
      assert.equal(zoom, 0.2);
    });
  });

  describe('QAD-TC17.4: Marquee Animation Application on Overflown Labels', () => {
    it('activates marquee state and computes proper distance when label overflows bounding box', () => {
      // Desk container is 60px wide, but text requires 140px
      const state = computeMarqueeState({
        text: 'Focus Pod 14 (Silent Zone Deluxe)',
        contentWidth: 140,
        containerWidth: 60,
        speedSeconds: 8,
      });

      assert.equal(state.isMarquee, true);
      assert.equal(state.dataMarquee, 'true');
      assert.equal(state.className, 'da-marquee-text');
      assert.ok(state.marqueeDistance > 0);
      assert.equal(state.marqueeDurationSeconds, 8);
      assert.equal(
        (state.contentStyle as Record<string, string>)['--da-marquee-duration'],
        '8s'
      );
    });

    it('activates marquee immediately when forceMarquee is enabled', () => {
      const state = computeMarqueeState({
        text: 'Focus Pod 14',
        forceMarquee: true,
        speedSeconds: 8,
      });

      assert.equal(state.isMarquee, true);
      assert.equal(state.dataMarquee, 'true');
      assert.equal(state.className, 'da-marquee-text');
    });

    it('includes continuous keyframe styling for da-text-marquee in presentation bundle', () => {
      const css = getMarqueeKeyframesCss();
      assert.ok(css.includes('@keyframes da-text-marquee'));
      assert.ok(css.includes('.da-marquee-text'));
      assert.ok(css.includes('translateX(-50%)'));
      assert.ok(css.includes('linear infinite'));
    });
  });

  describe('QAD-TC17.5: Non-Overflow Static Rendering', () => {
    it('renders static non-animated text when label fits inside container', () => {
      // Desk container is 120px wide and text is 40px wide
      const state = computeMarqueeState({
        text: 'Desk 1',
        contentWidth: 40,
        containerWidth: 120,
      });

      assert.equal(state.isMarquee, false);
      assert.equal(state.dataMarquee, 'false');
      assert.equal(state.className, '');
      assert.equal(state.marqueeDistance, 0);
      assert.equal(state.contentStyle.textOverflow, 'ellipsis');
    });
  });
});
