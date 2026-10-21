/**
 * Customer and Notification Outbox Repository Interface
 * Traceability: SPEC-1, SDD-C13, PRD-F22, ERD-E15, ERD-E21
 */

import type { Customer, NotificationOutboxJob, NotificationOutboxKind, NotificationOutboxStatus } from '../models/customer';

export interface CreateCustomerData {
  customerCode: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  firstConfirmedReservationId: string;
}

export interface EnqueueOutboxJobData {
  dedupeKey: string;
  kind: NotificationOutboxKind;
  customerId?: string | null;
  reservationId?: string | null;
  voucherId?: string | null;
  recipientEmail: string;
  payload: Record<string, unknown>;
  dependsOnId?: string | null;
  status?: NotificationOutboxStatus;
  nextAttemptAt?: string;
}

export interface UpdateOutboxJobStatusData {
  status: NotificationOutboxStatus;
  attempts?: number;
  nextAttemptAt?: string;
  leaseUntil?: string | null;
  providerMessageId?: string | null;
  lastErrorCode?: string | null;
  sentAt?: string | null;
}

export interface AccessChallengeData {
  tokenHash: string;
  customerId: string;
  purpose: string;
  createdAt?: string;
  expiresAt: string;
  revokedAt?: string | null;
}

export interface CustomerRepository {
  consumeRateLimits?(entries: Array<{ scope: string; subjectHash: string; limit: number; windowSeconds: number }>): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
  findCustomerByEmail(email: string): Promise<Customer | null>;
  findCustomerByCode(customerCode: string): Promise<Customer | null>;
  findCustomerById(id: string): Promise<Customer | null>;
  findByEmail?(email: string): Promise<Customer | null>;
  findById?(id: string): Promise<Customer | null>;
  createCustomer(data: CreateCustomerData): Promise<Customer>;
  linkCustomerToReservation(reservationId: string, customerId: string): Promise<void>;
  enqueueOutboxJob(job: EnqueueOutboxJobData): Promise<NotificationOutboxJob>;
  getDueOutboxJobs(limit?: number): Promise<NotificationOutboxJob[]>;
  claimDueOutboxJobs(limit?: number, leaseDurationSeconds?: number): Promise<NotificationOutboxJob[]>;
  updateOutboxJobStatus(id: string, update: UpdateOutboxJobStatusData): Promise<NotificationOutboxJob>;
  requeueOutboxJob(id: string): Promise<NotificationOutboxJob>;
  getOutboxJobsByCustomerId(customerId: string): Promise<NotificationOutboxJob[]>;
  getOutboxJobById(id: string): Promise<NotificationOutboxJob | null>;
  getOutboxJobByDedupeKey(dedupeKey: string): Promise<NotificationOutboxJob | null>;
  createAccessChallenge?(data: AccessChallengeData): Promise<void>;
  findAccessChallengeByHash?(tokenHash: string): Promise<AccessChallengeData | null>;
  revokeAccessChallenge?(tokenHash: string): Promise<void>;
  countRateLimitEvents?(scope: string, subjectHash: string, windowSeconds: number): Promise<number>;
  getOldestRateLimitEventInWindow?(scope: string, subjectHash: string, windowSeconds: number): Promise<{ createdAt: string } | null>;
  recordRateLimitEvent?(scope: string, subjectHash: string, requestId?: string | null): Promise<void>;
}

