import {
  PaymentMethod,
  PaymentProofSubmissionResult,
  PaymentSessionRecord,
} from "../models/reservation";

export interface CreateWebPaymentSessionInput {
  paymentAttemptId?: string;
  tokenHash: string;
  expiresAt: string;
}

export interface ReservationPaymentRepository {
  getPaymentExpiryMinutes(): Promise<number>;
  getBusinessName?(): Promise<string>;
  listActiveWebPaymentMethods(): Promise<PaymentMethod[]>;
  listActiveKioskPaymentMethods(): Promise<PaymentMethod[]>;
  findPaymentSessionByTokenHash(tokenHash: string): Promise<PaymentSessionRecord | null>;
  expirePaymentSession(tokenHash: string, expiredAt: string): Promise<boolean>;
  submitPaymentProof(input: {
    tokenHash: string;
    paymentMethodId: string;
    proofStoragePath: string;
    proofSubmittedAt: string;
  }): Promise<PaymentProofSubmissionResult>;
}
