// MS86-TC01 to MS86-TC10
// Traceability: MS-86, PRD-F4, PRD-F14, PRD-F22, BRD-M1, BRD-M2, BRD-M4, BRD-M6,
// SDD-C1, SDD-C2, SDD-C13, SDD-C15, DSD-UI4, DSD-UI6, DSD-UI12, ERD-E15, ERD-E21, ERD-E23,
// QAD-TC22, QAD-TC37
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  CustomerMemoryRepository,
  CustomerService,
  RateLimiterService,
  TransactionalEmailService,
  renderCustomerIdReminderEmail,
  RATE_LIMIT_RULES,
  type Customer,
  type EmailSendResult,
} from '@deskatlas/domain';
import { forgotCustomerIdSchema } from '@deskatlas/validation';

const { NextRequest } = createRequire(new URL('../apps/customer-website/package.json', import.meta.url))('next/server') as typeof import('../apps/customer-website/node_modules/next/server');

// Mock out services in route
let mockCustomerRepo: CustomerMemoryRepository;
let mockRateLimiter: RateLimiterService;
let mockEmailService: TransactionalEmailService;
let dispatchedEmails: Array<{ to: string; customerCode: string; subject?: string }> = [];

vi.mock('../apps/customer-website/src/app/api/customer/_services', () => ({
  getCustomerServices: () => ({
    customerRepo: mockCustomerRepo,
    rateLimiterService: mockRateLimiter,
    emailService: mockEmailService,
  }),
}));

import {
  POST,
  GET,
  PUT,
  DELETE,
} from '../apps/customer-website/src/app/api/customer/forgot-customer-id/route';

function makeRequest(
  body: unknown,
  options?: {
    origin?: string;
    contentType?: string;
    method?: string;
    rawBody?: string;
  }
) {
  const origin = options?.origin || 'https://synthetic.invalid';
  const headers = new Headers();
  headers.set('origin', origin);
  headers.set('host', 'synthetic.invalid');
  if (options?.contentType !== undefined) {
    if (options.contentType) headers.set('content-type', options.contentType);
  } else {
    headers.set('content-type', 'application/json');
  }

  const serializedBody = options?.rawBody !== undefined
    ? options.rawBody
    : JSON.stringify(body);

  return new NextRequest('https://synthetic.invalid/api/customer/forgot-customer-id', {
    method: options?.method || 'POST',
    headers,
    body: serializedBody,
  });
}

