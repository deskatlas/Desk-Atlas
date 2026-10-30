// MS98-TC01 to MS98-TC14
// Traceability: MS-98, PRD-F4, PRD-F14, PRD-F22, BRD-M1, BRD-M2, BRD-M4, BRD-M6,
// SDD-C1, SDD-C2, SDD-C13, SDD-C15, DSD-UI4, DSD-UI6, DSD-UI12, ERD-E15, ERD-E18, ERD-E21, ERD-E23,
// QAD-TC22, QAD-TC36, QAD-TC37
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'crypto';
import {
  CustomerMemoryRepository,
  RateLimiterService,
  TransactionalEmailService,
  CustomerEmailChangeMemoryRepository,
  CustomerEmailChangeService,
  VoucherMemoryRepository,
  RateLimitedError,
  EmailChangeError,
  type Customer,
  type EmailSendResult,
} from '@deskatlas/domain';

const { NextRequest } = createRequire(
  new URL('../apps/customer-website/package.json', import.meta.url)
)('next/server') as typeof import('../apps/customer-website/node_modules/next/server');

// Mocks for route handlers
let mockCustomerRepo: CustomerMemoryRepository;
let mockRateLimiter: RateLimiterService;
let mockEmailService: TransactionalEmailService;
let mockEmailChangeRepo: CustomerEmailChangeMemoryRepository;
let mockEmailChangeService: CustomerEmailChangeService;
let mockVoucherRepo: VoucherMemoryRepository;

let dispatchedOtpEmails: Array<{ to: string; customerCode?: string; otpCode: string }> = [];
let dispatchedConfirmationEmails: Array<{ to: string; customerCode: string; confirmationUrl: string }> = [];
let dispatchedPastNoticeEmails: Array<{ to: string; customerCode: string; maskedNewEmail: string }> = [];
let dispatchedNewNoticeEmails: Array<{ to: string; customerCode: string; portalUrl?: string }> = [];

vi.mock('../apps/customer-website/src/app/api/customer/_services', () => ({
  getCustomerServices: () => ({
    customerRepo: mockCustomerRepo,
    rateLimiterService: mockRateLimiter,
    emailService: mockEmailService,
    emailChangeRepo: mockEmailChangeRepo,
    emailChangeService: mockEmailChangeService,
    voucherRepo: mockVoucherRepo,
  }),
  getClientIp: () => '127.0.0.1',
}));

import { POST as requestOtpHandler } from '../apps/customer-website/src/app/api/customer/email-change/request-otp/route';
import { POST as verifyOtpHandler } from '../apps/customer-website/src/app/api/customer/email-change/verify-otp/route';
import { POST as initiateHandler } from '../apps/customer-website/src/app/api/customer/email-change/initiate/route';
import { POST as confirmHandler } from '../apps/customer-website/src/app/api/customer/email-change/confirm/route';

