import type {
  CreateCustomStructureTemplateInput,
  CustomStructureTemplate,
  FloorMap,
  MapElement,
  MapElementInput,
  MapElementRole,
  MapRepository,
  PublishMapDraftInput,
  SaveMapDraftInput,
  UpdateCustomStructureTemplateInput,
} from '../models/map';
import { computeRotatedAABB } from './mapGeometryService';

const DEFAULT_CANVAS_WIDTH = 1600;
const DEFAULT_CANVAS_HEIGHT = 1000;
const MIN_CANVAS_WIDTH = 800;
const MIN_CANVAS_HEIGHT = 600;
const DEFAULT_GRID_SIZE = 20;
const MAX_CANVAS_WIDTH = 4000;
const MAX_CANVAS_HEIGHT = 3000;
const MAX_ELEMENTS_PER_FLOOR = 500;
const MAX_BOOKABLE_ELEMENTS_PER_FLOOR = 200;
const ALLOWED_ROTATIONS = [0, 90, 180, 270] as const;
const BOOKABLE_ROLE: MapElementRole = 'WORKSPACE';

export class MapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapValidationError';
  }
}

export class MapConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapConflictError';
  }
}

export function createMapService(repository: MapRepository) {
  return {
    async loadDraft(floorId?: string) {
      const floor = floorId ? await requireFloor(repository, floorId) : await repository.getDefaultFloor();
      return repository.loadDraft(floor.id);
    },

    async saveDraft(input: SaveMapDraftInput) {
      const floor = input.floorId
        ? await requireFloor(repository, input.floorId)
        : await repository.getDefaultFloor();
      const canvasWidth = normalizeCanvasSize(
        input.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
        MIN_CANVAS_WIDTH,
        MAX_CANVAS_WIDTH,
        'Canvas width'
      );
      const canvasHeight = normalizeCanvasSize(
        input.canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
        MIN_CANVAS_HEIGHT,
        MAX_CANVAS_HEIGHT,
        'Canvas height'
      );
      const gridSize = normalizeCanvasSize(input.gridSize ?? DEFAULT_GRID_SIZE, 1, 200, 'Grid size');
      const elements = await normalizeElements(
        repository,
        floor.id,
        canvasWidth,
        canvasHeight,
        gridSize,
        input.elements
      );

      return repository.saveDraft({
        floorId: floor.id,
        canvasWidth,
        canvasHeight,
        gridSize,
        elements,
        actorUserId: input.actorUserId ?? null,
      });
    },

    async publishDraft(input: PublishMapDraftInput) {
      const floor = await requireFloor(repository, input.floorId);
      const draft = await repository.loadDraft(floor.id);

      if (!draft) {
        throw new MapValidationError(`No draft map exists for floor ${floor.id}`);
      }

      await validateMapForPublish(repository, draft);
      return repository.publishDraft({ floorId: floor.id, actorUserId: input.actorUserId ?? null });
    },

    async loadPublished(floorId?: string) {
      const floor = floorId ? await requireFloor(repository, floorId) : await repository.getDefaultFloor();
      return repository.loadPublished(floor.id);
    },

    async listCustomStructureTemplates(): Promise<CustomStructureTemplate[]> {
      if (!repository.listCustomStructureTemplates) return [];
      return repository.listCustomStructureTemplates();
    },

    async getCustomStructureTemplate(id: string): Promise<CustomStructureTemplate | null> {
      if (!repository.getCustomStructureTemplate) return null;
      return repository.getCustomStructureTemplate(id);
    },

    async createCustomStructureTemplate(
      input: CreateCustomStructureTemplateInput
    ): Promise<CustomStructureTemplate> {
      if (!repository.createCustomStructureTemplate) {
        throw new Error('Custom structure templates are not supported by this repository');
      }
      const normalized = normalizeCreateCustomStructureTemplateInput(input);
      return repository.createCustomStructureTemplate(normalized);
    },

    async updateCustomStructureTemplate(
      id: string,
      input: UpdateCustomStructureTemplateInput
    ): Promise<CustomStructureTemplate> {
      if (!repository.updateCustomStructureTemplate) {
        throw new Error('Custom structure templates are not supported by this repository');
      }
      const normalized = normalizeUpdateCustomStructureTemplateInput(input);
      return repository.updateCustomStructureTemplate(id, normalized);
    },

    async deleteCustomStructureTemplate(id: string): Promise<void> {
      if (!repository.deleteCustomStructureTemplate) {
        throw new Error('Custom structure templates are not supported by this repository');
      }
      return repository.deleteCustomStructureTemplate(id);
    },
  };
}

