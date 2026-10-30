import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
const { NextRequest } = createRequire(new URL('../apps/customer-website/package.json', import.meta.url))('next/server') as typeof import('../apps/customer-website/node_modules/next/server');
import {
  CANONICAL_PRODUCTION_CUSTOMER_URL,
  resolveCustomerAppOrigin,
  resolveCustomerRewardsPortalUrl,
  renderSaveCustomerIdEmail,
  renderCustomerIdReminderEmail,
  CustomerService,
  CustomerMemoryRepository,
  TransactionalEmailService,
  RateLimiterService,
  type Customer,
  type EmailSendResult,
} from '@deskatlas/domain';

let mockCustomerRepo: CustomerMemoryRepository;
let mockRateLimiter: RateLimiterService;
let mockEmailService: TransactionalEmailService;
let reminderDispatches: Array<{
  to: string;
  customerCode: string;
  rewardsPortalUrl?: string;
}> = [];

vi.mock('../apps/customer-website/src/app/api/customer/_services', () => ({
  getCustomerServices: () => ({
    customerRepo: mockCustomerRepo,
    rateLimiterService: mockRateLimiter,
    emailService: mockEmailService,
  }),
}));

import { POST as forgotCustomerIdHandler } from '../apps/customer-website/src/app/api/customer/forgot-customer-id/route';

