/**
 * In-Memory Customer and Notification Outbox Repository
 * Traceability: SPEC-1, SDD-C13, PRD-F22, ERD-E15, ERD-E21, QAD-TC36
 */

import { randomUUID } from 'crypto';
import type { Customer, NotificationOutboxJob, NotificationOutboxStatus } from '../models/customer';
import type {
  CustomerRepository,
  CreateCustomerData,
  EnqueueOutboxJobData,
  UpdateOutboxJobStatusData,
} from './customerRepository';
import { normalizeEmail, normalizeCustomerCode, isValidCustomerCode } from '@deskatlas/validation';

export class CustomerMemoryRepository implements CustomerRepository {
  private customers: Map<string, Customer> = new Map();
  private customersByEmail: Map<string, Customer> = new Map();
  private customersByCode: Map<string, Customer> = new Map();
  private outboxJobs: Map<string, NotificationOutboxJob> = new Map();
  private reservationCustomerLinks: Map<string, string> = new Map();
  private readonly nowProvider: () => Date;

  constructor(nowProvider?: () => Date) {
    this.nowProvider = nowProvider || (() => new Date());
  }

  async findCustomerByEmail(email: string): Promise<Customer | null> {
    const normalized = normalizeEmail(email);
    return this.customersByEmail.get(normalized) || null;
  }

  async findCustomerByCode(customerCode: string): Promise<Customer | null> {
    const normalized = normalizeCustomerCode(customerCode);
    return this.customersByCode.get(normalized) || null;
  }

  async findCustomerById(id: string): Promise<Customer | null> {
    return this.customers.get(id) || null;
  }

  async findById(id: string): Promise<Customer | null> {
    return this.findCustomerById(id);
  }

  async findByEmail(email: string): Promise<Customer | null> {
    return this.findCustomerByEmail(email);
  }

