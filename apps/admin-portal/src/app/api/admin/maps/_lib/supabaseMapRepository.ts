import type {
  CreateCustomStructureTemplateInput,
  CustomStructureTemplate,
  Floor,
  FloorMap,
  MapElement,
  MapElementInput,
  MapPublishResult,
  MapRepository,
  MapVersion,
  MapVersionStatus,
  PublishMapDraftInput,
  SaveMapDraftInput,
  UpdateCustomStructureTemplateInput,
  WorkspaceInstancePlacement,
} from '@deskatlas/domain';

type CustomStructureTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  default_width: number;
  default_height: number;
  default_color: string;
  border_style: 'solid' | 'dashed' | 'none';
  category: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

type FloorRow = {
  id: string;
  name: string;
  floor_number: number | null;
  display_order: number;
  is_active: boolean;
};

type MapVersionRow = {
  id: string;
  floor_id: string;
  version_number: number;
  status: MapVersionStatus;
  canvas_width: number;
  canvas_height: number;
  grid_size: number;
  created_by_user_id: string | null;
  published_by_user_id: string | null;
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
};

type MapElementRow = {
  id: string;
  map_version_id: string;
  element_role: MapElement['elementRole'];
  element_type: string;
  workspace_instance_id: string | null;
  x: string | number;
  y: string | number;
  width: string | number;
  height: string | number;
  rotation: 0 | 90 | 180 | 270;
  z_index: number;
  label: string | null;
  properties: Record<string, unknown> | null;
  is_locked: boolean;
  created_at?: string;
  updated_at?: string;
};

type WorkspaceInstanceRow = {
  id: string;
  floor_id: string;
  operational_status: string;
};

