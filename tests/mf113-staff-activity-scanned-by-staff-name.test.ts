import { describe, it, expect } from "vitest";
import {
  ReservationSupabaseRepository,
  createStaffDashboardService,
  createAdminDashboardService,
  type OperationalActivityRecord,
  type ReportReservationRecord,
  type ReportPaymentAttemptRecord,
  type WorkspaceCatalog,
  type OccupancyRecord,
} from "@deskatlas/domain";

describe("MF-113: Staff Dashboard Today's Activity Display Staff Name in Scanned By", () => {
  it("resolves staff display_name from staff_profiles in listOperationalActivity", async () => {
    const mockStaffProfiles = [
      { user_id: "staff-uuid-1", display_name: "Jane Smith" },
      { user_id: "staff-uuid-2", display_name: "John Doe" },
    ];

    const resId1 = "11111111-1111-1111-1111-111111111111";
    const resId2 = "22222222-2222-2222-2222-222222222222";
    const resId3 = "33333333-3333-3333-3333-333333333333";
    const resId4 = "44444444-4444-4444-4444-444444444444";

    const mockAuditLogs = [
      {
        id: "log-1",
        actor_user_id: "staff-uuid-1",
        actor_role: "STAFF",
        action: "reservation_checked_in",
        entity_type: "reservation",
        entity_id: resId1,
        created_at: "2026-09-17T10:00:00Z",
        metadata: {
          event_type: "CHECK_IN",
        },
      },
      {
        id: "log-2",
        actor_user_id: "staff-uuid-2",
        actor_role: "STAFF",
        action: "reservation_reentered",
        entity_type: "reservation",
        entity_id: resId2,
        created_at: "2026-09-17T10:15:00Z",
        metadata: {
          reentry: true,
        },
      },
      {
        id: "log-3",
        actor_user_id: "unknown-uuid",
        actor_role: "STAFF",
        action: "reservation_checked_out",
        entity_type: "reservation",
        entity_id: resId3,
        created_at: "2026-09-17T10:30:00Z",
        metadata: {},
      },
      {
        id: "log-4",
        actor_user_id: "staff-uuid-1",
        actor_role: "STAFF",
        action: "reservation_checked_in",
        entity_type: "reservation",
        entity_id: resId4,
        created_at: "2026-09-17T10:45:00Z",
        metadata: {
          actor_name: "Jane Smith (Direct)",
        },
      },
    ];

    const mockReservationData: Record<string, any> = {
      [resId1]: {
        id: resId1,
        reference_code: "DA-1001",
        customer_first_name: "Alice",
        customer_last_name: "Walker",
        status: "CHECKED_IN",
        checked_in_at: "2026-09-17T10:00:00Z",
        candidates: [{ is_assigned: true, rank: 0, start_at: "2026-09-17T09:00:00Z", end_at: "2026-09-17T17:00:00Z", workspace_instance_id: "inst-1" }],
      },
      [resId2]: {
        id: resId2,
        reference_code: "DA-1002",
        customer_first_name: "Bob",
        customer_last_name: "Marley",
        status: "CHECKED_IN",
        checked_in_at: "2026-09-17T09:30:00Z",
        candidates: [{ is_assigned: true, rank: 0, start_at: "2026-09-17T09:00:00Z", end_at: "2026-09-17T17:00:00Z", workspace_instance_id: "inst-2" }],
      },
      [resId3]: {
        id: resId3,
        reference_code: "DA-1003",
        customer_first_name: "Charlie",
        customer_last_name: "Chaplin",
        status: "COMPLETED",
        checked_out_at: "2026-09-17T10:30:00Z",
        candidates: [{ is_assigned: true, rank: 0, start_at: "2026-09-17T09:00:00Z", end_at: "2026-09-17T17:00:00Z", workspace_instance_id: "inst-3" }],
      },
      [resId4]: {
        id: resId4,
        reference_code: "DA-1004",
        customer_first_name: "Diana",
        customer_last_name: "Ross",
        status: "CHECKED_IN",
        checked_in_at: "2026-09-17T10:45:00Z",
        candidates: [{ is_assigned: true, rank: 0, start_at: "2026-09-17T09:00:00Z", end_at: "2026-09-17T17:00:00Z", workspace_instance_id: "inst-4" }],
      },
    };

    const repo = new ReservationSupabaseRepository({
      supabaseUrl: "https://mock.supabase.co",
      serviceRoleKey: "mock-key",
    });
    (repo as any).request = async (path: string) => {
      if (path.startsWith("/audit_logs")) {
        return mockAuditLogs;
      }
      if (path.startsWith("/staff_profiles")) {
        return mockStaffProfiles;
      }
      if (path.startsWith("/reservations?select=")) {
        const idMatch = path.match(/id=eq\.([^&]+)/);
        if (idMatch) {
          const resId = decodeURIComponent(idMatch[1]);
          const data = mockReservationData[resId];
          return data ? [data] : [];
        }
        return [];
      }
      if (path.startsWith("/reservation_candidates")) {
        return [];
      }
      if (path.startsWith("/workspace_instances")) {
        return [];
      }
      if (path.startsWith("/workspace_templates")) {
        return [];
      }
      if (path.startsWith("/floors")) {
        return [];
      }
      return [];
    };

    const activities = await repo.listOperationalActivity(10);
    expect(activities).toHaveLength(4);

    // log-1: check-in resolved via staff_profiles
    const act1 = activities.find((a) => a.reservationId === resId1);
    expect(act1).toBeDefined();
    expect(act1?.actorName).toBe("Jane Smith");
    expect(act1?.actorUserId).toBe("staff-uuid-1");

    // log-2: re-entry resolved via staff_profiles
    const act2 = activities.find((a) => a.reservationId === resId2);
    expect(act2).toBeDefined();
    expect(act2?.actorName).toBe("John Doe");
    expect(act2?.activityType).toBe("REENTRY");

    // log-3: unknown profile falls back to "Staff" and never raw UUID
    const act3 = activities.find((a) => a.reservationId === resId3);
    expect(act3).toBeDefined();
    expect(act3?.actorName).toBe("Staff");
    expect(act3?.actorName).not.toBe("unknown-uuid");

    // log-4: direct metadata.actor_name preserved
    const act4 = activities.find((a) => a.reservationId === resId4);
    expect(act4).toBeDefined();
    expect(act4?.actorName).toBe("Jane Smith (Direct)");
  });

  it("StaffDashboardService renders staff name and never sets raw UUID into actorName", async () => {
    const fixedNow = new Date("2026-09-17T12:00:00Z");

    const sampleAuditActivity: OperationalActivityRecord[] = [
      {
        reservationId: "res-1",
        referenceCode: "DA-1001",
        customerName: "Alice Walker",
        workspaceDisplayName: "Desk 01",
        workspaceInstanceCode: "D-01",
        activityType: "CHECK_IN",
        occurredAt: "2026-09-17T10:00:00Z",
        actorUserId: "staff-uuid-1",
        actorRole: "STAFF",
        actorName: "Jane Smith",
      },
      {
        reservationId: "res-2",
        referenceCode: "DA-1002",
        customerName: "Bob Marley",
        workspaceDisplayName: "Desk 02",
        workspaceInstanceCode: "D-02",
        activityType: "REENTRY",
        occurredAt: "2026-09-17T10:30:00Z",
        actorUserId: "staff-uuid-2",
        actorRole: "STAFF",
        actorName: "John Doe",
      },
      {
        reservationId: "res-3",
        referenceCode: "DA-1003",
        customerName: "Charlie Chaplin",
        workspaceDisplayName: "Desk 03",
        workspaceInstanceCode: "D-03",
        activityType: "CHECK_OUT",
        occurredAt: "2026-09-17T11:00:00Z",
        actorUserId: "staff-uuid-3",
        actorRole: "STAFF",
        actorName: null,
      },
    ];

    const mockReportsRepo: any = {
      listReportReservations: async () => [] as ReportReservationRecord[],
      listReportPaymentAttempts: async () => [] as ReportPaymentAttemptRecord[],
    };

    const mockStaffOpsRepo: any = {
      listOccupancy: async () => [] as OccupancyRecord[],
      listOperationalActivity: async () => sampleAuditActivity,
    };

    const mockWorkspaceRepo: any = {
      listCatalog: async () =>
        ({
          templates: [],
          floors: [{ id: "fl-1", name: "Ground Floor" }],
          instances: [],
        }) as WorkspaceCatalog,
    };

    const staffDashboardService = createStaffDashboardService(
      mockReportsRepo,
      mockStaffOpsRepo,
      mockWorkspaceRepo,
      () => fixedNow,
      "Asia/Manila"
    );

    const snapshot = await staffDashboardService.getDashboardSnapshot("today");
    expect(snapshot.activity).toHaveLength(3);

    const checkInItem = snapshot.activity.find((a) => a.id.includes("res-1"));
    expect(checkInItem?.actorName).toBe("Jane Smith");
    expect(checkInItem?.actorUserId).toBe("staff-uuid-1");

    const reEntryItem = snapshot.activity.find((a) => a.id.includes("res-2"));
    expect(reEntryItem?.actorName).toBe("John Doe");
    expect(reEntryItem?.actorUserId).toBe("staff-uuid-2");

    const checkOutItem = snapshot.activity.find((a) => a.id.includes("res-3"));
    expect(checkOutItem?.actorName).toBe("Staff");
    expect(checkOutItem?.actorName).not.toBe("staff-uuid-3");
  });

  it("AdminDashboardService renders staff name and never sets raw UUID into actorName", async () => {
    const fixedNow = new Date("2026-09-17T12:00:00Z");

    const sampleAuditActivity: OperationalActivityRecord[] = [
      {
        reservationId: "res-1",
        referenceCode: "DA-1001",
        customerName: "Alice Walker",
        workspaceDisplayName: "Desk 01",
        workspaceInstanceCode: "D-01",
        activityType: "CHECK_IN",
        occurredAt: "2026-09-17T10:00:00Z",
        actorUserId: "staff-uuid-1",
        actorRole: "STAFF",
        actorName: "Jane Smith",
      },
      {
        reservationId: "res-2",
        referenceCode: "DA-1002",
        customerName: "Bob Marley",
        workspaceDisplayName: "Desk 02",
        workspaceInstanceCode: "D-02",
        activityType: "CHECK_OUT",
        occurredAt: "2026-09-17T11:00:00Z",
        actorUserId: "admin-uuid-1",
        actorRole: "ADMIN",
        actorName: null,
      },
    ];

    const mockReportsRepo: any = {
      listReportReservations: async () => [] as ReportReservationRecord[],
      listReportPaymentAttempts: async () => [] as ReportPaymentAttemptRecord[],
    };

    const mockStaffOpsRepo: any = {
      listOccupancy: async () => [] as OccupancyRecord[],
      listOperationalActivity: async () => sampleAuditActivity,
    };

    const mockWorkspaceRepo: any = {
      listCatalog: async () =>
        ({
          templates: [],
          floors: [{ id: "fl-1", name: "Ground Floor" }],
          instances: [],
        }) as WorkspaceCatalog,
    };

    const adminDashboardService = createAdminDashboardService(
      mockReportsRepo,
      mockStaffOpsRepo,
      mockWorkspaceRepo,
      () => fixedNow,
      "Asia/Manila"
    );

    const snapshot = await adminDashboardService.getDashboardSnapshot("today");
    expect(snapshot.activity).toHaveLength(2);

    const item1 = snapshot.activity.find((a) => a.id.includes("res-1"));
    expect(item1?.actorName).toBe("Jane Smith");

    const item2 = snapshot.activity.find((a) => a.id.includes("res-2"));
    expect(item2?.actorName).toBe("Admin");
    expect(item2?.actorName).not.toBe("admin-uuid-1");
  });
});
