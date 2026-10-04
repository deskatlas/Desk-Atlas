import { describe, it, expect } from "vitest";
import {
  createAdminDashboardService,
  createStaffDashboardService,
  isReservationActivelyCheckedIn,
  type OccupancyRecord,
  type OperationalActivityRecord,
  type ReportPaymentAttemptRecord,
  type ReportReservationRecord,
  type WorkspaceCatalog,
  type WorkspaceInstance,
  type Floor,
  type WorkspaceTemplate,
} from "@deskatlas/domain";

describe("MS-30: Admin Dashboard Real-Time Metrics Parity, Capacity Exclusion, and In-Use Synchronization", () => {
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

  const createInstances = (count: number): WorkspaceInstance[] => {
    const instances: WorkspaceInstance[] = [];
    for (let i = 1; i <= count; i++) {
      instances.push({
        id: `inst-${i}`,
        workspaceTemplateId: "tpl-1",
        floorId: "floor-1",
        instanceCode: `DD-${i}`,
        displayName: `Desk ${i}`,
        operationalStatus: "ACTIVE",
        tags: [],
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      });
    }
    return instances;
  };

  const catalog: WorkspaceCatalog = {
    floors: [dummyFloor],
    templates: [dummyTemplate],
    instances: createInstances(34),
  };

  const createReportReservation = (
    overrides: Partial<ReportReservationRecord>
  ): ReportReservationRecord => ({
    reservationId: "res-1",
    referenceCode: "DA-2026-001",
    source: "WEB",
    customerFirstName: "Juan",
    customerLastName: "Dela Cruz",
    customerEmail: "juan@example.com",
    reservationStatus: "CONFIRMED",
    amountDue: 300,
    currency: "PHP",
    createdAt: "2026-10-04T08:00:00Z",
    confirmedAt: "2026-10-04T08:05:00Z",
    checkedInAt: null,
    checkedOutAt: null,
    bookingStartAt: "2026-10-04T09:00:00Z",
    bookingEndAt: "2026-10-04T17:00:00Z",
    assignedCandidateRank: 0,
    workspaceDisplayName: "Desk 1",
    workspaceInstanceCode: "DD-1",
    workspaceTemplateName: "Dedicated Desk",
    floorName: "Main Coworking Floor",
    rescheduleCount: 0,
    updatedAt: "2026-10-04T08:05:00Z",
    ...overrides,
  });

  const createPaymentAttempt = (
    overrides: Partial<ReportPaymentAttemptRecord>
  ): ReportPaymentAttemptRecord => ({
    paymentAttemptId: "pay-1",
    reservationId: "res-1",
    reservationReferenceCode: "DA-2026-001",
    channel: "WEB",
    paymentStatus: "APPROVED",
    refundStatus: "NONE",
    amount: 300,
    currency: "PHP",
    paymentMethodId: "pm-1",
    paymentMethodType: "GCASH",
    paymentMethodDisplayName: "GCash",
    createdAt: "2026-10-04T08:00:00Z",
    proofSubmittedAt: "2026-10-04T08:02:00Z",
    processedAt: "2026-10-04T08:05:00Z",
    ...overrides,
  });

  it("QAD-TC30-01: Admin dashboard with historical checked-in reservations whose bookingEndAt has passed excludes ghost check-ins", async () => {
    const fixedNow = new Date("2026-10-04T10:00:00+08:00"); // 02:00:00Z

    // 23 legacy reservations that checked in in the past without explicit checkout
    const legacyReservations: ReportReservationRecord[] = [];
    for (let i = 1; i <= 23; i++) {
      legacyReservations.push(
        createReportReservation({
          reservationId: `legacy-${i}`,
          referenceCode: `LEGACY-${i}`,
          checkedInAt: "2026-10-01T09:00:00Z",
          checkedOutAt: null,
          bookingStartAt: "2026-10-01T09:00:00Z",
          bookingEndAt: "2026-10-01T17:00:00Z", // Elapsed 3 days ago
          reservationStatus: "COMPLETED",
        })
      );
    }

    const mockReportsRepo = {
      listReportReservations: async () => legacyReservations,
      listReportPaymentAttempts: async () => [],
    };
    const mockStaffOpsRepo = {
      listOccupancy: async () => [] as OccupancyRecord[],
      listOperationalActivity: async () => [] as OperationalActivityRecord[],
    };
    const mockWorkspaceRepo = {
      listCatalog: async () => catalog,
    };

    const adminService = createAdminDashboardService(
      mockReportsRepo as never,
      mockStaffOpsRepo as never,
      mockWorkspaceRepo as never,
      () => fixedNow,
      "Asia/Manila"
    );

    const snapshot = await adminService.getDashboardSnapshot("today");

    expect(snapshot.metrics.checkedIn.value).toBe(0);
    expect(snapshot.metrics.checkedIn.formattedValue).toBe("0");
    expect(snapshot.metrics.checkedIn.capacityPercentage).toBe(0);

    const inUseBreakdown = snapshot.workspaceOverview.breakdown.find(
      (b) => b.label === "In Use"
    );
    expect(inUseBreakdown?.rawValue).toBe(0);
    expect(inUseBreakdown?.value).toBe("0");

    const availableBreakdown = snapshot.workspaceOverview.breakdown.find(
      (b) => b.label === "Available"
    );
    expect(availableBreakdown?.rawValue).toBe(34);
  });

  it("QAD-TC30-02: Admin dashboard with 1 actively checked-in guest within valid booking window displays checkedIn = 1 and inUse = 1", async () => {
    const fixedNow = new Date("2026-10-04T10:00:00+08:00"); // 02:00:00Z

    const activeReservation = createReportReservation({
      reservationId: "res-active",
      referenceCode: "ACTIVE-01",
      reservationStatus: "CHECKED_IN",
      checkedInAt: "2026-10-04T09:05:00+08:00",
      checkedOutAt: null,
      bookingStartAt: "2026-10-04T09:00:00+08:00",
      bookingEndAt: "2026-10-04T17:00:00+08:00", // valid until 5 PM
    });

    const mockReportsRepo = {
      listReportReservations: async () => [activeReservation],
      listReportPaymentAttempts: async () => [],
    };
    const mockStaffOpsRepo = {
      listOccupancy: async () => [] as OccupancyRecord[],
      listOperationalActivity: async () => [] as OperationalActivityRecord[],
    };
    const mockWorkspaceRepo = {
      listCatalog: async () => catalog,
    };

    const adminService = createAdminDashboardService(
      mockReportsRepo as never,
      mockStaffOpsRepo as never,
      mockWorkspaceRepo as never,
      () => fixedNow,
      "Asia/Manila"
    );

    const snapshot = await adminService.getDashboardSnapshot("today");

    expect(snapshot.metrics.checkedIn.value).toBe(1);
    expect(snapshot.metrics.checkedIn.formattedValue).toBe("1");

    const inUseBreakdown = snapshot.workspaceOverview.breakdown.find(
      (b) => b.label === "In Use"
    );
    expect(inUseBreakdown?.rawValue).toBe(1);
    expect(inUseBreakdown?.value).toBe("1");
  });

  it("QAD-TC30-03: Admin dashboard with pending payment proof submitted before midnight reflects in 'today' pending payments queue", async () => {
    const fixedNow = new Date("2026-10-04T09:00:00+08:00"); // Today 9:00 AM PHT

    // Proof was submitted at 11:45 PM yesterday
    const pendingPayment = createPaymentAttempt({
      paymentAttemptId: "pay-under-review",
      reservationId: "res-late",
      paymentStatus: "UNDER_REVIEW",
      proofSubmittedAt: "2026-10-03T23:45:00+08:00", // Yesterday
    });

    const pendingReservation = createReportReservation({
      reservationId: "res-late",
      referenceCode: "LATE-01",
      reservationStatus: "PAYMENT_UNDER_REVIEW",
      createdAt: "2026-10-03T23:40:00+08:00",
    });

    const mockReportsRepo = {
      listReportReservations: async () => [pendingReservation],
      listReportPaymentAttempts: async () => [pendingPayment],
    };
    const mockStaffOpsRepo = {
      listOccupancy: async () => [] as OccupancyRecord[],
      listOperationalActivity: async () => [] as OperationalActivityRecord[],
    };
    const mockWorkspaceRepo = {
      listCatalog: async () => catalog,
    };

    const adminService = createAdminDashboardService(
      mockReportsRepo as never,
      mockStaffOpsRepo as never,
      mockWorkspaceRepo as never,
      () => fixedNow,
      "Asia/Manila"
    );

    const snapshot = await adminService.getDashboardSnapshot("today");

    expect(snapshot.metrics.pendingPayments.value).toBe(1);
    expect(snapshot.metrics.pendingPayments.formattedValue).toBe("1");
  });

  it("QAD-TC30-03B: Pending payments metric strictly counts UNDER_REVIEW payments (5) matching the Payment Reviews tab and excludes unsubmitted booking drafts (3)", async () => {
    const fixedNow = new Date("2026-10-05T09:00:00+08:00");

    // 5 active payment proofs awaiting admin review
    const paymentsUnderReview: ReportPaymentAttemptRecord[] = [];
    for (let i = 1; i <= 5; i++) {
      paymentsUnderReview.push(
        createPaymentAttempt({
          paymentAttemptId: `pay-review-${i}`,
          reservationId: `res-review-${i}`,
          paymentStatus: "UNDER_REVIEW",
          proofSubmittedAt: `2026-10-05T08:0${i}:00+08:00`,
        })
      );
    }

    // 3 reservations in PENDING_PAYMENT or PENDING_COUNTER_CONFIRMATION without proof awaiting review
    const unsubmittedReservations: ReportReservationRecord[] = [
      createReportReservation({
        reservationId: "res-draft-1",
        referenceCode: "DRAFT-01",
        reservationStatus: "PENDING_PAYMENT",
        createdAt: "2026-10-05T08:30:00+08:00",
      }),
      createReportReservation({
        reservationId: "res-draft-2",
        referenceCode: "DRAFT-02",
        reservationStatus: "PENDING_PAYMENT",
        createdAt: "2026-10-05T08:35:00+08:00",
      }),
      createReportReservation({
        reservationId: "res-kiosk-counter",
        referenceCode: "KIOSK-01",
        reservationStatus: "PENDING_COUNTER_CONFIRMATION",
        createdAt: "2026-10-05T08:40:00+08:00",
      }),
    ];

    const mockReportsRepo = {
      listReportReservations: async () => unsubmittedReservations,
      listReportPaymentAttempts: async () => paymentsUnderReview,
    };
    const mockStaffOpsRepo = {
      listOccupancy: async () => [] as OccupancyRecord[],
      listOperationalActivity: async () => [] as OperationalActivityRecord[],
    };
    const mockWorkspaceRepo = {
      listCatalog: async () => catalog,
    };

    const adminService = createAdminDashboardService(
      mockReportsRepo as never,
      mockStaffOpsRepo as never,
      mockWorkspaceRepo as never,
      () => fixedNow,
      "Asia/Manila"
    );

    const snapshot = await adminService.getDashboardSnapshot("today");

    // Must be exactly 5, not 8 (5 under review + 3 pending drafts)
    expect(snapshot.metrics.pendingPayments.value).toBe(5);
    expect(snapshot.metrics.pendingPayments.formattedValue).toBe("5");
  });

  it("QAD-TC30-04: Reservation created last week and rescheduled today increments Today's Rescheduled Bookings", async () => {
    const fixedNow = new Date("2026-10-04T14:00:00+08:00"); // Today 2:00 PM PHT

    const rescheduledReservation = createReportReservation({
      reservationId: "res-rescheduled",
      referenceCode: "RESCHED-01",
      createdAt: "2026-09-28T10:00:00+08:00", // Created last week
      rescheduleCount: 1,
      updatedAt: "2026-10-04T11:00:00+08:00", // Rescheduled today
    });

    const auditEvents: OperationalActivityRecord[] = [
      {
        reservationId: "res-rescheduled",
        referenceCode: "RESCHED-01",
        customerName: "Juan Dela Cruz",
        workspaceDisplayName: "Desk 1",
        workspaceInstanceCode: "DD-1",
        activityType: "RESERVATION_RESCHEDULED" as never,
        occurredAt: "2026-10-04T11:00:00+08:00",
        actorUserId: "staff-1",
        actorRole: "STAFF",
        actorName: "Maria Staff",
      },
    ];

    const mockReportsRepo = {
      listReportReservations: async () => [rescheduledReservation],
      listReportPaymentAttempts: async () => [],
    };
    const mockStaffOpsRepo = {
      listOccupancy: async () => [] as OccupancyRecord[],
      listOperationalActivity: async () => auditEvents,
    };
    const mockWorkspaceRepo = {
      listCatalog: async () => catalog,
    };

    const adminService = createAdminDashboardService(
      mockReportsRepo as never,
      mockStaffOpsRepo as never,
      mockWorkspaceRepo as never,
      () => fixedNow,
      "Asia/Manila"
    );

    const snapshot = await adminService.getDashboardSnapshot("today");

    expect(snapshot.metrics.rescheduled.value).toBe(1);
    expect(snapshot.metrics.rescheduled.formattedValue).toBe("1");
  });

  it("QAD-TC30-05: Parity comparison between admin and staff dashboard currently checked-in counts", async () => {
    const fixedNow = new Date("2026-10-04T11:30:00+08:00");

    const dataset: ReportReservationRecord[] = [
      // 1. Live active guest
      createReportReservation({
        reservationId: "res-live",
        referenceCode: "LIVE-01",
        reservationStatus: "CHECKED_IN",
        checkedInAt: "2026-10-04T09:00:00+08:00",
        checkedOutAt: null,
        bookingStartAt: "2026-10-04T09:00:00+08:00",
        bookingEndAt: "2026-10-04T17:00:00+08:00",
      }),
      // 2. Completed reservation from earlier today (checked out)
      createReportReservation({
        reservationId: "res-done",
        referenceCode: "DONE-01",
        reservationStatus: "COMPLETED",
        checkedInAt: "2026-10-04T08:00:00+08:00",
        checkedOutAt: "2026-10-04T10:00:00+08:00",
        bookingStartAt: "2026-10-04T08:00:00+08:00",
        bookingEndAt: "2026-10-04T10:00:00+08:00",
      }),
      // 3. Ghost reservation (expired end time, no explicit checkout)
      createReportReservation({
        reservationId: "res-ghost",
        referenceCode: "GHOST-01",
        reservationStatus: "COMPLETED",
        checkedInAt: "2026-10-03T09:00:00+08:00",
        checkedOutAt: null,
        bookingStartAt: "2026-10-03T09:00:00+08:00",
        bookingEndAt: "2026-10-03T17:00:00+08:00",
      }),
    ];

    const mockReportsRepo = {
      listReportReservations: async () => dataset,
      listReportPaymentAttempts: async () => [],
    };
    const mockStaffOpsRepo = {
      listOccupancy: async () => [] as OccupancyRecord[],
      listOperationalActivity: async () => [] as OperationalActivityRecord[],
    };
    const mockWorkspaceRepo = {
      listCatalog: async () => catalog,
    };

    const adminService = createAdminDashboardService(
      mockReportsRepo as never,
      mockStaffOpsRepo as never,
      mockWorkspaceRepo as never,
      () => fixedNow,
      "Asia/Manila"
    );

    const staffService = createStaffDashboardService(
      mockReportsRepo as never,
      mockStaffOpsRepo as never,
      mockWorkspaceRepo as never,
      () => fixedNow,
      "Asia/Manila"
    );

    const [adminSnapshot, staffSnapshot] = await Promise.all([
      adminService.getDashboardSnapshot("today"),
      staffService.getDashboardSnapshot("today"),
    ]);

    expect(adminSnapshot.metrics.checkedIn.value).toBe(1);
    expect(staffSnapshot.metrics.checkedIn.value).toBe(1);
    expect(adminSnapshot.metrics.checkedIn.value).toBe(staffSnapshot.metrics.checkedIn.value);
  });

  it("isReservationActivelyCheckedIn helper validates active sessions correctly", () => {
    const now = new Date("2026-10-04T12:00:00Z");

    // Case 1: Active checked in
    expect(
      isReservationActivelyCheckedIn(
        createReportReservation({
          checkedInAt: "2026-10-04T11:00:00Z",
          checkedOutAt: null,
          bookingEndAt: "2026-10-04T15:00:00Z",
          reservationStatus: "CHECKED_IN",
        }),
        now
      )
    ).toBe(true);

    // Case 2: Not checked in yet
    expect(
      isReservationActivelyCheckedIn(
        createReportReservation({
          checkedInAt: null,
          checkedOutAt: null,
          bookingEndAt: "2026-10-04T15:00:00Z",
          reservationStatus: "CONFIRMED",
        }),
        now
      )
    ).toBe(false);

    // Case 3: Checked out
    expect(
      isReservationActivelyCheckedIn(
        createReportReservation({
          checkedInAt: "2026-10-04T10:00:00Z",
          checkedOutAt: "2026-10-04T11:30:00Z",
          bookingEndAt: "2026-10-04T15:00:00Z",
          reservationStatus: "COMPLETED",
        }),
        now
      )
    ).toBe(false);

    // Case 4: Booking end time in past
    expect(
      isReservationActivelyCheckedIn(
        createReportReservation({
          checkedInAt: "2026-10-04T09:00:00Z",
          checkedOutAt: null,
          bookingEndAt: "2026-10-04T11:00:00Z",
          reservationStatus: "CHECKED_IN",
        }),
        now
      )
    ).toBe(false);

    // Case 5: Cancelled status
    expect(
      isReservationActivelyCheckedIn(
        createReportReservation({
          checkedInAt: "2026-10-04T09:00:00Z",
          checkedOutAt: null,
          bookingEndAt: "2026-10-04T15:00:00Z",
          reservationStatus: "CANCELLED",
        }),
        now
      )
    ).toBe(false);
  });
});
