import type {
  PaymentReviewQueueItem,
  ReservationCandidate,
} from "../models/reservation";

export type UrgentPaymentThresholdLevel = "60m" | "30m" | "10m";

export interface UrgentPaymentAlert {
  paymentAttemptId: string;
  reservationId: string;
  reservationReferenceCode: string;
  customerName: string;
  customerEmail: string;
  amountDue: number;
  currency: string;
  startAt: string;
  timeRemainingMinutes: number;
  thresholdLevel: UrgentPaymentThresholdLevel;
  thresholdLabel: string;
  reviewUrl: string;
}

/**
 * Resolves the primary booking start time for candidate evaluations.
 * Prioritizes assigned candidate, then main candidate (rank 0), then earliest startAt.
 */
export function getReservationBookingStartTime(
  candidates?: ReservationCandidate[] | null
): string | null {
  if (!candidates || candidates.length === 0) return null;

  const assigned = candidates.find((c) => c.isAssigned);
  if (assigned?.startAt) return assigned.startAt;

  const main = candidates.find((c) => c.rank === 0);
  if (main?.startAt) return main.startAt;

  const valid = candidates.filter((c) => Boolean(c.startAt));
  if (valid.length === 0) return null;

  const sorted = [...valid].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );
  return sorted[0].startAt;
}

/**
 * Evaluates minutes remaining until booking start time against urgent thresholds:
 * - 10m: <= 10 minutes (down to -15m)
 * - 30m: <= 30 minutes and > 10 minutes
 * - 60m: <= 60 minutes and > 30 minutes
 */
export function getUrgentThresholdLevel(
  diffMinutes: number
): UrgentPaymentThresholdLevel | null {
  if (diffMinutes <= 10 && diffMinutes >= -15) {
    return "10m";
  }
  if (diffMinutes <= 30 && diffMinutes > 10) {
    return "30m";
  }
  if (diffMinutes <= 60 && diffMinutes > 30) {
    return "60m";
  }
  return null;
}

/**
 * Formats a human-readable label for the urgent threshold level.
 */
export function formatUrgentThresholdLabel(
  level: UrgentPaymentThresholdLevel
): string {
  switch (level) {
    case "10m":
      return "Starts in 10 minutes";
    case "30m":
      return "Starts in 30 minutes";
    case "60m":
      return "Starts in 1 hour";
    default:
      return "Starts soon";
  }
}

/**
 * Evaluates an individual payment review queue item against the given time.
 * Returns an UrgentPaymentAlert if the item is pending review and falls within an urgent threshold.
 */
export function evaluateUrgentPaymentThreshold(
  item: PaymentReviewQueueItem,
  now: Date = new Date()
): UrgentPaymentAlert | null {
  if (!item || item.paymentStatus !== "UNDER_REVIEW") {
    return null;
  }

  const startAt = getReservationBookingStartTime(item.submittedCandidates);
  if (!startAt) {
    return null;
  }

  const startTimeMs = new Date(startAt).getTime();
  if (Number.isNaN(startTimeMs)) {
    return null;
  }

  const diffMs = startTimeMs - now.getTime();
  const diffMinutes = diffMs / (60 * 1000);

  const thresholdLevel = getUrgentThresholdLevel(diffMinutes);
  if (!thresholdLevel) {
    return null;
  }

  const customerName = `${item.customerFirstName || ""} ${item.customerLastName || ""}`.trim() || "Guest Customer";

  return {
    paymentAttemptId: item.paymentAttemptId,
    reservationId: item.reservationId,
    reservationReferenceCode: item.reservationReferenceCode,
    customerName,
    customerEmail: item.customerEmail || "",
    amountDue: item.amountDue,
    currency: item.currency || "PHP",
    startAt,
    timeRemainingMinutes: Math.round(diffMinutes * 10) / 10,
    thresholdLevel,
    thresholdLabel: formatUrgentThresholdLabel(thresholdLevel),
    reviewUrl: `/manage/payments/review/${item.paymentAttemptId}`,
  };
}

/**
 * Evaluates all pending items in the review queue and returns urgent alerts sorted
 * with the most urgent (least time remaining) first.
 */
export function evaluateUrgentPendingPayments(
  queue: PaymentReviewQueueItem[],
  now: Date = new Date()
): UrgentPaymentAlert[] {
  if (!Array.isArray(queue)) return [];

  const alerts: UrgentPaymentAlert[] = [];
  for (const item of queue) {
    const alert = evaluateUrgentPaymentThreshold(item, now);
    if (alert) {
      alerts.push(alert);
    }
  }

  return alerts.sort((a, b) => a.timeRemainingMinutes - b.timeRemainingMinutes);
}

/**
 * Generates the dismissal key for an urgent alert at a specific threshold.
 */
export function makeUrgentAlertDismissKey(
  paymentAttemptId: string,
  threshold: UrgentPaymentThresholdLevel
): string {
  return `${paymentAttemptId}:${threshold}`;
}

/**
 * Checks whether an alert has been dismissed for its current threshold.
 */
export function isUrgentAlertDismissed(
  dismissedKeys: string[] | Set<string>,
  paymentAttemptId: string,
  threshold: UrgentPaymentThresholdLevel
): boolean {
  const key = makeUrgentAlertDismissKey(paymentAttemptId, threshold);
  if (dismissedKeys instanceof Set) {
    return dismissedKeys.has(key);
  }
  return dismissedKeys.includes(key);
}
