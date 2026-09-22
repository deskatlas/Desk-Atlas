import { describe, it, expect, vi } from "vitest";
import {
  ReservationSupabaseRepository,
  createCounterPaymentService,
  createBookingAccessService,
  createStaffDashboardService,
  type OperationalActivityRecord,
  type ReportReservationRecord,
  type ReportPaymentAttemptRecord,
  type WorkspaceCatalog,
  type OccupancyRecord,
} from "@deskatlas/domain";

describe("MF-179: Correct Staff Actor Attribution in Kiosk Confirmation & Check-In Activity Log", () => {
  it("attributes kiosk confirmation and check-in activity to Maurice when confirmed by Maurice", async () => {
    const mauriceUserId = "00000000-0000-0000-0000-000000000002";
    const reynardUserId = "00000000-0000-0000-0000-000000000001";
    const resId = "11111111-1111-1111-1111-111111111111";

    const mockStaffProfiles = [
      { user_id: reynardUserId, display_name: "Reynard Rabanal", role: "ADMIN", is_active: true },
      { user_id: mauriceUserId, display_name: "Maurice", role: "STAFF", is_active: true },
    ];

    const capturedAuditLogs: any[] = [];

    const mockReservationData: Record<string, any> = {
      [resId]: {
        id: resId,
        reference_code: "DA-2026-KIOSK1",
        customer_first_name: "John",
        customer_last_name: "Doe",
        status: "CHECKED_IN",
        checked_in_at: "2026-09-23T10:00:00Z",
        candidates: [
          {
            id: "cand-1",
            is_assigned: true,
            rank: 0,
            start_at: "2026-09-23T10:00:00Z",
            end_at: "2026-09-23T14:00:00Z",
            workspace_instance_id: "inst-1",
          },
        ],
      },
    };

    const repo = new ReservationSupabaseRepository({
      supabaseUrl: "https://mock.supabase.co",
      serviceRoleKey: "mock-key",
    });

    // Mock RPC and REST endpoints
    (repo as any).request = async (path: string, options?: any) => {
      if (path === "/rpc/confirm_kiosk_payment_and_allocate") {
        const body = JSON.parse(options.body);
        expect(body.p_processed_by_user_id).toBe(mauriceUserId);
        expect(body.p_processed_by_user_id).not.toBe(reynardUserId);

        // Simulate RPC behavior
        capturedAuditLogs.push({
          id: "log-kiosk-confirm",
          actor_user_id: mauriceUserId,
          actor_role: "STAFF",
          action: "reservation_checked_in",
          entity_type: "reservation",
          entity_id: resId,
          created_at: "2026-09-23T10:00:00Z",
          metadata: {
            source: "KIOSK",
            auto_check_in: true,
            event_type: "CHECK_IN",
            actor_name: "Maurice",
          },
        });

        return [
          {
            payment_attempt_id: body.p_payment_attempt_id,
            reservation_id: resId,
            reservation_reference_code: "DA-2026-KIOSK1",
            reservation_status: "CHECKED_IN",
            payment_status: "APPROVED",
            refund_status: null,
            assigned_candidate_id: "cand-1",
            assigned_candidate_rank: 0,
            assigned_workspace_instance_id: "inst-1",
            assigned_start_at: "2026-09-23T10:00:00Z",
            assigned_end_at: "2026-09-23T14:00:00Z",
            rejection_reason: null,
            processed_at: "2026-09-23T10:00:00Z",
            processed_by_user_id: mauriceUserId,
          },
        ];
      }

      if (path.startsWith("/audit_logs")) {
        return capturedAuditLogs;
      }

      if (path.startsWith("/staff_profiles")) {
        return mockStaffProfiles;
      }

      if (path.startsWith("/reservations?select=")) {
        const idMatch = path.match(/id=eq\.([^&]+)/);
        if (idMatch) {
          const matchedId = decodeURIComponent(idMatch[1]);
          const data = mockReservationData[matchedId];
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

    // Execute confirmation with Maurice as actor
    const counterService = createCounterPaymentService(repo);
    const result = await counterService.confirmPayment({
      paymentAttemptId: "pay-attempt-kiosk-1",
      actor: {
        userId: mauriceUserId,
        role: "STAFF",
      },
    });

    expect(result.assignedCandidate).toBeDefined();
    expect(result.assignedCandidate?.workspaceInstanceId).toBe("inst-1");

    // Retrieve activity stream
    const activities = await repo.listOperationalActivity(10);
    expect(activities).toHaveLength(1);
    expect(activities[0].actorName).toBe("Maurice");
    expect(activities[0].actorUserId).toBe(mauriceUserId);
    expect(activities[0].actorName).not.toBe("Reynard Rabanal");
  });

  it("fails confirmation when actor userId is missing or empty", async () => {
    const repo = new ReservationSupabaseRepository({
      supabaseUrl: "https://mock.supabase.co",
      serviceRoleKey: "mock-key",
    });

    const counterService = createCounterPaymentService(repo);

    await expect(
      counterService.confirmPayment({
        paymentAttemptId: "pay-attempt-1",
        actor: {
          userId: "",
          role: "STAFF",
        },
      })
    ).rejects.toThrow("Actor user ID is required.");
  });

  it("records booking scan with active staff user ID and attributes activity to that staff member", async () => {
    const mauriceUserId = "00000000-0000-0000-0000-000000000002";
    const resId = "11111111-1111-1111-1111-111111111111";

    const mockStaffProfiles = [
      { user_id: mauriceUserId, display_name: "Maurice", role: "STAFF", is_active: true },
    ];

    let recordedScanInput: any = null;

    const mockRepo: any = {
      findBookingAccessByTokenHash: async () => ({
        reservationId: resId,
        referenceCode: "DA-2026-KIOSK1",
        reservationStatus: "CONFIRMED",
        qrRevokedAt: null,
        assignedWorkspaceInstanceId: "inst-1",
        assignedWorkspaceDisplayName: "Spot 1",
        assignedWorkspaceInstanceCode: "S-1",
        assignedWorkspaceTemplateName: "Desk",
        assignedFloorName: "Main",
        assignedStartAt: "2026-09-23T10:00:00Z",
        assignedEndAt: "2026-09-23T14:00:00Z",
        checkedInAt: null,
        checkedOutAt: null,
        qrIssuedAt: "2026-09-23T09:00:00Z",
        customerFirstName: "John",
        customerLastName: "Doe",
        customerEmail: "john@example.com",
      }),
      recordBookingScan: async (input: any) => {
        recordedScanInput = input;
      },
    };

    const bookingAccessService = createBookingAccessService(
      mockRepo,
      () => new Date("2026-09-23T10:30:00Z")
    );

    const scanResult = await bookingAccessService.resolveBookingAccess(
      "test-token",
      { userId: mauriceUserId, role: "STAFF" }
    );

    expect(scanResult.accessState).toBe("ACTIVE");
    expect(recordedScanInput).toBeDefined();
    expect(recordedScanInput.actorUserId).toBe(mauriceUserId);
    expect(recordedScanInput.actorRole).toBe("STAFF");
  });

  it("StaffDashboard activity snapshot renders Maurice and never falls back to arbitrary profile", async () => {
    const fixedNow = new Date("2026-09-23T12:00:00Z");

    const sampleAuditActivity: OperationalActivityRecord[] = [
      {
        reservationId: "res-1",
        referenceCode: "DA-2026-KIOSK1",
        customerName: "John Doe",
        workspaceDisplayName: "Spot 1",
        workspaceInstanceCode: "S-1",
        activityType: "CHECK_IN",
        occurredAt: "2026-09-23T10:00:00Z",
        actorUserId: "00000000-0000-0000-0000-000000000002",
        actorRole: "STAFF",
        actorName: "Maurice",
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
    expect(snapshot.activity).toHaveLength(1);
    expect(snapshot.activity[0].actorName).toBe("Maurice");
    expect(snapshot.activity[0].actorName).not.toBe("Reynard Rabanal");
  });
});
