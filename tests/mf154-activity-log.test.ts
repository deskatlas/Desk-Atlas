import { describe, it, expect } from "vitest";
import {
  ActivityLogService,
  ActivityLogMemoryRepository,
  formatActionLabel,
  extractEntityLabel,
  getHumanReadableMetadata,
  ACTION_LABELS,
  type MemoryAuditLogRow,
  type MemoryStaffProfileRow,
} from "@deskatlas/domain";

describe("MF-154: Admin/Staff Activity Audit Log View", () => {
  const staffProfiles: MemoryStaffProfileRow[] = [
    {
      userId: "admin-1",
      displayName: "Alice Admin",
      role: "ADMIN",
      isActive: true,
    },
    {
      userId: "staff-1",
      displayName: "Bob Staff",
      role: "STAFF",
      createdByAdminId: "admin-1",
      isActive: true,
    },
    {
      userId: "staff-2",
      displayName: "Charlie Staff",
      role: "STAFF",
      createdByAdminId: "admin-1",
      isActive: true,
    },
  ];

  const auditLogs: MemoryAuditLogRow[] = [
    {
      id: "log-1",
      actor_user_id: "admin-1",
      actor_role: "ADMIN",
      action: "workspace_status_updated",
      entity_type: "workspace_instance",
      entity_id: "inst-101",
      metadata: { workspace_name: "Desk A-01", status: "MAINTENANCE" },
      created_at: "2026-09-20T10:00:00Z",
    },
    {
      id: "log-2",
      actor_user_id: "staff-1",
      actor_role: "STAFF",
      action: "reservation_checked_in",
      entity_type: "reservation",
      entity_id: "res-201",
      metadata: { reference_code: "REF-201", guest_name: "John Doe" },
      created_at: "2026-09-20T11:00:00Z",
    },
    {
      id: "log-3",
      actor_user_id: "admin-1",
      actor_role: "ADMIN",
      action: "payment_approved",
      entity_type: "payment_attempt",
      entity_id: "pay-301",
      metadata: { reference_code: "REF-201", amount: 250 },
      created_at: "2026-09-20T11:30:00Z",
    },
    {
      id: "log-4",
      actor_user_id: null,
      actor_role: "SYSTEM",
      action: "reservation_cancelled",
      entity_type: "reservation",
      entity_id: "res-202",
      metadata: { reference_code: "REF-202", reason: "Expired payment session" },
      created_at: "2026-09-20T12:00:00Z",
    },
    {
      id: "log-5",
      actor_user_id: "staff-2",
      actor_role: "STAFF",
      action: "recheckin",
      entity_type: "reservation",
      entity_id: "res-201",
      metadata: { reference_code: "REF-201" },
      created_at: "2026-09-20T12:30:00Z",
    },
  ];

  it("returns entries sorted newest first (created_at DESC)", async () => {
    const memoryRepo = new ActivityLogMemoryRepository({
      auditLogs,
      staffProfiles,
    });
    const service = new ActivityLogService(memoryRepo);

    const result = await service.listActivityLog();

    expect(result.entries.length).toBe(5);
    expect(result.total).toBe(5);
    expect(result.entries[0].id).toBe("log-5");
    expect(result.entries[1].id).toBe("log-4");
    expect(result.entries[2].id).toBe("log-3");
    expect(result.entries[3].id).toBe("log-2");
    expect(result.entries[4].id).toBe("log-1");
  });

  it("resolves actor name and role correctly from staff profiles, and handles SYSTEM actors", async () => {
    const memoryRepo = new ActivityLogMemoryRepository({
      auditLogs,
      staffProfiles,
    });
    const service = new ActivityLogService(memoryRepo);

    const result = await service.listActivityLog();

    const staffEntry = result.entries.find((e) => e.id === "log-2");
    expect(staffEntry).toBeDefined();
    expect(staffEntry?.actorName).toBe("Bob Staff");
    expect(staffEntry?.actorRole).toBe("STAFF");

    const adminEntry = result.entries.find((e) => e.id === "log-1");
    expect(adminEntry).toBeDefined();
    expect(adminEntry?.actorName).toBe("Alice Admin");
    expect(adminEntry?.actorRole).toBe("ADMIN");

    const systemEntry = result.entries.find((e) => e.id === "log-4");
    expect(systemEntry).toBeDefined();
    expect(systemEntry?.actorName).toBe("System");
    expect(systemEntry?.actorRole).toBe("SYSTEM");
  });

  it("formats human-readable action labels accurately", () => {
    expect(formatActionLabel("workspace_status_updated")).toBe("Workspace Status Changed");
    expect(formatActionLabel("payment_approved")).toBe("Payment Approved");
    expect(formatActionLabel("reservation_checked_in")).toBe("Customer Checked In");
    expect(formatActionLabel("recheckin")).toBe("Re-entry Allowed");
    expect(formatActionLabel("admin_manual_checkout")).toBe("Manual Checkout (Admin)");
    expect(formatActionLabel("custom_unmapped_action")).toBe("Custom Unmapped Action");
  });

  it("extracts entity labels accurately from metadata", () => {
    expect(
      extractEntityLabel("reservation", "res-123", { reference_code: "REF-999" })
    ).toBe("REF-999");

    expect(
      extractEntityLabel("workspace_instance", "inst-123", { workspace_name: "Meeting Room A" })
    ).toBe("Meeting Room A");

    expect(
      extractEntityLabel("reservation", "res-1234567890", {})
    ).toBeNull();
  });

  it("formats metadata payload into clean human-readable key-value items and strictly suppresses raw IDs", () => {
    const rawMetadata = {
      reference_code: "REF-201",
      reservation_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      workspace_instance_id: "inst-99201920-3321-4451",
      previous_workspace: "Desk A-01",
      new_workspace: "Desk B-04",
      guest_name: "John Doe",
      amount: 450,
      extension_minutes: 30,
      new_status: "MAINTENANCE",
      is_active: true,
      tags: ["WiFi", "Window View"],
    };

    const formatted = getHumanReadableMetadata(rawMetadata);
    // Should NOT contain reservation_id or workspace_instance_id
    expect(formatted.some((f) => f.key === "reservation_id")).toBe(false);
    expect(formatted.some((f) => f.key === "workspace_instance_id")).toBe(false);

    const refItem = formatted.find((f) => f.key === "reference_code");
    expect(refItem?.label).toBe("Reservation Reference");
    expect(refItem?.value).toBe("REF-201");

    const prevItem = formatted.find((f) => f.key === "previous_workspace");
    expect(prevItem?.label).toBe("Previous Workspace");
    expect(prevItem?.value).toBe("Desk A-01");

    const nextItem = formatted.find((f) => f.key === "new_workspace");
    expect(nextItem?.label).toBe("New Workspace");
    expect(nextItem?.value).toBe("Desk B-04");

    const amountItem = formatted.find((f) => f.key === "amount");
    expect(amountItem?.label).toBe("Amount");
    expect(amountItem?.value).toBe("₱450");

    const durationItem = formatted.find((f) => f.key === "extension_minutes");
    expect(durationItem?.label).toBe("Extension Duration");
    expect(durationItem?.value).toBe("30 mins");

    const statusItem = formatted.find((f) => f.key === "new_status");
    expect(statusItem?.label).toBe("New Status");
    expect(statusItem?.value).toBe("MAINTENANCE");
    expect(statusItem?.isBadge).toBe(true);

    const boolItem = formatted.find((f) => f.key === "is_active");
    expect(boolItem?.value).toBe("Yes");

    const tagItem = formatted.find((f) => f.key === "tags");
    expect(tagItem?.value).toBe("WiFi, Window View");
  });

  it("filters activity logs by date range (from / to)", async () => {
    const memoryRepo = new ActivityLogMemoryRepository({
      auditLogs,
      staffProfiles,
    });
    const service = new ActivityLogService(memoryRepo);

    const result = await service.listActivityLog(undefined, {
      from: "2026-09-20T11:00:00Z",
      to: "2026-09-20T12:00:00Z",
    });

    expect(result.entries.length).toBe(3); // log-4, log-3, log-2
    expect(result.entries.map((e) => e.id)).toEqual(["log-4", "log-3", "log-2"]);
  });

  it("filters activity logs by specific actorId", async () => {
    const memoryRepo = new ActivityLogMemoryRepository({
      auditLogs,
      staffProfiles,
    });
    const service = new ActivityLogService(memoryRepo);

    const staff1Logs = await service.listActivityLog(undefined, {
      actorId: "staff-1",
    });
    expect(staff1Logs.entries.length).toBe(1);
    expect(staff1Logs.entries[0].id).toBe("log-2");

    const systemLogs = await service.listActivityLog(undefined, {
      actorId: "SYSTEM",
    });
    expect(systemLogs.entries.length).toBe(1);
    expect(systemLogs.entries[0].id).toBe("log-4");
  });

  it("filters activity logs by action category / action types", async () => {
    const memoryRepo = new ActivityLogMemoryRepository({
      auditLogs,
      staffProfiles,
    });
    const service = new ActivityLogService(memoryRepo);

    const result = await service.listActivityLog(undefined, {
      actionTypes: ["reservation_checked_in", "recheckin"],
    });

    expect(result.entries.length).toBe(2);
    expect(result.entries.map((e) => e.id)).toEqual(["log-5", "log-2"]);
  });

  it("paginates activity log results correctly", async () => {
    const memoryRepo = new ActivityLogMemoryRepository({
      auditLogs,
      staffProfiles,
    });
    const service = new ActivityLogService(memoryRepo);

    const page1 = await service.listActivityLog(undefined, {
      page: 1,
      limit: 2,
    });
    expect(page1.entries.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.page).toBe(1);
    expect(page1.entries[0].id).toBe("log-5");
    expect(page1.entries[1].id).toBe("log-4");

    const page2 = await service.listActivityLog(undefined, {
      page: 2,
      limit: 2,
    });
    expect(page2.entries.length).toBe(2);
    expect(page2.page).toBe(2);
    expect(page2.entries[0].id).toBe("log-3");
    expect(page2.entries[1].id).toBe("log-2");

    const page3 = await service.listActivityLog(undefined, {
      page: 3,
      limit: 2,
    });
    expect(page3.entries.length).toBe(1);
    expect(page3.entries[0].id).toBe("log-1");
  });

  it("listStaffActivityLog scopes to only the requested staff actorId", async () => {
    const memoryRepo = new ActivityLogMemoryRepository({
      auditLogs,
      staffProfiles,
    });
    const service = new ActivityLogService(memoryRepo);

    const staff2Logs = await service.listStaffActivityLog("staff-2");

    expect(staff2Logs.entries.length).toBe(1);
    expect(staff2Logs.entries[0].id).toBe("log-5");
    expect(staff2Logs.entries[0].actorName).toBe("Charlie Staff");
  });

  it("defaults pagination to 20 records per page when limit is omitted", async () => {
    const largeLogList: MemoryAuditLogRow[] = Array.from({ length: 45 }, (_, i) => ({
      id: `log-${i + 1}`,
      actor_user_id: "staff-1",
      actor_role: "STAFF",
      action: "reservation_checked_in",
      entity_type: "reservation",
      entity_id: `res-${i + 1}`,
      created_at: new Date(1774080000000 + i * 1000).toISOString(),
    }));

    const memoryRepo = new ActivityLogMemoryRepository({
      auditLogs: largeLogList,
      staffProfiles,
    });
    const service = new ActivityLogService(memoryRepo);

    const page1 = await service.listActivityLog();
    expect(page1.entries.length).toBe(20);
    expect(page1.limit).toBe(20);
    expect(page1.total).toBe(45);

    const page2 = await service.listActivityLog(undefined, { page: 2 });
    expect(page2.entries.length).toBe(20);
    expect(page2.limit).toBe(20);

    const page3 = await service.listActivityLog(undefined, { page: 3 });
    expect(page3.entries.length).toBe(5);
    expect(page3.limit).toBe(20);
  });

  it("listActors lists active staff & admin profiles", async () => {
    const memoryRepo = new ActivityLogMemoryRepository({
      auditLogs,
      staffProfiles,
    });
    const service = new ActivityLogService(memoryRepo);

    const actors = await service.listActors("admin-1");

    expect(actors.length).toBe(3);
    expect(actors.map((a) => a.name)).toEqual(["Alice Admin", "Bob Staff", "Charlie Staff"]);
  });
});