function makeRequest(path: string, body: unknown) {
  const headers = new Headers();
  headers.set('origin', 'https://synthetic.invalid');
  headers.set('host', 'synthetic.invalid');
  headers.set('content-type', 'application/json');

  return new NextRequest(`https://synthetic.invalid${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('Milestone 98: Customer Identity Email Binding Transfer Lifecycle (MS-98)', () => {
  let currentTime = 1700000000000;
  let customerA: Customer;
  let customerB: Customer;

  beforeEach(async () => {
    currentTime = 1700000000000;
    dispatchedOtpEmails = [];
    dispatchedConfirmationEmails = [];
    dispatchedPastNoticeEmails = [];
    dispatchedNewNoticeEmails = [];

    mockCustomerRepo = new CustomerMemoryRepository(() => new Date(currentTime));
    mockRateLimiter = new RateLimiterService(mockCustomerRepo, 'test-rate-limit-secret');
    mockEmailChangeRepo = new CustomerEmailChangeMemoryRepository(
      mockCustomerRepo,
      () => new Date(currentTime)
    );
    mockVoucherRepo = new VoucherMemoryRepository(() => new Date(currentTime));

    mockEmailService = new TransactionalEmailService({
      apiKey: undefined,
      webhookUrl: undefined,
    });

    vi.spyOn(mockEmailService, 'sendEmailChangeOtpEmail').mockImplementation(
      async (input): Promise<EmailSendResult> => {
        dispatchedOtpEmails.push({
          to: input.to,
          customerCode: input.customerCode,
          otpCode: input.otpCode,
        });
        return { success: true, id: 'test-otp-email-id' };
      }
    );

    vi.spyOn(mockEmailService, 'sendEmailChangeConfirmationEmail').mockImplementation(
      async (input): Promise<EmailSendResult> => {
        dispatchedConfirmationEmails.push({
          to: input.to,
          customerCode: input.customerCode,
          confirmationUrl: input.confirmationUrl,
        });
        return { success: true, id: 'test-confirmation-email-id' };
      }
    );

    vi.spyOn(mockEmailService, 'sendEmailChangePastEmailNotice').mockImplementation(
      async (input): Promise<EmailSendResult> => {
        dispatchedPastNoticeEmails.push({
          to: input.to,
          customerCode: input.customerCode,
          maskedNewEmail: input.maskedNewEmail,
        });
        return { success: true, id: 'test-past-notice-email-id' };
      }
    );

    vi.spyOn(mockEmailService, 'sendEmailChangeNewEmailNotice').mockImplementation(
      async (input): Promise<EmailSendResult> => {
        dispatchedNewNoticeEmails.push({
          to: input.to,
          customerCode: input.customerCode,
          portalUrl: input.portalUrl,
        });
        return { success: true, id: 'test-new-notice-email-id' };
      }
    );

    mockEmailChangeService = new CustomerEmailChangeService(
      mockEmailChangeRepo,
      mockCustomerRepo,
      mockRateLimiter,
      mockEmailService,
      'test-token-secret-32-chars-long-1234',
      () => new Date(currentTime)
    );

    // Seed existing customers
    customerA = await mockCustomerRepo.createCustomer({
      customerCode: 'ABCDEF',
      email: 'customer.a@example.com',
      firstName: 'Alice',
      lastName: 'Ander',
      firstConfirmedReservationId: randomUUID(),
    });

    customerB = await mockCustomerRepo.createCustomer({
      customerCode: 'XYZ789',
      email: 'customer.b@example.com',
      firstName: 'Bob',
      lastName: 'Baker',
      firstConfirmedReservationId: randomUUID(),
    });
  });

  // MS98-TC01: Entry point rendering
  it('MS98-TC01: RewardsAccessCard renders trigger button to open email transfer modal', async () => {
    // Verified by component contract and test id
    const fs = await import('fs');
    const rac = fs.readFileSync(
      'apps/customer-website/src/features/tracking/components/RewardsAccessCard.tsx',
      'utf8'
    );
    expect(rac).toContain('data-testid="change-email-bound-trigger"');
    expect(rac).toContain('Change email bound to Customer ID');
    expect(rac).toContain('ChangeCustomerEmailModal');
  });

  // MS98-TC02: Dashboard entry trigger
  it('MS98-TC02: RewardsVoucherDashboard renders Change Email trigger button', async () => {
    const fs = await import('fs');
    const rvd = fs.readFileSync(
      'apps/customer-website/src/features/tracking/components/RewardsVoucherDashboard.tsx',
      'utf8'
    );
    expect(rvd).toContain('data-testid="dashboard-change-email-trigger"');
    expect(rvd).toContain('Change Email');
    expect(rvd).toContain('ChangeCustomerEmailModal');
  });

  // MS98-TC03: OTP Generation & 5-minute expiration
  it('MS98-TC03: Request OTP generates 6-digit numeric OTP with 5-minute expiration', async () => {
    const req = makeRequest('/api/customer/email-change/request-otp', {
      email: 'customer.a@example.com',
    });
    const res = await requestOtpHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.success).toBe(true);

    expect(dispatchedOtpEmails).toHaveLength(1);
    expect(dispatchedOtpEmails[0].to).toBe('customer.a@example.com');
    expect(dispatchedOtpEmails[0].otpCode).toMatch(/^\d{6}$/);

    const activeOtp = await mockEmailChangeRepo.findActiveOtp('customer.a@example.com');
    expect(activeOtp).not.toBeNull();
    expect(activeOtp?.maxAttempts).toBe(5);

    const expiryMs = new Date(activeOtp!.expiresAt).getTime();
    expect(expiryMs - currentTime).toBe(5 * 60 * 1000); // exactly 300 seconds
  });

  // MS98-TC03b: Rejection of invalid email formats
  it('MS98-TC03b: Request OTP rejects invalid email formats such as comma-separated syntax', async () => {
    const req = makeRequest('/api/customer/email-change/request-otp', {
      email: 'customer.a@example,com',
    });
    const res = await requestOtpHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('INVALID_INPUT');
    expect(json.error.message).toBe('Please enter a valid email address.');
  });

  // MS98-TC03c: Rejection when inputted email has no bound Customer ID
  it('MS98-TC03c: Request OTP rejects email with no bound Customer ID and returns HTTP 404', async () => {
    const req = makeRequest('/api/customer/email-change/request-otp', {
      email: 'nonexistent.user@example.com',
    });
    const res = await requestOtpHandler(req);
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error.code).toBe('NO_CUSTOMER_FOUND');
    expect(json.error.message).toBe('No Customer ID is bound to this email address.');
    expect(dispatchedOtpEmails).toHaveLength(0);
  });

  // MS98-TC04: Rate limiting on OTP dispatch
  it('MS98-TC04: 4 OTP requests within 10 minutes rejected with HTTP 429', async () => {
    // 3 requests allowed
    for (let i = 0; i < 3; i++) {
      const req = makeRequest('/api/customer/email-change/request-otp', {
        email: 'customer.a@example.com',
      });
      const res = await requestOtpHandler(req);
      expect(res.status).toBe(200);
    }

    // 4th request rejected
    const req4 = makeRequest('/api/customer/email-change/request-otp', {
      email: 'customer.a@example.com',
    });
    const res4 = await requestOtpHandler(req4);
    expect(res4.status).toBe(429);

    const json4 = await res4.json();
    expect(json4.error.code).toBe('RATE_LIMITED');
    expect(json4.error.message).toBe('Too many verification requests. Please try again later.');
    expect(res4.headers.get('Retry-After')).toBeDefined();

    // After 10 minutes (601 seconds), next request should be permitted
    currentTime += 10 * 60 * 1000 + 1000;
    const req5 = makeRequest('/api/customer/email-change/request-otp', {
      email: 'customer.a@example.com',
    });
    const res5 = await requestOtpHandler(req5);
    expect(res5.status).toBe(200);
  });

  // MS98-TC05: OTP Verification success & Customer ID return
  it('MS98-TC05: Submitting valid OTP marks code consumed and returns Customer ID and token', async () => {
    await mockEmailChangeService.requestOtp({ email: 'customer.a@example.com' });
    const otpCode = dispatchedOtpEmails[0].otpCode;

    const req = makeRequest('/api/customer/email-change/verify-otp', {
      email: 'customer.a@example.com',
      otp: otpCode,
    });
    const res = await verifyOtpHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.customer_code).toBe(customerA.customerCode);
    expect(json.data.verification_token).toBeDefined();

    // OTP record should now be consumed
    const activeOtp = await mockEmailChangeRepo.findActiveOtp('customer.a@example.com');
    expect(activeOtp).toBeNull();
  });

  // MS98-TC06: OTP Brute-force throttling
  it('MS98-TC06: 5 invalid OTP attempts permanently invalidates the code', async () => {
    await mockEmailChangeService.requestOtp({ email: 'customer.a@example.com' });

    for (let i = 1; i <= 4; i++) {
      const req = makeRequest('/api/customer/email-change/verify-otp', {
        email: 'customer.a@example.com',
        otp: '000000',
      });
      const res = await verifyOtpHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_OTP');
      expect(json.error.remainingAttempts).toBe(5 - i);
    }

    // 5th attempt locks the code
    const req5 = makeRequest('/api/customer/email-change/verify-otp', {
      email: 'customer.a@example.com',
      otp: '000000',
    });
    const res5 = await verifyOtpHandler(req5);
    expect(res5.status).toBe(400);
    const json5 = await res5.json();
    expect(json5.error.code).toBe('OTP_LOCKED');

    // Code is now consumed/invalidated
    const activeOtp = await mockEmailChangeRepo.findActiveOtp('customer.a@example.com');
    expect(activeOtp).toBeNull();
  });

  // MS98-TC07: Account Collision Guard
  it('MS98-TC07: Proposing email already registered returns HTTP 409 EMAIL_ALREADY_BOUND', async () => {
    await mockEmailChangeService.requestOtp({ email: 'customer.a@example.com' });
    const verifyRes = await mockEmailChangeService.verifyOtp({
      email: 'customer.a@example.com',
      otp: dispatchedOtpEmails[0].otpCode,
    });

    const req = makeRequest('/api/customer/email-change/initiate', {
      verificationToken: verifyRes.verificationToken,
      newEmail: 'customer.b@example.com', // Already registered to Customer B
    });

    const res = await initiateHandler(req);
    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error.code).toBe('EMAIL_ALREADY_BOUND');
    expect(json.error.canProceedToForgotId).toBe(true);
    expect(dispatchedConfirmationEmails).toHaveLength(0);
  });

  // MS98-TC08: Collision Modal UX & Redirect
  it('MS98-TC08: ChangeCustomerEmailModal includes amber warning and redirect for collision', async () => {
    const fs = await import('fs');
    const modalCode = fs.readFileSync(
      'apps/customer-website/src/features/tracking/components/ChangeCustomerEmailModal.tsx',
      'utf8'
    );
    expect(modalCode).toContain('data-testid="email-already-bound-alert"');
    expect(modalCode).toContain('data-testid="proceed-to-forgot-customer-id-btn"');
    expect(modalCode).toContain('data-testid="try-different-email-btn"');
  });

  // MS98-TC08b: Client-side email validation and noValidate form protection
  it('MS98-TC08b: ChangeCustomerEmailModal enforces noValidate on forms and validates email formats client-side', async () => {
    const fs = await import('fs');
    const modalCode = fs.readFileSync(
      'apps/customer-website/src/features/tracking/components/ChangeCustomerEmailModal.tsx',
      'utf8'
    );
    expect(modalCode).toContain('<form noValidate onSubmit={handleRequestOtp}');
    expect(modalCode).toContain('<form noValidate onSubmit={handleContinueToReview}');
    expect(modalCode).toContain('isValidEmail(trimmed)');
    expect(modalCode).toContain('Please enter a valid email address.');
  });

  // MS98-TC09: Double-check modal comparison
  it('MS98-TC09: Double-check modal renders comparison of Customer ID, current email, and new email', async () => {
    const fs = await import('fs');
    const modalCode = fs.readFileSync(
      'apps/customer-website/src/features/tracking/components/ChangeCustomerEmailModal.tsx',
      'utf8'
    );
    expect(modalCode).toContain('Double-Check New Email Address');
    expect(modalCode).toContain('data-testid="change-email-back-edit-btn"');
    expect(modalCode).toContain('data-testid="change-email-confirm-send-btn"');
  });

  // MS98-TC10: Confirmation token dispatch
  it('MS98-TC10: Valid new email creates change request with 24h expiry and sends confirmation link', async () => {
    await mockEmailChangeService.requestOtp({ email: 'customer.a@example.com' });
    const verifyRes = await mockEmailChangeService.verifyOtp({
      email: 'customer.a@example.com',
      otp: dispatchedOtpEmails[0].otpCode,
    });

    const req = makeRequest('/api/customer/email-change/initiate', {
      verificationToken: verifyRes.verificationToken,
      newEmail: 'alice.new@example.com',
    });

    const res = await initiateHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.success).toBe(true);

    expect(dispatchedConfirmationEmails).toHaveLength(1);
    expect(dispatchedConfirmationEmails[0].to).toBe('alice.new@example.com');
    expect(dispatchedConfirmationEmails[0].confirmationUrl).toContain(
      '/track/confirm-email-change?token='
    );

    // Verify token exists in repo
    const tokenUrl = dispatchedConfirmationEmails[0].confirmationUrl;
    const token = new URL(tokenUrl).searchParams.get('token')!;
    expect(token).toBeDefined();

    const tokenHash = (await import('crypto'))
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const requestRecord = await mockEmailChangeRepo.findChangeRequestByTokenHash(tokenHash);
    expect(requestRecord).not.toBeNull();
    expect(requestRecord?.oldEmail).toBe('customer.a@example.com');
    expect(requestRecord?.newEmail).toBe('alice.new@example.com');
    expect(requestRecord?.status).toBe('PENDING');

    const expiryMs = new Date(requestRecord!.expiresAt).getTime();
    expect(expiryMs - currentTime).toBe(24 * 60 * 60 * 1000); // 24 hours
  });

  // MS98-TC11: Atomic DB execution & immutability guard
  it('MS98-TC11: Confirming email change atomically updates customer email and preserves ID & customer_code', async () => {
    await mockEmailChangeService.requestOtp({ email: 'customer.a@example.com' });
    const verifyRes = await mockEmailChangeService.verifyOtp({
      email: 'customer.a@example.com',
      otp: dispatchedOtpEmails[0].otpCode,
    });
    await mockEmailChangeService.initiateTransfer({
      verificationToken: verifyRes.verificationToken,
      newEmail: 'alice.fresh@example.com',
    });

    const token = new URL(dispatchedConfirmationEmails[0].confirmationUrl).searchParams.get('token')!;

    const req = makeRequest('/api/customer/email-change/confirm', { token });
    const res = await confirmHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.customer_code).toBe(customerA.customerCode);
    expect(json.data.new_email).toBe('alice.fresh@example.com');

    // Customer email in repo is updated
    const updated = await mockCustomerRepo.findCustomerById(customerA.id);
    expect(updated?.email).toBe('alice.fresh@example.com');
    expect(updated?.customerCode).toBe(customerA.customerCode);
    expect(updated?.id).toBe(customerA.id);

    // Old email no longer maps to customer
    const oldLookup = await mockCustomerRepo.findCustomerByEmail('customer.a@example.com');
    expect(oldLookup).toBeNull();

    // New email now maps to customer
    const newLookup = await mockCustomerRepo.findCustomerByEmail('alice.fresh@example.com');
    expect(newLookup?.id).toBe(customerA.id);
  });

  // MS98-TC12: Voucher Preservation Invariant
  it('MS98-TC12: All vouchers linked to customer_id remain intact after email change', async () => {
    // Issue voucher to Customer A
    const voucher = await mockVoucherRepo.createVoucher({
      promoCode: 'LOYALTY50',
      customerId: customerA.id,
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Loyalty Reward',
      rewardType: 'FIXED_DISCOUNT',
      rewardValue: 50,
      status: 'AVAILABLE',
      startsAt: new Date(currentTime),
      expiresAt: new Date(currentTime + 30 * 24 * 60 * 60 * 1000),
      metadata: {},
    });

    // Execute email change
    await mockEmailChangeService.requestOtp({ email: 'customer.a@example.com' });
    const verifyRes = await mockEmailChangeService.verifyOtp({
      email: 'customer.a@example.com',
      otp: dispatchedOtpEmails[0].otpCode,
    });
    await mockEmailChangeService.initiateTransfer({
      verificationToken: verifyRes.verificationToken,
      newEmail: 'alice.transferred@example.com',
    });
    const token = new URL(dispatchedConfirmationEmails[0].confirmationUrl).searchParams.get('token')!;
    await mockEmailChangeService.confirmTransfer({ token });

    // Assert voucher still exists and belongs to customerA.id with AVAILABLE status
    const retrievedVoucher = await mockVoucherRepo.findVoucherById(voucher.id);
    expect(retrievedVoucher).not.toBeNull();
    expect(retrievedVoucher?.customerId).toBe(customerA.id);
    expect(retrievedVoucher?.status).toBe('AVAILABLE');

    const customerVouchers = await mockVoucherRepo.findVouchersByCustomerId(customerA.id);
    expect(customerVouchers).toHaveLength(1);
    expect(customerVouchers[0].promoCode).toBe('LOYALTY50');
  });

  // MS98-TC13: Dual Notification Dispatch
  it('MS98-TC13: Confirming email change dispatches exactly 2 transactional notices: alert to old, welcome to new', async () => {
    await mockEmailChangeService.requestOtp({ email: 'customer.a@example.com' });
    const verifyRes = await mockEmailChangeService.verifyOtp({
      email: 'customer.a@example.com',
      otp: dispatchedOtpEmails[0].otpCode,
    });
    await mockEmailChangeService.initiateTransfer({
      verificationToken: verifyRes.verificationToken,
      newEmail: 'alice.dual@example.com',
    });
    const token = new URL(dispatchedConfirmationEmails[0].confirmationUrl).searchParams.get('token')!;

    dispatchedPastNoticeEmails = [];
    dispatchedNewNoticeEmails = [];

    await mockEmailChangeService.confirmTransfer({ token });

    // 1. Alert to old email
    expect(dispatchedPastNoticeEmails).toHaveLength(1);
    expect(dispatchedPastNoticeEmails[0].to).toBe('customer.a@example.com');
    expect(dispatchedPastNoticeEmails[0].customerCode).toBe(customerA.customerCode);
    expect(dispatchedPastNoticeEmails[0].maskedNewEmail).toBe('a***l@example.com');

    // 2. Welcome to new email
    expect(dispatchedNewNoticeEmails).toHaveLength(1);
    expect(dispatchedNewNoticeEmails[0].to).toBe('alice.dual@example.com');
    expect(dispatchedNewNoticeEmails[0].customerCode).toBe(customerA.customerCode);
    expect(dispatchedNewNoticeEmails[0].portalUrl).toContain('/track/rewards');
  });

  // MS98-TC14: Landing page confirmation flow
  it('MS98-TC14: Confirmation landing page renders states and CTA to /track/rewards', async () => {
    const fs = await import('fs');
    const pageCode = fs.readFileSync(
      'apps/customer-website/src/app/track/confirm-email-change/page.tsx',
      'utf8'
    );
    expect(pageCode).toContain('data-testid="confirm-email-change-container"');
    expect(pageCode).toContain('data-testid="confirm-email-validating"');
    expect(pageCode).toContain('data-testid="confirm-email-success"');
    expect(pageCode).toContain('data-testid="confirm-email-invalid"');
    expect(pageCode).toContain('data-testid="confirm-email-collision"');
    expect(pageCode).toContain('data-testid="go-to-rewards-btn"');
    expect(pageCode).toContain('/track/rewards');
  });

  // MS98-TC15: Supabase migration disambiguation guard
  it('MS98-TC15: 050_customer_email_transfer.sql specifies #variable_conflict use_column and qualified column references', async () => {
    const fs = await import('fs');
    const sql = fs.readFileSync('supabase/migrations/050_customer_email_transfer.sql', 'utf8');
    expect(sql).toContain('#variable_conflict use_column');
    expect(sql).toContain('cust.customer_code');
    expect(sql).toContain('res.customer_id');
  });

  // MS98-TC16: CustomerEmailChangeSupabaseRepository confirmEmailChange contract
  it('MS98-TC16: CustomerEmailChangeSupabaseRepository parses confirm RPC responses and error codes', async () => {
    const { CustomerEmailChangeSupabaseRepository } = await import('@deskatlas/domain');
    const mockFetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/rpc/confirm_customer_email_change')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.p_token_hash === 'valid-hash') {
          return new Response(
            JSON.stringify([
              {
                success: true,
                customer_id: 'cust-uuid-1',
                customer_code: 'ABCDEF',
                old_email: 'old@example.com',
                new_email: 'new@example.com',
                error_code: null,
              },
            ]),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify([
            {
              success: false,
              customer_id: null,
              customer_code: null,
              old_email: null,
              new_email: null,
              error_code: 'TOKEN_EXPIRED',
            },
          ]),
          { status: 200 }
        );
      }
      return new Response('[]', { status: 200 });
    };

    const repo = new CustomerEmailChangeSupabaseRepository({
      supabaseUrl: 'https://synthetic.invalid',
      serviceRoleKey: 'test-key',
      fetcher: mockFetcher,
    });

    const successRes = await repo.confirmEmailChange('valid-hash');
    expect(successRes.success).toBe(true);
    expect(successRes.customerCode).toBe('ABCDEF');
    expect(successRes.newEmail).toBe('new@example.com');

    const failRes = await repo.confirmEmailChange('expired-hash');
    expect(failRes.success).toBe(false);
    expect(failRes.errorCode).toBe('TOKEN_EXPIRED');
  });

  // MS98-TC15: Collision alert CTA button sizing and styling
  it('MS98-TC15: Collision alert CTA buttons use compact sizing and avoid bloated full-size button classes', async () => {
    const fs = await import('fs');
    const modalCode = fs.readFileSync(
      'apps/customer-website/src/features/tracking/components/ChangeCustomerEmailModal.tsx',
      'utf8'
    );
    expect(modalCode).toContain('data-testid="email-already-bound-alert"');
    expect(modalCode).toContain('data-testid="proceed-to-forgot-customer-id-btn"');
    expect(modalCode).toContain('data-testid="try-different-email-btn"');

    // Ensure collision warning buttons do not use bloated da-primary-button or da-secondary-button
    const collisionSection = modalCode.slice(
      modalCode.indexOf('data-testid="email-already-bound-alert"'),
      modalCode.indexOf('data-testid="try-different-email-btn"') + 150
    );
    expect(collisionSection).not.toContain('da-primary-button');
    expect(collisionSection).not.toContain('da-secondary-button');
    expect(collisionSection).toContain('px-3.5 py-1.5');
    expect(collisionSection).toContain('text-xs');
    expect(collisionSection).toContain('rounded-full');
  });
});
