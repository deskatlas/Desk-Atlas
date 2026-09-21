export interface ActivityLogEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  actorRole: 'ADMIN' | 'STAFF' | 'SUPERADMIN' | 'SYSTEM';
  action: string;
  actionLabel: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityLogFilters {
  actorId?: string;
  actionTypes?: string[];
  action?: string;
  from?: string;
  to?: string;
  entityType?: string;
  page?: number;
  limit?: number;
}

export interface ActivityLogQueryResult {
  entries: ActivityLogEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface ActivityActor {
  id: string;
  name: string;
  role: 'ADMIN' | 'STAFF' | 'SUPERADMIN';
}

export const ACTION_LABELS: Record<string, string> = {
  // Workspace actions
  WORKSPACE_STATUS_UPDATED: "Workspace Status Changed",
  workspace_status_updated: "Workspace Status Changed",
  WORKSPACE_CREATED: "Workspace Created",
  workspace_created: "Workspace Created",
  WORKSPACE_UPDATED: "Workspace Updated",
  workspace_updated: "Workspace Updated",
  WORKSPACE_DEACTIVATED: "Workspace Deactivated",
  workspace_deactivated: "Workspace Deactivated",

  // Reservation actions
  RESERVATION_RELOCATED: "Reservation Relocated",
  reservation_relocated: "Reservation Relocated",
  RESERVATION_EXTENDED: "Time Extension Applied",
  reservation_extended: "Time Extension Applied",
  RESERVATION_CANCELLED: "Reservation Cancelled",
  reservation_cancelled: "Reservation Cancelled",
  RESERVATION_RESCHEDULED: "Reservation Rescheduled",
  reservation_rescheduled: "Reservation Rescheduled",
  RESERVATION_CREATED: "Reservation Created",
  reservation_created: "Reservation Created",

  // Payment actions
  PAYMENT_APPROVED: "Payment Approved",
  payment_approved: "Payment Approved",
  payment_review_completed: "Payment Approved",
  payment_review_reconsidered_approved: "Payment Approved (Reconsidered)",
  PAYMENT_REJECTED: "Payment Rejected",
  payment_rejected: "Payment Rejected",
  payment_review_rejected: "Payment Rejected",
  COUNTER_PAYMENT_CONFIRMED: "Counter Payment Confirmed",
  counter_payment_confirmed: "Counter Payment Confirmed",

  // Check-in / Check-out / Operations
  STAFF_CHECKED_IN: "Customer Checked In (Staff)",
  staff_checked_in: "Customer Checked In (Staff)",
  reservation_checked_in: "Customer Checked In",
  CHECK_IN: "Customer Checked In",
  check_in: "Customer Checked In",
  STAFF_CHECKED_OUT: "Customer Checked Out (Staff)",
  staff_checked_out: "Customer Checked Out (Staff)",
  reservation_checked_out: "Customer Checked Out",
  CHECK_OUT: "Customer Checked Out",
  check_out: "Customer Checked Out",
  RECHECKIN: "Re-entry Allowed",
  recheckin: "Re-entry Allowed",
  re_entry: "Re-entry Allowed",
  ADMIN_MANUAL_CHECKOUT: "Manual Checkout (Admin)",
  admin_manual_checkout: "Manual Checkout (Admin)",

  // Map actions
  MAP_PUBLISHED: "Map Published",
  map_published: "Map Published",
  MAP_DRAFT_SAVED: "Map Draft Saved",
  map_draft_saved: "Map Draft Saved",

  // Staff & Admin management
  STAFF_CREATED: "Staff Member Created",
  staff_created: "Staff Member Created",
  STAFF_UPDATED: "Staff Member Updated",
  staff_updated: "Staff Member Updated",
  STAFF_DEACTIVATED: "Staff Member Deactivated",
  staff_deactivated: "Staff Member Deactivated",
  STAFF_INVITED: "Staff Member Invited",
  staff_invited: "Staff Member Invited",
  STAFF_REINVITED: "Staff Invitation Resent",
  staff_reinvited: "Staff Invitation Resent",
  STAFF_INVITATION_CANCELLED: "Staff Invitation Cancelled",
  staff_invitation_cancelled: "Staff Invitation Cancelled",

  // Auth / Password
  PASSWORD_RESET_REQUESTED: "Password Reset Requested",
  password_reset_requested: "Password Reset Requested",
  PASSWORD_RESET_COMPLETED: "Password Reset Completed",
  password_reset_completed: "Password Reset Completed",
  ADMIN_LOGGED_IN: "Admin Logged In",
  admin_logged_in: "Admin Logged In",
  STAFF_LOGGED_IN: "Staff Logged In",
  staff_logged_in: "Staff Logged In",

  // Settings
  SETTINGS_UPDATED: "Settings Updated",
  settings_updated: "Settings Updated",
  PAYMENT_METHOD_CONFIGURED: "Payment Method Configured",
  payment_method_configured: "Payment Method Configured",
};

export function formatActionLabel(action: string): string {
  if (!action) return "Unknown Action";
  if (ACTION_LABELS[action]) {
    return ACTION_LABELS[action];
  }
  const upper = action.toUpperCase();
  if (ACTION_LABELS[upper]) {
    return ACTION_LABELS[upper];
  }

  // Convert snake_case or kebab-case or camelCase to Title Case
  return action
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function extractEntityLabel(
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {}
): string | null {
  if (metadata.reference_code && typeof metadata.reference_code === "string") {
    return metadata.reference_code;
  }
  if (metadata.referenceCode && typeof metadata.referenceCode === "string") {
    return metadata.referenceCode;
  }
  if (metadata.reference && typeof metadata.reference === "string") {
    return metadata.reference;
  }
  if (metadata.workspace_name && typeof metadata.workspace_name === "string") {
    return metadata.workspace_name;
  }
  if (metadata.workspaceName && typeof metadata.workspaceName === "string") {
    return metadata.workspaceName;
  }
  if (metadata.instance_name && typeof metadata.instance_name === "string") {
    return metadata.instance_name;
  }
  if (metadata.instance_code && typeof metadata.instance_code === "string") {
    return metadata.instance_code;
  }
  if (metadata.name && typeof metadata.name === "string") {
    return metadata.name;
  }
  if (metadata.display_name && typeof metadata.display_name === "string") {
    return metadata.display_name;
  }
  if (metadata.displayName && typeof metadata.displayName === "string") {
    return metadata.displayName;
  }
  if (metadata.email && typeof metadata.email === "string") {
    return metadata.email;
  }
  return null;
}

export interface FormattedMetadataItem {
  key: string;
  label: string;
  value: string;
  isBadge?: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_HASH_REGEX = /^[0-9a-fA-F-]{20,}$/;

export function isRawId(key: string, value: unknown): boolean {
  const k = key.toLowerCase();

  // Any key ending with id / _id or representing internal IDs
  if (
    k === "id" ||
    k.endsWith("_id") ||
    k.endsWith("id") ||
    k.includes("_id_") ||
    k === "entity_id" ||
    k === "entityid" ||
    k === "actor_id" ||
    k === "actorid" ||
    k === "actor_user_id" ||
    k === "user_id" ||
    k === "userid" ||
    k === "reservation_id" ||
    k === "reservationid" ||
    k === "workspace_id" ||
    k === "workspaceid" ||
    k === "workspace_instance_id" ||
    k === "workspaceinstanceid" ||
    k === "instance_id" ||
    k === "instanceid" ||
    k === "assigned_workspace_instance_id" ||
    k === "assigned_candidate_id" ||
    k === "candidate_id" ||
    k === "previous_instance_id" ||
    k === "new_instance_id" ||
    k === "floor_id" ||
    k === "floorid" ||
    k === "session_id" ||
    k === "sessionid" ||
    k === "payment_attempt_id" ||
    k === "paymentattemptid"
  ) {
    // Keep only if it's explicitly a reference number or human-friendly code
    if (!k.includes("reference") && !k.includes("code") && !k.includes("number")) {
      return true;
    }
  }

  if (typeof value === "string") {
    const valTrimmed = value.trim();
    if (UUID_REGEX.test(valTrimmed) || HEX_HASH_REGEX.test(valTrimmed)) {
      return true;
    }
    // If value starts with id prefixes like "res-", "inst-", "floor-", "usr-" followed by long opaque chars
    if (/^(res|inst|floor|usr|user|pay|cand|sess|draft)-[0-9a-zA-Z-]{8,}$/i.test(valTrimmed)) {
      return true;
    }
  }

  if (Array.isArray(value) && value.length > 0) {
    if (
      value.every(
        (v) =>
          typeof v === "string" &&
          (UUID_REGEX.test(v.trim()) ||
            HEX_HASH_REGEX.test(v.trim()) ||
            /^(res|inst|floor|usr|user|pay|cand|sess|draft)-[0-9a-zA-Z-]{8,}$/i.test(v.trim()))
      )
    ) {
      return true;
    }
  }

  return false;
}

export function formatMetadataKey(key: string): string {
  const KEY_MAP: Record<string, string> = {
    reference_code: "Reservation Reference",
    referenceCode: "Reservation Reference",
    reference: "Reservation Reference",
    reference_number: "Reservation Reference",
    referenceNumber: "Reservation Reference",
    guest_name: "Guest Name",
    guestName: "Guest Name",
    customer_name: "Customer Name",
    customerName: "Customer Name",
    email: "Email Address",
    contact_number: "Contact Number",
    contactNumber: "Contact Number",
    workspace_name: "Workspace Name",
    workspaceName: "Workspace Name",
    instance_name: "Workspace Name",
    instanceName: "Workspace Name",
    instance_code: "Workspace Code",
    instanceCode: "Workspace Code",
    previous_workspace: "Previous Workspace",
    previousWorkspace: "Previous Workspace",
    new_workspace: "New Workspace",
    newWorkspace: "New Workspace",
    assigned_workspace: "Assigned Workspace",
    assignedWorkspace: "Assigned Workspace",
    template_name: "Workspace Type",
    templateName: "Workspace Type",
    floor_name: "Floor",
    floorName: "Floor",
    is_bookable: "Availability Status",
    isBookable: "Availability Status",
    blocking_reason: "Blocking Reason",
    blockingReason: "Blocking Reason",
    template_is_active: "Template Status",
    templateIsActive: "Template Status",
    availability: "Availability",
    previous_status: "Previous Status",
    previousStatus: "Previous Status",
    new_status: "New Status",
    newStatus: "New Status",
    status: "Status",
    operational_status: "Operational Status",
    operationalStatus: "Operational Status",
    decision: "Review Decision",
    amount: "Amount",
    total_amount: "Total Amount",
    totalAmount: "Total Amount",
    additional_fee: "Additional Fee",
    additionalFee: "Additional Fee",
    reason: "Reason",
    cancellation_reason: "Cancellation Reason",
    cancellationReason: "Cancellation Reason",
    extension_minutes: "Extension Duration",
    extensionMinutes: "Extension Duration",
    payment_method: "Payment Method",
    paymentMethod: "Payment Method",
    scanned_by: "Scanned By",
    scannedBy: "Scanned By",
    maintenance_note: "Maintenance Note",
    maintenanceNote: "Maintenance Note",
    element_count: "Elements Count",
    elementCount: "Elements Count",
    start_at: "Start Time",
    startAt: "Start Time",
    end_at: "End Time",
    endAt: "End Time",
    acted_at: "Timestamp",
    actedAt: "Timestamp",
    check_in_time: "Check-in Time",
    checkInTime: "Check-in Time",
    check_out_time: "Check-out Time",
    checkOutTime: "Check-out Time",
    notes: "Notes",
    role: "Role",
    actor_name: "Staff Name",
    actorName: "Staff Name",
    assigned_candidate_rank: "Candidate Priority",
    assignedCandidateRank: "Candidate Priority",
    was_reconsidered: "Reconsidered After Rejection",
    wasReconsidered: "Reconsidered After Rejection",
    manual_resolution_required: "Requires Manual Resolution",
    manualResolutionRequired: "Requires Manual Resolution",
  };

  if (KEY_MAP[key]) return KEY_MAP[key];

  return key
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export interface AvailabilityInfo {
  isBookable?: boolean;
  blockingReason?: string | null;
  operationalStatus?: string;
  templateIsActive?: boolean;
  [key: string]: unknown;
}

export interface DisplayAvailability {
  status: string;
  blockingReason?: string | null;
  operationalStatus?: string;
  templateIsActive?: string | null;
}

export function formatOperationalStatus(status?: string | null): string {
  if (!status) return "";
  const map: Record<string, string> = {
    ACTIVE: "Active",
    INACTIVE: "Inactive",
    UNDER_MAINTENANCE: "Under Maintenance",
    MAINTENANCE: "Under Maintenance",
    BROKEN: "Broken",
    DECOMMISSIONED: "Decommissioned",
  };
  return (
    map[status] ??
    status
      .replace(/[_-]/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
  );
}

export function formatBlockingReason(reason?: string | null): string {
  if (!reason) return "";
  const map: Record<string, string> = {
    CLOSED: "Closed",
    MAINTENANCE: "Under Maintenance",
    HOLIDAY: "Holiday",
    OPERATIONAL_STATUS_BLOCKED: "Workspace Status Blocked",
    BUSINESS_CLOSED: "Business Closed",
    OUTSIDE_OPERATING_HOURS: "Outside Operating Hours",
    PAST_TIME: "Past Time",
    RESERVATION_CONFLICT: "Reserved / Occupied",
    SCHEDULE_BLOCKED: "Schedule Blocked",
    IMMEDIATE_WALK_IN_ONLY: "Immediate Walk-in Only",
    TEMPLATE_INACTIVE: "Template Inactive",
  };
  return (
    map[reason] ??
    reason
      .replace(/[_-]/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
  );
}

export function formatAvailability(availability: AvailabilityInfo): DisplayAvailability {
  let friendlyStatus = availability.isBookable ? "Available" : "Not Available";

  if (!availability.isBookable) {
    if (
      availability.operationalStatus &&
      availability.operationalStatus.toUpperCase() !== "ACTIVE"
    ) {
      friendlyStatus = `Unavailable (${formatOperationalStatus(availability.operationalStatus)})`;
    } else if (
      availability.templateIsActive === false ||
      availability.blockingReason?.toUpperCase() === "TEMPLATE_INACTIVE"
    ) {
      friendlyStatus = "Unavailable (Template Inactive)";
    } else if (
      availability.blockingReason &&
      availability.blockingReason.toUpperCase() !== "OPERATIONAL_STATUS_BLOCKED"
    ) {
      friendlyStatus = `Unavailable (${formatBlockingReason(availability.blockingReason)})`;
    } else {
      friendlyStatus = "Not Available";
    }
  }

  return {
    status: availability.isBookable ? "Available" : friendlyStatus,
    blockingReason:
      availability.blockingReason &&
      availability.blockingReason.toUpperCase() !== "OPERATIONAL_STATUS_BLOCKED"
        ? formatBlockingReason(availability.blockingReason)
        : null,
    operationalStatus: availability.operationalStatus
      ? formatOperationalStatus(availability.operationalStatus)
      : undefined,
    templateIsActive:
      typeof availability.templateIsActive === "boolean"
        ? availability.templateIsActive
          ? "Active Template"
          : "Template Inactive"
        : null,
  };
}

export function formatMetadataValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "N/A";

  const keyLower = key.toLowerCase();

  if (typeof value === "boolean") {
    if (keyLower.includes("bookable")) {
      return value ? "Available" : "Not Available";
    }
    if (keyLower.includes("template_is_active") || keyLower.includes("templateisactive")) {
      return value ? "Active Template" : "Template Inactive";
    }
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    if (
      keyLower.includes("amount") ||
      keyLower.includes("fee") ||
      keyLower.includes("rate") ||
      keyLower.includes("price")
    ) {
      return `₱${value.toLocaleString()}`;
    }
    if (keyLower.includes("minutes") || keyLower.includes("duration")) {
      return `${value} mins`;
    }
    return value.toLocaleString();
  }

  if (typeof value === "string") {
    if (keyLower === "operational_status" || keyLower === "operationalstatus") {
      return formatOperationalStatus(value);
    }
    if (keyLower === "blocking_reason" || keyLower === "blockingreason") {
      return formatBlockingReason(value);
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
        }
      } catch {
        // fallback
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    return value
      .filter((v) => !isRawId(key, v))
      .map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)))
      .join(", ");
  }

  if (typeof value === "object") {
    if (
      keyLower.includes("availability") ||
      "isBookable" in (value as Record<string, unknown>) ||
      "is_bookable" in (value as Record<string, unknown>)
    ) {
      const availObj = value as Record<string, unknown>;
      const isBookable =
        typeof availObj.isBookable === "boolean"
          ? availObj.isBookable
          : typeof availObj.is_bookable === "boolean"
          ? availObj.is_bookable
          : undefined;
      const blockingReason = (availObj.blockingReason ?? availObj.blocking_reason) as
        | string
        | null
        | undefined;
      const opStatus = (availObj.operationalStatus ?? availObj.operational_status) as
        | string
        | undefined;
      const templateActive = (availObj.templateIsActive ?? availObj.template_is_active) as
        | boolean
        | undefined;

      const avail = formatAvailability({
        isBookable,
        blockingReason,
        operationalStatus: opStatus,
        templateIsActive: templateActive,
      });

      return avail.status;
    }

    const validEntries = Object.entries(value as Record<string, unknown>).filter(
      ([subK, subV]) => !isRawId(subK, subV) && subV !== null && subV !== undefined
    );
    if (validEntries.length === 0) return "None";
    return validEntries
      .map(
        ([k, v]) =>
          `${formatMetadataKey(k)}: ${
            typeof v === "object" && v !== null
              ? JSON.stringify(v)
              : formatMetadataValue(k, v)
          }`
      )
      .join(", ");
  }

  return String(value);
}

export function getHumanReadableMetadata(
  metadata: Record<string, unknown> = {}
): FormattedMetadataItem[] {
  const items: FormattedMetadataItem[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    // Suppress raw UUID and internal ID fields completely
    if (isRawId(key, value)) continue;

    const label = formatMetadataKey(key);
    const formattedVal = formatMetadataValue(key, value);
    if (!formattedVal || formattedVal === "None" && Object.keys(metadata).length > 1) {
      // If it became empty after stripping IDs, omit
    }
    const isBadge = [
      "status",
      "new_status",
      "previous_status",
      "operational_status",
      "decision",
    ].some((k) => key.toLowerCase().includes(k));
    items.push({
      key,
      label,
      value: formattedVal,
      isBadge,
    });
  }
  return items;
}

export interface ActivityLogRepository {
  listActivityLogs(
    params: ActivityLogFilters & { adminId?: string }
  ): Promise<ActivityLogQueryResult>;
  listActors?(adminId?: string): Promise<ActivityActor[]>;
}

export class ActivityLogService {
  constructor(private readonly repository: ActivityLogRepository) {}

  async listActivityLog(
    adminId?: string,
    filters: ActivityLogFilters = {}
  ): Promise<ActivityLogQueryResult> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.max(1, Math.min(100, filters.limit ?? 20));

    return this.repository.listActivityLogs({
      ...filters,
      adminId,
      page,
      limit,
    });
  }

  async listStaffActivityLog(
    staffActorId: string,
    filters: ActivityLogFilters = {}
  ): Promise<ActivityLogQueryResult> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.max(1, Math.min(100, filters.limit ?? 20));

    return this.repository.listActivityLogs({
      ...filters,
      actorId: staffActorId,
      page,
      limit,
    });
  }

  async listActors(adminId?: string): Promise<ActivityActor[]> {
    if (this.repository.listActors) {
      return this.repository.listActors(adminId);
    }
    return [];
  }
}
