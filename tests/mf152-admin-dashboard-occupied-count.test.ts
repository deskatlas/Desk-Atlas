import { describe, it, expect } from "vitest";
import {
  calculateOccupancySummary,
  createAdminDashboardService,
  type OccupancyRecord,
  type OccupancySummary,
  type ReportPaymentAttemptRecord,
  type ReportReservationRecord,
  type WorkspaceCatalog,
  type WorkspaceInstance,
  type Floor,
  type WorkspaceTemplate,
} from "@deskatlas/domain";

describe("MF-152: Admin Dashboard Currently Occupied Workspaces Count & Status", () => {
  const dummyTemplate: WorkspaceTemplate = {
    id: "tpl-1",
    name: "Standard Desk",
    code: "SD",
    description: "Standard Desk",
    basePricePerHour: 100,
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
    name: "Ground Floor",
    description: null,
    mapWidth: 1000,
    mapHeight: 1000,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };

  const createInstances = (activeCount: number, maintenanceCount = 0, inactiveCount = 0): WorkspaceInstance[] => {
    const instances: WorkspaceInstance[] = [];
    for (let i = 1; i <= activeCount; i++) {
      instances.push({
        id: `inst-active-${i}`,
        workspaceTemplateId: "tpl-1",
        floorId: "floor-1",
        instanceCode: `SD-${i}`,
        displayName: `Standard Desk ${i}`,
        operationalStatus: "ACTIVE",
        tags: [],
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      });
    }
    for (let i = 1; i <= maintenanceCount; i++) {
      instances.push({
        id: `inst-maint-${i}`,
        workspaceTemplateId: "tpl-1",
        floorId: "floor-1",
        instanceCode: `SD-M${i}`,
        displayName: `Maintenance Desk ${i}`,
        operationalStatus: "MAINTENANCE",
        tags: [],
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      });
    }
    for (let i = 1; i <= inactiveCount; i++) {
      instances.push({
        id: `inst-inact-${i}`,
        workspaceTemplateId: "tpl-1",
        floorId: "floor-1",
        instanceCode: `SD-I${i}`,
        displayName: `Inactive Desk ${i}`,
        operationalStatus: "INACTIVE",
        tags: [],
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      });
    }
    return instances;
  };

  const createOccupancyRecord = (
    id: string,
    instanceId: string,
    status: "CHECKED_IN" | "CONFIRMED",
    occupancyState: "OCCUPIED" | "RESERVED"
  ): OccupancyRecord => ({
    reservationId: `res-${id}`,
    referenceCode: `DA-2026-${id}`,
    source: "WEB",
    customerFirstName: "Test",
    customerLastName: `User ${id}`,
    customerEmail: `user${id}@example.com`,
    reservationStatus: status,
    checkInState: status === "CHECKED_IN" ? "CHECKED_IN" : "NOT_CHECKED_IN",
    workspaceInstanceId: instanceId,
    workspaceDisplayName: `Desk ${id}`,
    workspaceInstanceCode: `SD-${id}`,
    workspaceTemplateName: "Standard Desk",
    floorName: "Ground Floor",
    bookingStartAt: "2026-09-20T09:00:00Z",
    bookingEndAt: "2026-09-20T17:00:00Z",
    confirmedAt: "2026-09-20T08:30:00Z",
    checkedInAt: status === "CHECKED_IN" ? "2026-09-20T09:05:00Z" : null,
    checkedOutAt: null,
    qrIssuedAt: "2026-09-20T08:30:00Z",
    occupancyState,
  });

  describe("calculateOccupancySummary", () => {
    it("returns correct occupiedCount for a mix of CHECKED_IN and active-window CONFIRMED bookings", () => {
      const catalog: WorkspaceCatalog = {
        floors: [dummyFloor],
        templates: [dummyTemplate],
        instances: createInstances(10),
      };

      const occupancyList: OccupancyRecord[] = [
        createOccupancyRecord("1", "inst-active-1", "CHECKED_IN", "OCCUPIED"),
        createOccupancyRecord("2", "inst-active-2", "CHECKED_IN", "OCCUPIED"),
        createOccupancyRecord("3", "inst-active-3", "CHECKED_IN", "OCCUPIED"),
        createOccupancyRecord("4", "inst-active-4", "CONFIRMED", "RESERVED"),
        createOccupancyRecord("5", "inst-active-5", "CONFIRMED", "RESERVED"),
      ];

      const summary = calculateOccupancySummary(catalog, occupancyList);

      expect(summary.checkedInCount).toBe(3);
      expect(summary.inWindowCount).toBe(2);
      expect(summary.occupiedCount).toBe(5);
      expect(summary.totalActiveInstances).toBe(10);
      expect(summary.occupancyRate).toBe(50);
      expect(summary.inWindowCount + summary.checkedInCount).toBe(summary.occupiedCount);
    });

    it("returns 0 when there are no active bookings", () => {
      const catalog: WorkspaceCatalog = {
        floors: [dummyFloor],
        templates: [dummyTemplate],
        instances: createInstances(8),
      };

      const summary = calculateOccupancySummary(catalog, []);

      expect(summary.occupiedCount).toBe(0);
      expect(summary.checkedInCount).toBe(0);
      expect(summary.inWindowCount).toBe(0);
      expect(summary.totalActiveInstances).toBe(8);
      expect(summary.occupancyRate).toBe(0);
    });

    it("correctly calculates occupancy rate as rounded percentage", () => {
      const catalog: WorkspaceCatalog = {
        floors: [dummyFloor],
        templates: [dummyTemplate],
        instances: createInstances(3),
      };

      // 1 out of 3 = 33.333% -> rounds to 33%
      const occupancyList: OccupancyRecord[] = [
        createOccupancyRecord("1", "inst-active-1", "CHECKED_IN", "OCCUPIED"),
      ];

      const summary = calculateOccupancySummary(catalog, occupancyList);
      expect(summary.occupiedCount).toBe(1);
      expect(summary.totalActiveInstances).toBe(3);
      expect(summary.occupancyRate).toBe(33);
    });

    it("excludes MAINTENANCE and INACTIVE instances from totalActiveInstances", () => {
      const catalog: WorkspaceCatalog = {
        floors: [dummyFloor],
        templates: [dummyTemplate],
        instances: createInstances(10, 3, 2), // 10 active, 3 maintenance, 2 inactive = 15 total
      };

      const occupancyList: OccupancyRecord[] = [
        createOccupancyRecord("1", "inst-active-1", "CHECKED_IN", "OCCUPIED"),
        createOccupancyRecord("2", "inst-active-2", "CONFIRMED", "RESERVED"),
      ];

      const summary = calculateOccupancySummary(catalog, occupancyList);
      expect(summary.totalActiveInstances).toBe(10);
      expect(summary.occupiedCount).toBe(2);
      expect(summary.occupancyRate).toBe(20);
    });

    it("handles 0 totalActiveInstances without division-by-zero error", () => {
      const catalog: WorkspaceCatalog = {
        floors: [dummyFloor],
        templates: [dummyTemplate],
        instances: [],
      };

      const summary = calculateOccupancySummary(catalog, []);
      expect(summary.totalActiveInstances).toBe(0);
      expect(summary.occupiedCount).toBe(0);
      expect(summary.occupancyRate).toBe(0);
    });
  });

  describe("AdminDashboardService integration", () => {
    it("getCurrentOccupancySummary resolves live occupancy from repositories", async () => {
      const mockCatalog: WorkspaceCatalog = {
        floors: [dummyFloor],
        templates: [dummyTemplate],
        instances: createInstances(20, 2, 1),
      };

      const mockOccupancy: OccupancyRecord[] = [
        createOccupancyRecord("1", "inst-active-1", "CHECKED_IN", "OCCUPIED"),
        createOccupancyRecord("2", "inst-active-2", "CHECKED_IN", "OCCUPIED"),
        createOccupancyRecord("3", "inst-active-3", "CHECKED_IN", "OCCUPIED"),
        createOccupancyRecord("4", "inst-active-4", "CHECKED_IN", "OCCUPIED"),
        createOccupancyRecord("5", "inst-active-5", "CONFIRMED", "RESERVED"),
        createOccupancyRecord("6", "inst-active-6", "CONFIRMED", "RESERVED"),
        createOccupancyRecord("7", "inst-active-7", "CONFIRMED", "RESERVED"),
      ];

      const mockReportsRepo = {
        listReportReservations: async () => [] as ReportReservationRecord[],
        listReportPaymentAttempts: async () => [] as ReportPaymentAttemptRecord[],
      };

      const mockStaffOpsRepo = {
        listOperationalReservations: async () => [],
        getOperationalReservation: async () => null,
        listOccupancy: async () => mockOccupancy,
        listOperationalActivity: async () => [],
        checkInReservation: async () => ({} as any),
        checkOutReservation: async () => ({} as any),
      };

      const mockWorkspaceRepo = {
        listCatalog: async () => mockCatalog,
      };

      const service = createAdminDashboardService(
        mockReportsRepo as any,
        mockStaffOpsRepo as any,
        mockWorkspaceRepo as any,
        () => new Date("2026-09-20T10:00:00Z")
      );

      const summary: OccupancySummary = await service.getCurrentOccupancySummary();

      expect(summary.occupiedCount).toBe(7);
      expect(summary.checkedInCount).toBe(4);
      expect(summary.inWindowCount).toBe(3);
      expect(summary.totalActiveInstances).toBe(20);
      expect(summary.occupancyRate).toBe(35); // 7 / 20 = 35%
    });

    it("getDashboardSnapshot attaches occupancySummary", async () => {
      const mockCatalog: WorkspaceCatalog = {
        floors: [dummyFloor],
        templates: [dummyTemplate],
        instances: createInstances(10),
      };

      const mockOccupancy: OccupancyRecord[] = [
        createOccupancyRecord("1", "inst-active-1", "CHECKED_IN", "OCCUPIED"),
        createOccupancyRecord("2", "inst-active-2", "CHECKED_IN", "OCCUPIED"),
      ];

      const mockReportsRepo = {
        listReportReservations: async () => [] as ReportReservationRecord[],
        listReportPaymentAttempts: async () => [] as ReportPaymentAttemptRecord[],
      };

      const mockStaffOpsRepo = {
        listOperationalReservations: async () => [],
        getOperationalReservation: async () => null,
        listOccupancy: async () => mockOccupancy,
        listOperationalActivity: async () => [],
        checkInReservation: async () => ({} as any),
        checkOutReservation: async () => ({} as any),
      };

      const mockWorkspaceRepo = {
        listCatalog: async () => mockCatalog,
      };

      const service = createAdminDashboardService(
        mockReportsRepo as any,
        mockStaffOpsRepo as any,
        mockWorkspaceRepo as any,
        () => new Date("2026-09-20T10:00:00Z")
      );

      const snapshot = await service.getDashboardSnapshot("today");

      expect(snapshot.occupancySummary).toBeDefined();
      expect(snapshot.occupancySummary?.occupiedCount).toBe(2);
      expect(snapshot.occupancySummary?.checkedInCount).toBe(2);
      expect(snapshot.occupancySummary?.inWindowCount).toBe(0);
      expect(snapshot.occupancySummary?.totalActiveInstances).toBe(10);
      expect(snapshot.occupancySummary?.occupancyRate).toBe(20);
    });
  });

  describe("Indicator threshold checks", () => {
    function getIndicatorLevel(rate: number): "LOW" | "AMBER" | "RED" {
      if (rate >= 90) return "RED";
      if (rate >= 70) return "AMBER";
      return "LOW";
    }

    it("evaluates green at low occupancy (<70%)", () => {
      expect(getIndicatorLevel(0)).toBe("LOW");
      expect(getIndicatorLevel(50)).toBe("LOW");
      expect(getIndicatorLevel(69)).toBe("LOW");
    });

    it("evaluates amber at medium-high occupancy (70% to 89%)", () => {
      expect(getIndicatorLevel(70)).toBe("AMBER");
      expect(getIndicatorLevel(80)).toBe("AMBER");
      expect(getIndicatorLevel(89)).toBe("AMBER");
    });

    it("evaluates red at high/critical occupancy (90%+)", () => {
      expect(getIndicatorLevel(90)).toBe("RED");
      expect(getIndicatorLevel(95)).toBe("RED");
      expect(getIndicatorLevel(100)).toBe("RED");
    });
  });
});