describe('Milestone 93: Customer ID Email Call-to-Action Deployed Origin Resolution & Rewards Routing (MS-93)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    reminderDispatches = [];
    mockCustomerRepo = new CustomerMemoryRepository(() => new Date());
    mockRateLimiter = new RateLimiterService(mockCustomerRepo, 'test-rate-limit-secret');
    mockEmailService = new TransactionalEmailService({
      apiKey: undefined,
      webhookUrl: undefined,
    });

    vi.spyOn(mockEmailService, 'sendCustomerIdReminderEmail').mockImplementation(
      async (input): Promise<EmailSendResult> => {
        reminderDispatches.push({
          to: input.to,
          customerCode: input.customerCode,
          rewardsPortalUrl: input.rewardsPortalUrl,
        });
        return { success: true, id: 'test-reminder-msg-id' };
      }
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // MS93-TC01: Production Localhost Ban
  it('MS93-TC01: rejects localhost under NODE_ENV=production and falls back to canonical production URL in Save Customer ID email', () => {
    process.env.NODE_ENV = 'production';
    process.env.DESKATLAS_PUBLIC_APP_URL = 'http://localhost:3001';

    const rendered = renderSaveCustomerIdEmail({
      to: 'guest@example.com',
      customerCode: 'CUST-1001',
      customerFirstName: 'Maria',
      customerLastName: 'Santos',
      customerEmail: 'guest@example.com',
    });

    expect(rendered.html).toContain(`${CANONICAL_PRODUCTION_CUSTOMER_URL}/track/rewards`);
    expect(rendered.html).not.toContain('localhost');
    expect(rendered.html).not.toContain('127.0.0.1');
    expect(rendered.html).toContain('Log In to My Bookings & Rewards');

    expect(rendered.text).toContain(`${CANONICAL_PRODUCTION_CUSTOMER_URL}/track/rewards`);
    expect(rendered.text).not.toContain('localhost');
    expect(rendered.text).not.toContain('127.0.0.1');
    expect(rendered.text).toContain('Log In to My Bookings & Rewards:');

    // BAN-PUNCT-01 enforcement
    expect(rendered.html).not.toContain('\u2014');
    expect(rendered.text).not.toContain('\u2014');
  });

  // MS93-TC02: Production Reminder Localhost Ban
  it('MS93-TC02: rejects localhost under NODE_ENV=production and points CTA to canonical production rewards dashboard', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DESKATLAS_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_CUSTOMER_URL;

    const rendered = renderCustomerIdReminderEmail({
      to: 'guest@example.com',
      customerCode: 'CUST-1002',
      customerFirstName: 'Juan',
      customerLastName: 'Dela Cruz',
      customerEmail: 'guest@example.com',
    });

    expect(rendered.html).toContain(`${CANONICAL_PRODUCTION_CUSTOMER_URL}/track/rewards`);
    expect(rendered.html).not.toContain('localhost');
    expect(rendered.html).not.toContain('127.0.0.1');
    expect(rendered.html).toContain('Log In to My Bookings & Rewards');

    expect(rendered.text).toContain(`${CANONICAL_PRODUCTION_CUSTOMER_URL}/track/rewards`);
    expect(rendered.text).not.toContain('localhost');
    expect(rendered.text).not.toContain('127.0.0.1');
    expect(rendered.text).toContain('Log In to My Bookings & Rewards:');

    // BAN-PUNCT-01 enforcement
    expect(rendered.html).not.toContain('\u2014');
    expect(rendered.text).not.toContain('\u2014');
  });

  // MS93-TC03: Development Localhost Allowed
  it('MS93-TC03: permits localhost when NODE_ENV=development and routes to /track/rewards', () => {
    process.env.NODE_ENV = 'development';
    process.env.DESKATLAS_PUBLIC_APP_URL = 'http://localhost:3001';

    const origin = resolveCustomerAppOrigin();
    expect(origin).toBe('http://localhost:3001');

    const portalUrl = resolveCustomerRewardsPortalUrl();
    expect(portalUrl).toBe('http://localhost:3001/track/rewards');

    const rendered = renderSaveCustomerIdEmail({
      to: 'developer@example.com',
      customerCode: 'DEV-001',
      customerEmail: 'developer@example.com',
    });

    expect(rendered.html).toContain('http://localhost:3001/track/rewards');
    expect(rendered.text).toContain('http://localhost:3001/track/rewards');
  });

  // MS93-TC04: Custom Production Origin Forwarding
  it('MS93-TC04: preserves verified custom production origin and routes to /track/rewards', () => {
    process.env.NODE_ENV = 'production';
    process.env.DESKATLAS_PUBLIC_APP_URL = 'https://staging.thedeskatlas.com';

    const origin = resolveCustomerAppOrigin();
    expect(origin).toBe('https://staging.thedeskatlas.com');

    const portalUrl = resolveCustomerRewardsPortalUrl();
    expect(portalUrl).toBe('https://staging.thedeskatlas.com/track/rewards');

    const rendered = renderSaveCustomerIdEmail({
      to: 'qa@example.com',
      customerCode: 'QA-001',
      customerEmail: 'qa@example.com',
    });

    expect(rendered.html).toContain('https://staging.thedeskatlas.com/track/rewards');
    expect(rendered.text).toContain('https://staging.thedeskatlas.com/track/rewards');
  });

  // MS93-TC05: Vercel Deployed Origin Resolution
  it('MS93-TC05: resolves Vercel deployment production origin and routes to /track/rewards', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DESKATLAS_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_CUSTOMER_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'deskatlas.vercel.app';

    const origin = resolveCustomerAppOrigin();
    expect(origin).toBe('https://deskatlas.vercel.app');

    const portalUrl = resolveCustomerRewardsPortalUrl();
    expect(portalUrl).toBe('https://deskatlas.vercel.app/track/rewards');
  });

  // MS93-TC06: Outbox Payload Fidelity
  it('MS93-TC06: persists rewardsPortalUrl in outbox payload and provides it during batch dispatch', async () => {
    const customerRepo = new CustomerMemoryRepository();
    const sentInputs: Array<{ to: string; customerCode: string; rewardsPortalUrl?: string }> = [];

    const emailService = new TransactionalEmailService({
      apiKey: undefined,
      webhookUrl: undefined,
    });
    vi.spyOn(emailService, 'sendSaveCustomerIdEmail').mockImplementation(async (input) => {
      sentInputs.push({
        to: input.to,
        customerCode: input.customerCode,
        rewardsPortalUrl: input.rewardsPortalUrl,
      });
      return { success: true, id: 'outbox-msg-1' };
    });

    const customerService = new CustomerService(customerRepo, emailService);

    const targetUrl = 'https://staging.thedeskatlas.com/track/rewards';
    const confirmation = await customerService.createCustomerIdentityAndEnqueueOutbox(
      {
        id: 'res-outbox-test-1',
        referenceCode: 'DA-REF-9301',
        customerFirstName: 'Elena',
        customerLastName: 'Reyes',
        customerEmail: 'elena.reyes@example.com',
        amountDue: 250,
        currency: 'PHP',
      },
      undefined,
      { rewardsPortalUrl: targetUrl }
    );

    expect(confirmation.isNew).toBe(true);
    expect(confirmation.idJob).toBeDefined();
    expect(confirmation.idJob?.payload.rewardsPortalUrl).toBe(targetUrl);

    // Also mark the prerequisite booking job as sent so the dependent job can be claimed
    await customerRepo.updateOutboxJobStatus(confirmation.bookingJob.id, {
      status: 'SENT',
      sentAt: new Date().toISOString(),
    });

    const batchResult = await customerService.processPendingOutboxJobs({
      limit: 10,
      requireSenderConfig: false,
    });

    expect(batchResult.sent).toBeGreaterThanOrEqual(1);
    expect(sentInputs).toHaveLength(1);
    expect(sentInputs[0].rewardsPortalUrl).toBe(targetUrl);
  });

  // MS93-TC07: Direct Payment Approval Handoff
  it('MS93-TC07: forwards caller-designated rewardsPortalUrl during direct booking handoff', async () => {
    const customerRepo = new CustomerMemoryRepository();
    const sentInputs: Array<{ to: string; customerCode: string; rewardsPortalUrl?: string }> = [];

    const emailService = new TransactionalEmailService({
      apiKey: undefined,
      webhookUrl: undefined,
    });
    vi.spyOn(emailService, 'sendSaveCustomerIdEmail').mockImplementation(async (input) => {
      sentInputs.push({
        to: input.to,
        customerCode: input.customerCode,
        rewardsPortalUrl: input.rewardsPortalUrl,
      });
      return { success: true, id: 'handoff-msg-1' };
    });

    const customerService = new CustomerService(customerRepo, emailService);

    // Initial setup: booking created and outbox job generated
    await customerService.handleReservationConfirmation({
      id: 'res-handoff-test-2',
      referenceCode: 'DA-REF-9302',
      customerFirstName: 'Carlos',
      customerLastName: 'Tan',
      customerEmail: 'carlos.tan@example.com',
      amountDue: 450,
      currency: 'PHP',
    });

    const customPortalUrl = 'https://coworking.example.com/track/rewards';
    const handoffResult = await customerService.completeDirectBookingEmailHandoff({
      reservationId: 'res-handoff-test-2',
      bookingProviderMessageId: 'booking-msg-9302',
      rewardsPortalUrl: customPortalUrl,
    });

    expect(handoffResult.bookingJobFound).toBe(true);
    expect(handoffResult.customerIdJobFound).toBe(true);
    expect(handoffResult.customerIdEmailSent).toBe(true);
    expect(sentInputs).toHaveLength(1);
    expect(sentInputs[0].rewardsPortalUrl).toBe(customPortalUrl);
  });

  // MS93-TC08: Forgot Customer ID Route Pass-Through
  it('MS93-TC08: resolves incoming Host header and forwards /track/rewards destination to email service', async () => {
    await mockCustomerRepo.createCustomer({
      customerCode: 'CUST93',
      email: 'member@company.org',
      firstName: 'Angela',
      lastName: 'Valdez',
    });

    const request = new NextRequest('http://company.org/api/customer/forgot-customer-id', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'host': 'company.org',
        'origin': 'https://company.org',
      },
      body: JSON.stringify({ email: 'member@company.org' }),
    });

    const response = await forgotCustomerIdHandler(request);
    expect(response.status).toBe(200);

    expect(reminderDispatches).toHaveLength(1);
    expect(reminderDispatches[0].to).toBe('member@company.org');
    expect(reminderDispatches[0].customerCode).toBe('CUST93');
    expect(reminderDispatches[0].rewardsPortalUrl).toBe('https://company.org/track/rewards');
  });
});
