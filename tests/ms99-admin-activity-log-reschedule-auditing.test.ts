import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  ActivityLogMemoryRepository,
  ActivityLogSupabaseRepository,
  formatMetadataKey,
  formatMetadataValue,
  getHumanReadableMetadata,
  type MemoryAuditLogRow,
  type MemoryStaffProfileRow,
} from "@deskatlas/domain";

describe("MS-99: Admin Activity Log Rescheduled Reservation Ingestion, Category Filtering, Customer Role Attribution, and Metadata Formatting", () => {
  const rootDir = path.resolve(__dirname, "..");
  const adminActivityLogPagePath = path.join(
    rootDir,
    "apps",
    "admin-portal",
    "src",
    "app",
    "manage",
    "activity-log",
    "page.tsx"
  );

  it("MS99-TC01: Dedicated Reschedule Action Group is configured in ACTION_GROUPS", () => {
    expect(fs.existsSync(adminActivityLogPagePath)).toBe(true);
    const pageContent = fs.readFileSync(adminActivityLogPagePath, "utf8");

    // Verify dedicated Rescheduled Bookings group in ACTION_GROUPS
    expect(pageContent).toContain('label: "Rescheduled Bookings"');
    expect(pageContent).toContain('value: "RESCHEDULED"');
    expect(pageContent).toContain('"reservation_rescheduled"');
    expect(pageContent).toContain('"RESERVATION_RESCHEDULED"');

    // Verify data-testid for action group filter
    expect(pageContent).toContain('data-testid="activity-log-action-filter"');
  });

  it("MS99-TC02: Customer Actor Filter Option and testid are present in AdminActivityLogPage", () => {
    const pageContent = fs.readFileSync(adminActivityLogPagePath, "utf8");

    // Verify data-testid on actor selector
    expect(pageContent).toContain('data-testid="activity-log-actor-filter"');

    // Verify Customer (Self-Service) option is available
    expect(pageContent).toContain('<option value="CUSTOMER">Customer (Self-Service)</option>');
  });

  it("MS99-TC03: Supabase Repository routes actorId CUSTOMER to actor_role=eq.CUSTOMER", async () => {
    let capturedUrl: URL | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      capturedUrl = new URL(String(input));
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const repo = new ActivityLogSupabaseRepository({
        supabaseUrl: "https://audit-fixture.invalid",
        serviceRoleKey: "service-role-test-key",
      });

      await repo.listActivityLogs({ actorId: "CUSTOMER" });

      expect(capturedUrl).not.toBeNull();
      const searchParams = capturedUrl!.searchParams;
      expect(searchParams.get("actor_role")).toBe("eq.CUSTOMER");
      expect(searchParams.get("actor_user_id")).toBeNull();

      // Verify SYSTEM actorId queries actor_role=eq.SYSTEM
      await repo.listActivityLogs({ actorId: "SYSTEM" });
      expect(capturedUrl!.searchParams.get("actor_role")).toBe("eq.SYSTEM");
      expect(capturedUrl!.searchParams.get("actor_user_id")).toBeNull();

      // Verify standard staff/admin UUID queries actor_user_id
      await repo.listActivityLogs({ actorId: "usr-staff-77" });
      expect(capturedUrl!.searchParams.get("actor_user_id")).toBe("eq.usr-staff-77");
      expect(capturedUrl!.searchParams.get("actor_role")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("MS99-TC04: Memory Repository filters CUSTOMER actor role accurately and attributes customer name", async () => {
    const staffProfiles: MemoryStaffProfileRow[] = [
      {
        userId: "admin-1",
        displayName: "Alice Admin",
        role: "ADMIN",
        isActive: true,
      },
    ];

    const auditLogs: MemoryAuditLogRow[] = [
      {
        id: "log-1",
        actor_user_id: null,
        actor_role: "CUSTOMER",
        action: "reservation_rescheduled",
        entity_type: "reservation",
        entity_id: "res-101",
        metadata: {
          reference_code: "REF-CUST-1",
          customer_name: "Maria Santos",
          old_schedule: "Oct 5, 2026 10:00 - 12:00",
          new_schedule: "Oct 6, 2026 10:00 - 12:00",
        },
        created_at: "2026-11-01T10:00:00Z",
      },
      {
        id: "log-2",
        actor_user_id: "admin-1",
        actor_role: "ADMIN",
        action: "reservation_rescheduled",
        entity_type: "reservation",
        entity_id: "res-102",
        metadata: {
          reference_code: "REF-ADM-1",
          old_schedule: "Oct 5, 2026 14:00 - 16:00",
          new_schedule: "Oct 7, 2026 14:00 - 16:00",
        },
        created_at: "2026-11-01T11:00:00Z",
      },
      {
        id: "log-3",
        actor_user_id: null,
        actor_role: "SYSTEM",
        action: "reservation_cancelled",
        entity_type: "reservation",
        entity_id: "res-103",
        metadata: { reference_code: "REF-SYS-1" },
        created_at: "2026-11-01T12:00:00Z",
      },
    ];

    const memoryRepo = new ActivityLogMemoryRepository({
      auditLogs,
      staffProfiles,
    });

    const result = await memoryRepo.listActivityLogs({ actorId: "CUSTOMER" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].id).toBe("log-1");
    expect(result.entries[0].actorRole).toBe("CUSTOMER");
    expect(result.entries[0].actorName).toBe("Maria Santos");

    // Also verify SYSTEM filter does not include CUSTOMER
    const sysResult = await memoryRepo.listActivityLogs({ actorId: "SYSTEM" });
    expect(sysResult.entries.length).toBe(1);
    expect(sysResult.entries[0].id).toBe("log-3");
    expect(sysResult.entries[0].actorRole).toBe("SYSTEM");
  });

  it("MS99-TC05: Customer Role Badge styling uses distinctive purple/indigo tokens", () => {
    const pageContent = fs.readFileSync(adminActivityLogPagePath, "utf8");

    // Assert getRoleBadgeStyle contains distinct CUSTOMER styling
    expect(pageContent).toContain('if (r === "CUSTOMER")');
    expect(pageContent).toContain('"#F5F3FF"');
    expect(pageContent).toContain('"#6D28D9"');
    expect(pageContent).toContain('"1px solid #DDD6FE"');
  });

  it("MS99-TC06: Reschedule Metadata Keys format cleanly into title case labels", () => {
    expect(formatMetadataKey("old_schedule")).toBe("Previous Schedule");
    expect(formatMetadataKey("oldSchedule")).toBe("Previous Schedule");
    expect(formatMetadataKey("new_schedule")).toBe("New Schedule");
    expect(formatMetadataKey("newSchedule")).toBe("New Schedule");
    expect(formatMetadataKey("reschedule_reason")).toBe("Reschedule Reason");
    expect(formatMetadataKey("rescheduleReason")).toBe("Reschedule Reason");
    expect(formatMetadataKey("rescheduled_by")).toBe("Rescheduled By");
    expect(formatMetadataKey("rescheduledBy")).toBe("Rescheduled By");
    expect(formatMetadataKey("reschedule_count")).toBe("Reschedule Count");
    expect(formatMetadataKey("rescheduleCount")).toBe("Reschedule Count");
  });

  it("MS99-TC07: Rescheduled At timestamp key and value format without raw ISO characters", () => {
    expect(formatMetadataKey("rescheduled_at")).toBe("Rescheduled At");
    expect(formatMetadataKey("rescheduledAt")).toBe("Rescheduled At");

    const formattedDate = formatMetadataValue("rescheduled_at", "2026-11-02T14:30:00Z");
    expect(formattedDate).not.toContain("T");
    expect(formattedDate).toMatch(/Nov\s+2,\s+2026/);
  });

  it("MS99-TC08: Activity Record Details Modal extracts human-readable reschedule metadata and suppresses raw IDs", () => {
    const rawMetadata: Record<string, unknown> = {
      reference_code: "DA-2026-RESCHED-01",
      reservation_id: "00000000-0000-4000-8000-000000000099",
      workspace_instance_id: "inst-99999999-0000-4000-8000-000000000099",
      old_schedule: "2026-11-05T09:00:00Z - 2026-11-05T17:00:00Z",
      new_schedule: "2026-11-06T09:00:00Z - 2026-11-06T17:00:00Z",
      rescheduled_at: "2026-11-02T10:00:00Z",
      reschedule_reason: "Shifted due to flight delay",
      reschedule_count: 1,
      rescheduled_by: "Alice Admin",
    };

    const items = getHumanReadableMetadata(rawMetadata);

    // Verify suppression of internal UUIDs
    expect(items.some((i) => i.key === "reservation_id")).toBe(false);
    expect(items.some((i) => i.key === "workspace_instance_id")).toBe(false);

    // Verify key labels
    const refItem = items.find((i) => i.key === "reference_code");
    expect(refItem?.label).toBe("Reservation Reference");
    expect(refItem?.value).toBe("DA-2026-RESCHED-01");

    const oldItem = items.find((i) => i.key === "old_schedule");
    expect(oldItem?.label).toBe("Previous Schedule");
    expect(oldItem?.value).not.toContain("T");

    const newItem = items.find((i) => i.key === "new_schedule");
    expect(newItem?.label).toBe("New Schedule");
    expect(newItem?.value).not.toContain("T");

    const atItem = items.find((i) => i.key === "rescheduled_at");
    expect(atItem?.label).toBe("Rescheduled At");
    expect(atItem?.value).not.toContain("T");

    const reasonItem = items.find((i) => i.key === "reschedule_reason");
    expect(reasonItem?.label).toBe("Reschedule Reason");
    expect(reasonItem?.value).toBe("Shifted due to flight delay");

    const countItem = items.find((i) => i.key === "reschedule_count");
    expect(countItem?.label).toBe("Reschedule Count");
    expect(countItem?.value).toBe("1");

    const byItem = items.find((i) => i.key === "rescheduled_by");
    expect(byItem?.label).toBe("Rescheduled By");
    expect(byItem?.value).toBe("Alice Admin");
  });
});
