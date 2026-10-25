/**
 * Customer Identity and Notification Outbox Service
 * Traceability: SPEC-1, SDD-C13, PRD-F22, ERD-E15, ERD-E21, QAD-TC36
 */

import { randomBytes, createHash } from 'crypto';
import type { Customer, NotificationOutboxJob } from '../models/customer';
import type { Reservation } from '../models/reservation';
import type { CustomerRepository } from './customerRepository';
import type { TransactionalEmailService } from './transactionalEmailService';
import {
  normalizeEmail,
  normalizeCustomerCode,
  generateCustomerCode,
} from '@deskatlas/validation';

export interface ReservationIdentityInput {
  id: string;
  referenceCode: string;
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
  customerContactNumber?: string | null;
  amountDue?: number;
  currency?: string;
}

export interface OutboxProcessBatchResult {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
}

export interface DirectBookingEmailHandoffResult {
  bookingJobFound: boolean;
  bookingJobMarkedSent: boolean;
  customerIdJobFound: boolean;
  customerIdEmailSent: boolean;
  customerIdEmailError?: string;
}

// Retry delay schedule in milliseconds according to SPEC-1 Section 3.2:
// Attempts: 1 -> 1m, 2 -> 5m, 3 -> 15m, 4 -> 60m, 5 -> 360m (6h), 6 -> FAILED
const RETRY_DELAYS_MS = [
  1 * 60 * 1000,       // 1 minute
  5 * 60 * 1000,       // 5 minutes
  15 * 60 * 1000,      // 15 minutes
  60 * 60 * 1000,      // 60 minutes
  360 * 60 * 1000,     // 6 hours
];

export const MAX_RETRY_ATTEMPTS = 6;

export class CustomerService {
  private readonly repository: CustomerRepository;
  private readonly emailService?: TransactionalEmailService;
  private readonly nowProvider: () => Date;

  constructor(
    repository: CustomerRepository,
    emailService?: TransactionalEmailService,
    nowProvider?: () => Date
  ) {
    this.repository = repository;
    this.emailService = emailService;
    this.nowProvider = nowProvider || (() => new Date());
  }

  async resolveOrCreateCustomerIdentity(
    reservation: ReservationIdentityInput
  ): Promise<{ customer: Customer; isNew: boolean }> {
    const normalizedEmail = normalizeEmail(reservation.customerEmail);

    const existing = await this.repository.findCustomerByEmail(normalizedEmail);
    if (existing) {
      await this.repository.linkCustomerToReservation(reservation.id, existing.id);
      return { customer: existing, isNew: false };
    }

    // Generate code with collision retries up to 20 attempts
    let customer: Customer | null = null;
    let attempts = 0;

    while (attempts < 20) {
      attempts++;
      const candidateCode = generateCustomerCode();

      try {
        customer = await this.repository.createCustomer({
          customerCode: candidateCode,
          email: normalizedEmail,
          firstName: reservation.customerFirstName.trim(),
          lastName: reservation.customerLastName.trim(),
          phone: reservation.customerContactNumber || null,
          firstConfirmedReservationId: reservation.id,
        });
        break;
      } catch (err: any) {
        // Check if conflict was on email (race condition)
        const recheck = await this.repository.findCustomerByEmail(normalizedEmail);
        if (recheck) {
          await this.repository.linkCustomerToReservation(reservation.id, recheck.id);
          return { customer: recheck, isNew: false };
        }
        // If code collision, continue loop
        if (attempts >= 20) {
          throw new Error('Customer code generation exhausted after 20 attempts');
        }
      }
    }

    if (!customer) {
      throw new Error('Customer creation failed');
    }

    await this.repository.linkCustomerToReservation(reservation.id, customer.id);
    return { customer, isNew: true };
  }

