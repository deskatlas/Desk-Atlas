import type {
  WorkspaceAuditLogEntry,
  CreateFloorInput,
  CreateWorkspaceInstanceInput,
  CreateWorkspaceTemplateInput,
  DuplicateWorkspaceInstanceInput,
  Floor,
  UpdateWorkspaceInstanceInput,
  UpdateWorkspaceTemplateInput,
  WorkspaceStatusImpactReservation,
  WorkspaceCatalog,
  WorkspaceInstanceDetails,
  WorkspaceOperationalStatus,
  WorkspaceRepository,
  WorkspaceTemplate,
} from "../models/workspace";
import { WorkspaceConflictError, sortWorkspaceInstances } from "./workspaceService";

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  photo_path: string | null;
  capacity: number;
  rate_amount: string | number;
  pricing_unit: "HOURLY";
  default_shape: string;
  default_color: string;
  default_style: Record<string, unknown> | null;
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

type InstanceRow = {
  id: string;
  template_id: string;
  floor_id: string;
  instance_code: string;
  display_name: string;
  operational_status: WorkspaceOperationalStatus;
  created_at?: string;
  updated_at?: string;
  template?: TemplateRow;
  floor?: FloorRow;
};

type FutureReservationRow = {
  id: string;
  reservation_id: string;
  start_at: string;
  end_at: string;
  reservation: {
    id: string;
    reference_code: string;
    status: "CONFIRMED";
  };
};

