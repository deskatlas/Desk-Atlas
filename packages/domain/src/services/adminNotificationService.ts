import {
  AdminNotificationItem,
  AdminNotificationListResult,
  AdminNotificationType,
} from "../models/adminNotification";
import {
  ReportPaymentAttemptRecord,
  ReportReservationRecord,
} from "../models/reports";
import { ReportsRepository } from "../services/reportsRepository";
import { OperationalActivityRecord } from "../models/reservation";
import { StaffOperationsRepository } from "../services/staffOperationsRepository";
import {
  WorkspaceAuditLogEntry,
  WorkspaceRepository,
} from "../models/workspace";

export interface AdminNotificationServiceDependencies {
  reportsRepo: ReportsRepository;
  staffOpsRepo: StaffOperationsRepository;
  workspaceRepo?: WorkspaceRepository;
  customAuditLogsProvider?: () => Promise<WorkspaceAuditLogEntry[]>;
}

export interface AdminNotificationService {
  listNotifications(limit?: number): Promise<AdminNotificationListResult>;
}

export function calculateUnreadCount(
  notifications: AdminNotificationItem[],
  readIds: Iterable<string>
): number {
  const readSet = new Set(readIds);
  return notifications.filter((n) => !readSet.has(n.id) && !n.read).length;
}

export function markAsRead(
  currentReadIds: Iterable<string>,
  idOrIds: string | string[]
): string[] {
  const set = new Set(currentReadIds);
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  for (const id of ids) {
    if (id) {
      set.add(id);
    }
  }
  return Array.from(set);
}

export function applyReadState(
  notifications: AdminNotificationItem[],
  readIds: Iterable<string>
): AdminNotificationItem[] {
  const readSet = new Set(readIds);
  return notifications.map((n) => ({
    ...n,
    read: readSet.has(n.id) || !!n.read,
  }));
}