  async handleReservationConfirmation(
    reservation: ReservationIdentityInput,
    bookingDetailsPayload?: Record<string, unknown>
  ): Promise<{
    customer: Customer;
    isNew: boolean;
    bookingJob: NotificationOutboxJob;
    idJob?: NotificationOutboxJob;
  }> {
    const { customer, isNew } = await this.resolveOrCreateCustomerIdentity(reservation);
    const normalizedEmail = customer.email;

    // 1. Enqueue normal Booking Confirmed outbox job
    const bookingJobDedupeKey = `booking-confirmed:${reservation.id}`;
    const bookingPayload = {
      reservationId: reservation.id,
      referenceCode: reservation.referenceCode,
      customerFirstName: reservation.customerFirstName,
      customerLastName: reservation.customerLastName,
      customerEmail: normalizedEmail,
      amountDue: reservation.amountDue,
      currency: reservation.currency,
      ...(bookingDetailsPayload || {}),
    };

    const bookingJob = await this.repository.enqueueOutboxJob({
      dedupeKey: bookingJobDedupeKey,
      kind: 'BOOKING_CONFIRMED',
      customerId: customer.id,
      reservationId: reservation.id,
      recipientEmail: normalizedEmail,
      payload: bookingPayload,
      dependsOnId: null,
    });

    let idJob: NotificationOutboxJob | undefined;

    // 2. Only if creating the identity, enqueue Save Your Customer ID job depending on the confirmation job
    if (isNew) {
      const idJobDedupeKey = `save-customer-id:${customer.id}`;
      const idPayload = {
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerEmail: normalizedEmail,
        customerFirstName: customer.firstName,
        customerLastName: customer.lastName,
      };

      idJob = await this.repository.enqueueOutboxJob({
        dedupeKey: idJobDedupeKey,
        kind: 'SAVE_CUSTOMER_ID',
        customerId: customer.id,
        reservationId: reservation.id,
        recipientEmail: normalizedEmail,
        payload: idPayload,
        dependsOnId: bookingJob.id,
      });
    }

    return { customer, isNew, bookingJob, idJob };
  }

  async processOutboxBatch(options?: {
    limit?: number;
    leaseSeconds?: number;
    requireSenderConfig?: boolean;
  }): Promise<OutboxProcessBatchResult> {
    const limit = options?.limit || 50;
    const leaseSeconds = options?.leaseSeconds || 60;
    const requireSenderConfig = options?.requireSenderConfig ?? true;

    const claimedJobs = await this.repository.claimDueOutboxJobs(limit, leaseSeconds);
    const result: OutboxProcessBatchResult = {
      claimed: claimedJobs.length,
      sent: 0,
      failed: 0,
      retried: 0,
    };

    const now = this.nowProvider();

    for (const job of claimedJobs) {
      try {
        if (!this.emailService) {
          throw new Error('TransactionalEmailService is not configured');
        }

        // Verify sender credentials if required (SPEC-1 Section 3.2: Missing production sender configuration is a failure, never a successfully skipped send)
        if (requireSenderConfig) {
          const hasApiKey = Boolean(process.env.RESEND_API_KEY || (this.emailService as any).apiKey);
          const hasWebhook = Boolean(process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL || (this.emailService as any).webhookUrl);
          if (!hasApiKey && !hasWebhook) {
            throw new Error('Missing production sender configuration (RESEND_API_KEY or TRANSACTIONAL_EMAIL_WEBHOOK_URL)');
          }
        }

        let sendResult: { success: boolean; id?: string; error?: string };

        if (job.kind === 'PAID_CANDIDATE_EXHAUSTED') {
          const { buildReservationTrackingUrl } = await import('./transactionalEmailService');
          const base = process.env.TRACKING_BASE_URL || process.env.DESKATLAS_PUBLIC_APP_URL;
          if (!base) throw new Error('Customer tracking URL is not configured');
          sendResult = await this.emailService.sendManualResolutionEmail({
            to: job.recipientEmail,
            idempotencyKey: job.dedupeKey,
            referenceCode: String(job.payload.referenceCode || ''),
            customerFirstName: String(job.payload.customerFirstName || ''),
            customerLastName: String(job.payload.customerLastName || ''),
            startAt: typeof job.payload.startAt === 'string' ? job.payload.startAt : undefined,
            endAt: typeof job.payload.endAt === 'string' ? job.payload.endAt : undefined,
            workspaceName: typeof job.payload.workspaceName === 'string' ? job.payload.workspaceName : undefined,
            trackingUrl: buildReservationTrackingUrl(base, String(job.payload.referenceCode || '')),
          });
        } else if (job.kind === 'BOOKING_CONFIRMED') {
          const recoveryBase = process.env.DESKATLAS_PUBLIC_APP_URL || process.env.TRACKING_BASE_URL;
          if (job.payload.paidRecovery && !recoveryBase) throw new Error('Customer booking URL is not configured');
          const { buildReservationTrackingUrl } = await import('./transactionalEmailService');
          sendResult = await this.emailService.sendBookingConfirmationEmail({
            to: job.recipientEmail,
            idempotencyKey: job.dedupeKey,
            referenceCode: (job.payload.referenceCode as string) || '',
            customerFirstName: (job.payload.customerFirstName as string) || '',
            customerLastName: (job.payload.customerLastName as string) || '',
            workspaceDisplayName: (job.payload.workspaceDisplayName as string) || 'Workspace Spot',
            workspaceTemplateName: (job.payload.workspaceTemplateName as string) || '',
            floorName: (job.payload.floorName as string) || 'Main Floor',
            bookingStartAt: (job.payload.bookingStartAt as string) || (job.payload.startAt as string) || '',
            bookingEndAt: (job.payload.bookingEndAt as string) || (job.payload.endAt as string) || '',
            bookingAccessUrl: job.payload.paidRecovery ? `${process.env.BOOKING_ACCESS_BASE_URL || recoveryBase!.replace(/\/$/, '') + '/api/booking'}/${encodeURIComponent(String(job.payload.bookingToken))}` : (job.payload.bookingAccessUrl as string) || '',
            trackingUrl: job.payload.paidRecovery ? buildReservationTrackingUrl(recoveryBase!, String(job.payload.referenceCode)) : (job.payload.trackingUrl as string) || '',
            termsUrl: (job.payload.termsUrl as string) || '',
          });
        } else if (job.kind === 'SAVE_CUSTOMER_ID') {
          sendResult = await this.emailService.sendSaveCustomerIdEmail({
            to: job.recipientEmail,
            customerCode: (job.payload.customerCode as string) || '',
            customerFirstName: (job.payload.customerFirstName as string) || '',
            customerLastName: (job.payload.customerLastName as string) || '',
            customerEmail: job.recipientEmail,
            rewardsPortalUrl: (job.payload.rewardsPortalUrl as string) || undefined,
          });
        } else {
          // Future kinds (e.g. VOUCHER_EMAIL)
          sendResult = { success: true, id: 'mock-dispatch' };
        }

        if (!sendResult.success) {
          throw new Error(sendResult.error || 'Email dispatch failed');
        }

        await this.repository.updateOutboxJobStatus(job.id, {
          status: 'SENT',
          sentAt: now.toISOString(),
          providerMessageId: sendResult.id || null,
          leaseUntil: null,
          lastErrorCode: null,
        });

        result.sent++;
      } catch (err: any) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const nextAttemptIndex = job.attempts - 1; // 0-based for delay lookup

        if (job.attempts >= MAX_RETRY_ATTEMPTS) {
          // Terminal failure: exhausted 6 attempts
          await this.repository.updateOutboxJobStatus(job.id, {
            status: 'FAILED',
            lastErrorCode: errorMessage,
            leaseUntil: null,
          });
          result.failed++;
        } else {
          // Schedule retry
          const delayMs = RETRY_DELAYS_MS[Math.min(nextAttemptIndex, RETRY_DELAYS_MS.length - 1)] || 360 * 60 * 1000;
          const nextAttemptAt = new Date(now.getTime() + delayMs).toISOString();

          await this.repository.updateOutboxJobStatus(job.id, {
            status: 'RETRY',
            nextAttemptAt,
            lastErrorCode: errorMessage,
            leaseUntil: null,
          });
          result.retried++;
        }
      }
    }

