import {
  PaymentReviewDecisionResult,
  PaymentReviewDetail,
  PaymentReviewQueueItem,
} from "../models/reservation";

export interface PaymentReviewRepository {
  listPaymentReviewQueue(): Promise<PaymentReviewQueueItem[]>;
  listRejectedPayments?(): Promise<PaymentReviewDetail[]>;
  getPaymentReviewDetail(paymentAttemptId: string): Promise<PaymentReviewDetail | null>;
  approvePaymentAndAllocate(input: {
    paymentAttemptId: string;
    actorUserId: string;
    processedAt: string;
  }): Promise<PaymentReviewDecisionResult>;
  rejectPaymentAttempt(input: {
    paymentAttemptId: string;
    actorUserId: string;
    processedAt: string;
    rejectionReason: string;
  }): Promise<PaymentReviewDecisionResult>;
}
