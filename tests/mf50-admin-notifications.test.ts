import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createAdminNotificationService,
  calculateUnreadCount,
  markAsRead,
  applyReadState,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  type CreateReservationRequest,
  type AdminNotificationItem,
} from "@deskatlas/domain";

describe("MF-50: Admin Notification Center", () => {
  it("fetches empty notifications list cleanly when no operational events exist", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const service = createAdminNotificationService({
      reportsRepo: reservationRepo,
      staffOpsRepo: reservationRepo,
      workspaceRepo,
    });

    const result = await service.listNotifications(50);
    assert.equal(result.total, 0);
    assert.deepEqual(result.notifications, []);

    const unread = calculateUnreadCount(result.notifications, []);
    assert.equal(unread, 0);
  });

  it("calculates unread count correctly and updates on mark-as-read state change", () => {
    const notifications: AdminNotificationItem[] = [
      {
        id: "notif-1",
        type: "RESERVATION_CREATED",
        title: "New Reservation",
        description: "Alice reserved Desk A1",
        link: "/manage/reservations",
        timestamp: "2026-09-08T10:00:00.000Z",
      },
      {
        id: "notif-2",
        type: "PAYMENT_APPROVED",
        title: "Payment Approved",
        description: "Payment approved for Desk A1",
        link: "/manage/payments",
        timestamp: "2026-09-08T10:05:00.000Z",
      },
      {
        id: "notif-3",
        type: "CHECK_IN",
        title: "Customer Check-in",
        description: "Alice checked in at Desk A1",
        link: "/manage/reservations",
        timestamp: "2026-09-08T10:10:00.000Z",
      },
    ];

    // Initially all unread
    assert.equal(calculateUnreadCount(notifications, []), 3);

    // Mark single as read
    const afterOne = markAsRead([], "notif-2");
    assert.deepEqual(afterOne, ["notif-2"]);
    assert.equal(calculateUnreadCount(notifications, afterOne), 2);

    // Apply read state
    const formatted = applyReadState(notifications, afterOne);
    assert.equal(formatted.find((n) => n.id === "notif-2")?.read, true);
    assert.equal(formatted.find((n) => n.id === "notif-1")?.read, false);
    assert.equal(formatted.find((n) => n.id === "notif-3")?.read, false);

    // Mark all as read
    const allIds = notifications.map((n) => n.id);
    const afterAll = markAsRead(afterOne, allIds);
    assert.equal(calculateUnreadCount(notifications, afterAll), 0);
  });

  it("maps all required event types and sorts them in reverse chronological order", async () => {
    let now = new Date("2026-09-08T08:00:00.000Z");
    const nowProvider = () => now;

    const reservationRepo = new ReservationMemoryRepository(nowProvider);
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);

    // Set up workspace
    const floor = await workspaceRepo.createFloor({ name: "1st Floor" });
    const template = await workspaceRepo.createTemplate({
      name: "Hot Desk",
      capacity: 1,
      rateAmount: 150,
      pricingUnit: "HOURLY",
      defaultShape: "rectangle",
      defaultColor: "#0f172a",
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: "HD-01",
      displayName: "Hot Desk 1",
    });

    // 1. Create reservation (RESERVATION_CREATED)
    const baseRequest: CreateReservationRequest = {
      customerFirstName: "Jordan",
      customerLastName: "Lee",
      customerEmail: "jordan@example.com",
      source: "WEB",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: instance.id,
          startAt: "2026-09-08T09:00:00.000Z",
          endAt: "2026-09-08T11:00:00.000Z",
        },
      ],
    };

    const reservation = await reservationService.createReservation(baseRequest, {
      paymentLinkBaseUrl: "https://deskatlas.com/pay",
    });

    // 2. Submit payment proof (PAYMENT_PROOF_SUBMITTED)
    now = new Date("2026-09-08T08:15:00.000Z");
    await paymentSessionService.submitPaymentProof({
      token: reservation.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proof/jordan-receipt.png",
    });

    // 3. Approve payment (PAYMENT_APPROVED)
    now = new Date("2026-09-08T08:20:00.000Z");
    const reviewQueue = await paymentReviewService.listPaymentReviewQueue();
    const item = reviewQueue.find((q) => q.reservationId === reservation.id);
    assert.ok(item, "Review queue item must exist");

    await paymentReviewService.reviewPayment({
      paymentAttemptId: item.paymentAttemptId,
      decision: "APPROVE",
      actor: { userId: "admin-1", role: "ADMIN" },
    });

    // 4. Log check-in operational activity (CHECK_IN)
    now = new Date("2026-09-08T09:00:00.000Z");
    reservationRepo.addOperationalActivity({
      reservationId: reservation.id,
      referenceCode: reservation.referenceCode,
      customerName: "Jordan Lee",
      workspaceDisplayName: "Hot Desk 1",
      workspaceInstanceCode: "HD-01",
      activityType: "CHECK_IN",
      occurredAt: now.toISOString(),
      actorUserId: "staff-1",
      actorRole: "STAFF",
    });

    // 5. Log workspace status change in audit log (WORKSPACE_STATUS_CHANGED)
    now = new Date("2026-09-08T09:30:00.000Z");
    await workspaceRepo.appendAuditLog({
      actorUserId: "admin-1",
      actorRole: "ADMIN",
      action: "workspace.instance.updated",
      entityType: "workspace_instance",
      entityId: instance.id,
      metadata: {
        previousDisplayName: "Hot Desk 1",
        newDisplayName: "Hot Desk 1",
        previousOperationalStatus: "ACTIVE",
        newOperationalStatus: "MAINTENANCE",
      },
      createdAt: now.toISOString(),
    });

    // Now test notification service
    const service = createAdminNotificationService({
      reportsRepo: reservationRepo,
      staffOpsRepo: reservationRepo,
      workspaceRepo,
    });

    const result = await service.listNotifications(50);
    assert.ok(result.total >= 4, `Expected at least 4 notifications, got ${result.total}`);

    // Verify chronological ordering (newest first)
    for (let i = 0; i < result.notifications.length - 1; i++) {
      const current = new Date(result.notifications[i].timestamp).getTime();
      const next = new Date(result.notifications[i + 1].timestamp).getTime();
      assert.ok(
        current >= next,
        `Notifications must be in reverse chronological order: ${result.notifications[i].timestamp} vs ${result.notifications[i + 1].timestamp}`
      );
    }

    // Verify event types exist
    const types = new Set(result.notifications.map((n) => n.type));
    assert.ok(types.has("RESERVATION_CREATED"), "Must contain RESERVATION_CREATED");
    assert.ok(types.has("PAYMENT_APPROVED"), "Must contain PAYMENT_APPROVED");
    assert.ok(types.has("CHECK_IN"), "Must contain CHECK_IN");
    assert.ok(types.has("WORKSPACE_STATUS_CHANGED"), "Must contain WORKSPACE_STATUS_CHANGED");

    // Verify workspace status changed notification content
    const wsNotif = result.notifications.find((n) => n.type === "WORKSPACE_STATUS_CHANGED");
    assert.ok(wsNotif);
    assert.equal(wsNotif.title, "Workspace Status Changed");
    assert.ok(wsNotif.description.includes("ACTIVE to MAINTENANCE"));
    assert.equal(wsNotif.link, "/manage/workspaces");

    // Verify check-in notification content
    const checkInNotif = result.notifications.find((n) => n.type === "CHECK_IN");
    assert.ok(checkInNotif);
    assert.equal(checkInNotif.title, "Customer Check-in");
    assert.ok(checkInNotif.description.includes("Jordan Lee"));
    assert.ok(checkInNotif.link.includes("/manage/reservations"));

    // Verify reservation created notification content
    const resNotif = result.notifications.find((n) => n.type === "RESERVATION_CREATED");
    assert.ok(resNotif);
    assert.equal(resNotif.title, "New Reservation");
    assert.ok(resNotif.description.includes("Jordan Lee"));
  });

  it("handles payment rejection, expired reservations, and manual resolution events", async () => {
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();

    // Custom operational events injection for edge cases
    const service = createAdminNotificationService({
      reportsRepo: {
        async listReportReservations() {
          return [
            {
              reservationId: "res-expired-1",
              referenceCode: "EXP-1234",
              customerFirstName: "Bob",
              customerLastName: "Vance",
              customerEmail: "bob@example.com",
              reservationStatus: "EXPIRED",
              createdAt: "2026-09-08T07:00:00.000Z",
              updatedAt: "2026-09-08T08:00:00.000Z",
              confirmedAt: null,
              cancelledAt: null,
              totalAmount: 100,
              paymentStatus: "EXPIRED",
              pricingUnit: "HOURLY",
              durationHours: 1,
              source: "CUSTOMER_WEB",
              workspaceDisplayName: "Desk 4",
              workspaceInstanceCode: "D4",
              workspaceTemplateName: "Desk",
              floorName: "Floor 1",
            },
            {
              reservationId: "res-manual-1",
              referenceCode: "MAN-5678",
              customerFirstName: "Phyllis",
              customerLastName: "Lapin",
              customerEmail: "phyllis@example.com",
              reservationStatus: "NEEDS_MANUAL_RESOLUTION",
              createdAt: "2026-09-08T08:30:00.000Z",
              updatedAt: "2026-09-08T08:45:00.000Z",
              confirmedAt: null,
              cancelledAt: null,
              totalAmount: 200,
              paymentStatus: "APPROVED",
              pricingUnit: "HOURLY",
              durationHours: 2,
              source: "CUSTOMER_WEB",
              workspaceDisplayName: "Desk 5",
              workspaceInstanceCode: "D5",
              workspaceTemplateName: "Desk",
              floorName: "Floor 1",
            },
          ];
        },
        async listReportPaymentAttempts() {
          return [
            {
              paymentAttemptId: "pay-rej-1",
              reservationId: "res-rej-1",
              paymentStatus: "REJECTED",
              paymentMethod: "GCASH",
              amount: 150,
              proofPath: "proofs/rej.png",
              proofSubmittedAt: "2026-09-08T08:10:00.000Z",
              processedAt: "2026-09-08T08:25:00.000Z",
              rejectionReason: "Unclear transaction reference",
              createdAt: "2026-09-08T08:00:00.000Z",
            },
          ];
        },
      },
      staffOpsRepo: {
        async listOperationalActivity() {
          return [];
        },
      },
      workspaceRepo,
    });

    const result = await service.listNotifications(50);
    const types = result.notifications.map((n) => n.type);

    assert.ok(types.includes("PAYMENT_EXPIRED"));
    assert.ok(types.includes("MANUAL_RESOLUTION_REQUIRED"));
    assert.ok(types.includes("PAYMENT_REJECTED"));

    const rej = result.notifications.find((n) => n.type === "PAYMENT_REJECTED");
    assert.ok(rej?.description.includes("Unclear transaction reference"));

    const exp = result.notifications.find((n) => n.type === "PAYMENT_EXPIRED");
    assert.ok(exp?.description.includes("EXP-1234"));

    const man = result.notifications.find((n) => n.type === "MANUAL_RESOLUTION_REQUIRED");
    assert.ok(man?.description.includes("MAN-5678"));
  });
});