export class SupabaseWorkspaceRepository implements WorkspaceRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    const supabaseUrl =
      options?.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for workspace routes");
    }

    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for workspace routes");
    }

    this.restUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
  }

  async listCatalog(): Promise<WorkspaceCatalog> {
    const [templates, floors, instances] = await Promise.all([
      this.request<TemplateRow[]>("/workspace_templates?select=*&order=name.asc"),
      this.request<FloorRow[]>("/floors?select=*&order=display_order.asc"),
      this.request<InstanceRow[]>(
        "/workspace_instances?select=*,template:workspace_templates(*),floor:floors(*)&order=instance_code.asc"
      ),
    ]);

    return {
      templates: templates.map(mapTemplate),
      floors: floors.map(mapFloor),
      instances: sortWorkspaceInstances(instances.map(mapInstanceDetails)),
    };
  }

  async getInstance(id: string): Promise<WorkspaceInstanceDetails> {
    const [row] = await this.request<InstanceRow[]>(
      `/workspace_instances?id=eq.${encodeURIComponent(id)}&select=*,template:workspace_templates(*),floor:floors(*)&limit=1`
    );

    if (!row) throw new Error(`Instance not found: ${id}`);
    return mapInstanceDetails(row);
  }

  async createFloor(input: CreateFloorInput): Promise<Floor> {
    const existingFloors = await this.request<FloorRow[]>(
      "/floors?select=display_order&order=display_order.desc&limit=1"
    );
    const nextOrder = existingFloors.length > 0 ? existingFloors[0].display_order + 1 : 1;

    const [row] = await this.request<FloorRow[]>("/floors", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        display_order: nextOrder,
        is_active: true,
      }),
      prefer: "return=representation",
    });
    return mapFloor(row);
  }

  async createTemplate(input: CreateWorkspaceTemplateInput): Promise<WorkspaceTemplate> {
    const [row] = await this.request<TemplateRow[]>("/workspace_templates", {
      method: "POST",
      body: JSON.stringify(templatePayload(input)),
      prefer: "return=representation",
    });
    return mapTemplate(row);
  }

  async updateTemplate(id: string, input: UpdateWorkspaceTemplateInput): Promise<WorkspaceTemplate> {
    const [row] = await this.request<TemplateRow[]>(
      `/workspace_templates?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(templatePayload(input)),
        prefer: "return=representation",
      }
    );
    return mapTemplate(row);
  }

  async createInstance(input: CreateWorkspaceInstanceInput): Promise<WorkspaceInstanceDetails> {
    await this.assertUniqueInstanceCode(input.instanceCode);
    const [row] = await this.request<InstanceRow[]>(
      "/workspace_instances?select=*,template:workspace_templates(*),floor:floors(*)",
      {
        method: "POST",
        body: JSON.stringify(instancePayload(input)),
        prefer: "return=representation",
      }
    );
    return mapInstanceDetails(row);
  }

  async updateInstance(
    id: string,
    input: UpdateWorkspaceInstanceInput
  ): Promise<WorkspaceInstanceDetails> {
    const [row] = await this.request<InstanceRow[]>(
      `/workspace_instances?id=eq.${encodeURIComponent(id)}&select=*,template:workspace_templates(*),floor:floors(*)`,
      {
        method: "PATCH",
        body: JSON.stringify(instanceUpdatePayload(input)),
        prefer: "return=representation",
      }
    );
    return mapInstanceDetails(row);
  }

  async deactivateInstance(id: string): Promise<WorkspaceInstanceDetails> {
    return this.updateInstance(id, { operationalStatus: "INACTIVE" });
  }

  async duplicateInstance(
    id: string,
    input: DuplicateWorkspaceInstanceInput
  ): Promise<WorkspaceInstanceDetails> {
    const [existing] = await this.request<InstanceRow[]>(
      `/workspace_instances?id=eq.${encodeURIComponent(id)}&select=*,template:workspace_templates(*),floor:floors(*)&limit=1`
    );
    if (!existing) throw new Error(`Instance not found: ${id}`);

    return this.createInstance({
      templateId: existing.template_id,
      floorId: existing.floor_id,
      instanceCode: input.instanceCode,
      displayName: input.displayName,
      operationalStatus: existing.operational_status,
    });
  }

  async listFutureConfirmedReservations(
    instanceId: string,
    fromIso: string
  ): Promise<WorkspaceStatusImpactReservation[]> {
    const rows = await this.request<FutureReservationRow[]>(
      `/reservation_candidates?select=id,reservation_id,start_at,end_at,reservation:reservations!inner(id,reference_code,status)&workspace_instance_id=eq.${encodeURIComponent(
        instanceId
      )}&start_at=gt.${encodeURIComponent(fromIso)}&reservation.status=eq.CONFIRMED&order=start_at.asc`
    );

    return rows.map((row) => ({
      reservationId: row.reservation_id,
      reservationReferenceCode: row.reservation.reference_code,
      candidateId: row.id,
      startAt: row.start_at,
      endAt: row.end_at,
      reservationStatus: row.reservation.status,
    }));
  }

  async appendAuditLog(entry: WorkspaceAuditLogEntry): Promise<void> {
    const validUuid =
      typeof entry.actorUserId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.actorUserId.trim())
        ? entry.actorUserId.trim()
        : null;

    const actorRole = validUuid ? entry.actorRole : "SYSTEM";
    const actorUserId = validUuid ? validUuid : null;

    await this.request<unknown>("/audit_logs", {
      method: "POST",
      body: JSON.stringify({
        actor_user_id: actorUserId,
        actor_role: actorRole,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        metadata: entry.metadata,
        created_at: entry.createdAt,
      }),
      prefer: "return=minimal",
    });
  }

  async listAuditLogs(limit = 50): Promise<WorkspaceAuditLogEntry[]> {
    const rows = await this.request<any[]>(
      `/audit_logs?select=*&order=created_at.desc&limit=${limit}`
    );
    return rows.map((row) => ({
      actorRole: row.actor_role,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: (row.metadata && typeof row.metadata === "object") ? row.metadata : {},
      createdAt: row.created_at,
    }));
  }

  private async assertUniqueInstanceCode(instanceCode: string) {
    const rows = await this.request<Array<{ id: string }>>(
      `/workspace_instances?select=id&instance_code=ilike.${encodeURIComponent(instanceCode)}&limit=1`
    );
    if (rows.length > 0) {
      throw new WorkspaceConflictError(`Instance code already exists: ${instanceCode}`);
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit & { prefer?: string } = {}
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("apikey", this.serviceRoleKey);
    headers.set("Authorization", `Bearer ${this.serviceRoleKey}`);
    headers.set("Content-Type", "application/json");
    if (options.prefer) headers.set("Prefer", options.prefer);

    const response = await fetch(`${this.restUrl}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase workspace request failed (${response.status}): ${detail}`);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }
}

function templatePayload(input: CreateWorkspaceTemplateInput | UpdateWorkspaceTemplateInput) {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.photoPath !== undefined) payload.photo_path = input.photoPath;
  if (input.capacity !== undefined) payload.capacity = input.capacity;
  if (input.rateAmount !== undefined) payload.rate_amount = input.rateAmount;
  if ("pricingUnit" in input && input.pricingUnit !== undefined)
    payload.pricing_unit = input.pricingUnit;
  if (input.defaultShape !== undefined) payload.default_shape = input.defaultShape;
  if (input.defaultColor !== undefined) payload.default_color = input.defaultColor;
  if (input.defaultStyle !== undefined) payload.default_style = input.defaultStyle;
  if (input.isActive !== undefined) payload.is_active = input.isActive;
  return payload;
}

function instancePayload(input: CreateWorkspaceInstanceInput) {
  return {
    template_id: input.templateId,
    floor_id: input.floorId,
    instance_code: input.instanceCode,
    display_name: input.displayName,
    operational_status: input.operationalStatus ?? "ACTIVE",
  };
}

function instanceUpdatePayload(input: UpdateWorkspaceInstanceInput) {
  const payload: Record<string, unknown> = {};
  if (input.displayName !== undefined) payload.display_name = input.displayName;
  if (input.operationalStatus !== undefined) payload.operational_status = input.operationalStatus;
  return payload;
}

function mapTemplate(row: TemplateRow): WorkspaceTemplate {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

function mapInstanceDetails(row: InstanceRow): WorkspaceInstanceDetails {
  if (!row.template || !row.floor) {
    throw new Error(`Workspace instance ${row.id} is missing template or floor join data`);
  }

  return {
    id: row.id,
    templateId: row.template_id,
    floorId: row.floor_id,
    instanceCode: row.instance_code,
    displayName: row.display_name,
    operationalStatus: row.operational_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    template: mapTemplate(row.template),
    floor: mapFloor(row.floor),
  };
}