export async function validateMapForPublish(repository: MapRepository, map: FloorMap): Promise<void> {
  if (map.version.status !== 'DRAFT') {
    throw new MapValidationError('Only a draft map version can be published');
  }

  await normalizeElements(
    repository,
    map.floor.id,
    map.version.canvasWidth,
    map.version.canvasHeight,
    map.version.gridSize,
    map.elements.map((element) => ({
      id: element.id,
      elementRole: element.elementRole,
      elementType: element.elementType,
      workspaceInstanceId: element.workspaceInstanceId,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      zIndex: element.zIndex,
      label: element.label,
      properties: element.properties,
      isLocked: element.isLocked,
    }))
  );
}

function isKioskMarkerElement(element: MapElementInput): boolean {
  return (
    element.elementType?.toUpperCase() === 'KIOSK_YOU_ARE_HERE' ||
    (Boolean(element.properties) && element.properties?.markerType === 'KIOSK_YOU_ARE_HERE')
  );
}

async function normalizeElements(
  repository: MapRepository,
  floorId: string,
  canvasWidth: number,
  canvasHeight: number,
  gridSize: number,
  elements: MapElementInput[]
): Promise<MapElementInput[]> {
  if (!Array.isArray(elements)) {
    throw new MapValidationError('Map elements must be an array');
  }

  if (elements.length > MAX_ELEMENTS_PER_FLOOR) {
    throw new MapValidationError(`A floor map can contain at most ${MAX_ELEMENTS_PER_FLOOR} elements`);
  }

  const normalized = elements.map((element, index) =>
    normalizeElementGeometry(element, index, canvasWidth, canvasHeight, gridSize)
  );

  const kioskMarkers = normalized.filter(isKioskMarkerElement);
  if (kioskMarkers.length > 1) {
    throw new MapValidationError('A floor map can contain at most one Kiosk You-Are-Here marker');
  }

  const bookable = normalized.filter((element) => element.elementRole === BOOKABLE_ROLE);

  if (bookable.length > MAX_BOOKABLE_ELEMENTS_PER_FLOOR) {
    throw new MapValidationError(
      `A floor map can contain at most ${MAX_BOOKABLE_ELEMENTS_PER_FLOOR} bookable workspace elements`
    );
  }

  const seenInstanceIds = new Set<string>();
  for (const element of normalized) {
    if (isKioskMarkerElement(element)) {
      if (element.workspaceInstanceId) {
        throw new MapValidationError('Kiosk You-Are-Here marker cannot link to a workspace instance');
      }
      if (element.elementRole !== 'INFORMATION') {
        throw new MapValidationError('Kiosk You-Are-Here marker must have element role INFORMATION');
      }
    } else if (element.elementRole === BOOKABLE_ROLE) {
      if (!element.workspaceInstanceId) {
        throw new MapValidationError('Bookable workspace map elements must link to a workspace instance');
      }

      if (seenInstanceIds.has(element.workspaceInstanceId)) {
        throw new MapConflictError(`Workspace instance is placed more than once: ${element.workspaceInstanceId}`);
      }
      seenInstanceIds.add(element.workspaceInstanceId);

      const instance = await repository.getWorkspaceInstance(element.workspaceInstanceId);
      if (!instance) {
        throw new MapValidationError(`Workspace instance does not exist: ${element.workspaceInstanceId}`);
      }
      if (instance.floorId !== floorId) {
        throw new MapValidationError('Workspace instance must belong to the same floor as the map');
      }
    } else if (element.workspaceInstanceId) {
      throw new MapValidationError('Only bookable workspace elements can link to a workspace instance');
    }
  }

  return normalized;
}

