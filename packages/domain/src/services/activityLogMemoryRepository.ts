import {
  ActivityActor,
  ActivityLogEntry,
  ActivityLogFilters,
  ActivityLogQueryResult,
  ActivityLogRepository,
  extractEntityLabel,
  formatActionLabel,
} from "./activityLogService";

export interface MemoryAuditLogRow {
  id: string;
  actor_user_id: string | null;
  actor_role: "ADMIN" | "STAFF" | "SUPERADMIN" | "SYSTEM";
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface MemoryStaffProfileRow {
  userId: string;
  displayName: string;
  role: "ADMIN" | "STAFF" | "SUPERADMIN";
  createdByAdminId?: string | null;
  isActive?: boolean;
}

export class ActivityLogMemoryRepository implements ActivityLogRepository {
  private auditLogs: MemoryAuditLogRow[] = [];
  private staffProfiles: Map<string, MemoryStaffProfileRow> = new Map();

  constructor(options?: {
    auditLogs?: MemoryAuditLogRow[];
    staffProfiles?: MemoryStaffProfileRow[];
  }) {
    if (options?.auditLogs) {
      this.auditLogs = [...options.auditLogs];
    }
    if (options?.staffProfiles) {
      for (const p of options.staffProfiles) {
        this.staffProfiles.set(p.userId, p);
      }
    }
  }

  addAuditLog(entry: MemoryAuditLogRow): void {
    this.auditLogs.unshift(entry);
  }

  setStaffProfile(profile: MemoryStaffProfileRow): void {
    this.staffProfiles.set(profile.userId, profile);
  }

  async listActors(adminId?: string): Promise<ActivityActor[]> {
    const actors: ActivityActor[] = [];
    for (const p of this.staffProfiles.values()) {
      if (p.isActive === false) continue;
      if (
        adminId &&
        p.userId !== adminId &&
        p.createdByAdminId &&
        p.createdByAdminId !== adminId &&
        p.role !== "SUPERADMIN"
      ) {
        continue;
      }
      actors.push({
        id: p.userId,
        name: p.displayName,
        role: p.role,
      });
    }
    return actors.sort((a, b) => a.name.localeCompare(b.name));
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

    let filtered = [...this.auditLogs];

    // Filter by admin roster if adminId is specified and actor is not superadmin
    if (adminId) {
      const allowedActorIds = new Set<string>();
      allowedActorIds.add(adminId);
      for (const p of this.staffProfiles.values()) {
        if (p.createdByAdminId === adminId || p.userId === adminId) {
          allowedActorIds.add(p.userId);
        }
      }
      // Keep entries belonging to admin roster or SYSTEM entries
      // Note: If adminId filter is given without specific actorId, we keep roster + system
      // or if actorId is given, actorId filter applies.
    }

    if (actorId) {
      if (actorId.toUpperCase() === "SYSTEM") {
        filtered = filtered.filter(
          (row) => row.actor_role === "SYSTEM" || row.actor_user_id === null
        );
      } else {
        filtered = filtered.filter((row) => row.actor_user_id === actorId);
      }
    }

    if (action) {
      const actionLower = action.toLowerCase();
      filtered = filtered.filter(
        (row) =>
          row.action.toLowerCase() === actionLower ||
          row.action.toLowerCase().includes(actionLower)
      );
    }

    if (actionTypes && actionTypes.length > 0) {
      const typeSet = new Set(actionTypes.map((t) => t.toLowerCase()));
      filtered = filtered.filter((row) => typeSet.has(row.action.toLowerCase()));
    }

    if (entityType) {
      const entityLower = entityType.toLowerCase();
      filtered = filtered.filter(
        (row) => row.entity_type.toLowerCase() === entityLower
      );
    }

    if (from) {
      const fromTime = new Date(from).getTime();
      filtered = filtered.filter((row) => new Date(row.created_at).getTime() >= fromTime);
    }

    if (to) {
      const toTime = new Date(to).getTime();
      filtered = filtered.filter((row) => new Date(row.created_at).getTime() <= toTime);
    }

    // Sort newest first
    filtered.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const total = filtered.length;
    const startIndex = (page - 1) * limit;
    const pagedRows = filtered.slice(startIndex, startIndex + limit);

    const entries: ActivityLogEntry[] = pagedRows.map((row) => {
      let actorName = "System";
      let actorRole: "ADMIN" | "STAFF" | "SUPERADMIN" | "SYSTEM" = row.actor_role;

      if (row.actor_user_id) {
        const profile = this.staffProfiles.get(row.actor_user_id);
        if (profile) {
          actorName = profile.displayName;
          actorRole = profile.role;
        } else {
          actorName = row.actor_role ? `${row.actor_role} User` : "Staff Member";
        }
      } else if (row.actor_role === "SYSTEM") {
        actorName = "System";
      }

      const metadata = row.metadata ?? {};
      const actionLabel = formatActionLabel(row.action);
      const entityLabel = extractEntityLabel(row.entity_type, row.entity_id, metadata);

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
