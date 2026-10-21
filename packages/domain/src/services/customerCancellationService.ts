// MS-68: Customer Booking Cancellation Policy, Self-Service Cancellation, and Refund Eligibility Notification
// Traceability: PRD-F5, PRD-F6, SDD-C4, SDD-C5, SDD-C11, DSD-UI11, ERD-E2, ERD-E10, ERD-E11, ERD-E13, QAD-TC49, MS68-TC01..12

import { BusinessSettings, calculateCancellationCutoffHours } from "../models/settings";
import { GuestReservationTrackingRecord } from "./guestReservationTrackingRepository";
import { TransactionalEmailService } from "./transactionalEmailService";

export interface CustomerCancellationEvaluation {
  canCancel: boolean;
  reasonCode?: 'STATUS_NOT_CONFIRMED' | 'ALREADY_CHECKED_IN' | 'COMPLETED' | 'NO_SCHEDULE' | 'START_PASSED' | 'CUTOFF_PASSED';
  reason?: string;
  cutoffHours: number;
  cancellationCutoffDisplay: string;
}

/**
 * Evaluates whether a guest reservation qualifies for self-service cancellation.
 * A booking is eligible if:
 * 1. Status is CONFIRMED
 * 2. Has not checked in (checkedInAt is null/undefined)
 * 3. Has not checked out (checkedOutAt is null/undefined)
 * 4. Booking start time is valid and in the future
 * 5. now <= bookingStartAt - cutoffHours
 */
export function evaluateCustomerCancellationEligibility(
  record: GuestReservationTrackingRecord,
  settings?: Pick<BusinessSettings, 'customerCancellationCutoffValue' | 'customerCancellationCutoffUnit'> | null,
  now: Date | number = new Date()
): CustomerCancellationEvaluation {
  const cutoffHours = calculateCancellationCutoffHours(settings);
  const cutoffValue = settings?.customerCancellationCutoffValue ?? 12;
  const cutoffUnit = settings?.customerCancellationCutoffUnit ?? "HOURS";
  const cancellationCutoffDisplay =
    cutoffUnit === "DAYS"
      ? `${cutoffValue} ${cutoffValue === 1 ? "day" : "days"}`
      : `${cutoffValue} ${cutoffValue === 1 ? "hour" : "hours"}`;

  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  if (record.reservationStatus !== "CONFIRMED") {
    return {
      canCancel: false,
      reason: `Cannot cancel a reservation in ${record.reservationStatus.toLowerCase()} status.`,
      reasonCode: 'STATUS_NOT_CONFIRMED',
      cutoffHours,
      cancellationCutoffDisplay,
    };
  }

  if (record.checkedInAt) {
    return {
      canCancel: false,
      reason: "Cannot cancel a reservation that has already checked in.",
      reasonCode: 'ALREADY_CHECKED_IN',
      cutoffHours,
      cancellationCutoffDisplay,
    };
  }

  if (record.checkedOutAt) {
    return {
      canCancel: false,
      reason: "Cannot cancel a completed reservation.",
      reasonCode: 'COMPLETED',
      cutoffHours,
      cancellationCutoffDisplay,
    };
  }

  const startStr = record.finalAssignment?.bookingStartAt;
  if (!startStr) {
    return {
      canCancel: false,
      reason: "Reservation does not have a scheduled start time.",
      reasonCode: 'NO_SCHEDULE',
      cutoffHours,
      cancellationCutoffDisplay,
    };
  }

  const startMs = new Date(startStr).getTime();
  if (isNaN(startMs) || startMs <= nowMs) {
    return {
      canCancel: false,
      reason: "Scheduled start time has already passed.",
      reasonCode: 'START_PASSED',
      cutoffHours,
      cancellationCutoffDisplay,
    };
  }

  const cutoffThresholdMs = startMs - cutoffHours * 3600 * 1000;
  if (nowMs > cutoffThresholdMs) {
    return {
      canCancel: false,
      reason: `Self-service cancellation closed ${cancellationCutoffDisplay} prior to booking start time.`,
      reasonCode: 'CUTOFF_PASSED',
      cutoffHours,
      cancellationCutoffDisplay,
    };
  }

  return {
    canCancel: true,
    cutoffHours,
    cancellationCutoffDisplay,
  };
}

export interface ProcessCancellationInput {
  record: GuestReservationTrackingRecord;
  settings?: BusinessSettings | null;
  emailService?: TransactionalEmailService;
  now?: Date | number;
  cancellationRefundNotifiedAt?: string | null;
  onNotificationRecorded?: (notifiedAt: string) => Promise<void> | void;
}

export interface ProcessCancellationResult {
  success: boolean;
  canCancel: boolean;
  notified: boolean;
  skippedReason?: string;
  error?: string;
  cancellationRefundNotifiedAt?: string;
}

/**
 * Idempotently handles customer refund notification upon cancellation.
 * Only dispatches email if cancellationRefundNotifiedAt is null/undefined.
 */
export async function notifyCustomerOfCancellationRefundIdempotent(
  input: ProcessCancellationInput
): Promise<ProcessCancellationResult> {
  const now = input.now ? (input.now instanceof Date ? input.now : new Date(input.now)) : new Date();
  const nowIso = now.toISOString();

  const evalResult = evaluateCustomerCancellationEligibility(input.record, input.settings, now);
  if (!evalResult.canCancel) {
    return {
      success: false,
      canCancel: false,
      notified: false,
      skippedReason: evalResult.reason,
    };
  }

  if (input.cancellationRefundNotifiedAt) {
    return {
      success: true,
      canCancel: true,
      notified: false,
      skippedReason: "ALREADY_NOTIFIED",
    };
  }

  if (!input.emailService) {
    return {
      success: true,
      canCancel: true,
      notified: false,
      skippedReason: "NO_EMAIL_SERVICE",
    };
  }

  const cutoffValue = input.settings?.customerCancellationCutoffValue ?? 12;
  const cutoffUnit = input.settings?.customerCancellationCutoffUnit ?? "HOURS";
  const cutoffNotice =
    cutoffUnit === "DAYS"
      ? `${cutoffValue} ${cutoffValue === 1 ? "day" : "days"}`
      : `${cutoffValue} ${cutoffValue === 1 ? "hour" : "hours"}`;

  const sendResult = await input.emailService.sendCustomerCancellationRefundEligibleEmail({
    to: input.record.customerEmail,
    customerFirstName: input.record.customerFirstName || "Valued Guest",
    customerLastName: input.record.customerLastName,
    referenceCode: input.record.referenceCode,
    workspaceName: input.record.finalAssignment?.workspaceDisplayName,
    scheduledVisit:
      input.record.finalAssignment?.bookingStartAt && input.record.finalAssignment?.bookingEndAt
        ? `${input.record.finalAssignment.bookingStartAt} - ${input.record.finalAssignment.bookingEndAt}`
        : undefined,
    amountDue: input.record.amountDue ?? 0,
    cutoffNotice,
  });

  if (!sendResult.success) {
    return {
      success: true,
      canCancel: true,
      notified: false,
      error: sendResult.error || "Failed to dispatch refund eligibility email.",
    };
  }

  if (typeof input.onNotificationRecorded === "function") {
    try {
      await input.onNotificationRecorded(nowIso);
    } catch (err: unknown) {
      console.warn("[CustomerCancellation] Error in onNotificationRecorded hook:", err);
    }
  }

  return {
    success: true,
    canCancel: true,
    notified: true,
    cancellationRefundNotifiedAt: nowIso,
  };
}
