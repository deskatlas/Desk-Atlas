// MS-66: PRD-F6, SDD-C5, DSD-UI11, ERD-E10, ERD-E13, QAD-TC47
// Multi-criterion sorting and immutable rank preservation for admin payment review queue.

import type {
  PaymentQueueSortMode,
  PaymentReviewQueueItem,
  RankedPaymentReviewQueueItem,
} from "../models/reservation";

/**
 * Assigns immutable canonical queue ranks (1..N) to payment review items strictly
 * in FIFO order by proofSubmittedAt ascending, tie-broken deterministically by paymentAttemptId.
 */
export function assignCanonicalQueueRanks<T extends PaymentReviewQueueItem>(
  items: T[]
): (T & { queueRank: number })[] {
  return [...items]
    .sort((a, b) => {
      const aTime = a.proofSubmittedAt
        ? new Date(a.proofSubmittedAt).getTime()
        : Number.POSITIVE_INFINITY;
      const bTime = b.proofSubmittedAt
        ? new Date(b.proofSubmittedAt).getTime()
        : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
    })
    .map((item, index) => ({
      ...item,
      queueRank: index + 1,
    }));
}

/**
 * Sorts ranked payment review queue items according to the selected sorting mode.
 * Preserves each item's immutable queueRank and uses deterministic tie-breaking.
 */
export function sortPaymentReviewQueue<T extends RankedPaymentReviewQueueItem>(
  items: T[],
  sortMode: PaymentQueueSortMode
): T[] {
  const queue = [...items];
  switch (sortMode) {
    case "RANK_DESC":
      // Highest queue priority (Rank #1) at the top down to Rank #N
      return queue.sort((a, b) => {
        const rankDiff = a.queueRank - b.queueRank;
        if (rankDiff !== 0) return rankDiff;
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      });

    case "RANK_ASC":
      // Lowest queue priority (Rank #N) at the top up to Rank #1
      return queue.sort((a, b) => {
        const rankDiff = b.queueRank - a.queueRank;
        if (rankDiff !== 0) return rankDiff;
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      });

    case "AMOUNT_DESC":
      // Highest monetary amount first; ties broken by queueRank asc, then paymentAttemptId asc
      return queue.sort((a, b) => {
        const diff = Number(b.amountDue) - Number(a.amountDue);
        if (diff !== 0) return diff;
        const rankDiff = a.queueRank - b.queueRank;
        if (rankDiff !== 0) return rankDiff;
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      });

    case "AMOUNT_ASC":
      // Lowest monetary amount first; ties broken by queueRank asc, then paymentAttemptId asc
      return queue.sort((a, b) => {
        const diff = Number(a.amountDue) - Number(b.amountDue);
        if (diff !== 0) return diff;
        const rankDiff = a.queueRank - b.queueRank;
        if (rankDiff !== 0) return rankDiff;
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      });

    default:
      return queue;
  }
}

// MS-72: PRD-F6, SDD-C5, DSD-UI11, ERD-E10, ERD-E13, QAD-TC53
// Multi-criterion sorting and chronological triage for rejected online payments.

export type RejectedQueueSortMode =
  | "REJECTED_DESC"
  | "REJECTED_ASC"
  | "AMOUNT_DESC"
  | "AMOUNT_ASC";

/**
 * Sorts rejected payment items according to the selected sorting mode.
 * Supports elapsed time (rejection timestamp) and monetary amount sorting with deterministic tie-breaking.
 */
