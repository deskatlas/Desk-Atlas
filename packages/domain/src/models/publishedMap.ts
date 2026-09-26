import type { Floor, PricingUnit, WorkspaceAvailabilityBlockReason, WorkspaceOperationalStatus } from './workspace';

export interface PublishedMapVersion {
  id: string;
  versionNumber: number;
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  publishedAt: string | null;
}

export interface PublishedWorkspaceSummary {
  workspaceInstanceId: string;
  templateId: string;
  floorId: string;
  instanceCode: string;
  displayName: string;
  templateName: string;
  description: string | null;
  photoPath: string | null;
  photoPosition?: { x: number; y: number };
  capacity: number;
  rateAmount: number;
  pricingUnit: PricingUnit;
  operationalStatus: WorkspaceOperationalStatus;
  maintenanceNote?: string | null;
  isBookable: boolean;
  blockingReason: WorkspaceAvailabilityBlockReason | null;
  tags?: string[];
}

export interface PublishedMapElement {
  id: string;
  elementRole: 'WORKSPACE' | 'STRUCTURE' | 'AMENITY' | 'INFORMATION';
  elementType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  zIndex: number;
  label: string | null;
  style: Record<string, string | number | boolean | null>;
  workspace: PublishedWorkspaceSummary | null;
}

export type PublishedMapAudience = 'CUSTOMER' | 'KIOSK' | 'STAFF' | 'ADMIN';

export interface PublishedFloorMap {
  floor: Floor;
  version: PublishedMapVersion;
  elements: PublishedMapElement[];
}

export interface PublishedMapRepository {
  listPublishedFloors(): Promise<Floor[]>;
  loadPublishedFloorMap(floorId: string, options?: { audience?: PublishedMapAudience }): Promise<PublishedFloorMap | null>;
  loadAllPublishedFloorMaps?(options?: { audience?: PublishedMapAudience }): Promise<PublishedFloorMap[]>;
}
