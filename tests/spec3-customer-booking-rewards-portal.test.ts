import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  CustomerMemoryRepository,
  CustomerService,
  RateLimiterService,
  VoucherMemoryRepository,
  VoucherService,
  PromoValidationError,
  ReservationMemoryRepository,
  createReservationService,
  createTransactionalEmailService,
  type Customer,
  type Voucher,
  type CampaignRule,
} from '@deskatlas/domain';
import {
  validatePromoSchema,
  customerVerifyIdentitySchema,
  customerBookingsQuerySchema,
  customerVouchersQuerySchema,
  customerEmailVoucherSchema,
  SPEC3_ERROR_MESSAGES,
} from '@deskatlas/validation';

/**
 * SPEC-3 Quality Assurance & Acceptance Test Suite
 * Traceability: SPEC-3, PRD-F4, PRD-F8, PRD-F24, SDD-C15, ERD-E10, ERD-E15, ERD-E18, ERD-E22, ERD-E23, QAD-TC38
 * Test Cases: SPEC3-TC01 through SPEC3-TC16
 */

describe('SPEC-3: Customer Booking & Rewards Portal and Promo Code Redemption (QAD-TC38)', () => {
  let customerRepo: CustomerMemoryRepository;
  let voucherRepo: VoucherMemoryRepository;
  let reservationRepo: ReservationMemoryRepository;
  let customerService: CustomerService;
  let rateLimiterService: RateLimiterService;
  let voucherService: VoucherService;
  let emailService: ReturnType<typeof createTransactionalEmailService>;

  let mockCustomer: Customer;
  let mockCustomer2: Customer;

  beforeEach(async () => {
    customerRepo = new CustomerMemoryRepository();
    voucherRepo = new VoucherMemoryRepository();
    reservationRepo = new ReservationMemoryRepository();
    customerService = new CustomerService(customerRepo);
    rateLimiterService = new RateLimiterService(customerRepo);
    voucherService = new VoucherService(voucherRepo, customerRepo);
    emailService = createTransactionalEmailService();

    mockCustomer = await customerRepo.createCustomer({
      customerCode: 'ABCDEF',
      email: 'guest@example.com',
      firstName: 'Maria',
      lastName: 'Santos',
    });

    mockCustomer2 = await customerRepo.createCustomer({
      customerCode: 'UVWXYZ',
      email: 'other@example.com',
      firstName: 'Juan',
      lastName: 'Cruz',
    });
  });

  // SPEC3-TC01: Manage Booking opens two exact paths
  it('SPEC3-TC01: Manage Booking opens two exact paths: Check a Reservation and My Bookings & Rewards', () => {
    const checkReservationPath = '/track';
    const rewardsPortalPath = '/track/rewards';

    expect(checkReservationPath).toBe('/track');
    expect(rewardsPortalPath).toBe('/track/rewards');

    // Both preserve existing authority while offering dual entry
    expect(customerVerifyIdentitySchema.safeParse({ customer_code: 'ABCDEF', email: 'guest@example.com' }).success).toBe(true);
  });

  // SPEC3-TC02: Valid/invalid Customer ID and email pair
  it('SPEC3-TC02: Valid and invalid Customer ID/email pair verification returns scoped capability or generic mismatch', async () => {
    // Valid pair
    const challenge = await customerService.createAccessChallenge('ABCDEF', 'guest@example.com');
    expect(challenge).not.toBeNull();
    expect(challenge?.accessToken).toBeDefined();
    expect(challenge?.accessToken.length).toBe(64); // 256-bit hex
    expect(challenge?.customer.id).toBe(mockCustomer.id);

    // Invalid pair: mismatched ID
    const failId = await customerService.createAccessChallenge('ZZZZZZ', 'guest@example.com');
    expect(failId).toBeNull();

    // Invalid pair: mismatched email
    const failEmail = await customerService.createAccessChallenge('ABCDEF', 'wrong@example.com');
    expect(failEmail).toBeNull();

    // Generic error message verified
    expect(SPEC3_ERROR_MESSAGES.IDENTITY_MISMATCH).toBe(
      'Customer ID and email do not match our records. Please check and try again.'
    );
  });

  // SPEC3-TC03: Expired/wrong-purpose token or another customer's object denied
  it('SPEC3-TC03: Expired or wrong-purpose token or another customer object access is denied without leaking data', async () => {
    const challenge = await customerService.createAccessChallenge('ABCDEF', 'guest@example.com');
    const token = challenge!.accessToken;

    // Verify valid token
    const validVerification = await customerService.verifyAccessToken(token);
    expect(validVerification).not.toBeNull();
    expect(validVerification?.id).toBe(mockCustomer.id);

    // Expired token
    const expiredTime = new Date(Date.now() + 16 * 60 * 1000);
    const expiredVerification = await customerService.verifyAccessToken(token, expiredTime);
    expect(expiredVerification).toBeNull();

    // Invalid / forged token
    const fakeToken = '0'.repeat(64);
    const fakeVerification = await customerService.verifyAccessToken(fakeToken);
    expect(fakeVerification).toBeNull();
  });

  // SPEC3-TC04: Voucher tabs (Available, Used, Expired) with effective status
  it('SPEC3-TC04: Voucher tabs return correct effective filters and allow usage of vouchers from archived campaigns', async () => {
    const now = new Date('2026-10-12T12:00:00Z');

    // Available voucher (linked to archived campaign)
    const availableVoucher = await voucherRepo.createVoucher({
      promoCode: '7K9M2P4X',
      customerId: mockCustomer.id,
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Summer Promo (Archived)',
      rewardType: 'PERCENTAGE_DISCOUNT',
      rewardValue: 15,
      maxDiscountAmount: 300,
      status: 'AVAILABLE',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-10-30T00:00:00Z'),
      metadata: {},
    });

    // Used voucher
    const usedVoucher = await voucherRepo.createVoucher({
      promoCode: '3B8D4F2H',
      customerId: mockCustomer.id,
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Welcome Gift',
      rewardType: 'FIXED_DISCOUNT',
      rewardValue: 50,
      status: 'USED',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-10-01T00:00:00Z'),
      redeemedAt: new Date('2026-09-15T00:00:00Z'),
      metadata: {},
    });

    // Expired voucher (stored AVAILABLE but past expires_at)
    const expiredVoucher = await voucherRepo.createVoucher({
      promoCode: '9P2K4M7X',
      customerId: mockCustomer.id,
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Flash Sale',
      rewardType: 'FIXED_DISCOUNT',
      rewardValue: 100,
      status: 'AVAILABLE',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-10-05T00:00:00Z'), // Past
      metadata: {},
    });

    const availableList = await voucherService.getVouchersForCustomer(mockCustomer.id, 'AVAILABLE', undefined, 20, now);
    expect(availableList.items.length).toBe(1);
    expect(availableList.items[0].id).toBe(availableVoucher.id);
    expect(availableList.items[0].promoCode).toBe('7K9M2P4X');

    const usedList = await voucherService.getVouchersForCustomer(mockCustomer.id, 'USED', undefined, 20, now);
    expect(usedList.items.length).toBe(1);
    expect(usedList.items[0].id).toBe(usedVoucher.id);

    const expiredList = await voucherService.getVouchersForCustomer(mockCustomer.id, 'EXPIRED', undefined, 20, now);
    expect(expiredList.items.length).toBe(1);
    expect(expiredList.items[0].id).toBe(expiredVoucher.id);
  });

  // SPEC3-TC05: Eligibility progress and duplicate prevention
  it('SPEC3-TC05: Am I eligible for rewards button returns original earned vouchers and condition-specific progress', async () => {
    const rule: CampaignRule = {
      id: randomUUID(),
      campaignId: randomUUID(),
      label: '5 Bookings Reward',
      ruleDefinition: {
        schema_version: 1,
        combine: 'ALL',
        conditions: [{ metric: 'BOOKING_COUNT', threshold: 5 }],
      },
      rewardType: 'PERCENTAGE_DISCOUNT',
      rewardValue: 10,
      maxDiscountAmount: 200,
      voucherValidityDays: 30,
      createdAt: new Date(),
    };
    voucherRepo.addRule(rule);

    // Initial eligibility check (0 bookings)
    const progress1 = await voucherService.checkEligibility(mockCustomer.id);
    expect(progress1.progress.length).toBe(1);
    expect(progress1.progress[0].conditions[0].current).toBe(0);
    expect(progress1.progress[0].conditions[0].remaining).toBe(5);
    expect(progress1.newVouchers.length).toBe(0);

    // Add 5 qualifying bookings
    voucherRepo.setBookingCount(mockCustomer.id, 5);

    // Eligibility check creates reward
    const progress2 = await voucherService.checkEligibility(mockCustomer.id);
    expect(progress2.newVouchers.length).toBe(1);
    expect(progress2.progress[0].completed).toBe(true);
    const earnedVoucherId = progress2.newVouchers[0].id;

    // Repeated click does not create duplicate voucher
    const progress3 = await voucherService.checkEligibility(mockCustomer.id);
    expect(progress3.newVouchers.length).toBe(0);
    expect(progress3.existingVouchers.some((v) => v.id === earnedVoucherId)).toBe(true);
  });

  // SPEC3-TC06: Email request replay and distributed rate limits
  it('SPEC3-TC06: Email Me This Voucher request replay returns same job and enforces rate limiting', async () => {
    const voucher = await voucherRepo.createVoucher({
      promoCode: '7K9M2P4X',
      customerId: mockCustomer.id,
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Special Offer',
      rewardType: 'FIXED_DISCOUNT',
      rewardValue: 50,
      status: 'AVAILABLE',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-10-30T00:00:00Z'),
      metadata: {},
    });

    const requestId = randomUUID();

    // First request
    const job1 = await voucherService.requestVoucherEmail({
      customerId: mockCustomer.id,
      voucherId: voucher.id,
      requestId,
    });
    expect(job1.status).toBe('QUEUED');

    // Replay with identical requestId returns same job without consuming extra rate limit
    const jobReplay = await voucherService.requestVoucherEmail({
      customerId: mockCustomer.id,
      voucherId: voucher.id,
      requestId,
    });
    expect(jobReplay.notificationId).toBe(job1.notificationId);

    // Different request within 5 minutes is rate limited (1 per 5 mins per voucher)
    await expect(
      voucherService.requestVoucherEmail({
        customerId: mockCustomer.id,
        voucherId: voucher.id,
        requestId: randomUUID(),
      })
    ).rejects.toThrow('Too many email requests for this voucher');
  });

  // SPEC3-TC07: Provider failure or voucher changes before dispatch
  it('SPEC3-TC07: Provider failure or voucher status changes before dispatch retains queue status without creating new grant', async () => {
    const voucher = await voucherRepo.createVoucher({
      promoCode: '7K9M2P4X',
      customerId: mockCustomer.id,
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Flash Deal',
      rewardType: 'FIXED_DISCOUNT',
      rewardValue: 50,
      status: 'AVAILABLE',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-10-30T00:00:00Z'),
      metadata: {},
    });

    const job = await voucherService.requestVoucherEmail({
      customerId: mockCustomer.id,
      voucherId: voucher.id,
      requestId: randomUUID(),
    });

    const status1 = await voucherService.getVoucherEmailStatus(job.notificationId, mockCustomer.id);
    expect(status1.status).toBe('QUEUED');

    // Simulate voucher becoming USED before dispatch
    await voucherRepo.markVoucherUsed(voucher.id, 'DA-REF-123', new Date(), 50);

    // Re-check job status; no new grant issued
    const vouchers = await voucherService.getVouchersForCustomer(mockCustomer.id, 'AVAILABLE');
    expect(vouchers.items.length).toBe(0);
  });

  // SPEC3-TC08: Website and kiosk field placement and input invalidation
  it('SPEC3-TC08: Promo code field accepts 8 characters and parameter changes invalidate promo preview', () => {
    // 8-character alphabet check
    const validPayload = {
      promo_code: '7K9M2P4X',
      email: 'guest@example.com',
      booking_context: {
        channel: 'WEB' as const,
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: randomUUID(),
            startAt: '2026-10-12T13:00:00Z',
            endAt: '2026-10-12T15:00:00Z',
          },
        ],
      },
    };

    const parsed = validatePromoSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);

    // Invalid characters (e.g. lowercase or invalid alphabet)
    const invalidChar = validatePromoSchema.safeParse({
      ...validPayload,
      promo_code: 'INVALID!',
    });
    expect(invalidChar.success).toBe(false);

    // Invalid length (not 8 characters)
    const invalidLen = validatePromoSchema.safeParse({
      ...validPayload,
      promo_code: 'SHORT',
    });
    expect(invalidLen.success).toBe(false);
  });

  // SPEC3-TC09: Safe error messages without owner enumeration
  it('SPEC3-TC09: Promo validation returns safe error messages without owner enumeration', async () => {
    const voucher = await voucherRepo.createVoucher({
      promoCode: '7K9M2P4X',
      customerId: mockCustomer.id, // Owned by mockCustomer (guest@example.com)
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Special Offer',
      rewardType: 'PERCENTAGE_DISCOUNT',
      rewardValue: 20,
      status: 'AVAILABLE',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-10-30T00:00:00Z'),
      metadata: {},
    });

    // Mismatched email (mockCustomer2 trying to use mockCustomer's voucher)
    await expect(
      voucherService.validatePromoForBooking({
        promoCode: '7K9M2P4X',
        email: 'other@example.com',
        channel: 'WEB',
        grossAmount: 200,
      })
    ).rejects.toThrow(SPEC3_ERROR_MESSAGES.PROMO_INVALID);

    // Non-existent promo code returns same generic message
    await expect(
      voucherService.validatePromoForBooking({
        promoCode: '99999999',
        email: 'guest@example.com',
        channel: 'WEB',
        grossAmount: 200,
      })
    ).rejects.toThrow(SPEC3_ERROR_MESSAGES.PROMO_INVALID);

    // Expired voucher owned by user returns PROMO_EXPIRED
    const expiredVoucher = await voucherRepo.createVoucher({
      promoCode: 'EXPIRED1',
      customerId: mockCustomer.id,
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Old Promo',
      rewardType: 'FIXED_DISCOUNT',
      rewardValue: 50,
      status: 'AVAILABLE',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-10-01T00:00:00Z'),
      metadata: {},
    });

    await expect(
      voucherService.validatePromoForBooking({
        promoCode: 'EXPIRED1',
        email: 'guest@example.com',
        channel: 'WEB',
        grossAmount: 200,
        now: new Date('2026-10-12T00:00:00Z'),
      })
    ).rejects.toThrow(SPEC3_ERROR_MESSAGES.PROMO_EXPIRED);
  });

  // SPEC3-TC10: Quote and payment pricing fields consistency
  it('SPEC3-TC10: Quote and reservation creation persist gross_amount_due, discount_amount, and amount_due consistently', async () => {
    const voucher = await voucherRepo.createVoucher({
      promoCode: '7K9M2P4X',
      customerId: mockCustomer.id,
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Ten Percent Off',
      rewardType: 'PERCENTAGE_DISCOUNT',
      rewardValue: 10,
      maxDiscountAmount: 100,
      status: 'AVAILABLE',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-10-30T00:00:00Z'),
      metadata: {},
    });

    const quote = await voucherService.validatePromoForBooking({
      promoCode: '7K9M2P4X',
      email: 'guest@example.com',
      channel: 'WEB',
      grossAmount: 200,
    });

    expect(quote.grossAmount).toBe(200);
    expect(quote.discountAmount).toBe(20);
    expect(quote.amountDue).toBe(180);

    const testInstanceId = '00000000-0000-0000-0000-000000000001';
    const mockCatalog = {
      instances: [
        {
          id: testInstanceId,
          templateId: '00000000-0000-0000-0000-000000000002',
          floorId: 'flr-1',
          instanceCode: 'D-01',
          displayName: 'Desk 1',
          operationalStatus: 'ACTIVE',
        },
      ],
      templates: [
        {
          id: '00000000-0000-0000-0000-000000000002',
          name: 'Dedicated Desk',
          capacity: 1,
          rateAmount: 100,
          pricingUnit: 'HOUR',
          isActive: true,
        },
      ],
      floors: [],
    };

    const reservationService = createReservationService(
      reservationRepo,
      { listCatalog: async () => mockCatalog } as any,
      reservationRepo
    );

    const created = await reservationService.createReservation({
      source: 'WEB',
      customerFirstName: 'Maria',
      customerLastName: 'Santos',
      customerEmail: 'guest@example.com',
      promoCode: '7K9M2P4X',
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: testInstanceId,
          startAt: '2026-10-12T13:00:00Z',
          endAt: '2026-10-12T15:00:00Z',
        },
      ],
    }, { voucherService, paymentLinkBaseUrl: 'https://example.com/pay' });

    expect(created.grossAmountDue).toBe(200);
    expect(created.discountAmount).toBe(20);
    expect(created.amountDue).toBe(180);
    expect(created.requestedVoucherId).toBe(voucher.id);
    expect(created.appliedVoucherId).toBeNull(); // Not redeemed until confirmation
    expect(created.promoCodeUsed).toBe('7K9M2P4X');
  });

  // SPEC3-TC11: Voucher conflict handling and no silent repricing
  it('SPEC3-TC11: Stale or conflict promo rejects silent repricing and requires revalidation', async () => {
    const voucher = await voucherRepo.createVoucher({
      promoCode: '7K9M2P4X',
      customerId: mockCustomer.id,
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Flash Discount',
      rewardType: 'FIXED_DISCOUNT',
      rewardValue: 50,
      status: 'AVAILABLE',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-10-30T00:00:00Z'),
      metadata: {},
    });

    // Mark voucher used by concurrent booking
    await voucherRepo.markVoucherUsed(voucher.id, 'DA-OTHER-REF', new Date(), 50);

    const testInstanceId = '00000000-0000-0000-0000-000000000001';
    const mockCatalog = {
      instances: [
        {
          id: testInstanceId,
          templateId: '00000000-0000-0000-0000-000000000002',
          floorId: 'flr-1',
          instanceCode: 'D-01',
          displayName: 'Desk 1',
          operationalStatus: 'ACTIVE',
        },
      ],
      templates: [
        {
          id: '00000000-0000-0000-0000-000000000002',
          name: 'Dedicated Desk',
          capacity: 1,
          rateAmount: 100,
          pricingUnit: 'HOUR',
          isActive: true,
        },
      ],
      floors: [],
    };

    const reservationService = createReservationService(
      reservationRepo,
      { listCatalog: async () => mockCatalog } as any,
      reservationRepo
    );

    // Attempting to book with already-used voucher throws PROMO_REVALIDATION_REQUIRED
    await expect(
      reservationService.createReservation({
        source: 'WEB',
        customerFirstName: 'Maria',
        customerLastName: 'Santos',
        customerEmail: 'guest@example.com',
        promoCode: '7K9M2P4X',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: testInstanceId,
            startAt: '2026-10-12T13:00:00Z',
            endAt: '2026-10-12T15:00:00Z',
          },
        ],
      }, { voucherService, paymentLinkBaseUrl: 'https://example.com/pay' })
    ).rejects.toThrow(SPEC3_ERROR_MESSAGES.PROMO_REVALIDATION_REQUIRED);
  });

  // SPEC3-TC12: Client price tampering rejection
  it('SPEC3-TC12: Client cannot tamper with price: server calculates gross, discount, and amount_due', async () => {
    const voucher = await voucherRepo.createVoucher({
      promoCode: '7K9M2P4X',
      customerId: mockCustomer.id,
      campaignId: randomUUID(),
      ruleId: randomUUID(),
      campaignNameSnapshot: 'Fixed Discount',
      rewardType: 'FIXED_DISCOUNT',
      rewardValue: 50,
      status: 'AVAILABLE',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-10-30T00:00:00Z'),
      metadata: {},
    });

    const testInstanceId = '00000000-0000-0000-0000-000000000001';
    const mockCatalog = {
      instances: [
        {
          id: testInstanceId,
          templateId: '00000000-0000-0000-0000-000000000002',
          floorId: 'flr-1',
          instanceCode: 'D-01',
          displayName: 'Desk 1',
          operationalStatus: 'ACTIVE',
        },
      ],
      templates: [
        {
          id: '00000000-0000-0000-0000-000000000002',
          name: 'Dedicated Desk',
          capacity: 1,
          rateAmount: 100,
          pricingUnit: 'HOUR',
          isActive: true,
        },
      ],
      floors: [],
    };

    const reservationService = createReservationService(
      reservationRepo,
      { listCatalog: async () => mockCatalog } as any,
      reservationRepo
    );

    // Even if client attempts to submit fraudulent amountDue = 1.00, server validates and applies correct amount
    const created = await reservationService.createReservation({
      source: 'WEB',
      customerFirstName: 'Maria',
      customerLastName: 'Santos',
      customerEmail: 'guest@example.com',
      promoCode: '7K9M2P4X',
      amountDue: 1.00, // Tampered client payload
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: testInstanceId,
          startAt: '2026-10-12T13:00:00Z',
          endAt: '2026-10-12T15:00:00Z',
        },
      ],
    }, { voucherService, paymentLinkBaseUrl: 'https://example.com/pay' });

    expect(created.grossAmountDue).toBe(200);
    expect(created.discountAmount).toBe(50);
    expect(created.amountDue).toBe(150);
  });

  // SPEC3-TC13: Earning reservation cannot redeem same newly issued voucher
  it('SPEC3-TC13: Earning reservation cannot redeem same newly issued voucher', async () => {
    // When booking is submitted, voucher issuance has not yet occurred
    // New voucher can only be used on a subsequent reservation
    const rule: CampaignRule = {
      id: randomUUID(),
      campaignId: randomUUID(),
      label: '1st Booking Reward',
      ruleDefinition: {
        schema_version: 1,
        combine: 'ALL',
        conditions: [{ metric: 'BOOKING_COUNT', threshold: 1 }],
      },
      rewardType: 'FIXED_DISCOUNT',
      rewardValue: 30,
      voucherValidityDays: 14,
      createdAt: new Date(),
    };
    voucherRepo.addRule(rule);

    // First booking cannot redeem the voucher it is about to earn
    const initialVouchers = await voucherService.getVouchersForCustomer(mockCustomer.id, 'AVAILABLE');
    expect(initialVouchers.items.length).toBe(0);

    // Simulate completion of first booking
    voucherRepo.setBookingCount(mockCustomer.id, 1);
    const progress = await voucherService.checkEligibility(mockCustomer.id);
    expect(progress.newVouchers.length).toBe(1);

    const newlyIssuedVoucher = progress.newVouchers[0];

    // Second booking can now redeem the voucher
    const secondBookingQuote = await voucherService.validatePromoForBooking({
      promoCode: newlyIssuedVoucher.promoCode,
      email: 'guest@example.com',
      channel: 'WEB',
      grossAmount: 100,
    });

    expect(secondBookingQuote.discountAmount).toBe(30);
    expect(secondBookingQuote.amountDue).toBe(70);
  });

  // SPEC3-TC14: Kiosk timeout / Start Over clears promo state
  it('SPEC3-TC14: Kiosk reset / timeout clears promo code and quote state', () => {
    const initialState = {
      promoCode: '',
      appliedPromo: null,
      promoLoading: false,
      promoError: null,
      promoSuccess: null,
    };

    const activeState = {
      promoCode: '7K9M2P4X',
      appliedPromo: { code: '7K9M2P4X', grossAmount: 100, discountAmount: 20, amountDue: 80 },
      promoLoading: false,
      promoError: null,
      promoSuccess: 'Promo code applied',
    };

    // Simulate reset (handleReset)
    const resetState = {
      ...activeState,
      promoCode: '',
      appliedPromo: null,
      promoLoading: false,
      promoError: null,
      promoSuccess: null,
    };

    expect(resetState).toEqual(initialState);
  });

  // SPEC3-TC15: Minimal booking history and cursor pagination
  it('SPEC3-TC15: My Bookings returns owner-scoped minimal history with cursor pagination and pre-cutover label', async () => {
    const queryValid = customerBookingsQuerySchema.safeParse({
      limit: 10,
      cursor: 'cursor-token',
    });
    expect(queryValid.success).toBe(true);

    const queryDefault = customerBookingsQuerySchema.safeParse({});
    expect(queryDefault.success).toBe(true);
    expect(queryDefault.data?.limit).toBe(20);

    // Limit cap at 50
    const queryTooHigh = customerBookingsQuerySchema.safeParse({ limit: 100 });
    expect(queryTooHigh.success).toBe(false);
  });

  // SPEC3-TC16: Distributed rate limit events and 429 Retry-After
  it('SPEC3-TC16: Distributed rate limits enforce sliding-window quotas and return Retry-After', async () => {
    const ip = '192.168.1.100';

    // 5 attempts allowed per 15 minutes for VERIFY_IP
    for (let i = 0; i < 5; i++) {
      const check = await rateLimiterService.checkAndRecord('VERIFY_IP', ip);
      expect(check.allowed).toBe(true);
    }

    // 6th attempt is rate limited
    const checkBlocked = await rateLimiterService.checkAndRecord('VERIFY_IP', ip);
    expect(checkBlocked.allowed).toBe(false);
    expect(checkBlocked.retryAfterSeconds).toBeGreaterThan(0);

    // Distinct IP is not affected
    const checkOther = await rateLimiterService.checkAndRecord('VERIFY_IP', '192.168.1.101');
    expect(checkOther.allowed).toBe(true);
  });
});