function isWallElement(elementType: string, elementRole: MapElementRole): boolean {
  const type = elementType.toLowerCase();
  return elementRole === 'STRUCTURE' && (type.includes('wall') || isThinWallElement(elementType, elementRole) || type.includes('glass'));
}

function isThinWallElement(elementType: string, elementRole: MapElementRole): boolean {
  const type = elementType.toLowerCase();
  return (
    elementRole === 'STRUCTURE' &&
    (type === 'thin_wall' ||
      type === 'thin-wall' ||
      type === 'thin' ||
      type.includes('thin_wall') ||
      type.includes('separator'))
  );
}

function isWindowElement(elementType: string, elementRole: MapElementRole): boolean {
  const type = elementType.toLowerCase();
  return elementRole === 'STRUCTURE' && (type === 'window' || type.includes('window'));
}

function normalizeElementGeometry(
  element: MapElementInput,
  index: number,
  canvasWidth: number,
  canvasHeight: number,
  gridSize: number
): MapElementInput {
  const label = (element.label && element.label.trim()) || `Map element ${index + 1}`;
  const elementType = requireNonBlank(element.elementType, `${label} type`);
  const elementRole = normalizeRole(element.elementRole, label);
  const rawX = requireFiniteNumber(element.x, `${label} x`);
  const rawY = requireFiniteNumber(element.y, `${label} y`);

  if (rawX < 0 || rawY < 0) {
    throw new MapValidationError(`${label} coordinates must be non-negative`);
  }

  const isWall = isWallElement(elementType, elementRole);
  const isThinWall = isThinWallElement(elementType, elementRole);
  const isWindow = isWindowElement(elementType, elementRole);

  const x = snapToGrid(rawX, gridSize, false);
  const y = snapToGrid(rawY, gridSize, false);
  const width = snapToGrid(requirePositiveNumber(element.width, `${label} width`), gridSize, true);
  const height = isThinWall
    ? 10
    : isWindow
    ? Math.max(10, Math.round(requirePositiveNumber(element.height ?? 20, `${label} height`)))
    : (isWall
      ? snapToGrid(20, gridSize, true)
      : snapToGrid(requirePositiveNumber(element.height, `${label} height`), gridSize, true));
  const rotation = normalizeRotation(element.rotation ?? 0, label);
  const zIndex = normalizeInteger(element.zIndex ?? index, `${label} z-index`);

  const aabb = computeRotatedAABB(x, y, width, height, rotation);
  if (
    x + width > canvasWidth ||
    y + height > canvasHeight ||
    aabb.minX < -1e-2 ||
    aabb.minY < -1e-2 ||
    aabb.maxX > canvasWidth + 1e-2 ||
    aabb.maxY > canvasHeight + 1e-2
  ) {
    throw new MapValidationError(`${label} must stay within the canvas bounds`);
  }

  return {
    id: normalizeNullableId(element.id),
    elementRole,
    elementType,
    workspaceInstanceId: normalizeNullableId(element.workspaceInstanceId),
    x,
    y,
    width,
    height,
    rotation,
    zIndex,
    label: normalizeNullableText(element.label),
    properties: requirePlainObject(element.properties ?? {}),
    isLocked: Boolean(element.isLocked),
  };
}

function normalizeRole(value: MapElementRole, label: string): MapElementRole {
  const allowed: MapElementRole[] = ['WORKSPACE', 'STRUCTURE', 'AMENITY', 'INFORMATION', 'EDITOR_AID'];
  if (!allowed.includes(value)) {
    throw new MapValidationError(`${label} has unsupported role: ${value}`);
  }
  return value;
}

async function requireFloor(repository: MapRepository, floorId: string) {
  const normalizedFloorId = requireNonBlank(floorId, 'Floor id');
  const floor = await repository.getFloor(normalizedFloorId);
  if (!floor || !floor.isActive) {
    throw new MapValidationError(`Active floor not found: ${normalizedFloorId}`);
  }
  return floor;
}

function normalizeCanvasSize(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new MapValidationError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function requireFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new MapValidationError(`${label} must be a finite number`);
  }
  return Math.round(value * 1000) / 1000;
}

