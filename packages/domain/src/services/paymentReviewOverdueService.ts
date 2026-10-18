// MS-67: Admin Payment Review Overdue Detection, Customer Refund Notification, and Segregated Triage Queue
// Traceability: PRD-F5, PRD-F6, SDD-C4, SDD-C5, SDD-C11, DSD-UI11, ERD-E10, ERD-E11, ERD-E13, QAD-TC48

import type {
  PaymentReviewQueueItem,
} from "../models/reservation";
import { getReservationBookingStartTime } from "./urgentPaymentAlertService";
import type {
  PaymentReviewOverdueRefundEmailInput,
  TransactionalEmailService,
} from "./transactionalEmailService";

/**
 * Evaluates whether a payment review queue item is overdue.
 * Qualifies strictly when status is UNDER_REVIEW and the candidate booking start time
 * has arrived or passed (bookingStartTime <= now).
 */
export function isPaymentReviewOverdue(
  item: PaymentReviewQueueItem,
  now: Date = new Date()
): boolean {
  if (item.refundStatus === "REFUNDED") {
    return false;
  }

  if (item.paymentStatus !== "UNDER_REVIEW") {
    return false;
  }

  const startTimeIso = getReservationBookingStartTime(item.submittedCandidates);
  if (!startTimeIso) {
    return false;
  }

  const startTimeMs = new Date(startTimeIso).getTime();
  if (isNaN(startTimeMs)) {
    return false;
  }

  return startTimeMs <= now.getTime();
}

/**
 * Calculates human-readable elapsed overdue duration for an overdue booking.
 */
export function formatOverdueElapsedDuration(
  startTimeIso: string,
  now: Date = new Date()
): string {
  const startTimeMs = new Date(startTimeIso).getTime();
  if (isNaN(startTimeMs)) {
    return "Overdue";
  }

  const elapsedMs = Math.max(0, now.getTime() - startTimeMs);
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  if (hours > 0 && mins === 0) {
    return `Overdue by ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  if (hours > 0) {
    return `Overdue by ${hours}h ${mins}m`;
  }

  return `Overdue by ${mins} minute${mins === 1 ? "" : "s"}`;
}

/**
 * Calculates approximate elapsed overdue hours (e.g. "Overdue by 2 hours").
 */
export function formatOverdueElapsedApproxHours(
  startTimeIso: string,
  now: Date = new Date()
): string {
  const startTimeMs = new Date(startTimeIso).getTime();
  if (isNaN(startTimeMs)) {
    return "Overdue";
  }

  const elapsedMs = Math.max(0, now.getTime() - startTimeMs);
  const hours = Math.floor(elapsedMs / 3600000);
  if (hours >= 1) {
    return `Overdue by ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const minutes = Math.floor(elapsedMs / 60000);
  return `Overdue by ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export interface SegregatedPaymentReviews<T extends PaymentReviewQueueItem> {
  activeQueue: (T & { isOverdue: false })[];
  overdueQueue: (T & { isOverdue: true })[];
  refundedQueue: T[];
}

/**
 * Partitions review queue items into active reviews (future start times),
 * overdue reviews (past/elapsed start times eligible for refund), and
 * refunded reviews (disbursed and recorded refunds).
 */
export function evaluateAndSegregatePaymentReviews<T extends PaymentReviewQueueItem>(
  items: T[],
  now: Date = new Date()
): SegregatedPaymentReviews<T> {
  const activeQueue: (T & { isOverdue: false })[] = [];
  const overdueQueue: (T & { isOverdue: true })[] = [];
  const refundedQueue: T[] = [];

  for (const item of items) {
    if (item.refundStatus === "REFUNDED") {
      refundedQueue.push(item);
    } else if (isPaymentReviewOverdue(item, now)) {
      overdueQueue.push({
        ...item,
        isOverdue: true,
      });
    } else {
      activeQueue.push({
        ...item,
        isOverdue: false,
      });
    }
  }

  return {
    activeQueue,
    overdueQueue,
    refundedQueue,
  };
}

export interface NotifyCustomerOverdueParams {
  item: PaymentReviewQueueItem;
  emailService: TransactionalEmailService;
  now?: Date;
  onNotificationRecorded?: (
    paymentAttemptId: string,
    notifiedAt: string
  ) => Promise<void> | void;
}

export interface OverdueNotificationResult {
  notified: boolean;
  skippedReason?: "NOT_OVERDUE" | "ALREADY_NOTIFIED";
  error?: string;
}

/**
 * Idempotently dispatches a customer refund eligibility notification for an overdue payment attempt.
 * Skips dispatch if already notified (overdueNotifiedAt is non-null).
 * Transitions item.refundStatus to REQUIRED upon successful dispatch.
 */
export async function notifyCustomerOfOverdueReviewIdempotent(
  params: NotifyCustomerOverdueParams
): Promise<OverdueNotificationResult> {
  const now = params.now || new Date();
  const { item, emailService } = params;

  if (!isPaymentReviewOverdue(item, now)) {
    return { notified: false, skippedReason: "NOT_OVERDUE" };
  }

  if (item.overdueNotifiedAt) {
    return { notified: false, skippedReason: "ALREADY_NOTIFIED" };
  }

  if (!item.customerEmail) {
    return { notified: false, error: "Customer email is missing." };
  }

  const bookingStartTime =
    getReservationBookingStartTime(item.submittedCandidates) || now.toISOString();

  const emailInput: PaymentReviewOverdueRefundEmailInput = {
    to: item.customerEmail,
    customerFirstName: item.customerFirstName,
    customerLastName: item.customerLastName,
    referenceCode: item.reservationReferenceCode,
    bookingStartTime,
    amountDue: item.amountDue,
  };

  const sendResult = await emailService.sendPaymentReviewOverdueRefundEmail(emailInput);

  if (!sendResult.success) {
    return {
      notified: false,
      error: sendResult.error || "Failed to dispatch overdue refund email.",
    };
  }

  const notifiedAt = now.toISOString();
  item.overdueNotifiedAt = notifiedAt;
  item.refundStatus = "REQUIRED";

  if (typeof params.onNotificationRecorded === "function") {
    try {
      await params.onNotificationRecorded(item.paymentAttemptId, notifiedAt);
    } catch (recordError: unknown) {
      const msg = recordError instanceof Error ? recordError.message : String(recordError);
      console.warn(
        `[MS-67] Warning: Notification recorded callback failed for ${item.paymentAttemptId}:`,
        msg
      );
    }
  }

  return { notified: true };
}