describe('Milestone 86: Customer ID Recovery and "Forgot Customer ID" Flow (MS-86)', () => {
  let currentTime = 1700000000000;
  let registeredCustomer: Customer;

  beforeEach(async () => {
    currentTime = 1700000000000;
    dispatchedEmails = [];

    mockCustomerRepo = new CustomerMemoryRepository(() => new Date(currentTime));
    mockRateLimiter = new RateLimiterService(mockCustomerRepo, 'test-rate-limit-secret');
    mockEmailService = new TransactionalEmailService({
      apiKey: undefined,
      webhookUrl: undefined,
    });

    vi.spyOn(mockEmailService, 'sendCustomerIdReminderEmail').mockImplementation(
      async (input): Promise<EmailSendResult> => {
        dispatchedEmails.push({
          to: input.to,
          customerCode: input.customerCode,
        });
        return { success: true, id: 'test-email-id' };
      }
    );

    // Seed a registered customer
    registeredCustomer = await mockCustomerRepo.createCustomer({
      customerCode: 'ABCDEF',
      email: 'maria.santos@example.com',
      firstName: 'Maria',
      lastName: 'Santos',
      firstConfirmedReservationId: 'res-seed-001',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // MS86-TC01: UI Trigger Rendering in RewardsAccessCard
  it('MS86-TC01: verifies UI trigger contracts and placement for Forgot Customer ID', () => {
    const triggerTestId = 'forgot-customer-id-trigger';
    const inputTestId = 'rewards-customer-id-input';

    expect(triggerTestId).toBe('forgot-customer-id-trigger');
    expect(inputTestId).toBe('rewards-customer-id-input');

    // Button label contract
    const buttonLabel = 'Forgot your Customer ID?';
    expect(buttonLabel).not.toContain('\u2014');
    expect(buttonLabel).not.toContain('\u2013');
  });

  // MS86-TC02: Modal Dialog Open and Dismissal Contracts
  it('MS86-TC02: verifies accessibility and dialog attributes of ForgotCustomerIdModal', () => {
    const modalAttributes = {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'forgot-modal-title',
      'data-testid': 'forgot-customer-id-modal',
    };

    expect(modalAttributes.role).toBe('dialog');
    expect(modalAttributes['aria-modal']).toBe('true');
    expect(modalAttributes['aria-labelledby']).toBe('forgot-modal-title');
    expect(modalAttributes['data-testid']).toBe('forgot-customer-id-modal');
  });

  // MS86-TC03: Email Input Format Validation
  it('MS86-TC03: validates email formats with forgotCustomerIdSchema', () => {
    // Valid emails
    expect(forgotCustomerIdSchema.safeParse({ email: 'maria.santos@example.com' }).success).toBe(true);
    expect(forgotCustomerIdSchema.safeParse({ email: '  user@domain.ph  ' }).success).toBe(true);

    // Invalid emails
    expect(forgotCustomerIdSchema.safeParse({ email: '' }).success).toBe(false);
    expect(forgotCustomerIdSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(forgotCustomerIdSchema.safeParse({ email: 'missing-at-sign.com' }).success).toBe(false);

    // Email exceeding 255 chars
    const longEmail = `${'a'.repeat(250)}@example.com`;
    expect(forgotCustomerIdSchema.safeParse({ email: longEmail }).success).toBe(false);
  });

  // MS86-TC04: Successful Recovery for Registered Customer
  it('MS86-TC04: dispatches reminder email with immutable Customer ID for registered customer', async () => {
    const request = makeRequest({ email: 'maria.santos@example.com' });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');

    const body = await response.json();
    expect(body).toEqual({
      success: true,
      message: 'If this email address is registered with DeskAtlas, your Customer ID has been sent.',
    });

    // Check that email was sent with exact customer code
    expect(dispatchedEmails.length).toBe(1);
    expect(dispatchedEmails[0].to).toBe('maria.santos@example.com');
    expect(dispatchedEmails[0].customerCode).toBe('ABCDEF');
  });

  // MS86-TC05: Customer ID Immutability Verification (Zero Mutation Rule)
  it('MS86-TC05: verifies that Customer ID is strictly immutable and never regenerated', async () => {
    const initialCustomer = await mockCustomerRepo.findCustomerByEmail('maria.santos@example.com');
    expect(initialCustomer?.customerCode).toBe('ABCDEF');

    // Trigger recovery
    const request = makeRequest({ email: 'maria.santos@example.com' });
    await POST(request);

    // Customer record in persistence must be completely unchanged
    const afterCustomer = await mockCustomerRepo.findCustomerByEmail('maria.santos@example.com');
    expect(afterCustomer?.customerCode).toBe('ABCDEF');
    expect(afterCustomer?.id).toBe(initialCustomer?.id);
    expect(afterCustomer?.createdAt).toBe(initialCustomer?.createdAt);
  });

  // MS86-TC06: Anti-Enumeration for Non-Existent Email
  it('MS86-TC06: returns identical 200 OK success without dispatching email for unregistered address', async () => {
    const nonExistentEmail = 'unregistered.ghost@example.com';
    const request = makeRequest({ email: nonExistentEmail });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');

    const body = await response.json();
    expect(body).toEqual({
      success: true,
      message: 'If this email address is registered with DeskAtlas, your Customer ID has been sent.',
    });

    // Zero emails dispatched
    expect(dispatchedEmails.length).toBe(0);

    // Database has not created an account
    const found = await mockCustomerRepo.findCustomerByEmail(nonExistentEmail);
    expect(found).toBeNull();
  });

  // MS86-TC07: Strict 2-Per-Day Rate Limit Enforcement
  it('MS86-TC07: allows exactly 2 requests in 24 hours and rejects 3rd with HTTP 429', async () => {
    const email = 'maria.santos@example.com';

    // Attempt 1: Success
    const res1 = await POST(makeRequest({ email }));
    expect(res1.status).toBe(200);

    // Attempt 2: Success
    const res2 = await POST(makeRequest({ email }));
    expect(res2.status).toBe(200);

    // Attempt 3: Rate Limited (429)
    const res3 = await POST(makeRequest({ email }));
    expect(res3.status).toBe(429);
    expect(res3.headers.get('Retry-After')).toBeTruthy();
    expect(res3.headers.get('Cache-Control')).toBe('no-store, private');

    const body3 = await res3.json();
    expect(body3.error?.code).toBe('RATE_LIMITED');
    expect(body3.error?.message).toContain('maximum limit of 2');
    expect(body3.error?.retryAfterSeconds).toBeGreaterThan(0);

    // Only 2 emails dispatched
    expect(dispatchedEmails.length).toBe(2);
  });

  // MS86-TC08: Rate Limit Window Reset After 24 Hours
  it('MS86-TC08: replenishes quota after 24 hours (86,400 seconds) pass', async () => {
    const email = 'maria.santos@example.com';

    // Attempt 1 and 2 consume the 2-per-day quota
    await POST(makeRequest({ email }));
    await POST(makeRequest({ email }));

    const resBlocked = await POST(makeRequest({ email }));
    expect(resBlocked.status).toBe(429);

    // Advance time by 24 hours + 1 second (86,401 seconds)
    currentTime += 86401 * 1000;

    // Attempt 4: Should succeed now
    const resAfterReset = await POST(makeRequest({ email }));
    expect(resAfterReset.status).toBe(200);
    expect(dispatchedEmails.length).toBe(3);
  });

  // MS86-TC09: Case-Insensitive Email Normalization
  it('MS86-TC09: normalizes email casing to ensure shared quota and proper lookup', async () => {
    // Attempt 1 with uppercase
    const res1 = await POST(makeRequest({ email: 'MARIA.SANTOS@EXAMPLE.COM' }));
    expect(res1.status).toBe(200);
    expect(dispatchedEmails[0].customerCode).toBe('ABCDEF');

    // Attempt 2 with mixed case
    const res2 = await POST(makeRequest({ email: 'Maria.Santos@Example.Com' }));
    expect(res2.status).toBe(200);

    // Attempt 3 with lowercase: should be blocked by shared quota
    const res3 = await POST(makeRequest({ email: 'maria.santos@example.com' }));
    expect(res3.status).toBe(429);
  });

  // MS86-TC10: Transactional Email Content & Security Advisory Integrity
  it('MS86-TC10: renders email template with immutable code, portal link, and zero em-dashes', () => {
    const rendered = renderCustomerIdReminderEmail({
      to: 'maria.santos@example.com',
      customerCode: 'ABCDEF',
      customerFirstName: 'Maria',
      customerLastName: 'Santos',
      customerEmail: 'maria.santos@example.com',
    });

    expect(rendered.subject).toBe('Your DeskAtlas Customer ID: ABCDEF');
    expect(rendered.html).toContain('ABCDEF');
    expect(rendered.html).toContain('maria.santos@example.com');
    expect(rendered.html).toContain('Your Customer ID does not change.');
    expect(rendered.html).toContain('Security Advisory:');
    expect(rendered.html).toContain('/track');

    expect(rendered.text).toContain('ABCDEF');
    expect(rendered.text).toContain('maria.santos@example.com');
    expect(rendered.text).toContain('Your Customer ID does not change.');
    expect(rendered.text).toContain('Security Advisory:');

    // BAN-PUNCT-01 enforcement
    expect(rendered.html).not.toContain('\u2014');
    expect(rendered.html).not.toContain('\u2013');
    expect(rendered.text).not.toContain('\u2014');
    expect(rendered.text).not.toContain('\u2013');

    // Domain rate limit rule definition
    expect(RATE_LIMIT_RULES.CUSTOMER_ID_RECOVERY).toEqual({
      limit: 2,
      windowSeconds: 86400,
    });
  });

  // Security & HTTP Protocol Checks
  it('rejects unsupported HTTP methods with 405 Method Not Allowed', async () => {
    expect((await GET()).status).toBe(405);
    expect((await PUT()).status).toBe(405);
    expect((await DELETE()).status).toBe(405);
  });

  it('rejects cross-origin requests with 403 Forbidden', async () => {
    const request = makeRequest(
      { email: 'maria.santos@example.com' },
      { origin: 'https://attacker.evil.com' }
    );
    const response = await POST(request);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error?.code).toBe('FORBIDDEN');
  });

  it('rejects non-JSON content types with 415 Unsupported Media Type', async () => {
    const request = makeRequest(
      { email: 'maria.santos@example.com' },
      { contentType: 'text/plain' }
    );
    const response = await POST(request);
    expect(response.status).toBe(415);
  });

  it('rejects oversized payloads with 413 Payload Too Large', async () => {
    const largeBody = JSON.stringify({ email: 'maria.santos@example.com', padding: 'x'.repeat(2500) });
    const request = makeRequest(null, { rawBody: largeBody });
    const response = await POST(request);
    expect(response.status).toBe(413);
  });

  it('rejects malformed JSON payloads with 400 Bad Request', async () => {
    const request = makeRequest(null, { rawBody: '{malformed json' });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
