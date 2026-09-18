import type { Floor } from './workspace';

export type MapVersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type MapElementRole =
  | 'WORKSPACE'
  | 'STRUCTURE'
  | 'AMENITY'
  | 'INFORMATION'
  | 'EDITOR_AID';

export interface MapVersion {
  id: string;
  floorId: string;
  versionNumber: number;
  status: MapVersionStatus;
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  createdByUserId: string | null;
  publishedByUserId: string | null;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
}

export interface MapElement {
  id: string;
  mapVersionId: string;
  elementRole: MapElementRole;
  elementType: string;
  workspaceInstanceId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  zIndex: number;
  label: string | null;
  properties: Record<string, unknown>;
  isLocked: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FloorMap {
  floor: Floor;
  version: MapVersion;
  elements: MapElement[];
}

export interface MapElementInput {
  id?: string;
  elementRole: MapElementRole;
  elementType: string;
  workspaceInstanceId?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: 0 | 90 | 180 | 270;
  zIndex?: number;
  label?: string | null;
  properties?: Record<string, unknown>;
  isLocked?: boolean;
}

export interface SaveMapDraftInput {
  floorId?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  gridSize?: number;
  elements: MapElementInput[];
  actorUserId?: string | null;
}

export interface PublishMapDraftInput {
  floorId: string;
  actorUserId?: string | null;
}

export interface WorkspaceInstancePlacement {
  id: string;
  floorId: string;
  operationalStatus: string;
}

export interface MapPublishResult {
  published: FloorMap;
  archivedVersionIds: string[];
}

export interface CustomStructureTemplate {
  id: string;
  name: string;
  description: string | null;
  defaultWidth: number;
  defaultHeight: number;
  defaultColor: string;
  borderStyle: 'solid' | 'dashed' | 'none';
  category: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateCustomStructureTemplateInput {
  name: string;
  description?: string | null;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultColor?: string;
  borderStyle?: 'solid' | 'dashed' | 'none';
  category?: string;
  isActive?: boolean;
}

export interface UpdateCustomStructureTemplateInput {
  name?: string;
  description?: string | null;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultColor?: string;
  borderStyle?: 'solid' | 'dashed' | 'none';
  category?: string;
  isActive?: boolean;
}

export interface MapRepository {
  getDefaultFloor(): Promise<Floor>;
  getFloor(floorId: string): Promise<Floor | null>;
  getWorkspaceInstance(instanceId: string): Promise<WorkspaceInstancePlacement | null>;
  loadDraft(floorId: string): Promise<FloorMap | null>;
  loadPublished(floorId: string): Promise<FloorMap | null>;
  listVersions(floorId: string): Promise<MapVersion[]>;
  saveDraft(input: Required<Omit<SaveMapDraftInput, 'actorUserId'>> & { actorUserId: string | null }): Promise<FloorMap>;
  publishDraft(input: PublishMapDraftInput): Promise<MapPublishResult>;
  listCustomStructureTemplates?(): Promise<CustomStructureTemplate[]>;
  getCustomStructureTemplate?(id: string): Promise<CustomStructureTemplate | null>;
  createCustomStructureTemplate?(input: CreateCustomStructureTemplateInput): Promise<CustomStructureTemplate>;
  updateCustomStructureTemplate?(id: string, input: UpdateCustomStructureTemplateInput): Promise<CustomStructureTemplate>;
  deleteCustomStructureTemplate?(id: string): Promise<void>;
}
