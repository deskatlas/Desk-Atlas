import type {
  Floor,
  WorkspaceAvailabilityBlockReason,
  WorkspaceInstanceDetails,
  WorkspaceOperationalStatus,
  WorkspaceTemplate,
} from '../models/workspace';
import type {
  PublishedFloorMap,
  PublishedMapAudience,
  PublishedMapElement,
  PublishedMapRepository,
  PublishedMapVersion,
  PublishedWorkspaceSummary,
} from '../models/publishedMap';
import { getWorkspaceAvailabilityStatus } from './workspaceService';

type FloorRow = {
  id: string;
  name: string;
  floor_number: number | null;
  display_order: number;
  is_active: boolean;
};

type PublishedVersionRow = {
  id: string;
  floor_id: string;
  version_number: number;
  canvas_width: number;
  canvas_height: number;
  grid_size: number;
  published_at: string | null;
};

type WorkspaceTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  photo_path: string | null;
  capacity: number;
  rate_amount: string | number;
  pricing_unit: 'HOURLY';
  default_shape: string;
  default_color: string;
  default_style: Record<string, unknown> | null;
  is_active: boolean;
};

type WorkspaceInstanceRow = {
  id: string;
  template_id: string;
  floor_id: string;
  instance_code: string;
  display_name: string;
  operational_status: WorkspaceOperationalStatus;
  template: WorkspaceTemplateRow | null;
};

type PublishedElementRow = {
  id: string;
  element_role: 'WORKSPACE' | 'STRUCTURE' | 'AMENITY' | 'INFORMATION' | 'EDITOR_AID';
  element_type: string;
  x: string | number;
  y: string | number;
  width: string | number;
  height: string | number;
  rotation: 0 | 90 | 180 | 270;
  z_index: number;
  label: string | null;
  properties: Record<string, unknown> | null;
  workspace_instance: WorkspaceInstanceRow | null;
};

