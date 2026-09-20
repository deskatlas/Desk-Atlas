import {
  ActivityActor,
  ActivityLogEntry,
  ActivityLogFilters,
  ActivityLogQueryResult,
  ActivityLogRepository,
  extractEntityLabel,
  formatActionLabel,
} from "./activityLogService";

interface SupabaseAuditLogRow {
  id: string;
  actor_user_id: string | null;
  actor_role: "ADMIN" | "STAFF" | "SUPERADMIN" | "SYSTEM";
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

interface SupabaseStaffProfileRow {
  user_id: string;
  display_name: string;
  role: "ADMIN" | "STAFF" | "SUPERADMIN";
  created_by_admin_id?: string | null;
  is_active?: boolean;
}

export class ActivityLogSupabaseRepository implements ActivityLogRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    const supabaseUrl =
      options?.supabaseUrl ??
      process.env.SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey =
      options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error(
        "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for ActivityLogSupabaseRepository"
      );
    }

    if (!serviceRoleKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is required for ActivityLogSupabaseRepository"
      );
    }

    this.restUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ data: T; count?: number }> {
    const headers = new Headers(options.headers);
    headers.set("apikey", this.serviceRoleKey);
    headers.set("Authorization", `Bearer ${this.serviceRoleKey}`);
    headers.set("Content-Type", "application/json");

    const response = await fetch(`${this.restUrl}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${detail}`);
    }

    let count: number | undefined;
    const contentRange = response.headers.get("content-range");
    if (contentRange) {
      const parts = contentRange.split("/");
      if (parts.length === 2 && parts[1] !== "*") {
        count = parseInt(parts[1], 10);
      }
    }

    const data = (await response.json()) as T;
    return { data, count };
  }

  async listActors(adminId?: string): Promise<ActivityActor[]> {
    try {
      const queryParams = new URLSearchParams({
        select: "user_id,display_name,role,created_by_admin_id,is_active",
        is_active: "eq.true",
        order: "display_name.asc",
      });

      const { data } = await this.request<SupabaseStaffProfileRow[]>(
        `/staff_profiles?${queryParams.toString()}`
      );

      return (data ?? [])
        .filter((p) => {
          if (!adminId) return true;
          if (p.user_id === adminId) return true;
          if (p.created_by_admin_id === adminId) return true;
          if (p.role === "SUPERADMIN") return true;
          return false;
        })
        .map((p) => ({
          id: p.user_id,
          name: p.display_name,
          role: p.role,
        }));
    } catch {
      return [];
    }
  }

  async listActivityLogs(
    params: ActivityLogFilters & { adminId?: string }
  ): Promise<ActivityLogQueryResult> {
    const {
      actorId,
      actionTypes,
      action,
      from,
      to,
      entityType,
      page = 1,
      limit = 20,
      adminId,
    } = params;

    const queryParams = new URLSearchParams({
      select: "id,actor_user_id,actor_role,action,entity_type,entity_id,metadata,created_at",
      order: "created_at.desc",
      limit: limit.toString(),
      offset: ((page - 1) * limit).toString(),
    });

    if (actorId) {
      if (actorId.toUpperCase() === "SYSTEM") {
        queryParams.set("actor_role", "eq.SYSTEM");
      } else {
        queryParams.set("actor_user_id", `eq.${actorId}`);
      }
    }

    if (action) {
      queryParams.set("action", `ilike.*${action}*`);
    } else if (actionTypes && actionTypes.length > 0) {
      queryParams.set("action", `in.(${actionTypes.join(",")})`);
    }

    if (entityType) {
      queryParams.set("entity_type", `eq.${entityType}`);
    }

    if (from) {
      queryParams.set("created_at", `gte.${new Date(from).toISOString()}`);
    }

    if (to) {
      queryParams.set("created_at", `lte.${new Date(to).toISOString()}`);
    }

    const { data: rows, count } = await this.request<SupabaseAuditLogRow[]>(
      `/audit_logs?${queryParams.toString()}`,
      {
        headers: {
          Prefer: "count=exact",
        },
      }
    );

    const safeRows = rows ?? [];
    const total = count ?? safeRows.length;

    // Resolve actor profiles for all distinct actor_user_id
    const actorUserIds = Array.from(
      new Set(safeRows.map((r) => r.actor_user_id).filter((id): id is string => Boolean(id)))
    );

    const profileMap = new Map<string, SupabaseStaffProfileRow>();
    if (actorUserIds.length > 0) {
      try {
        const idFilter = `in.(${actorUserIds.join(",")})`;
        const { data: profiles } = await this.request<SupabaseStaffProfileRow[]>(
          `/staff_profiles?select=user_id,display_name,role&user_id=${encodeURIComponent(idFilter)}`
        );
        for (const p of profiles ?? []) {
          profileMap.set(p.user_id, p);
        }
      } catch {
        // Fallback if profile resolution encounters network error
      }
    }

    // Collect entity IDs that need human-friendly name resolution
    const reservationIdsToFetch = new Set<string>();
    const paymentAttemptIdsToFetch = new Set<string>();
    const instanceIdsToFetch = new Set<string>();
    const floorIdsToFetch = new Set<string>();

    for (const r of safeRows) {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;

      if (r.entity_id) {
        if (r.entity_type === "reservation") {
          reservationIdsToFetch.add(r.entity_id);
        } else if (r.entity_type === "payment_attempt") {
          paymentAttemptIdsToFetch.add(r.entity_id);
        } else if (r.entity_type === "workspace_instance") {
          instanceIdsToFetch.add(r.entity_id);
        } else if (r.entity_type === "floor" || r.entity_type === "map_version") {
          floorIdsToFetch.add(r.entity_id);
        }
      }

      if (typeof meta.reservation_id === "string") reservationIdsToFetch.add(meta.reservation_id);
      if (typeof meta.reservationId === "string") reservationIdsToFetch.add(meta.reservationId);
      if (typeof meta.workspace_instance_id === "string") instanceIdsToFetch.add(meta.workspace_instance_id);
      if (typeof meta.instance_id === "string") instanceIdsToFetch.add(meta.instance_id);
      if (typeof meta.assigned_workspace_instance_id === "string") instanceIdsToFetch.add(meta.assigned_workspace_instance_id);
      if (typeof meta.previous_instance_id === "string") instanceIdsToFetch.add(meta.previous_instance_id);
      if (typeof meta.new_instance_id === "string") instanceIdsToFetch.add(meta.new_instance_id);
      if (typeof meta.floor_id === "string") floorIdsToFetch.add(meta.floor_id);
    }

    const reservationRefMap = new Map<string, string>();
    if (paymentAttemptIdsToFetch.size > 0) {
      try {
        const filter = `in.(${Array.from(paymentAttemptIdsToFetch).join(",")})`;
        const { data: payData } = await this.request<Array<{ id: string; reservation_id: string }>>(
          `/payment_attempts?select=id,reservation_id&id=${encodeURIComponent(filter)}`
        );
        for (const p of payData ?? []) {
          if (p.reservation_id) {
            reservationIdsToFetch.add(p.reservation_id);
            // Map payment attempt id to reservation id for secondary lookup
            reservationRefMap.set(p.id, p.reservation_id);
          }
        }
      } catch {
        // ignore
      }
    }

    if (reservationIdsToFetch.size > 0) {
      try {
        const filter = `in.(${Array.from(reservationIdsToFetch).join(",")})`;
        const { data: resData } = await this.request<Array<{ id: string; reference_code: string }>>(
          `/reservations?select=id,reference_code&id=${encodeURIComponent(filter)}`
        );
        for (const res of resData ?? []) {
          reservationRefMap.set(res.id, res.reference_code);
        }
      } catch {
        // ignore
      }
    }

    const instanceNameMap = new Map<string, string>();
    if (instanceIdsToFetch.size > 0) {
      try {
        const filter = `in.(${Array.from(instanceIdsToFetch).join(",")})`;
        const { data: instData } = await this.request<
          Array<{ id: string; display_name: string; instance_code: string }>
        >(
          `/workspace_instances?select=id,display_name,instance_code&id=${encodeURIComponent(filter)}`
        );
        for (const inst of instData ?? []) {
          instanceNameMap.set(inst.id, inst.display_name || inst.instance_code);
        }
      } catch {
        // ignore
      }
    }

    const floorNameMap = new Map<string, string>();
    if (floorIdsToFetch.size > 0) {
      try {
        const filter = `in.(${Array.from(floorIdsToFetch).join(",")})`;
        const { data: floorData } = await this.request<Array<{ id: string; name: string }>>(
          `/floors?select=id,name&id=${encodeURIComponent(filter)}`
        );
        for (const f of floorData ?? []) {
          floorNameMap.set(f.id, f.name);
        }
      } catch {
        // ignore
      }
    }

    const entries: ActivityLogEntry[] = safeRows.map((row) => {
      let actorName = "System";
      let actorRole: "ADMIN" | "STAFF" | "SUPERADMIN" | "SYSTEM" = row.actor_role;

      if (row.actor_user_id) {
        const profile = profileMap.get(row.actor_user_id);
        if (profile) {
          actorName = profile.display_name;
          actorRole = profile.role;
        } else {
          actorName = row.actor_role ? `${row.actor_role} User` : "Staff Member";
        }
      } else if (row.actor_role === "SYSTEM") {
        actorName = "System";
      }

      const metadata: Record<string, unknown> = { ...(row.metadata ?? {}) };

      // Enrich metadata with human-friendly values where IDs exist
      if (typeof metadata.reservation_id === "string" && reservationRefMap.has(metadata.reservation_id)) {
        metadata.reference_code = reservationRefMap.get(metadata.reservation_id);
      }
      if (typeof metadata.previous_instance_id === "string" && instanceNameMap.has(metadata.previous_instance_id)) {
        metadata.previous_workspace = instanceNameMap.get(metadata.previous_instance_id);
      }
      if (typeof metadata.new_instance_id === "string" && instanceNameMap.has(metadata.new_instance_id)) {
        metadata.new_workspace = instanceNameMap.get(metadata.new_instance_id);
      }
      if (typeof metadata.assigned_workspace_instance_id === "string" && instanceNameMap.has(metadata.assigned_workspace_instance_id)) {
        metadata.assigned_workspace = instanceNameMap.get(metadata.assigned_workspace_instance_id);
      }
      if (typeof metadata.workspace_instance_id === "string" && instanceNameMap.has(metadata.workspace_instance_id)) {
        metadata.workspace_name = instanceNameMap.get(metadata.workspace_instance_id);
      }
      if (typeof metadata.floor_id === "string" && floorNameMap.has(metadata.floor_id)) {
        metadata.floor_name = floorNameMap.get(metadata.floor_id);
      }

      const actionLabel = formatActionLabel(row.action);
      let entityLabel = extractEntityLabel(row.entity_type, row.entity_id, metadata);
      if (!entityLabel && row.entity_id) {
        if (reservationRefMap.has(row.entity_id)) {
          const mapped = reservationRefMap.get(row.entity_id)!;
          entityLabel = reservationRefMap.get(mapped) ?? mapped;
        } else if (instanceNameMap.has(row.entity_id)) {
          entityLabel = instanceNameMap.get(row.entity_id)!;
        } else if (floorNameMap.has(row.entity_id)) {
          entityLabel = floorNameMap.get(row.entity_id)!;
        }
      }

      return {
        id: row.id,
        actorId: row.actor_user_id,
        actorName,
        actorRole,
        action: row.action,
        actionLabel,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityLabel,
        metadata,
        createdAt: row.created_at,
      };
    });

    return {
      entries,
      total,
      page,
      limit,
    };
  }
}