export class SupabaseMapRepository implements MapRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for M02 map routes');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for controlled pre-auth Admin map routes');
    }

    this.restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
  }

  async getDefaultFloor(): Promise<Floor> {
    const [row] = await this.request<FloorRow[]>(
      '/floors?select=*&is_active=eq.true&order=display_order.asc,name.asc&limit=1'
    );
    if (!row) throw new Error('No active floor exists');
    return mapFloor(row);
  }

  async getFloor(floorId: string): Promise<Floor | null> {
    const [row] = await this.request<FloorRow[]>(`/floors?select=*&id=eq.${encodeURIComponent(floorId)}&limit=1`);
    return row ? mapFloor(row) : null;
  }

  async getWorkspaceInstance(instanceId: string): Promise<WorkspaceInstancePlacement | null> {
    const [row] = await this.request<WorkspaceInstanceRow[]>(
      `/workspace_instances?select=id,floor_id,operational_status&id=eq.${encodeURIComponent(instanceId)}&limit=1`
    );
    return row
      ? {
          id: row.id,
          floorId: row.floor_id,
          operationalStatus: row.operational_status,
        }
      : null;
  }

  async loadDraft(floorId: string): Promise<FloorMap | null> {
    return this.loadByStatus(floorId, 'DRAFT');
  }

  async loadPublished(floorId: string): Promise<FloorMap | null> {
    return this.loadByStatus(floorId, 'PUBLISHED');
  }

  async listVersions(floorId: string): Promise<MapVersion[]> {
    const rows = await this.request<MapVersionRow[]>(
      `/map_versions?select=*&floor_id=eq.${encodeURIComponent(floorId)}&order=version_number.asc`
    );
    return rows.map(mapVersion);
  }

  async saveDraft(
    input: Required<Omit<SaveMapDraftInput, 'actorUserId'>> & { actorUserId: string | null }
  ): Promise<FloorMap> {
    const floor = await this.getFloor(input.floorId);
    if (!floor) throw new Error(`Floor not found: ${input.floorId}`);

    let version = (await this.loadDraft(input.floorId))?.version;
    if (!version) {
      try {
        const nextVersionNumber = await this.nextVersionNumber(input.floorId);
        const [created] = await this.request<MapVersionRow[]>('/map_versions', {
          method: 'POST',
          body: JSON.stringify({
            floor_id: input.floorId,
            version_number: nextVersionNumber,
            status: 'DRAFT',
            canvas_width: input.canvasWidth,
            canvas_height: input.canvasHeight,
            grid_size: input.gridSize,
            created_by_user_id: input.actorUserId,
          }),
          prefer: 'return=representation',
        });
        version = mapVersion(created);
      } catch (err: any) {
        // Handle race condition where another concurrent save or process created the DRAFT
        const existingDraft = (await this.loadDraft(input.floorId))?.version;
        if (existingDraft) {
          version = existingDraft;
        } else {
          // Retry once with refreshed next version number
          const retryVersionNumber = await this.nextVersionNumber(input.floorId);
          const [created] = await this.request<MapVersionRow[]>('/map_versions', {
            method: 'POST',
            body: JSON.stringify({
              floor_id: input.floorId,
              version_number: retryVersionNumber,
              status: 'DRAFT',
              canvas_width: input.canvasWidth,
              canvas_height: input.canvasHeight,
              grid_size: input.gridSize,
              created_by_user_id: input.actorUserId,
            }),
            prefer: 'return=representation',
          });
          version = mapVersion(created);
        }
      }
    } else {
      const [updated] = await this.request<MapVersionRow[]>(
        `/map_versions?id=eq.${encodeURIComponent(version.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            canvas_width: input.canvasWidth,
            canvas_height: input.canvasHeight,
            grid_size: input.gridSize,
          }),
          prefer: 'return=representation',
        }
      );
      version = mapVersion(updated);
    }

    await this.request<void>(`/map_elements?map_version_id=eq.${encodeURIComponent(version.id)}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });

    if (input.elements.length > 0) {
      await this.request<MapElementRow[]>('/map_elements', {
        method: 'POST',
        body: JSON.stringify(input.elements.map((element) => mapElementPayload(version.id, element))),
        prefer: 'return=minimal',
      });
    }

    const elements = await this.loadElements(version.id);
    return { floor, version, elements };
  }

  async publishDraft(input: PublishMapDraftInput): Promise<MapPublishResult> {
    let actorUserId = input.actorUserId;
    if (!actorUserId) {
      const profiles = await this.request<Array<{ user_id: string }>>(
        '/staff_profiles?role=eq.ADMIN&is_active=eq.true&limit=1'
      );
      if (profiles.length > 0 && profiles[0].user_id) {
        actorUserId = profiles[0].user_id;
      }
    }

    const draft = await this.loadDraft(input.floorId);
    if (!draft) throw new Error(`No draft map exists for floor ${input.floorId}`);

    const beforeVersions = await this.listVersions(input.floorId);
    const published = await this.request<FloorMapPayload>('/rpc/publish_map_version', {
      method: 'POST',
      body: JSON.stringify({
        p_draft_version_id: draft.version.id,
        p_published_by_user_id: actorUserId,
      }),
    });
    const archivedVersionIds = beforeVersions
      .filter((version) => version.status === 'PUBLISHED')
      .map((version) => version.id);

    try {
      const floorInstances = await this.request<Array<{ id: string; operational_status: string }>>(
        `/workspace_instances?floor_id=eq.${encodeURIComponent(input.floorId)}&select=id,operational_status`
      );
      const placedInstanceIds = new Set(
        published.elements
          .map((e) => e.workspace_instance_id)
          .filter((id): id is string => Boolean(id))
      );

      for (const instance of floorInstances) {
        if (!placedInstanceIds.has(instance.id)) {
          const candidates = await this.request<any[]>(
            `/reservation_candidates?workspace_instance_id=eq.${encodeURIComponent(instance.id)}&select=id&limit=1`
          );

          if (candidates.length > 0) {
            if (instance.operational_status !== 'INACTIVE') {
              await this.request<unknown>(`/workspace_instances?id=eq.${encodeURIComponent(instance.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ operational_status: 'INACTIVE' }),
              });
            }
          } else {
            try {
              await this.request<unknown>(`/workspace_instances?id=eq.${encodeURIComponent(instance.id)}`, {
                method: 'DELETE',
              });
            } catch {
              if (instance.operational_status !== 'INACTIVE') {
                await this.request<unknown>(`/workspace_instances?id=eq.${encodeURIComponent(instance.id)}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ operational_status: 'INACTIVE' }),
                });
              }
            }
          }
        }
      }
    } catch {
      // Non-blocking for publish response
    }

    return {
      published: {
        floor: mapFloor(published.floor),
        version: mapVersion(published.version),
        elements: published.elements.map(mapElement),
      },
      archivedVersionIds,
    };
  }

  private async loadByStatus(floorId: string, status: 'DRAFT' | 'PUBLISHED'): Promise<FloorMap | null> {
    const floor = await this.getFloor(floorId);
    if (!floor) return null;

    const [versionRow] = await this.request<MapVersionRow[]>(
      `/map_versions?select=*&floor_id=eq.${encodeURIComponent(floorId)}&status=eq.${status}&limit=1`
    );
    if (!versionRow) return null;

    const version = mapVersion(versionRow);
    const elements = await this.loadElements(version.id);
    return { floor, version, elements };
  }

  async listCustomStructureTemplates(): Promise<CustomStructureTemplate[]> {
    const rows = await this.request<CustomStructureTemplateRow[]>(
      '/custom_structure_templates?select=*&is_active=eq.true&order=name.asc'
    );
    return rows.map(mapCustomStructureTemplate);
  }

  async getCustomStructureTemplate(id: string): Promise<CustomStructureTemplate | null> {
    const [row] = await this.request<CustomStructureTemplateRow[]>(
      `/custom_structure_templates?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
    );
    return row ? mapCustomStructureTemplate(row) : null;
  }

  async createCustomStructureTemplate(
    input: CreateCustomStructureTemplateInput
  ): Promise<CustomStructureTemplate> {
    const [row] = await this.request<CustomStructureTemplateRow[]>(
      '/custom_structure_templates',
      {
        method: 'POST',
        prefer: 'return=representation',
        body: JSON.stringify({
          name: input.name,
          description: input.description ?? null,
          default_width: input.defaultWidth ?? 120,
          default_height: input.defaultHeight ?? 60,
          default_color: input.defaultColor ?? '#CBD5E1',
          border_style: input.borderStyle ?? 'solid',
          category: input.category ?? 'ARCHITECTURAL',
          is_active: input.isActive ?? true,
        }),
      }
    );
    if (!row) throw new Error('Failed to create custom structure template');
    return mapCustomStructureTemplate(row);
  }

  async updateCustomStructureTemplate(
    id: string,
    input: UpdateCustomStructureTemplateInput
  ): Promise<CustomStructureTemplate> {
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.name !== undefined) payload.name = input.name;
    if (input.description !== undefined) payload.description = input.description;
    if (input.defaultWidth !== undefined) payload.default_width = input.defaultWidth;
    if (input.defaultHeight !== undefined) payload.default_height = input.defaultHeight;
    if (input.defaultColor !== undefined) payload.default_color = input.defaultColor;
    if (input.borderStyle !== undefined) payload.border_style = input.borderStyle;
    if (input.category !== undefined) payload.category = input.category;
    if (input.isActive !== undefined) payload.is_active = input.isActive;

    const [row] = await this.request<CustomStructureTemplateRow[]>(
      `/custom_structure_templates?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: JSON.stringify(payload),
      }
    );
    if (!row) throw new Error(`Custom structure template not found: ${id}`);
    return mapCustomStructureTemplate(row);
  }

  async deleteCustomStructureTemplate(id: string): Promise<void> {
    await this.request<void>(
      `/custom_structure_templates?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
  }

  private async loadElements(mapVersionId: string): Promise<MapElement[]> {
    const rows = await this.request<MapElementRow[]>(
      `/map_elements?select=*&map_version_id=eq.${encodeURIComponent(mapVersionId)}&order=z_index.asc,id.asc`
    );
    return rows.map(mapElement);
  }

  private async nextVersionNumber(floorId: string): Promise<number> {
    const [row] = await this.request<Array<{ version_number: number }>>(
      `/map_versions?select=version_number&floor_id=eq.${encodeURIComponent(floorId)}&order=version_number.desc&limit=1`
    );
    return (row?.version_number ?? 0) + 1;
  }

  private async request<T>(
    path: string,
    options: RequestInit & { prefer?: string } = {}
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('apikey', this.serviceRoleKey);
    headers.set('Authorization', `Bearer ${this.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');
    if (options.prefer) headers.set('Prefer', options.prefer);

    const response = await fetch(`${this.restUrl}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase map request failed (${response.status}): ${detail}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : (undefined as T);
  }
}

type FloorMapPayload = {
  floor: FloorRow;
  version: MapVersionRow;
  elements: MapElementRow[];
};

function mapElementPayload(mapVersionId: string, element: MapElementInput) {
  return {
    id: element.id ?? crypto.randomUUID(),
    map_version_id: mapVersionId,
    element_role: element.elementRole,
    element_type: element.elementType,
    workspace_instance_id: element.workspaceInstanceId ?? null,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation ?? 0,
    z_index: element.zIndex ?? 0,
    label: element.label ?? null,
    properties: element.properties ?? {},
    is_locked: element.isLocked ?? false,
  };
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

function mapVersion(row: MapVersionRow): MapVersion {
  return {
    id: row.id,
    floorId: row.floor_id,
    versionNumber: row.version_number,
    status: row.status,
    canvasWidth: row.canvas_width,
    canvasHeight: row.canvas_height,
    gridSize: row.grid_size,
    createdByUserId: row.created_by_user_id,
    publishedByUserId: row.published_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

function mapElement(row: MapElementRow): MapElement {
  return {
    id: row.id,
    mapVersionId: row.map_version_id,
    elementRole: row.element_role,
    elementType: row.element_type,
    workspaceInstanceId: row.workspace_instance_id,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    rotation: row.rotation,
    zIndex: row.z_index,
    label: row.label,
    properties: row.properties ?? {},
    isLocked: row.is_locked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCustomStructureTemplate(row: CustomStructureTemplateRow): CustomStructureTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    defaultWidth: Number(row.default_width),
    defaultHeight: Number(row.default_height),
    defaultColor: row.default_color,
    borderStyle: row.border_style,
    category: row.category,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