function requirePositiveNumber(value: number, label: string): number {
  const normalized = requireFiniteNumber(value, label);
  if (normalized <= 0) {
    throw new MapValidationError(`${label} must be greater than zero`);
  }
  return normalized;
}

function snapToGrid(value: number, gridSize: number, enforceMinimumGrid: boolean): number {
  const snapped = Math.round(value / gridSize) * gridSize;
  if (enforceMinimumGrid) {
    return Math.max(gridSize, snapped);
  }
  return snapped;
}

function normalizeInteger(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new MapValidationError(`${label} must be an integer`);
  }
  return value;
}

function normalizeRotation(value: number, label: string): 0 | 90 | 180 | 270 {
  if (!ALLOWED_ROTATIONS.includes(value as 0 | 90 | 180 | 270)) {
    throw new MapValidationError(`${label} rotation must be 0, 90, 180, or 270`);
  }
  return value as 0 | 90 | 180 | 270;
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MapValidationError(`${label} is required`);
  }
  return value.trim();
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableId(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  return requireNonBlank(value, 'Map id');
}

function requirePlainObject(value: Record<string, unknown>): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new MapValidationError('Map element properties must be an object');
  }
  return value;
}

export function sortMapElements(elements: MapElement[]): MapElement[] {
  return [...elements].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
}

export function normalizeCreateCustomStructureTemplateInput(
  input: CreateCustomStructureTemplateInput
): CreateCustomStructureTemplateInput {
  const name = requireNonBlank(input.name, 'Custom structure template name');
  const defaultWidth = normalizeSize(input.defaultWidth ?? 120, 20, 2000, 'Default width');
  const defaultHeight = normalizeSize(input.defaultHeight ?? 60, 20, 2000, 'Default height');
  const defaultColor = requireNonBlank(input.defaultColor ?? '#CBD5E1', 'Default color');
  const borderStyle = normalizeBorderStyle(input.borderStyle);
  const category = (input.category && input.category.trim()) || 'ARCHITECTURAL';

  return {
    name,
    description: normalizeNullableText(input.description),
    defaultWidth,
    defaultHeight,
    defaultColor,
    borderStyle,
    category,
    isActive: input.isActive ?? true,
  };
}

export function normalizeUpdateCustomStructureTemplateInput(
  input: UpdateCustomStructureTemplateInput
): UpdateCustomStructureTemplateInput {
  const normalized: UpdateCustomStructureTemplateInput = {};

  if (input.name !== undefined) {
    normalized.name = requireNonBlank(input.name, 'Custom structure template name');
  }
  if (input.description !== undefined) {
    normalized.description = normalizeNullableText(input.description);
  }
  if (input.defaultWidth !== undefined) {
    normalized.defaultWidth = normalizeSize(input.defaultWidth, 20, 2000, 'Default width');
  }
  if (input.defaultHeight !== undefined) {
    normalized.defaultHeight = normalizeSize(input.defaultHeight, 20, 2000, 'Default height');
  }
  if (input.defaultColor !== undefined) {
    normalized.defaultColor = requireNonBlank(input.defaultColor, 'Default color');
  }
  if (input.borderStyle !== undefined) {
    normalized.borderStyle = normalizeBorderStyle(input.borderStyle);
  }
  if (input.category !== undefined) {
    normalized.category = (input.category && input.category.trim()) || 'ARCHITECTURAL';
  }
  if (input.isActive !== undefined) {
    normalized.isActive = Boolean(input.isActive);
  }

  return normalized;
}

function normalizeBorderStyle(value?: string | null): 'solid' | 'dashed' | 'none' {
  if (!value) return 'solid';
  const norm = value.toLowerCase().trim();
  if (norm === 'dashed') return 'dashed';
  if (norm === 'none') return 'none';
  return 'solid';
}

function normalizeSize(value: number, min: number, max: number, label: string): number {
  const num = requirePositiveNumber(value, label);
  if (num < min || num > max) {
    throw new MapValidationError(`${label} must be between ${min} and ${max}`);
  }
  return Math.round(num);
}

