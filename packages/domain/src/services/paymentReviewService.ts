import {
  PaymentReviewDecisionResult,
  PaymentReviewDetail,
  PaymentReviewQueueItem,
  ReviewPaymentRequest,
} from "../models/reservation";
import { PaymentReviewRepository } from "./paymentReviewRepository";

export class PaymentReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentReviewError";
  }
}

export class PaymentReviewConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentReviewConflictError";
  }
}

export class PaymentReviewService {
  constructor(
    private readonly paymentReviewRepository: PaymentReviewRepository,
    private readonly nowProvider: () => Date = () => new Date()
  ) {}

  async listPaymentReviewQueue(): Promise<PaymentReviewQueueItem[]> {
    const queue = await this.paymentReviewRepository.listPaymentReviewQueue();
    return [...queue].sort((a, b) => {
      const aTime = a.proofSubmittedAt ? new Date(a.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.proofSubmittedAt ? new Date(b.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
    });
  }

  async listRejectedPayments(): Promise<PaymentReviewDetail[]> {
    if (typeof this.paymentReviewRepository.listRejectedPayments === "function") {
      const rejected = await this.paymentReviewRepository.listRejectedPayments();
      return [...rejected].sort((a, b) => {
        const aTime = a.processedAt ? new Date(a.processedAt).getTime() : 0;
        const bTime = b.processedAt ? new Date(b.processedAt).getTime() : 0;
        if (aTime !== bTime) {
          return bTime - aTime;
        }
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      });
    }
    return [];
  }

  async getPaymentReviewDetail(paymentAttemptId: string): Promise<PaymentReviewDetail> {
    if (!paymentAttemptId || paymentAttemptId.trim() === "") {
      throw new PaymentReviewError("Payment attempt ID is required.");
    }

    const detail = await this.paymentReviewRepository.getPaymentReviewDetail(paymentAttemptId);
    if (!detail) {
      throw new PaymentReviewError("Payment review item was not found.");
    }

    return detail;
  }

  async reviewPayment(request: ReviewPaymentRequest): Promise<PaymentReviewDecisionResult> {
    if (!request.paymentAttemptId || request.paymentAttemptId.trim() === "") {
      throw new PaymentReviewError("Payment attempt ID is required.");
    }

    if (!request.actor?.userId || request.actor.userId.trim() === "") {
      throw new PaymentReviewError("Actor user ID is required.");
    }

    if (request.actor.role !== "ADMIN") {
      throw new PaymentReviewConflictError("Only ADMIN may approve or reject online payment proof.");
    }

    const processedAt = this.nowProvider().toISOString();

    if (request.decision === "REJECT") {
      const rejectionReason = request.rejectionReason?.trim() ?? "";
      if (!rejectionReason) {
        throw new PaymentReviewError("Rejection reason is required.");
      }

      return this.paymentReviewRepository.rejectPaymentAttempt({
        paymentAttemptId: request.paymentAttemptId,
        actorUserId: request.actor.userId,
        processedAt,
        rejectionReason,
      });
    }

    if (request.decision !== "APPROVE" && request.decision !== "RECONSIDER_APPROVE") {
      throw new PaymentReviewError("Unsupported payment review decision.");
    }

    return this.paymentReviewRepository.approvePaymentAndAllocate({
      paymentAttemptId: request.paymentAttemptId,
      actorUserId: request.actor.userId,
      processedAt,
    });
  }
}

export function createPaymentReviewService(
  paymentReviewRepository: PaymentReviewRepository,
  nowProvider?: () => Date
) {
  return new PaymentReviewService(paymentReviewRepository, nowProvider);
}