  async createCustomer(data: CreateCustomerData): Promise<Customer> {
    const normalizedEmail = normalizeEmail(data.email);
    const normalizedCode = normalizeCustomerCode(data.customerCode);

    if (!isValidCustomerCode(normalizedCode)) {
      throw new Error(`Invalid customer code: ${data.customerCode}`);
    }

    if (this.customersByEmail.has(normalizedEmail)) {
      throw new Error(`Customer with email ${normalizedEmail} already exists`);
    }

    if (this.customersByCode.has(normalizedCode)) {
      throw new Error(`Customer code collision: ${normalizedCode}`);
    }

    const nowIso = this.nowProvider().toISOString();
    const customer: Customer = {
      id: randomUUID(),
      customerCode: normalizedCode,
      email: normalizedEmail,
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      phone: data.phone ? data.phone.trim() : null,
      firstConfirmedReservationId: data.firstConfirmedReservationId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.customers.set(customer.id, customer);
    this.customersByEmail.set(normalizedEmail, customer);
    this.customersByCode.set(normalizedCode, customer);
    return { ...customer };
  }

  async linkCustomerToReservation(reservationId: string, customerId: string): Promise<void> {
    this.reservationCustomerLinks.set(reservationId, customerId);
  }

  async enqueueOutboxJob(data: EnqueueOutboxJobData): Promise<NotificationOutboxJob> {
    // Deduplication check
    for (const job of this.outboxJobs.values()) {
      if (job.dedupeKey === data.dedupeKey) {
        return { ...job };
      }
    }

    const nowIso = this.nowProvider().toISOString();
    const job: NotificationOutboxJob = {
      id: randomUUID(),
      dedupeKey: data.dedupeKey,
      kind: data.kind,
      customerId: data.customerId ?? null,
      reservationId: data.reservationId ?? null,
      voucherId: data.voucherId ?? null,
      recipientEmail: normalizeEmail(data.recipientEmail),
      payload: { ...data.payload },
      dependsOnId: data.dependsOnId ?? null,
      status: data.status || 'PENDING',
      attempts: 0,
      nextAttemptAt: data.nextAttemptAt || nowIso,
      leaseUntil: null,
      providerMessageId: null,
      lastErrorCode: null,
      createdAt: nowIso,
      sentAt: null,
    };

    this.outboxJobs.set(job.id, job);
    return { ...job };
  }

  async getDueOutboxJobs(limit: number = 50): Promise<NotificationOutboxJob[]> {
    const now = this.nowProvider();
    const results: NotificationOutboxJob[] = [];

    for (const job of this.outboxJobs.values()) {
      const isDue = (job.status === 'PENDING' || job.status === 'RETRY') && new Date(job.nextAttemptAt) <= now;
      const isLeaseExpired = job.status === 'PROCESSING' && job.leaseUntil && new Date(job.leaseUntil) <= now;

      if (!isDue && !isLeaseExpired) {
        continue;
      }

      // Check dependency
      if (job.dependsOnId) {
        const predecessor = this.outboxJobs.get(job.dependsOnId);
        if (!predecessor || predecessor.status !== 'SENT') {
          continue; // Blocked by unfinished predecessor
        }
      }

      results.push({ ...job });
      if (results.length >= limit) break;
    }

    return results;
  }

  async claimDueOutboxJobs(limit: number = 50, leaseDurationSeconds: number = 60): Promise<NotificationOutboxJob[]> {
    const now = this.nowProvider();
    const claimed: NotificationOutboxJob[] = [];

    for (const job of this.outboxJobs.values()) {
      const isDue = (job.status === 'PENDING' || job.status === 'RETRY') && new Date(job.nextAttemptAt) <= now;
      const isLeaseExpired = job.status === 'PROCESSING' && job.leaseUntil && new Date(job.leaseUntil) <= now;

      if (!isDue && !isLeaseExpired) {
        continue;
      }

      // Check dependency
      if (job.dependsOnId) {
        const predecessor = this.outboxJobs.get(job.dependsOnId);
        if (!predecessor || predecessor.status !== 'SENT') {
          continue; // Blocked until predecessor is SENT
        }
      }

      const leaseUntilDate = new Date(now.getTime() + leaseDurationSeconds * 1000);
      job.status = 'PROCESSING';
      job.leaseUntil = leaseUntilDate.toISOString();
      job.attempts += 1;

      claimed.push({ ...job });
      if (claimed.length >= limit) break;
    }

    return claimed;
  }

  async updateOutboxJobStatus(id: string, update: UpdateOutboxJobStatusData): Promise<NotificationOutboxJob> {
    const job = this.outboxJobs.get(id);
    if (!job) {
      throw new Error(`Outbox job not found: ${id}`);
    }

    job.status = update.status;
    if (update.attempts !== undefined) job.attempts = update.attempts;
    if (update.nextAttemptAt !== undefined) job.nextAttemptAt = update.nextAttemptAt;
    if (update.leaseUntil !== undefined) job.leaseUntil = update.leaseUntil;
    if (update.providerMessageId !== undefined) job.providerMessageId = update.providerMessageId;
    if (update.lastErrorCode !== undefined) job.lastErrorCode = update.lastErrorCode;
    if (update.sentAt !== undefined) job.sentAt = update.sentAt;

    return { ...job };
  }

  async requeueOutboxJob(id: string): Promise<NotificationOutboxJob> {
    const job = this.outboxJobs.get(id);
    if (!job) {
      throw new Error(`Outbox job not found: ${id}`);
    }
    if (job.status !== 'FAILED') {
      throw new Error(`Only FAILED outbox jobs can be requeued (current status: ${job.status})`);
    }

    job.status = 'PENDING';
    job.attempts = 0;
    job.nextAttemptAt = this.nowProvider().toISOString();
    job.leaseUntil = null;
    job.lastErrorCode = null;

    return { ...job };
  }

  async getOutboxJobsByCustomerId(customerId: string): Promise<NotificationOutboxJob[]> {
    return Array.from(this.outboxJobs.values())
      .filter((j) => j.customerId === customerId)
      .map((j) => ({ ...j }));
  }

  async getOutboxJobById(id: string): Promise<NotificationOutboxJob | null> {
    const job = this.outboxJobs.get(id);
    return job ? { ...job } : null;
  }

  async getOutboxJobByDedupeKey(dedupeKey: string): Promise<NotificationOutboxJob | null> {
    for (const job of this.outboxJobs.values()) {
      if (job.dedupeKey === dedupeKey) {
        return { ...job };
      }
    }
    return null;
  }

  private accessChallenges: Map<string, any> = new Map();
  private rateLimitEvents: Array<{
    id: string;
    scope: string;
    subjectHash: string;
    requestId?: string | null;
    createdAt: string;
  }> = [];

  async createAccessChallenge(data: any): Promise<void> {
    this.accessChallenges.set(data.tokenHash, {
      ...data,
      createdAt: data.createdAt || this.nowProvider().toISOString(),
    });
  }

  async findAccessChallengeByHash(tokenHash: string): Promise<any | null> {
    const challenge = this.accessChallenges.get(tokenHash);
    return challenge ? { ...challenge } : null;
  }

  async revokeAccessChallenge(tokenHash: string): Promise<void> {
    const challenge = this.accessChallenges.get(tokenHash);
    if (challenge) {
      challenge.revokedAt = this.nowProvider().toISOString();
    }
  }

  async countRateLimitEvents(scope: string, subjectHash: string, windowSeconds: number): Promise<number> {
    const windowStart = new Date(this.nowProvider().getTime() - windowSeconds * 1000);
    return this.rateLimitEvents.filter(
      (e) => e.scope === scope && e.subjectHash === subjectHash && new Date(e.createdAt) >= windowStart
    ).length;
  }

  async getOldestRateLimitEventInWindow(scope: string, subjectHash: string, windowSeconds: number): Promise<{ createdAt: string } | null> {
    const windowStart = new Date(this.nowProvider().getTime() - windowSeconds * 1000);
    const matching = this.rateLimitEvents
      .filter((e) => e.scope === scope && e.subjectHash === subjectHash && new Date(e.createdAt) >= windowStart)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return matching[0] || null;
  }

  async recordRateLimitEvent(scope: string, subjectHash: string, requestId?: string | null): Promise<void> {
    this.rateLimitEvents.push({
      id: randomUUID(),
      scope,
      subjectHash,
      requestId,
      createdAt: this.nowProvider().toISOString(),
    });
  }
}