export class SupabasePublishedMapRepository implements PublishedMapRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    const supabaseUrl =
      options?.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for published map routes');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for published map routes');
    }

    this.restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
  }

  async listPublishedFloors(): Promise<Floor[]> {
    const publishedVersions = await this.request<Array<{ floor_id: string }>>(
      '/map_versions?select=floor_id&status=eq.PUBLISHED'
    );
    const floorIds = [...new Set(publishedVersions.map((row) => row.floor_id))];

    if (floorIds.length === 0) {
      return [];
    }

    const floors = await this.request<FloorRow[]>(
      `/floors?select=*&is_active=eq.true&id=in.(${floorIds.map(encodeURIComponent).join(',')})&order=display_order.asc,name.asc`
    );

    return floors.map(mapFloor);
  }

  async loadPublishedFloorMap(
    floorId: string,
    options?: { audience?: PublishedMapAudience }
  ): Promise<PublishedFloorMap | null> {
    const [floorRow] = await this.request<FloorRow[]>(
      `/floors?select=*&id=eq.${encodeURIComponent(floorId)}&is_active=eq.true&limit=1`
    );
    if (!floorRow) {
      return null;
    }

    const [versionRow] = await this.request<PublishedVersionRow[]>(
      `/map_versions?select=id,floor_id,version_number,canvas_width,canvas_height,grid_size,published_at&floor_id=eq.${encodeURIComponent(
        floorId
      )}&status=eq.PUBLISHED&limit=1`
    );
    if (!versionRow) {
      return null;
    }

    const elementRows = await this.request<PublishedElementRow[]>(
      `/map_elements?select=id,element_role,element_type,x,y,width,height,rotation,z_index,label,properties,workspace_instance:workspace_instances(id,template_id,floor_id,instance_code,display_name,operational_status,template:workspace_templates(id,name,description,photo_path,capacity,rate_amount,pricing_unit,default_shape,default_color,default_style,is_active))&map_version_id=eq.${encodeURIComponent(
        versionRow.id
      )}&order=z_index.asc,id.asc`
    );

    const isStaffOrAdmin = options?.audience === 'STAFF' || options?.audience === 'ADMIN';

    return {
      floor: mapFloor(floorRow),
      version: mapPublishedVersion(versionRow),
      elements: elementRows
        .filter((row) => {
          if (row.element_role === 'EDITOR_AID') return false;
          if (row.element_role === 'WORKSPACE') {
            if (!row.workspace_instance || !row.workspace_instance.template) return false;
            if (row.workspace_instance.template.is_active === false) return false;
            if (!isStaffOrAdmin && row.workspace_instance.operational_status === 'INACTIVE') return false;
          }
          return true;
        })
        .map((row) => mapPublishedElement(row, floorRow)),
    };
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('apikey', this.serviceRoleKey);
    headers.set('Authorization', `Bearer ${this.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${this.restUrl}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase published map request failed (${response.status}): ${detail}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }
}

function mapFloor(row: FloorRow): Floor {
  return {
    id: row.id,
    name: row.name,
    floorNumber: row.floor_number,
    displayOrder: row.display_order,
    isActive: row.is_active,
  };
}

function mapPublishedVersion(row: PublishedVersionRow): PublishedMapVersion {
  return {
    id: row.id,
    versionNumber: row.version_number,
    canvasWidth: row.canvas_width,
    canvasHeight: row.canvas_height,
    gridSize: row.grid_size,
    publishedAt: row.published_at,
  };
}

export function mapPublishedElement(row: PublishedElementRow, floor: FloorRow): PublishedMapElement {
  return {
    id: row.id,
    elementRole: row.element_role === 'EDITOR_AID' ? 'INFORMATION' : row.element_role,
    elementType: row.element_type,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    rotation: row.rotation,
    zIndex: row.z_index,
    label: row.label,
    style: sanitizeStyle(row.properties),
    workspace: row.workspace_instance ? mapPublishedWorkspace(row.workspace_instance, floor, row.properties) : null,
  };
}

function mapPublishedWorkspace(
  row: WorkspaceInstanceRow,
  floor: FloorRow,
  elementProperties?: Record<string, unknown> | null
): PublishedWorkspaceSummary {
  if (!row.template) {
    throw new Error(`Workspace instance ${row.id} is missing its template relation`);
  }

  const instance = mapWorkspaceInstanceDetails(row, floor);
  const availability = getWorkspaceAvailabilityStatus(instance);
  const elementTags = extractRecommendationTags(elementProperties);
  const templateTags = extractRecommendationTags(instance.template.defaultStyle);
  const tags = elementTags ?? templateTags;
  const photoPosition = extractPhotoPosition(instance.template.defaultStyle);

  return {
    workspaceInstanceId: instance.id,
    templateId: instance.templateId,
    floorId: instance.floorId,
    instanceCode: instance.instanceCode,
    displayName: instance.displayName,
    templateName: instance.template.name,
    description: instance.template.description,
    photoPath: instance.template.photoPath,
    photoPosition,
    capacity: instance.template.capacity,
    rateAmount: instance.template.rateAmount,
    pricingUnit: instance.template.pricingUnit,
    operationalStatus: instance.operationalStatus,
    isBookable: availability.isBookable,
    blockingReason: availability.blockingReason as WorkspaceAvailabilityBlockReason | null,
    tags: tags && tags.length > 0 ? tags : undefined,
  };
}

function extractPhotoPosition(
  defaultStyle: Record<string, unknown> | null | undefined
): { x: number; y: number } | undefined {
  if (!defaultStyle) return undefined;
  const pos = defaultStyle.photoPosition as any;
  if (pos && typeof pos === 'object' && typeof pos.x === 'number' && typeof pos.y === 'number') {
    return { x: pos.x, y: pos.y };
  }
  return undefined;
}

function extractRecommendationTags(props: Record<string, unknown> | null | undefined): string[] | undefined {
  if (!props) return undefined;
  const tagsCandidate = props.recommendationTags ?? props.recommendations ?? props.tags;
  if (Array.isArray(tagsCandidate)) {
    const list = tagsCandidate.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0);
    return list.length > 0 ? list : undefined;
  }
  if (typeof tagsCandidate === 'object' && tagsCandidate !== null) {
    const flattened = Object.values(tagsCandidate)
      .flat()
      .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0);
    return flattened.length > 0 ? flattened : undefined;
  }
  return undefined;
}

function mapWorkspaceInstanceDetails(row: WorkspaceInstanceRow, floor: FloorRow): WorkspaceInstanceDetails {
  return {
    id: row.id,
    templateId: row.template_id,
    floorId: row.floor_id,
    instanceCode: row.instance_code,
    displayName: row.display_name,
    operationalStatus: row.operational_status,
    template: mapWorkspaceTemplate(row.template!),
    floor: mapFloor(floor),
  };
}

function mapWorkspaceTemplate(row: WorkspaceTemplateRow): WorkspaceTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    photoPath: row.photo_path,
    capacity: row.capacity,
    rateAmount: Number(row.rate_amount),
    pricingUnit: row.pricing_unit,
    defaultShape: row.default_shape,
    defaultColor: row.default_color,
    defaultStyle: row.default_style ?? {},
    isActive: row.is_active,
  };
}

function sanitizeStyle(
  properties: Record<string, unknown> | null
): Record<string, string | number | boolean | null> {
  if (!properties) {
    return {};
  }

  const allowedKeys = new Set([
    'color',
    'shape',
    'kind',
    'spaceType',
    'zone',
    'fillColor',
    'strokeColor',
    'textColor',
    'opacity',
    'icon',
    'amenityType',
    'markerType',
    'kioskId',
    'borderStyle',
    'isCustomStructure',
    'templateId',
    'category',
  ]);
  const sanitized: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (!allowedKeys.has(key)) {
      continue;
    }

    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      sanitized[key] = value as string | number | boolean | null;
    }
  }

  return sanitized;
}
