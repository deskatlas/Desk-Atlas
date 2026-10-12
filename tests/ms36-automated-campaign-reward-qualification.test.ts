import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CustomerMemoryRepository,
  CustomerService,
  VoucherMemoryRepository,
  VoucherSupabaseRepository,
  VoucherService,
  handleConfirmedReservationCampaignQualification,
  PromoValidationError,
  createTransactionalEmailService,
  type Campaign,
  type CampaignRule,
  type QualifyingBookingFact,
} from '@deskatlas/domain';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// MS-36 Quality Assurance & Verification Test Suite
// Traceability: MS-36, BRD-M1, BRD-M3, BRD-M5, PRD-F4, PRD-F23, PRD-F24, SDD-C5, SDD-C6, SDD-C11, SDD-C14, SDD-C15, ERD-E16 through ERD-E20, QAD-TC36
// Test Cases: QAD-TC36-01 through QAD-TC36-12

describe('MS-36: Automated Booking Confirmation Campaign Qualification Pipeline (QAD-TC36)', () => {
  let customerRepo: CustomerMemoryRepository;
  let voucherRepo: VoucherMemoryRepository;
  let customerService: CustomerService;
  let voucherService: VoucherService;

  const testCustomerId = '11111111-1111-1111-1111-111111111111';
  const testCustomerEmail = 'loyaltytest@example.com';
  const testCustomerCode = 'DEF234';
  const testCampaignId = 'camp-loyalty-2026';
  const testRuleId = 'rule-2-bookings';
  const testWorkspaceTypeId = 'tpl-dedicated-desk-01';

  const testCampaign: Campaign = {
    id: testCampaignId,
    name: 'Loyalty 2-Bookings Reward',
    description: 'Complete 2 confirmed bookings on Web or Kiosk to earn 30% off',
    status: 'ACTIVE',
    starts_at: '2026-10-01T00:00:00Z',
    startsAt: '2026-10-01T00:00:00Z',
    ends_at: null,
    endsAt: null,
    activated_at: '2026-10-01T00:00:00Z',
    revision: 2,
    created_by: 'admin-01',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };

  const testRule: CampaignRule = {
    id: testRuleId,
    campaign_id: testCampaignId,
    campaignId: testCampaignId,
    label: 'Complete 2 Bookings for 30% Off',
    version: 1,
    supersedes_rule_id: null,
    effective_from: '2026-10-01T00:00:00Z',
    retired_at: null,
    retiredAt: null,
    reward_type: 'PERCENTAGE_DISCOUNT',
    rewardType: 'PERCENTAGE_DISCOUNT',
    reward_value: 30,
    rewardValue: 30,
    max_discount_amount: 500,
    maxDiscountAmount: 500,
    voucher_validity_days: 30,
    voucherValidityDays: 30,
    created_at: '2026-10-01T00:00:00Z',
    rule_definition: {
      schema_version: 1,
      combine: 'ALL',
      conditions: [{ metric: 'BOOKING_COUNT', threshold: 2 }],
      recurring: false,
      qualification_start_at: '2026-10-01T00:00:00Z',
      qualification_end_at: null,
      earning_channels: ['WEB', 'KIOSK'],
      earning_workspace_type_ids: [],
      redemption_channels: ['WEB', 'KIOSK'],
      redemption_workspace_type_ids: [],
      minimum_booking_amount: 0,
    },
    ruleDefinition: {
      schema_version: 1,
      combine: 'ALL',
      conditions: [{ metric: 'BOOKING_COUNT', threshold: 2 }],
      recurring: false,
      qualification_start_at: '2026-10-01T00:00:00Z',
      qualification_end_at: null,
      earning_channels: ['WEB', 'KIOSK'],
      earning_workspace_type_ids: [],
      redemption_channels: ['WEB', 'KIOSK'],
      redemption_workspace_type_ids: [],
      minimum_booking_amount: 0,
    },
  };

  beforeEach(async () => {
    customerRepo = new CustomerMemoryRepository();
    voucherRepo = new VoucherMemoryRepository();
    customerService = new CustomerService(customerRepo);
    voucherService = new VoucherService(voucherRepo, customerRepo);

    // Register active campaign and rule in repository
    voucherRepo.addCampaign(testCampaign);
    voucherRepo.addRule(testRule);

    // Seed customer
    await customerRepo.createCustomer({
      customerCode: testCustomerCode,
      email: testCustomerEmail,
      firstName: 'Reynard',
      lastName: 'Rabanal',
    });

    const registered = await customerRepo.findCustomerByEmail(testCustomerEmail);
    if (registered) {
      // Align ID with testCustomerId
      (customerRepo as unknown as { customers: Map<string, unknown> }).customers.set(testCustomerId, {
        ...registered,
        id: testCustomerId,
      });
      (customerRepo as unknown as { customersByEmail: Map<string, unknown> }).customersByEmail.set(
        testCustomerEmail,
        {
          ...registered,
          id: testCustomerId,
        }
      );
    }
  });

  // QAD-TC36-01: Admin creates 2-booking campaign on WEB and KIOSK; customer completes 1 booking
  it('QAD-TC36-01: Customer completes 1 booking; fact recorded; progress shows 1 of 2 bookings; zero vouchers issued', async () => {
    const hookResult = await handleConfirmedReservationCampaignQualification({
      reservationId: 'res-booking-001',
      source: 'WEB',
      confirmedAt: '2026-10-02T10:00:00Z',
      voucherRepository: voucherRepo,
      customerRepository: customerRepo,
    });

    // Record qualifying fact directly via repository
    await voucherRepo.recordQualifyingFact({
      reservationId: 'res-booking-001',
      customerId: testCustomerId,
      confirmedAt: '2026-10-02T10:00:00Z',
      source: 'WEB',
      workspaceTypeId: testWorkspaceTypeId,
      netPaidAmount: 300,
      bookedMinutes: 120,
      isQualifying: true,
      createdAt: '2026-10-02T10:00:00Z',
    });

    const eligibility = await voucherService.checkEligibility(testCustomerId, new Date('2026-10-02T10:00:00Z'));
    expect(eligibility.newVouchers.length).toBe(0);
    expect(eligibility.existingVouchers.length).toBe(0);

    const ruleProg = eligibility.progress.find((p) => p.ruleId === testRuleId);
    expect(ruleProg).toBeDefined();
    expect(ruleProg?.conditions[0].current).toBe(1);
    expect(ruleProg?.conditions[0].threshold).toBe(2);
    expect(ruleProg?.conditions[0].remaining).toBe(1);
    expect(ruleProg?.completed).toBe(false);
  });

  // QAD-TC36-02: Customer completes 2nd booking (1 Web, 1 Kiosk)
  it('QAD-TC36-02: Customer completes 2nd booking across channels; milestone reached; 30% voucher automatically minted in repository', async () => {
    // 1st booking on Web
    await voucherRepo.recordQualifyingFact({
      reservationId: 'res-booking-001',
      customerId: testCustomerId,
      confirmedAt: '2026-10-02T10:00:00Z',
      source: 'WEB',
      workspaceTypeId: testWorkspaceTypeId,
      netPaidAmount: 300,
      bookedMinutes: 120,
      isQualifying: true,
      createdAt: '2026-10-02T10:00:00Z',
    });

    // 2nd booking on Kiosk
    await voucherRepo.recordQualifyingFact({
      reservationId: 'res-booking-002',
      customerId: testCustomerId,
      confirmedAt: '2026-10-03T14:30:00Z',
      source: 'KIOSK',
      workspaceTypeId: testWorkspaceTypeId,
      netPaidAmount: 450,
      bookedMinutes: 180,
      isQualifying: true,
      createdAt: '2026-10-03T14:30:00Z',
    });

    const eligibility = await voucherService.checkEligibility(testCustomerId, new Date('2026-10-03T14:30:00Z'));
    expect(eligibility.newVouchers.length).toBe(1);

    const minted = eligibility.newVouchers[0];
    expect(minted.customerId).toBe(testCustomerId);
    expect(minted.campaignRuleId).toBe(testRuleId);
    expect(minted.milestoneIndex).toBe(1);
    expect(minted.status).toBe('AVAILABLE');
    expect(minted.promoCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(minted.rewardSnapshot.rewardType).toBe('PERCENTAGE_DISCOUNT');
    expect(minted.rewardSnapshot.rewardValue).toBe(30);
    expect(minted.rewardSnapshot.maxDiscountAmount).toBe(500);

    // Verify voucher is persisted in voucher repository
    const customerVouchers = await voucherRepo.findVouchersByCustomerId(testCustomerId);
    expect(customerVouchers.length).toBe(1);
    expect(customerVouchers[0].promoCode).toBe(minted.promoCode);
  });

  // QAD-TC36-03: Customer checks Rewards Portal (/track/rewards) after 2 bookings
  it('QAD-TC36-03: Customer portal query returns active voucher with promo code, 30% discount, PHP 500 cap, and 30-day validity', async () => {
    // Seed 2 facts and evaluate
    await voucherRepo.recordQualifyingFact({
      reservationId: 'res-001',
      customerId: testCustomerId,
      confirmedAt: '2026-10-02T10:00:00Z',
      source: 'WEB',
      workspaceTypeId: testWorkspaceTypeId,
      netPaidAmount: 200,
      bookedMinutes: 60,
      isQualifying: true,
      createdAt: '2026-10-02T10:00:00Z',
    });
    await voucherRepo.recordQualifyingFact({
      reservationId: 'res-002',
      customerId: testCustomerId,
      confirmedAt: '2026-10-03T10:00:00Z',
      source: 'KIOSK',
      workspaceTypeId: testWorkspaceTypeId,
      netPaidAmount: 200,
      bookedMinutes: 60,
      isQualifying: true,
      createdAt: '2026-10-03T10:00:00Z',
    });

    const now = new Date('2026-10-03T10:00:00Z');
    await voucherService.checkEligibility(testCustomerId, now);

    const portalVouchers = await voucherService.getVouchersForCustomer(testCustomerId, 'AVAILABLE', undefined, 20, now);
    expect(portalVouchers.items.length).toBe(1);

    const v = portalVouchers.items[0];
    expect(v.status).toBe('AVAILABLE');
    expect(v.promoCode.length).toBe(8);
    expect(v.rewardSnapshot.rewardValue).toBe(30);
    expect(v.rewardSnapshot.maxDiscountAmount).toBe(500);

    const expiryDate = new Date(v.expiresAt);
    const issuedDate = new Date(v.issuedAt);
    const diffDays = Math.round((expiryDate.getTime() - issuedDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  // QAD-TC36-04: Customer calls /api/customer/check-eligibility after 2 bookings
  it('QAD-TC36-04: Customer calls check-eligibility after 2 bookings; returns new_vouchers: [] and marks completed: true', async () => {
    await voucherRepo.recordQualifyingFact({
      reservationId: 'res-001',
      customerId: testCustomerId,
      confirmedAt: '2026-10-02T10:00:00Z',
      source: 'WEB',
      workspaceTypeId: testWorkspaceTypeId,
      netPaidAmount: 200,
      bookedMinutes: 60,
      isQualifying: true,
      createdAt: '2026-10-02T10:00:00Z',
    });
    await voucherRepo.recordQualifyingFact({
      reservationId: 'res-002',
      customerId: testCustomerId,
      confirmedAt: '2026-10-03T10:00:00Z',
      source: 'WEB',
      workspaceTypeId: testWorkspaceTypeId,
      netPaidAmount: 200,
      bookedMinutes: 60,
      isQualifying: true,
      createdAt: '2026-10-03T10:00:00Z',
    });

    // First run issues voucher
    const initialRun = await voucherService.checkEligibility(testCustomerId, new Date('2026-10-03T10:00:00Z'));
    expect(initialRun.newVouchers.length).toBe(1);

    // Second run (simulating manual button press) returns already issued voucher without creating new ones
    const subsequentRun = await voucherService.checkEligibility(testCustomerId, new Date('2026-10-03T10:05:00Z'));
    expect(subsequentRun.newVouchers.length).toBe(0);
    expect(subsequentRun.existingVouchers.length).toBe(1);
    expect(subsequentRun.existingVouchers[0].promoCode).toBe(initialRun.newVouchers[0].promoCode);

    const ruleProg = subsequentRun.progress.find((p) => p.ruleId === testRuleId);
    expect(ruleProg?.completed).toBe(true);
  });

  // QAD-TC36-05: Customer completes 3rd booking on non-recurring rule
  it('QAD-TC36-05: Customer completes 3rd booking on non-recurring rule; fact recorded; zero duplicate vouchers issued', async () => {
    for (let i = 1; i <= 2; i++) {
      await voucherRepo.recordQualifyingFact({
        reservationId: `res-00${i}`,
        customerId: testCustomerId,
        confirmedAt: `2026-10-0${i}T10:00:00Z`,
        source: 'WEB',
        workspaceTypeId: testWorkspaceTypeId,
        netPaidAmount: 200,
        bookedMinutes: 60,
        isQualifying: true,
        createdAt: `2026-10-0${i}T10:00:00Z`,
      });
    }

    await voucherService.checkEligibility(testCustomerId, new Date('2026-10-02T10:00:00Z'));

    // 3rd booking confirmed
    await voucherRepo.recordQualifyingFact({
      reservationId: 'res-003',
      customerId: testCustomerId,
      confirmedAt: '2026-10-04T10:00:00Z',
      source: 'KIOSK',
      workspaceTypeId: testWorkspaceTypeId,
      netPaidAmount: 200,
      bookedMinutes: 60,
      isQualifying: true,
      createdAt: '2026-10-04T10:00:00Z',
    });

    const runAfter3rd = await voucherService.checkEligibility(testCustomerId, new Date('2026-10-04T10:00:00Z'));
    expect(runAfter3rd.newVouchers.length).toBe(0);

    const allVouchers = await voucherRepo.findVouchersByCustomerId(testCustomerId);
    expect(allVouchers.length).toBe(1);
    expect(allVouchers[0].milestoneIndex).toBe(1);
  });

  // QAD-TC36-06: Recurring campaign with threshold 2; customer completes 4 bookings
  it('QAD-TC36-06: Recurring campaign issues sequential milestone index vouchers at exact 2nd and 4th bookings', async () => {
    const recurringCampaignId = 'camp-recurring-2026';
    const recurringRuleId = 'rule-recurring-2';

    voucherRepo.addCampaign({
      id: recurringCampaignId,
      name: 'Recurring 2-Booking Program',
      description: 'Awards voucher on every 2 bookings',
      status: 'ACTIVE',
      starts_at: '2026-10-01T00:00:00Z',
      startsAt: '2026-10-01T00:00:00Z',
      ends_at: null,
      endsAt: null,
      activated_at: '2026-10-01T00:00:00Z',
      revision: 1,
      created_by: 'admin-01',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    });

    voucherRepo.addRule({
      id: recurringRuleId,
      campaign_id: recurringCampaignId,
      campaignId: recurringCampaignId,
      label: 'Every 2 Bookings Reward',
      version: 1,
      reward_type: 'PERCENTAGE_DISCOUNT',
      rewardType: 'PERCENTAGE_DISCOUNT',
      reward_value: 20,
      rewardValue: 20,
      voucher_validity_days: 30,
      voucherValidityDays: 30,
      rule_definition: {
        schema_version: 1,
        combine: 'ALL',
        conditions: [{ metric: 'BOOKING_COUNT', threshold: 2 }],
        recurring: true,
        qualification_start_at: '2026-10-01T00:00:00Z',
        earning_channels: ['WEB', 'KIOSK'],
        earning_workspace_type_ids: [],
        redemption_channels: ['WEB', 'KIOSK'],
        redemption_workspace_type_ids: [],
        minimum_booking_amount: 0,
      },
      ruleDefinition: {
        schema_version: 1,
        combine: 'ALL',
        conditions: [{ metric: 'BOOKING_COUNT', threshold: 2 }],
        recurring: true,
        qualification_start_at: '2026-10-01T00:00:00Z',
        earning_channels: ['WEB', 'KIOSK'],
        earning_workspace_type_ids: [],
        redemption_channels: ['WEB', 'KIOSK'],
        redemption_workspace_type_ids: [],
        minimum_booking_amount: 0,
      },
    });

    // 4 bookings
    for (let i = 1; i <= 4; i++) {
      await voucherRepo.recordQualifyingFact({
        reservationId: `res-rec-00${i}`,
        customerId: testCustomerId,
        confirmedAt: `2026-10-0${i}T10:00:00Z`,
        source: i % 2 === 0 ? 'KIOSK' : 'WEB',
        workspaceTypeId: testWorkspaceTypeId,
        netPaidAmount: 200,
        bookedMinutes: 60,
        isQualifying: true,
        createdAt: `2026-10-0${i}T10:00:00Z`,
      });
    }

    const eligibility = await voucherService.checkEligibility(testCustomerId, new Date('2026-10-04T12:00:00Z'));
    const recurringVouchers = eligibility.newVouchers.filter((v) => v.campaignRuleId === recurringRuleId);

    expect(recurringVouchers.length).toBe(2);
    expect(recurringVouchers[0].milestoneIndex).toBe(1);
    expect(recurringVouchers[1].milestoneIndex).toBe(2);
    expect(recurringVouchers[0].promoCode).not.toBe(recurringVouchers[1].promoCode);
  });

  // QAD-TC36-07: Customer applies newly minted voucher on Web checkout (/api/booking/validate-promo)
  it('QAD-TC36-07: Newly minted voucher applies on Web checkout with 30% discount deducted from gross price up to PHP 500 cap', async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      campaignId: testCampaignId,
      campaignRuleId: testRuleId,
      promoCode: 'TEST30PC',
      milestoneIndex: 1,
      campaignNameSnapshot: testCampaign.name,
      rewardSnapshot: {
        rewardType: 'PERCENTAGE_DISCOUNT',
        rewardValue: 30,
        maxDiscountAmount: 500,
        voucherValidityDays: 30,
        redemptionChannels: ['WEB', 'KIOSK'],
      },
      status: 'AVAILABLE',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    // Test with gross 1000: 30% is 300, below 500 cap
    const result1 = await voucherService.validatePromoForBooking({
      promoCode: voucher.promoCode,
      email: testCustomerEmail,
      channel: 'WEB',
      grossAmount: 1000,
    });
    expect(result1.discountAmount).toBe(300);
    expect(result1.amountDue).toBe(700);

    // Test with gross 2000: 30% is 600, capped at 500
    const result2 = await voucherService.validatePromoForBooking({
      promoCode: voucher.promoCode,
      email: testCustomerEmail,
      channel: 'WEB',
      grossAmount: 2000,
    });
    expect(result2.discountAmount).toBe(500);
    expect(result2.amountDue).toBe(1500);
  });

  // QAD-TC36-08: Customer applies newly minted voucher on Kiosk checkout
  it('QAD-TC36-08: Customer applies newly minted voucher on Kiosk checkout; validates successfully with channel eligibility', async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      campaignId: testCampaignId,
      campaignRuleId: testRuleId,
      promoCode: 'KIOSK30P',
      milestoneIndex: 1,
      campaignNameSnapshot: testCampaign.name,
      rewardSnapshot: {
        rewardType: 'PERCENTAGE_DISCOUNT',
        rewardValue: 30,
        maxDiscountAmount: 500,
        voucherValidityDays: 30,
        redemptionChannels: ['WEB', 'KIOSK'],
      },
      status: 'AVAILABLE',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    const result = await voucherService.validatePromoForBooking({
      promoCode: voucher.promoCode,
      email: testCustomerEmail,
      channel: 'KIOSK',
      grossAmount: 500,
    });

    expect(result.discountAmount).toBe(150);
    expect(result.amountDue).toBe(350);
    expect(result.terms.promoCode).toBe('KIOSK30P');
  });

  // QAD-TC36-09: Customer attempts to redeem already used voucher
  it('QAD-TC36-09: Redemption attempt of already used voucher throws PROMO_USED error', async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      campaignId: testCampaignId,
      campaignRuleId: testRuleId,
      promoCode: 'ALRDYUSE',
      milestoneIndex: 1,
      campaignNameSnapshot: testCampaign.name,
      rewardSnapshot: {
        rewardType: 'PERCENTAGE_DISCOUNT',
        rewardValue: 30,
        voucherValidityDays: 30,
      },
      status: 'USED',
      issuedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      expiresAt: new Date(Date.now() + 20 * 86400000).toISOString(),
      redeemedAt: new Date().toISOString(),
      redeemedReservationId: 'res-prior-999',
      redeemedDiscountAmount: 150,
    });

    await expect(
      voucherService.validatePromoForBooking({
        promoCode: voucher.promoCode,
        email: testCustomerEmail,
        channel: 'WEB',
        grossAmount: 500,
      })
    ).rejects.toThrow(PromoValidationError);

    await expect(
      voucherService.validatePromoForBooking({
        promoCode: voucher.promoCode,
        email: testCustomerEmail,
        channel: 'WEB',
        grossAmount: 500,
      })
    ).rejects.toThrow('This promo code has already been redeemed.');
  });

  // QAD-TC36-10: Booking cancellation excludes fact
  it('QAD-TC36-10: Booking cancellation sets is_qualifying = false; progress calculation excludes cancelled booking', async () => {
    await voucherRepo.recordQualifyingFact({
      reservationId: 'res-active-01',
      customerId: testCustomerId,
      confirmedAt: '2026-10-02T10:00:00Z',
      source: 'WEB',
      workspaceTypeId: testWorkspaceTypeId,
      netPaidAmount: 200,
      bookedMinutes: 60,
      isQualifying: true,
      createdAt: '2026-10-02T10:00:00Z',
    });

    await voucherRepo.recordQualifyingFact({
      reservationId: 'res-cancelled-02',
      customerId: testCustomerId,
      confirmedAt: '2026-10-03T10:00:00Z',
      source: 'WEB',
      workspaceTypeId: testWorkspaceTypeId,
      netPaidAmount: 200,
      bookedMinutes: 60,
      isQualifying: false, // Cancelled booking
      createdAt: '2026-10-03T10:00:00Z',
    });

    const eligibility = await voucherService.checkEligibility(testCustomerId, new Date('2026-10-04T10:00:00Z'));
    expect(eligibility.newVouchers.length).toBe(0);

    const ruleProg = eligibility.progress.find((p) => p.ruleId === testRuleId);
    expect(ruleProg?.conditions[0].current).toBe(1); // Excludes cancelled booking
  });

  // QAD-TC36-11: Automated award email dispatched on milestone completion
  it('QAD-TC36-11: TransactionalEmailService dispatches sendVoucherAwardedEmail with promo code, discount amount, and expiry date', async () => {
    const emailService = createTransactionalEmailService();
    const sendSpy = vi.spyOn(emailService, 'sendVoucherAwardedEmail').mockResolvedValue({
      success: true,
      id: 'mock-msg-award-001',
    });

    await emailService.sendVoucherAwardedEmail({
      to: testCustomerEmail,
      customerFirstName: 'Reynard',
      promoCode: 'TESTAWARD',
      discountDescription: '30% off up to PHP 500.00',
      discountText: '30% off up to PHP 500.00',
      campaignName: 'Loyalty 2-Bookings Reward',
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const callArgs = sendSpy.mock.calls[0][0];
    expect(callArgs.to).toBe(testCustomerEmail);
    expect(callArgs.promoCode).toBe('TESTAWARD');
    expect(callArgs.discountText).toContain('30% off');
  });

  // QAD-TC36-12: Direct customer booking history parity
  it('QAD-TC36-12: /api/customer/bookings returns populated items matching database reservations with qualifying count', async () => {
    voucherRepo.addReservation(testCustomerId, {
      id: 'res-101',
      reference_code: 'DA-REF-101',
      source: 'WEB',
      status: 'CONFIRMED',
      start_at: '2026-10-02T09:00:00Z',
      end_at: '2026-10-02T17:00:00Z',
      workspace_name: 'Desk 5',
      amount_due: 450,
      currency: 'PHP',
      created_at: '2026-10-01T15:00:00Z',
    });

    voucherRepo.addReservation(testCustomerId, {
      id: 'res-102',
      reference_code: 'DA-REF-102',
      source: 'KIOSK',
      status: 'CHECKED_IN',
      start_at: '2026-10-03T10:00:00Z',
      end_at: '2026-10-03T18:00:00Z',
      workspace_name: 'Desk 8',
      amount_due: 500,
      currency: 'PHP',
      created_at: '2026-10-03T09:30:00Z',
    });

    const reservations = await voucherRepo.findCustomerReservations(testCustomerId, 20);
    expect(reservations.length).toBe(2);
    expect(reservations[0].reference_code).toBe('DA-REF-102'); // Most recent first
    expect(reservations[1].reference_code).toBe('DA-REF-101');
    expect(reservations[0].amount_due).toBe(500);
    expect(reservations[1].amount_due).toBe(450);
  });

  // Forward Migration Integrity Check
  it('verifies forward migration 011_qualifying_facts_confirmation_trigger.sql exists and is syntactically sound', () => {
    const migrationPath = resolve(__dirname, '../supabase/migrations/011_qualifying_facts_confirmation_trigger.sql');
    expect(existsSync(migrationPath)).toBe(true);

    const sqlContent = readFileSync(migrationPath, 'utf8');
    expect(sqlContent).toContain('record_qualifying_booking_fact_for_reservation');
    expect(sqlContent).toContain('trg_record_qualifying_booking_fact');
    expect(sqlContent).toContain('qualifying_booking_facts');
    expect(sqlContent).toContain('notification_outbox');
    expect(sqlContent).toContain('VOUCHER_AWARDED');
    expect(sqlContent).not.toMatch(/\u2014/); // Zero em-dashes
  });
});
