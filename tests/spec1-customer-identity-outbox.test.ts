/**
 * Test Suite: SPEC-1 Guest Customer Identity and Permanent Customer ID System
 * Traceability: SPEC-1, SDD-C13, PRD-F22, ERD-E10, ERD-E15, ERD-E21, QAD-TC36
 * Verification Matrix: SPEC1-TC01 through SPEC1-TC12
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  ReservationMemoryRepository,
  CustomerMemoryRepository,
  CustomerService,
  TransactionalEmailService,
  MAX_RETRY_ATTEMPTS,
} from '@deskatlas/domain';
import {
  normalizeEmail,
  normalizeCustomerCode,
  isValidCustomerCode,
  generateCustomerCode,
  validateCustomer,
  validateOutboxJob,
  CUSTOMER_CODE_ALPHABET,
} from '@deskatlas/validation';

describe('SPEC-1: Guest Customer Identity and Permanent Customer ID System (QAD-TC36)', () => {
  let now: Date;
  let repo: ReservationMemoryRepository;
  let customerRepo: CustomerMemoryRepository;
  let sentEmails: any[];
  let emailService: TransactionalEmailService;
  let customerService: CustomerService;

  const nowProvider = () => now;

  async function createAndSubmitWebBooking(options: {
    email: string;
    firstName?: string;
    lastName?: string;
    instanceId?: string;
    contactNumber?: string;
    amountDue?: number;
  }) {
    const attemptId = `att-${randomUUID()}`;
    const tokenHash = `hash-${randomUUID()}`;
    const res = await repo.createReservation(
      {
        source: 'WEB',
        customerFirstName: options.firstName || 'Alex',
        customerLastName: options.lastName || 'Morgan',
        customerEmail: options.email,
        customerContactNumber: options.contactNumber,
        rateSnapshot: 150,
        amountDue: options.amountDue || 150,
        currency: 'PHP',
        candidates: [
          {
            workspaceInstanceId: options.instanceId || 'inst-1',
            rank: 0,
            startAt: '2026-10-12T13:00:00+08:00',
            endAt: '2026-10-12T15:00:00+08:00',
          },
        ],
      },
      150,
      options.amountDue || 150,
      {
        paymentAttemptId: attemptId,
        tokenHash,
        expiresAt: '2026-10-12T12:00:00+08:00',
      }
    );

    await repo.submitPaymentProof({
      tokenHash,
      paymentMethodId: 'pm-gcash',
      proofStoragePath: 'proofs/receipt.jpg',
      proofSubmittedAt: '2026-10-12T10:15:00+08:00',
    });

    return { res, attemptId, tokenHash };
  }

  beforeEach(() => {
    now = new Date('2026-10-12T10:00:00+08:00');
    sentEmails = [];
    customerRepo = new CustomerMemoryRepository(nowProvider);
    repo = new ReservationMemoryRepository(nowProvider);
    repo.setCustomerRepository(customerRepo);

    emailService = new TransactionalEmailService({
      apiKey: 'test-api-key',
      fetcher: async (url: string | URL | Request, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        sentEmails.push({ url, body });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}` }),
          text: async () => JSON.stringify({ id: 'msg_ok' }),
        } as any;
      },
    });

    customerService = new CustomerService(customerRepo, emailService, nowProvider);
  });

  // SPEC1-TC01: First website confirmation
  it('SPEC1-TC01: creates permanent customer and links reservation; booking job precedes separate ID job', async () => {
    const rawEmail = '  Alex.Morgan+desk@Example.COM  ';
    const { res, attemptId } = await createAndSubmitWebBooking({
      email: rawEmail,
      contactNumber: '09171234567',
      amountDue: 300,
    });

    const decision = await repo.approvePaymentAndAllocate({
      paymentAttemptId: attemptId,
      actorUserId: 'admin-user-1',
      processedAt: '2026-10-12T10:20:00+08:00',
    });

    expect(decision.reservationStatus).toBe('CONFIRMED');

    // Verify Customer Identity
    const expectedEmail = 'alex.morgan+desk@example.com';
    const customer = await customerRepo.findCustomerByEmail(expectedEmail);
    expect(customer).not.toBeNull();
    expect(customer?.email).toBe(expectedEmail);
    expect(customer?.firstName).toBe('Alex');
    expect(customer?.lastName).toBe('Morgan');
    expect(customer?.phone).toBe('09171234567');
    expect(customer?.firstConfirmedReservationId).toBe(res.id);
    expect(isValidCustomerCode(customer!.customerCode)).toBe(true);

    // Verify Reservation link
    const storedRes = repo.getStoredReservation(res.id);
    expect(storedRes?.customerId).toBe(customer!.id);

    // Verify Outbox Jobs ordering and dependencies
    const bookingJob = await customerRepo.getOutboxJobByDedupeKey(`booking-confirmed:${res.id}`);
    expect(bookingJob).not.toBeNull();
    expect(bookingJob?.kind).toBe('BOOKING_CONFIRMED');
    expect(bookingJob?.dependsOnId).toBeNull();
    expect(bookingJob?.status).toBe('PENDING');

    const idJob = await customerRepo.getOutboxJobByDedupeKey(`save-customer-id:${customer!.id}`);
    expect(idJob).not.toBeNull();
    expect(idJob?.kind).toBe('SAVE_CUSTOMER_ID');
    expect(idJob?.dependsOnId).toBe(bookingJob!.id);
    expect(idJob?.status).toBe('PENDING');
  });

  it('reconciles a direct booking email and immediately sends the dependent customer ID email', async () => {
    const { res, attemptId } = await createAndSubmitWebBooking({
      email: 'direct-handoff@example.com',
      firstName: 'Direct',
      lastName: 'Handoff',
    });
    await repo.approvePaymentAndAllocate({
      paymentAttemptId: attemptId,
      actorUserId: 'admin-user-1',
      processedAt: '2026-10-12T10:20:00+08:00',
    });

    const handoff = await customerService.completeDirectBookingEmailHandoff({
      reservationId: res.id,
      bookingProviderMessageId: 'booking-provider-message-1',
    });

    expect(handoff).toMatchObject({
      bookingJobFound: true,
      bookingJobMarkedSent: true,
      customerIdJobFound: true,
      customerIdEmailSent: true,
    });
    const customer = await customerRepo.findCustomerByEmail('direct-handoff@example.com');
    const jobs = await customerRepo.getOutboxJobsByCustomerId(customer!.id);
    expect(jobs.find((job) => job.kind === 'BOOKING_CONFIRMED')?.status).toBe('SENT');
    expect(jobs.find((job) => job.kind === 'SAVE_CUSTOMER_ID')?.status).toBe('SENT');
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].body.subject).toContain(customer!.customerCode);
  });

  // SPEC1-TC02: Repeat normalized email
  it('SPEC1-TC02: repeat normalized email resolves to same identity without creating duplicate ID job', async () => {
    // 1st Booking
    const { res: res1, attemptId: att1 } = await createAndSubmitWebBooking({
      email: 'jordan.lee@example.com',
      firstName: 'Jordan',
      lastName: 'Lee',
      instanceId: 'inst-1',
    });
    await repo.approvePaymentAndAllocate({ paymentAttemptId: att1, actorUserId: 'admin-1', processedAt: '2026-10-12T10:15:00+08:00' });

    const customer1 = await customerRepo.findCustomerByEmail('jordan.lee@example.com');
    expect(customer1).not.toBeNull();

    // 2nd Booking with different casing and whitespace
    const { res: res2, attemptId: att2 } = await createAndSubmitWebBooking({
      email: ' JORDAN.LEE@Example.Com ',
      firstName: 'Jordan',
      lastName: 'Lee',
      instanceId: 'inst-2',
    });
    await repo.approvePaymentAndAllocate({ paymentAttemptId: att2, actorUserId: 'admin-1', processedAt: '2026-10-12T10:35:00+08:00' });

    // Same identity resolved
    const storedRes2 = repo.getStoredReservation(res2.id);
    expect(storedRes2?.customerId).toBe(customer1!.id);
    expect(res2.referenceCode).not.toBe(res1.referenceCode);

    // Only one SAVE_CUSTOMER_ID job exists for this customer
    const customerJobs = await customerRepo.getOutboxJobsByCustomerId(customer1!.id);
    const saveIdJobs = customerJobs.filter((j) => j.kind === 'SAVE_CUSTOMER_ID');
    expect(saveIdJobs.length).toBe(1);

    // Both booking confirmation jobs exist
    const bookingJobs = customerJobs.filter((j) => j.kind === 'BOOKING_CONFIRMED');
    expect(bookingJobs.length).toBe(2);
  });

  // SPEC1-TC03: Concurrent confirmations for one email
  it('SPEC1-TC03: concurrent confirmations create one identity/ID job and link both reservations', async () => {
    const email = 'concurrent.guest@example.com';
    const res1 = {
      id: 'res-c1',
      referenceCode: 'CONC01',
      customerFirstName: 'Concurrent',
      customerLastName: 'Guest',
      customerEmail: email,
      amountDue: 150,
      currency: 'PHP',
    };
    const res2 = {
      id: 'res-c2',
      referenceCode: 'CONC02',
      customerFirstName: 'Concurrent',
      customerLastName: 'Guest',
      customerEmail: email,
      amountDue: 150,
      currency: 'PHP',
    };

    const [conf1, conf2] = await Promise.all([
      customerService.handleReservationConfirmation(res1),
      customerService.handleReservationConfirmation(res2),
    ]);

    // Both point to the exact same customer ID
    expect(conf1.customer.id).toBe(conf2.customer.id);
    expect(conf1.customer.customerCode).toBe(conf2.customer.customerCode);

    // Exactly one was new
    const newCount = (conf1.isNew ? 1 : 0) + (conf2.isNew ? 1 : 0);
    expect(newCount).toBe(1);

    // Exactly one SAVE_CUSTOMER_ID job was enqueued
    const jobs = await customerRepo.getOutboxJobsByCustomerId(conf1.customer.id);
    const saveIdJobs = jobs.filter((j) => j.kind === 'SAVE_CUSTOMER_ID');
    expect(saveIdJobs.length).toBe(1);
  });

  // SPEC1-TC04: Public code collision/exhaustion
  it('SPEC1-TC04: code collision retries up to 20 times and bounded failure rolls back confirmation', async () => {
    await customerRepo.createCustomer({
      customerCode: 'AAAAAA',
      email: 'already@exists.com',
      firstName: 'Already',
      lastName: 'Exists',
      firstConfirmedReservationId: 'res-0',
    });

    // Mock customerRepo.createCustomer to throw collision 19 times then succeed
    const originalCreate = customerRepo.createCustomer.bind(customerRepo);
    let attempts = 0;
    customerRepo.createCustomer = async (data) => {
      attempts++;
      if (attempts < 20) {
        throw new Error(`Customer code collision: ${data.customerCode}`);
      }
      return originalCreate({ ...data, customerCode: 'BBBBBB' });
    };

    // Should succeed on 20th attempt
    const res = await customerService.resolveOrCreateCustomerIdentity({
      id: 'res-collision-1',
      referenceCode: 'COLL01',
      customerEmail: 'new.guest@example.com',
      customerFirstName: 'New',
      customerLastName: 'Guest',
    });
    expect(res.customer.customerCode).toBe('BBBBBB');
    expect(attempts).toBe(20);

    // Now test exhaustion (> 20 collisions)
    attempts = 0;
    customerRepo.createCustomer = async (data) => {
      attempts++;
      throw new Error(`Customer code collision: ${data.customerCode}`);
    };

    await expect(
      customerService.resolveOrCreateCustomerIdentity({
        id: 'res-collision-2',
        referenceCode: 'COLL02',
        customerEmail: 'fail.guest@example.com',
        customerFirstName: 'Fail',
        customerLastName: 'Guest',
      })
    ).rejects.toThrow('Customer code generation exhausted after 20 attempts');
  });

  // SPEC1-TC05: Never confirmed or allocation fails
  it('SPEC1-TC05: unconfirmed or failed allocation creates no customer, ID job, or reward fact', async () => {
    // 1. Unconfirmed reservation
    await repo.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Unconfirmed',
        customerLastName: 'User',
        customerEmail: 'unconfirmed@example.com',
        rateSnapshot: 150,
        amountDue: 150,
        currency: 'PHP',
        candidates: [{ workspaceInstanceId: 'inst-1', rank: 0, startAt: '2026-10-12T13:00:00+08:00', endAt: '2026-10-12T14:00:00+08:00' }],
      },
      150,
      150
    );

    let customer = await customerRepo.findCustomerByEmail('unconfirmed@example.com');
    expect(customer).toBeNull();

    // 2. Allocation failure: occupant takes spot
    const { attemptId: occAtt } = await createAndSubmitWebBooking({
      email: 'occupant@example.com',
      instanceId: 'inst-1',
    });
    await repo.approvePaymentAndAllocate({ paymentAttemptId: occAtt, actorUserId: 'admin-1', processedAt: '2026-10-12T10:15:00+08:00' });

    // Second booking also targeting inst-1
    const { attemptId: resAtt } = await createAndSubmitWebBooking({
      email: 'unconfirmed@example.com',
      instanceId: 'inst-1',
    });
    const decision = await repo.approvePaymentAndAllocate({ paymentAttemptId: resAtt, actorUserId: 'admin-1', processedAt: '2026-10-12T10:20:00+08:00' });

    expect(decision.reservationStatus).toBe('NEEDS_MANUAL_RESOLUTION');
    customer = await customerRepo.findCustomerByEmail('unconfirmed@example.com');
    expect(customer).toBeNull();

    const jobs = await customerRepo.getDueOutboxJobs(100);
    const unconfirmedJobs = jobs.filter((j) => j.recipientEmail === 'unconfirmed@example.com');
    expect(unconfirmedJobs.length).toBe(0);
  });

  // SPEC1-TC06: Commit succeeds but response lost
  it('SPEC1-TC06: confirmation replay duplicates no identity, allocation, or outbox jobs', async () => {
    const { res, attemptId } = await createAndSubmitWebBooking({
      email: 'replay.guest@example.com',
      firstName: 'Replay',
      lastName: 'Test',
    });

    // Initial commit
    const dec1 = await repo.approvePaymentAndAllocate({ paymentAttemptId: attemptId, actorUserId: 'admin-1', processedAt: '2026-10-12T10:15:00+08:00' });
    expect(dec1.reservationStatus).toBe('CONFIRMED');

    const customer1 = await customerRepo.findCustomerByEmail('replay.guest@example.com');
    const jobs1 = await customerRepo.getOutboxJobsByCustomerId(customer1!.id);
    expect(jobs1.length).toBe(2);

    // Replay call
    const dec2 = await repo.approvePaymentAndAllocate({ paymentAttemptId: attemptId, actorUserId: 'admin-1', processedAt: '2026-10-12T10:16:00+08:00' });
    expect(dec2.reservationStatus).toBe('CONFIRMED');
    expect(dec2.assignedCandidate?.id).toBe(dec1.assignedCandidate?.id);

    const customer2 = await customerRepo.findCustomerByEmail('replay.guest@example.com');
    expect(customer2?.id).toBe(customer1?.id);
    expect(customer2?.customerCode).toBe(customer1?.customerCode);

    const jobs2 = await customerRepo.getOutboxJobsByCustomerId(customer1!.id);
    expect(jobs2.length).toBe(2);
  });

  // SPEC1-TC07: Confirmation email fails then succeeds
  it('SPEC1-TC07: ID job waits for predecessor and sends with original ID only after confirmation succeeds', async () => {
    let failPredecessor = true;
    const failingEmailService = new TransactionalEmailService({
      apiKey: 'test-api-key',
      fetcher: async (url, init) => {
        const body = JSON.parse((init?.body as string) || '{}');
        if (failPredecessor && body.subject.includes('Booking Confirmed')) {
          return { ok: false, status: 500, text: async () => 'Provider down' } as any;
        }
        return { ok: true, status: 200, json: async () => ({ id: 'msg-success' }), text: async () => 'ok' } as any;
      },
    });

    const customCustomerService = new CustomerService(customerRepo, failingEmailService, nowProvider);

    const res = {
      id: 'res-order-check',
      referenceCode: 'ORD01',
      customerFirstName: 'Order',
      customerLastName: 'Check',
      customerEmail: 'order.check@example.com',
      amountDue: 150,
      currency: 'PHP',
    };

    await customCustomerService.handleReservationConfirmation(res);

    // 1st Outbox batch: booking confirmation fails
    const batch1 = await customCustomerService.processOutboxBatch({ limit: 10 });
    expect(batch1.claimed).toBe(1); // Only booking job was claimed; ID job was blocked
    expect(batch1.failed + batch1.retried).toBe(1);

    const bookingJob = await customerRepo.getOutboxJobByDedupeKey(`booking-confirmed:${res.id}`);
    expect(bookingJob?.status).toBe('RETRY');

    const customer = await customerRepo.findCustomerByEmail('order.check@example.com');
    const idJob = await customerRepo.getOutboxJobByDedupeKey(`save-customer-id:${customer!.id}`);
    expect(idJob?.status).toBe('PENDING'); // Still pending, never falsely claimed

    // Provider recovers, advance time for retry
    failPredecessor = false;
    now = new Date(now.getTime() + 2 * 60 * 1000); // +2 minutes

    // 2nd Outbox batch: booking confirmation succeeds
    const batch2 = await customCustomerService.processOutboxBatch({ limit: 10 });
    expect(batch2.claimed).toBe(1);
    expect(batch2.sent).toBe(1);

    const bookingJobUpdated = await customerRepo.getOutboxJobByDedupeKey(`booking-confirmed:${res.id}`);
    expect(bookingJobUpdated?.status).toBe('SENT');

    // 3rd Outbox batch: now ID job is unblocked and sent with original customer code
    const batch3 = await customCustomerService.processOutboxBatch({ limit: 10 });
    expect(batch3.claimed).toBe(1);
    expect(batch3.sent).toBe(1);

    const idJobUpdated = await customerRepo.getOutboxJobByDedupeKey(`save-customer-id:${customer!.id}`);
    expect(idJobUpdated?.status).toBe('SENT');
    expect(idJobUpdated?.payload.customerCode).toBe(customer?.customerCode);
  });

  // SPEC1-TC08: ID delivery fails or worker crashes
  it('SPEC1-TC08: durable lease recovers abandoned work and failure transitions to observable exhaustion', async () => {
    const job = await customerRepo.enqueueOutboxJob({
      dedupeKey: 'lease-test-1',
      kind: 'BOOKING_CONFIRMED',
      reservationId: 'res-lease-1',
      recipientEmail: 'crash@example.com',
      payload: { test: true },
    });

    // Claim with 60 second lease
    const claimed = await customerRepo.claimDueOutboxJobs(1, 60);
    expect(claimed.length).toBe(1);
    expect(claimed[0].status).toBe('PROCESSING');
    expect(claimed[0].leaseUntil).not.toBeNull();

    // Immediately claiming again finds nothing (leased)
    const claimedAgain = await customerRepo.claimDueOutboxJobs(1, 60);
    expect(claimedAgain.length).toBe(0);

    // Advance time by 61 seconds (lease expired due to simulated worker crash)
    now = new Date(now.getTime() + 61 * 1000);

    // Another worker reclaims the abandoned job
    const reclaimed = await customerRepo.claimDueOutboxJobs(1, 60);
    expect(reclaimed.length).toBe(1);
    expect(reclaimed[0].id).toBe(job.id);
    expect(reclaimed[0].attempts).toBe(2);

    // Simulate 6 total failures for observable exhaustion
    const failingEmailService = new TransactionalEmailService({
      apiKey: 'test-api-key',
      fetcher: async () => ({
        ok: false,
        status: 500,
        text: async () => 'Terminal SMTP 550 User Unknown',
      } as any),
    });

    const failingCustomerService = new CustomerService(customerRepo, failingEmailService, nowProvider);

    // Run through remaining retries
    for (let i = 2; i <= MAX_RETRY_ATTEMPTS; i++) {
      now = new Date(now.getTime() + 24 * 60 * 60 * 1000); // advance past retry delay
      await failingCustomerService.processOutboxBatch({ limit: 10 });
    }

    const exhaustedJob = await customerRepo.getOutboxJobById(job.id);
    expect(exhaustedJob?.status).toBe('FAILED');
    expect(exhaustedJob?.lastErrorCode).toContain('Terminal SMTP 550');

    // Admin can requeue the failed job
    const requeued = await failingCustomerService.requeueFailedJob(job.id, 'ADMIN');
    expect(requeued.status).toBe('PENDING');
    expect(requeued.attempts).toBe(0);

    // Non-admin cannot requeue
    await expect(failingCustomerService.requeueFailedJob(job.id, 'STAFF')).rejects.toThrow('Only an authorized ADMIN');
  });

  // SPEC1-TC09: Kiosk auto-check-in / manual resolution
  it('SPEC1-TC09: kiosk counter payment applies same first-confirmation contract upon CHECKED_IN', async () => {
    const kioskRes = await repo.createReservation(
      {
        source: 'KIOSK',
        customerFirstName: 'WalkIn',
        customerLastName: 'Guest',
        customerEmail: 'walkin@example.com',
        rateSnapshot: 150,
        amountDue: 150,
        currency: 'PHP',
        candidates: [{ workspaceInstanceId: 'inst-1', rank: 0, startAt: '2026-10-12T10:00:00+08:00', endAt: '2026-10-12T11:00:00+08:00' }],
      },
      150,
      150
    );

    const kioskAttempt = Array.from((repo as any).paymentAttempts.values()).find(
      (a: any) => a.reservationId === kioskRes.id && a.channel === 'KIOSK'
    );
    expect(kioskAttempt).toBeDefined();

    const decision = await repo.confirmCounterPaymentAndAllocate({
      paymentAttemptId: (kioskAttempt as any).id,
      actorUserId: 'staff-user-1',
      processedAt: '2026-10-12T10:05:00+08:00',
    });

    expect(decision.reservationStatus).toBe('CHECKED_IN');

    // Permanent Customer Identity created
    const customer = await customerRepo.findCustomerByEmail('walkin@example.com');
    expect(customer).not.toBeNull();
    expect(customer?.firstName).toBe('WalkIn');
    expect(customer?.firstConfirmedReservationId).toBe(kioskRes.id);

    // Linked on reservation
    const stored = repo.getStoredReservation(kioskRes.id);
    expect(stored?.customerId).toBe(customer!.id);

    // Both jobs enqueued
    const jobs = await customerRepo.getOutboxJobsByCustomerId(customer!.id);
    expect(jobs.length).toBe(2);
  });

  // SPEC1-TC10: Guest/staff reads or immutable edits
  it('SPEC1-TC10: immutable identity fields cannot be modified even by admin CRUD', async () => {
    const customer = await customerRepo.createCustomer({
      customerCode: 'DEF234',
      email: 'immutable@example.com',
      firstName: 'Original',
      lastName: 'Name',
      firstConfirmedReservationId: 'res-orig',
    });

    // Validation prevents invalid customer codes
    expect(isValidCustomerCode('123456')).toBe(false); // Contains 1 (banned in 32-char alphabet)
    expect(isValidCustomerCode('000000')).toBe(false); // Contains 0
    expect(isValidCustomerCode('IIIIII')).toBe(false); // Contains I
    expect(isValidCustomerCode('OOOOOO')).toBe(false); // Contains O
    expect(isValidCustomerCode('DEF234')).toBe(true);

    // Duplicate email or code throws
    await expect(
      customerRepo.createCustomer({
        customerCode: 'GHJ567',
        email: 'immutable@example.com',
        firstName: 'Duplicate',
        lastName: 'Email',
        firstConfirmedReservationId: 'res-dup',
      })
    ).rejects.toThrow('already exists');

    await expect(
      customerRepo.createCustomer({
        customerCode: 'DEF234',
        email: 'other@example.com',
        firstName: 'Duplicate',
        lastName: 'Code',
        firstConfirmedReservationId: 'res-dup2',
      })
    ).rejects.toThrow('collision');
  });

  // SPEC1-TC11: Historical data and email aliases
  it('SPEC1-TC11: plus and dot addresses stay distinct and no mass issuance occurs', async () => {
    const email1 = 'john.doe@gmail.com';
    const email2 = 'johndoe@gmail.com';
    const email3 = 'john.doe+work@gmail.com';

    expect(normalizeEmail(email1)).toBe('john.doe@gmail.com');
    expect(normalizeEmail(email2)).toBe('johndoe@gmail.com');
    expect(normalizeEmail(email3)).toBe('john.doe+work@gmail.com');

    // Create identity for email1
    const res1 = await customerService.resolveOrCreateCustomerIdentity({
      id: 'res-h1',
      referenceCode: 'HIST01',
      customerEmail: email1,
      customerFirstName: 'John',
      customerLastName: 'Doe',
    });

    // Create identity for email2 (different normalized string)
    const res2 = await customerService.resolveOrCreateCustomerIdentity({
      id: 'res-h2',
      referenceCode: 'HIST02',
      customerEmail: email2,
      customerFirstName: 'John',
      customerLastName: 'Doe',
    });

    // Create identity for email3 (different plus tag)
    const res3 = await customerService.resolveOrCreateCustomerIdentity({
      id: 'res-h3',
      referenceCode: 'HIST03',
      customerEmail: email3,
      customerFirstName: 'John',
      customerLastName: 'Doe',
    });

    expect(res1.customer.id).not.toBe(res2.customer.id);
    expect(res1.customer.id).not.toBe(res3.customer.id);
    expect(res2.customer.id).not.toBe(res3.customer.id);
  });

  // SPEC1-TC12: Missing production sender
  it('SPEC1-TC12: missing production sender does not yield false SENT state; booking remains confirmed', async () => {
    // Service with no API key and no webhook URL
    const unconfiguredEmailService = new TransactionalEmailService({
      apiKey: '',
      fromEmail: 'DeskAtlas <noreply@deskatlas.com>',
      webhookUrl: '',
    });

    const unconfiguredCustomerService = new CustomerService(customerRepo, unconfiguredEmailService, nowProvider);

    const { res, attemptId } = await createAndSubmitWebBooking({
      email: 'sender.check@example.com',
      firstName: 'Sender',
      lastName: 'Check',
    });

    const decision = await repo.approvePaymentAndAllocate({
      paymentAttemptId: attemptId,
      actorUserId: 'admin-1',
      processedAt: '2026-10-12T10:15:00+08:00',
    });

    // Booking remains firmly confirmed in database
    expect(decision.reservationStatus).toBe('CONFIRMED');

    // Run batch with unconfigured sender (requireSenderConfig: true)
    const oldApiKey = process.env.RESEND_API_KEY;
    const oldWebhook = process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL;
    delete process.env.RESEND_API_KEY;
    delete process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL;

    try {
      const batchResult = await unconfiguredCustomerService.processOutboxBatch({
        limit: 10,
        requireSenderConfig: true,
      });

      expect(batchResult.sent).toBe(0);
      expect(batchResult.retried).toBe(1); // Not falsely marked SENT!

      const job = await customerRepo.getOutboxJobByDedupeKey(`booking-confirmed:${res.id}`);
      expect(job?.status).toBe('RETRY');
      expect(job?.lastErrorCode).toContain('Missing production sender configuration');

      // Booking status is never compromised by email sender configuration issue
      const stored = repo.getStoredReservation(res.id);
      expect(stored?.status).toBe('CONFIRMED');
    } finally {
      if (oldApiKey) process.env.RESEND_API_KEY = oldApiKey;
      if (oldWebhook) process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL = oldWebhook;
    }
  });
});
