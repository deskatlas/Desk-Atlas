import { describe, it, expect, beforeEach } from "vitest";
import {
  formatBookingAccessState,
  formatBookingCheckInState,
  ReservationMemoryRepository,
  createAdminDashboardService,
  createStaffDashboardService,
  ActivityLogService,
  ActivityLogMemoryRepository,
  type OperationalActivityRecord,
  type ReportReservationRecord,
  type ReportPaymentAttemptRecord,
  type WorkspaceCatalog,
  type WorkspaceInstance,
  type Floor,
  type WorkspaceTemplate,
  type CreateReservationRequest,
  type MemoryAuditLogRow,
  type MemoryStaffProfileRow,
} from "@deskatlas/domain";

describe("MS-34: Scanner and Tracker Access State Formatting and Rescheduled Booking Activity Audit Logging System", () => {
  describe("Formatting Functions (formatBookingAccessState & formatBookingCheckInState)", () => {
    it("QAD-TC34-01: Format access state NOT_ACTIVE using formatBookingAccessState returns 'Not Active' without underscores", () => {
      const result = formatBookingAccessState("NOT_ACTIVE");
      expect(result).toBe("Not Active");
      expect(result).not.toContain("_");
    });

    it("QAD-TC34-02: Format check-in state NOT_CHECKED_IN using formatBookingCheckInState returns 'Not Checked In' without underscores", () => {
      const result = formatBookingCheckInState("NOT_CHECKED_IN");
      expect(result).toBe("Not Checked In");
      expect(result).not.toContain("_");
    });

    it("QAD-TC34-03: Format active and checked-in states (ACTIVE, CHECKED_IN, CHECKED_OUT, EXPIRED, INVALID) cleanly", () => {
      expect(formatBookingAccessState("ACTIVE")).toBe("Active");
      expect(formatBookingAccessState("EXPIRED")).toBe("Expired");
      expect(formatBookingAccessState("INVALID")).toBe("Invalid");
      expect(formatBookingAccessState(null)).toBe("Unknown");
      expect(formatBookingAccessState(undefined)).toBe("Unknown");
      expect(formatBookingAccessState("CUSTOM_ACCESS_STATE")).toBe("Custom Access State");

      expect(formatBookingCheckInState("CHECKED_IN")).toBe("Checked In");
      expect(formatBookingCheckInState("CHECKED_OUT")).toBe("Checked Out");
      expect(formatBookingCheckInState(null)).toBe("Not Checked In");
      expect(formatBookingCheckInState(undefined)).toBe("Not Checked In");
      expect(formatBookingCheckInState("CUSTOM_CHECK_IN_STATE")).toBe("Custom Check In State");
    });
  });

  describe("In-Memory Operational Activity Logging on Reschedule", () => {
    let repo: ReservationMemoryRepository;
    const now = new Date("2026-10-05T09:00:00+08:00");
    const nowProvider = () => now;

    beforeEach(async () => {
      repo = new ReservationMemoryRepository(nowProvider);
    });

    async function seedConfirmedReservation(referenceCode: string) {
      const createReq: CreateReservationRequest = {
        source: "WEB",
        customerFirstName: "Maria",
        customerLastName: "Santos",
        customerEmail: "maria.santos@example.com",
        customerContactNumber: "09171234567",
        amountDue: 500,
        currency: "PHP",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "spot-1",
            startAt: "2026-10-06T10:00:00+08:00",
            endAt: "2026-10-06T14:00:00+08:00",
          },
        ],
      };

      const reservation = await repo.createReservation(createReq);
      // Manually set status to CONFIRMED
      reservation.status = "CONFIRMED";
      reservation.confirmedAt = "2026-10-05T09:30:00+08:00";
      return reservation;
    }

    it("QAD-TC34-04: Execute rescheduleReservation() in memory repository inserts operational activity with activityType = 'RESCHEDULED'", async () => {
      const reservation = await seedConfirmedReservation("DA-2026-0001");

      const rescheduleResult = await repo.rescheduleReservation({
        reservationId: reservation.id,
        startAt: "2026-10-07T10:00:00+08:00",
        endAt: "2026-10-07T14:00:00+08:00",
        actorUserId: "admin-user-1",
        actorRole: "ADMIN",
      });

      expect(rescheduleResult.success).toBe(true);
      expect(rescheduleResult.reservation.rescheduleCount).toBe(1);

      const activityList = await repo.listOperationalActivity(10);
      expect(activityList.length).toBeGreaterThan(0);

      const rescheduleEvent = activityList.find((a) => a.reservationId === reservation.id);
      expect(rescheduleEvent).toBeDefined();
      expect(rescheduleEvent?.activityType).toBe("RESCHEDULED");
      expect(rescheduleEvent?.actorRole).toBe("ADMIN");
      expect(rescheduleEvent?.actorName).toBe("Admin");
    });

    it("QAD-TC34-05: Call listOperationalActivity() after customer reschedule returns reschedule record with reference code, customer name, and timestamp", async () => {
      const reservation = await seedConfirmedReservation("DA-2026-0002");

      await repo.rescheduleReservation({
        reservationId: reservation.id,
        startAt: "2026-10-08T10:00:00+08:00",
        endAt: "2026-10-08T14:00:00+08:00",
        actorRole: "CUSTOMER",
      });

      const activityList = await repo.listOperationalActivity(5);
      const customerReschedule = activityList.find(
        (a) => a.reservationId === reservation.id && a.activityType === "RESCHEDULED"
      );

      expect(customerReschedule).toBeDefined();
      expect(customerReschedule?.referenceCode).toBe(reservation.referenceCode);
      expect(customerReschedule?.customerName).toBe("Maria Santos");
      expect(customerReschedule?.actorRole).toBe("CUSTOMER");
      expect(customerReschedule?.actorName).toBe("Customer");
      expect(customerReschedule?.occurredAt).toBe(now.toISOString());
    });
  });

  describe("Admin and Staff Dashboard Today's Activity Feeds", () => {
    const dummyTemplate: WorkspaceTemplate = {
      id: "tpl-1",
      name: "Dedicated Desk",
      code: "DD",
      description: "Dedicated Desk",
      basePricePerHour: 150,
      minBookingHours: 1,
      maxBookingHours: 8,
      photoUrl: null,
      recommendationTags: [],
      pricingUnit: "HOURLY",
      pricingUnits: ["HOURLY"],
      dailyRate: null,
      weeklyRate: null,
      monthlyRate: null,
      isCustomStructure: false,
      colorHex: "#3B82F6",
      shapeType: "RECTANGLE",
      dimensions: { width: 100, length: 100 },
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    };

    const dummyFloor: Floor = {
      id: "floor-1",
      floorNumber: 1,
      name: "Main Coworking Floor",
      description: null,
      mapWidth: 1000,
      mapHeight: 1000,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    };

    const dummyInstance: WorkspaceInstance = {
      id: "spot-1",
      workspaceTemplateId: "tpl-1",
      floorId: "floor-1",
      instanceCode: "DD-01",
      displayName: "Desk 01",
      operationalStatus: "ACTIVE",
      capacity: 1,
      coordinates: { x: 10, y: 10 },
      dimensions: { width: 100, length: 100 },
      rotation: 0,
      metadata: {},
      isLocked: false,
      recommendationTags: [],
      shapeType: "RECTANGLE",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    };

    const catalog: WorkspaceCatalog = {
      floors: [dummyFloor],
      templates: [dummyTemplate],
      instances: [dummyInstance],
    };

    const fixedNow = new Date("2026-10-05T14:30:00+08:00");

    it("QAD-TC34-06: Generate Admin Dashboard snapshot with a rescheduled booking includes item with status = 'Rescheduled' and mark = '↺'", async () => {
      const rescheduleAudit: OperationalActivityRecord = {
        reservationId: "res-101",
        referenceCode: "DA-2026-101",
        customerName: "Carlos Miguel",
        workspaceDisplayName: "Desk 01",
        workspaceInstanceCode: "DD-01",
        activityType: "RESCHEDULED",
        occurredAt: "2026-10-05T11:00:00+08:00",
        actorUserId: "admin-1",
        actorRole: "ADMIN",
        actorName: "Admin User",
      };

      const mockReportsRepo = {
        listReportReservations: async () => [] as ReportReservationRecord[],
        listReportPaymentAttempts: async () => [] as ReportPaymentAttemptRecord[],
      };
      const mockStaffOpsRepo = {
        listOccupancy: async () => [],
        listOperationalActivity: async () => [rescheduleAudit],
      };
      const mockWorkspaceRepo = {
        listCatalog: async () => catalog,
      };

      const adminDashboardService = createAdminDashboardService(
        mockReportsRepo as never,
        mockStaffOpsRepo as never,
        mockWorkspaceRepo as never,
        () => fixedNow,
        "Asia/Manila"
      );

      const snapshot = await adminDashboardService.getDashboardSnapshot("today");
      const rescheduleItem = snapshot.activity.find((a) => a.status === "Rescheduled");

      expect(rescheduleItem).toBeDefined();
      expect(rescheduleItem?.name).toBe("Carlos Miguel");
      expect(rescheduleItem?.workspace).toBe("Desk 01");
      expect(rescheduleItem?.mark).toBe("↺");
      expect(rescheduleItem?.status).toBe("Rescheduled");
      expect(rescheduleItem?.style).toEqual({ background: "#EBF5FF", color: "#1E40AF" });
    });

    it("QAD-TC34-07: Generate Staff Dashboard snapshot with a rescheduled booking includes the item in real time", async () => {
      const rescheduleAudit: OperationalActivityRecord = {
        reservationId: "res-202",
        referenceCode: "DA-2026-202",
        customerName: "Elena Rodriguez",
        workspaceDisplayName: "Desk 01",
        workspaceInstanceCode: "DD-01",
        activityType: "RESCHEDULED",
        occurredAt: "2026-10-05T12:15:00+08:00",
        actorUserId: null,
        actorRole: "CUSTOMER",
        actorName: "Customer",
      };

      const mockReportsRepo = {
        listReportReservations: async () => [] as ReportReservationRecord[],
        listReportPaymentAttempts: async () => [] as ReportPaymentAttemptRecord[],
      };
      const mockStaffOpsRepo = {
        listOccupancy: async () => [],
        listOperationalActivity: async () => [rescheduleAudit],
      };
      const mockWorkspaceRepo = {
        listCatalog: async () => catalog,
      };

      const staffDashboardService = createStaffDashboardService(
        mockReportsRepo as never,
        mockStaffOpsRepo as never,
        mockWorkspaceRepo as never,
        () => fixedNow,
        "Asia/Manila"
      );

      const snapshot = await staffDashboardService.getDashboardSnapshot();
      const rescheduleItem = snapshot.activity.find((a) => a.status === "Rescheduled");

      expect(rescheduleItem).toBeDefined();
      expect(rescheduleItem?.name).toBe("Elena Rodriguez");
      expect(rescheduleItem?.mark).toBe("↺");
      expect(rescheduleItem?.status).toBe("Rescheduled");
      expect(rescheduleItem?.actorName).toBe("Customer");
    });
  });

  describe("Staff Activity Log Querying and Filtering", () => {
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
    ];

    const auditLogs: MemoryAuditLogRow[] = [
      {
        id: "log-reschedule-1",
        actor_user_id: null,
        actor_role: "CUSTOMER",
        action: "reservation_rescheduled",
        entity_type: "reservation",
        entity_id: "res-303",
        metadata: {
          reference_code: "DA-2026-303",
          old_schedule: "Oct 5, 2026 10:00 - 12:00",
          new_schedule: "Oct 6, 2026 10:00 - 12:00",
        },
        created_at: "2026-10-05T10:00:00Z",
      },
      {
        id: "log-relocate-1",
        actor_user_id: "staff-1",
        actor_role: "STAFF",
        action: "reservation_relocated",
        entity_type: "reservation",
        entity_id: "res-304",
        metadata: { reference_code: "DA-2026-304" },
        created_at: "2026-10-05T10:30:00Z",
      },
      {
        id: "log-checkout-1",
        actor_user_id: "staff-1",
        actor_role: "STAFF",
        action: "reservation_checked_out",
        entity_type: "reservation",
        entity_id: "res-305",
        metadata: { reference_code: "DA-2026-305" },
        created_at: "2026-10-05T11:00:00Z",
      },
    ];

    it("QAD-TC34-08: Filter Staff Activity Log with actionTypes including reservation_rescheduled returns reschedule audit entries with Customer attribution", async () => {
      const memoryRepo = new ActivityLogMemoryRepository({
        auditLogs,
        staffProfiles,
      });

      const service = new ActivityLogService(memoryRepo);

      // Filtering with the types from the updated ACTION_GROUPS for RESERVATIONS
      const result = await service.listActivityLog(undefined, {
        actionTypes: [
          "reservation_relocated",
          "RESERVATION_RELOCATED",
          "reservation_extended",
          "RESERVATION_EXTENDED",
          "reservation_rescheduled",
          "RESERVATION_RESCHEDULED",
        ],
      });

      expect(result.total).toBe(2);
      const rescheduleEntry = result.entries.find((e) => e.action === "reservation_rescheduled");
      expect(rescheduleEntry).toBeDefined();
      expect(rescheduleEntry?.actorName).toBe("Customer");
      expect(rescheduleEntry?.actorRole).toBe("CUSTOMER");
      expect(rescheduleEntry?.actionLabel).toBe("Reservation Rescheduled");
      expect(rescheduleEntry?.metadata.reference_code).toBe("DA-2026-303");
    });
  });
});
