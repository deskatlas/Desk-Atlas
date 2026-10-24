import { z } from 'zod';

// PRD-F6/F9 / QAD-TC35: live SQL aggregate response contract.
const count = z.number().int().nonnegative();
export const adminBadgeCountsSchema = z.object({
  reservationsCount: count, paymentsCount: count, kioskCount: count,
  awaitingProof: count, paymentReviews: count, counterQueue: count,
  awaitingReviewCount: count, overdueCount: count,
}).strict();