export function createAdminNotificationService(
  dependencies: AdminNotificationServiceDependencies
): AdminNotificationService {
  const { reportsRepo, staffOpsRepo, workspaceRepo, customAuditLogsProvider } =
    dependencies;

  return {
    async listNotifications(limit = 50): Promise<AdminNotificationListResult> {
      const fetchAuditsPromise: Promise<WorkspaceAuditLogEntry[]> =
        customAuditLogsProvider
          ? customAuditLogsProvider()
          : workspaceRepo && typeof workspaceRepo.listAuditLogs === "function"
            ? workspaceRepo.listAuditLogs(limit)
            : Promise.resolve([]);

      const [reservations, payments, operationalActivity, auditLogs] =
        await Promise.all([
          reportsRepo.listReportReservations().catch(() => [] as ReportReservationRecord[]),
          reportsRepo.listReportPaymentAttempts().catch(() => [] as ReportPaymentAttemptRecord[]),
          staffOpsRepo.listOperationalActivity(limit).catch(() => [] as OperationalActivityRecord[]),
          fetchAuditsPromise.catch(() => [] as WorkspaceAuditLogEntry[]),
        ]);

      const items: AdminNotificationItem[] = [];
      const seenIds = new Set<string>();

      const addNotification = (item: AdminNotificationItem) => {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          items.push(item);
        }
      };

      // 1. New reservation submissions & status-based reservation notifications
      for (const res of reservations) {
        const fullName =
          `${res.customerFirstName ?? ""} ${res.customerLastName ?? ""}`.trim() ||
          "Guest";
        const workspaceName =
          res.workspaceDisplayName ?? res.workspaceInstanceCode ?? "Workspace";
        const refCode = res.referenceCode ?? res.reservationId.slice(0, 8);

        // Reservation created
        if (res.createdAt) {
          addNotification({
            id: `res-created-${res.reservationId}`,
            type: "RESERVATION_CREATED",
            title: "New Reservation",
            description: `${fullName} submitted a reservation for ${workspaceName} (${refCode})`,
            link: `/manage/reservations?id=${res.reservationId}`,
            timestamp: res.createdAt,
            metadata: {
              reservationId: res.reservationId,
              referenceCode: res.referenceCode,
              customerName: fullName,
              workspaceName,
            },
          });
        }

        // Needs manual resolution
        if (res.reservationStatus === "NEEDS_MANUAL_RESOLUTION") {
          addNotification({
            id: `res-manual-res-${res.reservationId}`,
            type: "MANUAL_RESOLUTION_REQUIRED",
            title: "Manual Resolution Required",
            description: `Reservation ${refCode} (${fullName}) requires manual spot allocation`,
            link: `/manage/reservations?id=${res.reservationId}`,
            timestamp: (res as any).updatedAt ?? res.createdAt,
            metadata: {
              reservationId: res.reservationId,
              referenceCode: res.referenceCode,
              customerName: fullName,
            },
          });
        }

        // Expired reservation
        if (res.reservationStatus === "EXPIRED") {
          addNotification({
            id: `res-expired-${res.reservationId}`,
            type: "PAYMENT_EXPIRED",
            title: "Reservation Expired",
            description: `Reservation ${refCode} (${fullName}) expired without payment`,
            link: `/manage/reservations?id=${res.reservationId}`,
            timestamp: (res as any).updatedAt ?? res.createdAt,
            metadata: {
              reservationId: res.reservationId,
              referenceCode: res.referenceCode,
            },
          });
        }
      }

      // 2. Payment proof submissions, approvals, rejections
      const resById = new Map<string, ReportReservationRecord>();
      for (const res of reservations) {
        resById.set(res.reservationId, res);
      }

      for (const pay of payments) {
        const matchingRes = resById.get(pay.reservationId);
        const refCode =
          matchingRes?.referenceCode ?? pay.reservationId.slice(0, 8);
        const customerName = matchingRes
          ? `${matchingRes.customerFirstName} ${matchingRes.customerLastName}`.trim()
          : "Customer";

        // Proof submitted awaiting review
        if (pay.paymentStatus === "UNDER_REVIEW" && pay.proofSubmittedAt) {
          addNotification({
            id: `pay-proof-${pay.paymentAttemptId}`,
            type: "PAYMENT_PROOF_SUBMITTED",
            title: "Payment Proof Submitted",
            description: `${customerName} uploaded payment proof for ${refCode} (Awaiting review)`,
            link: "/manage/payments",
            timestamp: pay.proofSubmittedAt,
            metadata: {
              paymentAttemptId: pay.paymentAttemptId,
              reservationId: pay.reservationId,
              referenceCode: refCode,
            },
          });
        }

        // Payment approved
        if (pay.paymentStatus === "APPROVED" && pay.processedAt) {
          addNotification({
            id: `pay-approved-${pay.paymentAttemptId}`,
            type: "PAYMENT_APPROVED",
            title: "Payment Approved",
            description: `Payment for reservation ${refCode} was approved`,
            link: "/manage/payments",
            timestamp: pay.processedAt,
            metadata: {
              paymentAttemptId: pay.paymentAttemptId,
              reservationId: pay.reservationId,
              referenceCode: refCode,
            },
          });
        }

        // Payment rejected
        if (pay.paymentStatus === "REJECTED" && pay.processedAt) {
          const reasonText = (pay as any).rejectionReason
            ? `: ${(pay as any).rejectionReason}`
            : "";
          addNotification({
            id: `pay-rejected-${pay.paymentAttemptId}`,
            type: "PAYMENT_REJECTED",
            title: "Payment Rejected",
            description: `Payment for reservation ${refCode} was rejected${reasonText}`,
            link: "/manage/payments",
            timestamp: pay.processedAt,
            metadata: {
              paymentAttemptId: pay.paymentAttemptId,
              reservationId: pay.reservationId,
              referenceCode: refCode,
              rejectionReason: (pay as any).rejectionReason,
            },
          });
        }
      }

      // 3. Operational check-ins and check-outs (from QR scans / audit activity)
      for (const activity of operationalActivity) {
        const isCheckIn =
          activity.activityType === "CHECK_IN" ||
          activity.activityType === "REENTRY";
        const isReentry = activity.activityType === "REENTRY";
        const title = isReentry
          ? "Customer Re-entry"
          : isCheckIn
            ? "Customer Check-in"
            : "Customer Check-out";
        const actionVerb = isReentry
          ? "re-entered"
          : isCheckIn
            ? "checked in at"
            : "checked out from";
        const spot =
          activity.workspaceDisplayName ??
          activity.workspaceInstanceCode ??
          "workspace";
        const refCode =
          activity.referenceCode ?? activity.reservationId.slice(0, 8);

        addNotification({
          id: `op-act-${activity.reservationId}-${activity.activityType}-${activity.occurredAt}`,
          type: isCheckIn ? "CHECK_IN" : "CHECK_OUT",
          title,
          description: `${activity.customerName} ${actionVerb} ${spot} (${refCode})`,
          link: `/manage/reservations?id=${activity.reservationId}`,
          timestamp: activity.occurredAt,
          metadata: {
            reservationId: activity.reservationId,
            referenceCode: activity.referenceCode,
            activityType: activity.activityType,
            customerName: activity.customerName,
            workspace: spot,
          },
        });
      }

      // 4. Workspace operational status changes from audit logs
      for (const log of auditLogs) {
        const isWorkspaceUpdate =
          log.action === "workspace.instance.updated" ||
          log.entityType === "workspace_instance";

        if (isWorkspaceUpdate && log.metadata) {
          const prevStatus =
            log.metadata.previousOperationalStatus as string | undefined;
          const nextStatus =
            log.metadata.newOperationalStatus as string | undefined;
          const displayName =
            (log.metadata.newDisplayName as string) ||
            (log.metadata.previousDisplayName as string) ||
            "Workspace spot";

          if (prevStatus && nextStatus && prevStatus !== nextStatus) {
            const time = log.createdAt ?? new Date().toISOString();
            addNotification({
              id: `ws-status-${log.entityId}-${time}`,
              type: "WORKSPACE_STATUS_CHANGED",
              title: "Workspace Status Changed",
              description: `${displayName} status changed from ${prevStatus} to ${nextStatus}`,
              link: "/manage/workspaces",
              timestamp: time,
              metadata: {
                workspaceId: log.entityId,
                previousStatus: prevStatus,
                newStatus: nextStatus,
                displayName,
              },
            });
          }
        }
      }

      // Sort reverse chronologically: newest timestamp first
      items.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeB - timeA;
      });

      const sliced = items.slice(0, limit);
      return {
        notifications: sliced,
        total: items.length,
      };
    },
  };
}