    return result;
  }

  async completeDirectBookingEmailHandoff(input: {
    reservationId: string;
    bookingProviderMessageId?: string | null;
  }): Promise<DirectBookingEmailHandoffResult> {
    const bookingJob = await this.repository.getOutboxJobByDedupeKey(
      `booking-confirmed:${input.reservationId}`
    );

    if (!bookingJob) {
      return {
        bookingJobFound: false,
        bookingJobMarkedSent: false,
        customerIdJobFound: false,
        customerIdEmailSent: false,
      };
    }

    const sentAt = this.nowProvider().toISOString();
    if (bookingJob.status !== 'SENT') {
      await this.repository.updateOutboxJobStatus(bookingJob.id, {
        status: 'SENT',
        sentAt,
        providerMessageId: input.bookingProviderMessageId || 'direct-booking-confirmation',
        leaseUntil: null,
        lastErrorCode: null,
      });
    }

    if (!bookingJob.customerId) {
      return {
        bookingJobFound: true,
        bookingJobMarkedSent: bookingJob.status !== 'SENT',
        customerIdJobFound: false,
        customerIdEmailSent: false,
      };
    }

    const customerJobs = await this.repository.getOutboxJobsByCustomerId(bookingJob.customerId);
    const customerIdJob = customerJobs.find(
      (job) => job.kind === 'SAVE_CUSTOMER_ID' && job.dependsOnId === bookingJob.id
    );

    if (!customerIdJob) {
      return {
        bookingJobFound: true,
        bookingJobMarkedSent: bookingJob.status !== 'SENT',
        customerIdJobFound: false,
        customerIdEmailSent: false,
      };
    }

    if (customerIdJob.status === 'SENT') {
      return {
        bookingJobFound: true,
        bookingJobMarkedSent: bookingJob.status !== 'SENT',
        customerIdJobFound: true,
        customerIdEmailSent: true,
      };
    }

    if (!this.emailService) {
      return {
        bookingJobFound: true,
        bookingJobMarkedSent: bookingJob.status !== 'SENT',
        customerIdJobFound: true,
        customerIdEmailSent: false,
        customerIdEmailError: 'TransactionalEmailService is not configured',
      };
    }

    const sendResult = await this.emailService.sendSaveCustomerIdEmail({
      to: customerIdJob.recipientEmail,
      customerCode: String(customerIdJob.payload.customerCode || ''),
      customerFirstName: String(customerIdJob.payload.customerFirstName || ''),
      customerLastName: String(customerIdJob.payload.customerLastName || ''),
      customerEmail: customerIdJob.recipientEmail,
      rewardsPortalUrl:
        typeof customerIdJob.payload.rewardsPortalUrl === 'string'
          ? customerIdJob.payload.rewardsPortalUrl
          : undefined,
    });

    if (!sendResult.success) {
      return {
        bookingJobFound: true,
        bookingJobMarkedSent: bookingJob.status !== 'SENT',
        customerIdJobFound: true,
        customerIdEmailSent: false,
        customerIdEmailError: sendResult.error || 'Customer ID email dispatch failed',
      };
    }

    await this.repository.updateOutboxJobStatus(customerIdJob.id, {
      status: 'SENT',
      sentAt,
      providerMessageId: sendResult.id || null,
      leaseUntil: null,
      lastErrorCode: null,
    });

    return {
      bookingJobFound: true,
      bookingJobMarkedSent: bookingJob.status !== 'SENT',
      customerIdJobFound: true,
      customerIdEmailSent: true,
    };
  }

  async requeueFailedJob(jobId: string, actorRole: string): Promise<NotificationOutboxJob> {
    if (actorRole !== 'ADMIN' && actorRole !== 'SUPERADMIN' && actorRole !== 'SUPER_ADMIN') {
      throw new Error('Only an authorized ADMIN may requeue failed notification jobs');
    }
    return this.repository.requeueOutboxJob(jobId);
  }

  async createAccessChallenge(
    customerCode: string,
    email: string,
    purpose: 'REWARDS_ACCESS' | 'REWARDS_AND_ASSISTANT_ACCESS' = 'REWARDS_ACCESS'
  ): Promise<{ accessToken: string; expiresAt: string; customer: Customer } | null> {
    if (!['REWARDS_ACCESS', 'REWARDS_AND_ASSISTANT_ACCESS'].includes(purpose)) return null;
    const normalizedCode = normalizeCustomerCode(customerCode);
    const normalizedEmail = normalizeEmail(email);

    const customer = await this.repository.findCustomerByCode(normalizedCode);
    if (!customer || customer.email !== normalizedEmail) {
      return null;
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = this.nowProvider();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    if (this.repository.createAccessChallenge) {
      await this.repository.createAccessChallenge({
        tokenHash,
        customerId: customer.id,
        purpose,
        createdAt: now.toISOString(),
        expiresAt,
      });
    }

    return {
      accessToken: token,
      expiresAt,
      customer,
    };
  }

  async verifyAccessToken(
    token: string,
    now: Date = this.nowProvider(),
    requiredPurpose: 'REWARDS_ACCESS' | 'REWARDS_AND_ASSISTANT_ACCESS' = 'REWARDS_ACCESS'
  ): Promise<Customer | null> {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = createHash('sha256').update(token).digest('hex');

    if (!this.repository.findAccessChallengeByHash) return null;
    const challenge = await this.repository.findAccessChallengeByHash(tokenHash);
    if (!challenge) return null;

    // MS76-TC09: combined challenges retain rewards compatibility only.
    if (requiredPurpose === 'REWARDS_AND_ASSISTANT_ACCESS') {
      if (challenge.purpose !== requiredPurpose) return null;
    } else if (requiredPurpose !== 'REWARDS_ACCESS' || !['REWARDS_ACCESS', 'REWARDS_AND_ASSISTANT_ACCESS'].includes(challenge.purpose)) return null;
    if (challenge.revokedAt) return null;
    if (!Number.isFinite(Date.parse(challenge.expiresAt)) || new Date(challenge.expiresAt) <= now) return null;

    return this.repository.findCustomerById(challenge.customerId);
  }

  async revokeAccessToken(token: string): Promise<void> {
    if (!token) return;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    if (this.repository.revokeAccessChallenge) {
      await this.repository.revokeAccessChallenge(tokenHash);
    }
  }
}

export function createCustomerService(
  repository: CustomerRepository,
  emailService?: TransactionalEmailService,
  nowProvider?: () => Date
): CustomerService {
  return new CustomerService(repository, emailService, nowProvider);
}
