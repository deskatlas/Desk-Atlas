/**
 * Customer and Notification Outbox Models
 * Traceability: SPEC-1, SDD-C13, PRD-F22, ERD-E15, ERD-E21
 */

export interface Customer {
  id: string;
  customerCode: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  firstConfirmedReservationId: string;
  createdAt: string;
  updatedAt: string;
}

export type NotificationOutboxKind = "BOOKING_CONFIRMED" | "SAVE_CUSTOMER_ID" | "VOUCHER_EMAIL" | "PAID_CANDIDATE_EXHAUSTED";
export type NotificationOutboxStatus = "PENDING" | "PROCESSING" | "SENT" | "RETRY" | "FAILED";

export type RateLimitScope =
  | 'VERIFY_IP'
  | 'VERIFY_EMAIL'
  | 'CUSTOMER_TOKEN'
  | 'ASSISTANT_TOKEN'
  | 'PROMO_IP'
  | 'PROMO_EMAIL'
  | 'EMAIL_CUSTOMER'
  | 'EMAIL_VOUCHER';

export interface NotificationOutboxJob {
  id: string;
  dedupeKey: string;
  kind: NotificationOutboxKind;
  customerId?: string | null;
  reservationId?: string | null;
  voucherId?: string | null;
  recipientEmail: string;
  payload: Record<string, unknown>;
  dependsOnId?: string | null;
  status: NotificationOutboxStatus;
  attempts: number;
  nextAttemptAt: string;
  leaseUntil?: string | null;
  providerMessageId?: string | null;
  lastErrorCode?: string | null;
  createdAt: string;
  sentAt?: string | null;
}
