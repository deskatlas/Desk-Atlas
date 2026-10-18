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