export function sortRejectedPaymentsQueue<T extends {
  paymentAttemptId: string;
  amountDue: number | string;
  processedAt?: string | null;
  proofSubmittedAt?: string | null;
  createdAt?: string;
}>(
  items: T[],
  sortMode: RejectedQueueSortMode = "REJECTED_DESC"
): T[] {
  const shallowCopy = [...items];

  const getRejectionTime = (item: T): number => {
    const raw = item.processedAt || item.proofSubmittedAt || item.createdAt;
    if (!raw) return 0;
    const time = new Date(raw).getTime();
    return isNaN(time) ? 0 : time;
  };

  const getNumericAmount = (item: T): number => {
    const num = Number(item.amountDue);
    return isNaN(num) ? 0 : num;
  };

  return shallowCopy.sort((a, b) => {
    switch (sortMode) {
      case "REJECTED_DESC": {
        // Most recently rejected first (highest timestamp)
        const diff = getRejectionTime(b) - getRejectionTime(a);
        if (diff !== 0) return diff;
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      }

      case "REJECTED_ASC": {
        // Oldest rejection first (lowest timestamp)
        const diff = getRejectionTime(a) - getRejectionTime(b);
        if (diff !== 0) return diff;
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      }

      case "AMOUNT_DESC": {
        // Highest monetary amount first
        const diff = getNumericAmount(b) - getNumericAmount(a);
        if (diff !== 0) return diff;
        // Tie-breaker 1: most recently rejected first
        const timeDiff = getRejectionTime(b) - getRejectionTime(a);
        if (timeDiff !== 0) return timeDiff;
        // Tie-breaker 2: paymentAttemptId
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      }

      case "AMOUNT_ASC": {
        // Lowest monetary amount first
        const diff = getNumericAmount(a) - getNumericAmount(b);
        if (diff !== 0) return diff;
        // Tie-breaker 1: most recently rejected first
        const timeDiff = getRejectionTime(b) - getRejectionTime(a);
        if (timeDiff !== 0) return timeDiff;
        // Tie-breaker 2: paymentAttemptId
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      }

      default:
        return 0;
    }
  });
}

export type { RecentQueueSortMode } from "../models/reservation";

/**
 * Sorts overdue and refunded payment queue items according to the selected sorting mode.
 * Supports chronological recency (most recent descending / oldest first ascending) and
 * monetary amount sorting with deterministic tie-breaking.
 */
export function sortRecentPaymentsQueue<T extends {
  paymentAttemptId: string;
  amountDue: number | string;
  proofSubmittedAt?: string | null;
  refundedAt?: string | null;
  processedAt?: string | null;
  createdAt?: string;
}>(
  items: T[],
  sortMode: import("../models/reservation").RecentQueueSortMode = "RECENT_DESC",
  timeExtractor?: (item: T) => number
): T[] {
  const shallowCopy = [...items];

  const getDefaultTime = (item: T): number => {
    if (timeExtractor) return timeExtractor(item);
    const raw = item.refundedAt || item.proofSubmittedAt || item.processedAt || item.createdAt;
    if (!raw) return 0;
    const time = new Date(raw).getTime();
    return isNaN(time) ? 0 : time;
  };

  const getNumericAmount = (item: T): number => {
    const num = Number(item.amountDue);
    return isNaN(num) ? 0 : num;
  };

  return shallowCopy.sort((a, b) => {
    switch (sortMode) {
      case "RECENT_DESC": {
        // Most recent first (highest timestamp)
        const diff = getDefaultTime(b) - getDefaultTime(a);
        if (diff !== 0) return diff;
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      }

      case "RECENT_ASC": {
        // Oldest first (lowest timestamp)
        const diff = getDefaultTime(a) - getDefaultTime(b);
        if (diff !== 0) return diff;
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      }

      case "AMOUNT_DESC": {
        // Highest monetary amount first
        const diff = getNumericAmount(b) - getNumericAmount(a);
        if (diff !== 0) return diff;
        // Tie-breaker 1: most recent first
        const timeDiff = getDefaultTime(b) - getDefaultTime(a);
        if (timeDiff !== 0) return timeDiff;
        // Tie-breaker 2: paymentAttemptId
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      }

      case "AMOUNT_ASC": {
        // Lowest monetary amount first
        const diff = getNumericAmount(a) - getNumericAmount(b);
        if (diff !== 0) return diff;
        // Tie-breaker 1: most recent first
        const timeDiff = getDefaultTime(b) - getDefaultTime(a);
        if (timeDiff !== 0) return timeDiff;
        // Tie-breaker 2: paymentAttemptId
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      }

      default:
        return 0;
    }
  });
}

