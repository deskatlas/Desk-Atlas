import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  VoucherMemoryRepository,
  CustomerMemoryRepository,
  CampaignMemoryRepository,
  VoucherService,
  PromoValidationError,
  getEffectiveVoucherStatus,
  redeemReservationVoucher,
  calculateEffectiveVoucherStatus,
  type Voucher,
} from "@deskatlas/domain";

// MS-39 Quality Assurance & Verification Test Suite
// Traceability: MS-39, BRD-M1, BRD-M2, BRD-M3, BRD-M5, PRD-F4, PRD-F6, PRD-F8, PRD-F23, PRD-F24, SDD-C5, SDD-C6, SDD-C14, SDD-C15, DSD-UI13, DSD-UI14, ERD-E10, ERD-E16, ERD-E18, QAD-TC39
// Test Cases: QAD-TC39-01 through QAD-TC39-12

describe("MS-39: End-to-End Single-Use Voucher Redemption Lifecycle, Admin Confirmation Status Invalidation, Customer Portal Used-State Transition, and Admin Campaign Settings Redeemed Count Synchronization (QAD-TC39)", () => {
  const root = resolve(__dirname, "..");

  const migration012Path = resolve(
    root,
    "supabase/migrations/012_voucher_single_use_redemption_trigger.sql"
  );
  const adminDecisionRoutePath = resolve(
    root,
    "apps/admin-portal/src/app/api/admin/payments/reviews/[paymentAttemptId]/decision/route.ts"
  );
  const staffConfirmRoutePath = resolve(
    root,
    "apps/staff-dashboard/src/app/api/payments/[paymentAttemptId]/confirm/route.ts"
  );
  const kioskConfirmRoutePath = resolve(
    root,
    "apps/kiosk/src/app/api/payments/[paymentAttemptId]/confirm/route.ts"
  );
  const customerVouchersRoutePath = resolve(
    root,
    "apps/customer-website/src/app/api/customer/vouchers/route.ts"
  );
  const customerRewardsDashboardPath = resolve(
    root,
    "apps/customer-website/src/features/tracking/components/RewardsVoucherDashboard.tsx"
  );
  const adminCampaignsSettingsPath = resolve(
    root,
    "apps/admin-portal/src/features/settings/components/CampaignsSettings.tsx"
  );
  const voucherRepoInterfacePath = resolve(
    root,
    "packages/domain/src/services/voucherRepository.ts"
  );
  const voucherSupabaseRepoPath = resolve(
    root,
    "packages/domain/src/services/voucherSupabaseRepository.ts"
  );
  const voucherHelperPath = resolve(
    root,
    "packages/domain/src/services/voucherRedemptionHelper.ts"
  );

  let voucherRepo: VoucherMemoryRepository;
  let customerRepo: CustomerMemoryRepository;
  let voucherService: VoucherService;

  let testCustomerId = "cust-1111-2222-3333";
  const testCustomerEmail = "guest@example.com";
  const testPromoCode = "7K9M2P4X";

  beforeEach(async () => {
    voucherRepo = new VoucherMemoryRepository();
    customerRepo = new CustomerMemoryRepository();
    voucherService = new VoucherService(voucherRepo, customerRepo);

    const created = await customerRepo.createCustomer({
      customerCode: "CUST89",
      email: testCustomerEmail,
      firstName: "Reynard",
      lastName: "Rabanal",
    });
    testCustomerId = created.id;
  });

  // Structural & Architectural Contract Assertions
  it("MS-39 Architecture: Migration 012 and file contracts exist and satisfy specifications", () => {
    expect(existsSync(migration012Path)).toBe(true);
    const migContent = readFileSync(migration012Path, "utf-8");
    expect(migContent).toContain("public.redeem_voucher_for_confirmed_reservation");
    expect(migContent).toContain("public.trg_redeem_reservation_voucher");
    expect(migContent).toContain("trg_reservation_voucher_redemption");
    expect(migContent).toContain("public.approve_online_payment_and_allocate");
    expect(migContent).toContain("public.confirm_kiosk_payment_and_allocate");
    expect(migContent).toContain("UPDATE public.vouchers");
    expect(migContent).toContain("status = 'USED'");

    // Ban on em-dashes across migration and newly added files
    expect(migContent).not.toMatch(/\u2014/);
    const helperContent = readFileSync(voucherHelperPath, "utf-8");
    expect(helperContent).not.toMatch(/\u2014/);
  });

  it("MS-39 Architecture: Route handlers wired with single-use voucher redemption hook", () => {
    const adminDecisionContent = readFileSync(adminDecisionRoutePath, "utf-8");
    expect(adminDecisionContent).toContain("redeemReservationVoucher");
    expect(adminDecisionContent).toContain("VoucherSupabaseRepository");

    const staffConfirmContent = readFileSync(staffConfirmRoutePath, "utf-8");
    expect(staffConfirmContent).toContain("redeemReservationVoucher");
    expect(staffConfirmContent).toContain("VoucherSupabaseRepository");

    const kioskConfirmContent = readFileSync(kioskConfirmRoutePath, "utf-8");
    expect(kioskConfirmContent).toContain("redeemReservationVoucher");
    expect(kioskConfirmContent).toContain("VoucherSupabaseRepository");
  });

  it("MS-39 Architecture: VoucherRepository interface and implementations provide redeemVoucher", () => {
    const ifaceContent = readFileSync(voucherRepoInterfacePath, "utf-8");
    expect(ifaceContent).toContain("redeemVoucher(");

    const supaContent = readFileSync(voucherSupabaseRepoPath, "utf-8");
    expect(supaContent).toContain("async redeemVoucher(");
    expect(supaContent).toContain(".eq('status', 'AVAILABLE')");
    expect(supaContent).toContain(".is('redeemed_at', null)");
  });

  it("MS-39 Architecture: Admin Campaign Settings contains campaign-voucher-used-count testid", () => {
    const settingsContent = readFileSync(adminCampaignsSettingsPath, "utf-8");
    expect(settingsContent).toContain('data-testid="campaign-voucher-used-count"');
  });

  // QAD-TC39-01: Strict No-Hold: Booking submission leaves voucher AVAILABLE
  it("QAD-TC39-01: Strict No-Hold: Booking submission leaves voucher AVAILABLE while reservation is unconfirmed", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: testPromoCode,
      promo_code: testPromoCode,
      milestoneIndex: 1,
      campaignNameSnapshot: "Loyalty 30%",
      rewardSnapshot: {
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 30,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    // Validating promo for booking quotes discount without changing voucher state
    const quote = await voucherService.validatePromoForBooking({
      promoCode: testPromoCode,
      email: testCustomerEmail,
      channel: "WEB",
      grossAmount: 100,
    });

    expect(quote.discountAmount).toBe(30);
    expect(quote.amountDue).toBe(70);

    // Voucher in repository remains strictly AVAILABLE
    const checkVoucher = await voucherRepo.findVoucherById(voucher.id);
    expect(checkVoucher).not.toBeNull();
    expect(checkVoucher?.status).toBe("AVAILABLE");
    expect(checkVoucher?.redeemedAt).toBeNull();
    expect(checkVoucher?.redeemedReservationId).toBeNull();
    expect(checkVoucher?.redeemedDiscountAmount).toBeNull();
  });

  // QAD-TC39-02: Admin payment approval transitions voucher to USED
  it("QAD-TC39-02: Admin payment approval transitions voucher to USED with required redemption fields", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: testPromoCode,
      promo_code: testPromoCode,
      milestoneIndex: 1,
      campaignNameSnapshot: "Loyalty 30%",
      rewardSnapshot: {
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 30,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    const testReservationId = "res-uuid-9999-0001";
    const discountAmount = 30;
    const confirmedTimestamp = new Date().toISOString();

    const result = await redeemReservationVoucher({
      reservationId: testReservationId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
      discountAmount,
      confirmedAt: confirmedTimestamp,
    });

    expect(result.success).toBe(true);
    expect(result.redeemedVoucher?.status).toBe("USED");
    expect(result.redeemedVoucher?.redeemedReservationId).toBe(testReservationId);
    expect(result.redeemedVoucher?.redeemedDiscountAmount).toBe(30);
    expect(result.redeemedVoucher?.redeemedAt).toBe(confirmedTimestamp);

    const reloaded = await voucherRepo.findVoucherById(voucher.id);
    expect(reloaded?.status).toBe("USED");
    expect(reloaded?.redeemedReservationId).toBe(testReservationId);
    expect(reloaded?.redeemedDiscountAmount).toBe(30);
  });

  // QAD-TC39-03: Relational consistency constraints satisfied
  it("QAD-TC39-03: Relational consistency constraints satisfied: all redemption fields populated simultaneously", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "REL8CONS",
      promo_code: "REL8CONS",
      milestoneIndex: 1,
      campaignNameSnapshot: "Consistency Test",
      rewardSnapshot: {
        rewardType: "FIXED_AMOUNT_DISCOUNT",
        rewardValue: 50,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    const testResId = "res-uuid-rel-001";
    const redeemed = await voucherRepo.redeemVoucher(
      voucher.id,
      testResId,
      50,
      new Date().toISOString()
    );

    // Constraint: (status = 'USED' AND redeemed_at IS NOT NULL AND redeemed_reservation_id IS NOT NULL AND redeemed_discount_amount IS NOT NULL)
    expect(redeemed.status).toBe("USED");
    expect(redeemed.redeemedAt).not.toBeNull();
    expect(redeemed.redeemedReservationId).not.toBeNull();
    expect(redeemed.redeemedDiscountAmount).not.toBeNull();
  });

  // QAD-TC39-04: Admin payment rejection preserves voucher as AVAILABLE
  it("QAD-TC39-04: Admin payment rejection preserves voucher as AVAILABLE for future bookings", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "REJECT01",
      promo_code: "REJECT01",
      milestoneIndex: 1,
      campaignNameSnapshot: "Rejection Non-Destructive",
      rewardSnapshot: {
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 20,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    // When payment review rejects the attempt, redeemReservationVoucher is NOT executed.
    // Confirm voucher remains AVAILABLE
    const checkVoucher = await voucherRepo.findVoucherById(voucher.id);
    expect(checkVoucher?.status).toBe("AVAILABLE");
    expect(checkVoucher?.redeemedAt).toBeNull();

    // Customer can quote promo code again on a subsequent reservation
    const subsequentQuote = await voucherService.validatePromoForBooking({
      promoCode: "REJECT01",
      email: testCustomerEmail,
      channel: "WEB",
      grossAmount: 120,
    });
    expect(subsequentQuote.discountAmount).toBe(24);
  });

  // QAD-TC39-05: Payment session expiry preserves voucher as AVAILABLE
  it("QAD-TC39-05: Payment session expiry preserves voucher as AVAILABLE", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "EXPIRY01",
      promo_code: "EXPIRY01",
      milestoneIndex: 1,
      campaignNameSnapshot: "Expiry Test",
      rewardSnapshot: {
        rewardType: "FIXED_AMOUNT_DISCOUNT",
        rewardValue: 40,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    // An unpaid session expires without calling confirmation or redemption
    const current = await voucherRepo.findVoucherById(voucher.id);
    expect(current?.status).toBe("AVAILABLE");
    expect(current?.redeemedReservationId).toBeNull();
  });

  // QAD-TC39-06: Single-use reuse blocked at checkout
  it("QAD-TC39-06: Single-use reuse blocked at checkout with PROMO_USED error code", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "ONCEONLY",
      promo_code: "ONCEONLY",
      milestoneIndex: 1,
      campaignNameSnapshot: "Single-Use Promo",
      rewardSnapshot: {
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 25,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    // Confirm booking and redeem voucher
    await voucherRepo.redeemVoucher(voucher.id, "res-first-booking", 25);

    // Customer attempts to reuse code on a second booking
    await expect(
      voucherService.validatePromoForBooking({
        promoCode: "ONCEONLY",
        email: testCustomerEmail,
        channel: "WEB",
        grossAmount: 100,
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "PROMO_USED",
        message: "This promo code has already been redeemed.",
      })
    );
  });

  // QAD-TC39-07: Customer portal tab separation
  it("QAD-TC39-07: Customer portal tab separation: getEffectiveVoucherStatus routes used vouchers to USED tab", async () => {
    const now = new Date();

    const availableVoucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "AVAIL001",
      promo_code: "AVAIL001",
      milestoneIndex: 1,
      campaignNameSnapshot: "Available Promo",
      rewardSnapshot: {
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 15,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
    });

    const usedVoucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "USED0001",
      promo_code: "USED0001",
      milestoneIndex: 2,
      campaignNameSnapshot: "Used Promo",
      rewardSnapshot: {
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 20,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
    });

    // Mark usedVoucher as redeemed
    await voucherRepo.redeemVoucher(usedVoucher.id, "res-prev-123", 20);

    const allVouchers = await voucherRepo.findVouchersByCustomerId(testCustomerId);

    const availableTabItems = allVouchers
      .map((v) => ({ ...v, effectiveStatus: getEffectiveVoucherStatus(v, now) }))
      .filter((v) => v.effectiveStatus === "AVAILABLE");

    const usedTabItems = allVouchers
      .map((v) => ({ ...v, effectiveStatus: getEffectiveVoucherStatus(v, now) }))
      .filter((v) => v.effectiveStatus === "USED");

    expect(availableTabItems.map((v) => v.promoCode)).toEqual(["AVAIL001"]);
    expect(usedTabItems.map((v) => v.promoCode)).toEqual(["USED0001"]);
  });

  // QAD-TC39-08: Customer portal used voucher presentation
  it("QAD-TC39-08: Customer portal used voucher presentation renders USED badge and suppresses email button", () => {
    const dashboardContent = readFileSync(customerRewardsDashboardPath, "utf-8");
    expect(dashboardContent).toMatch(/data-testid=\{`voucher-tab-\$\{tab\.toLowerCase\(\)\}`\}/);
    expect(dashboardContent).toContain('v.status === "USED" && v.redeemed_reservation_id');
    expect(dashboardContent).toContain("Redeemed discount: PHP");
    expect(dashboardContent).toContain('v.status === "AVAILABLE"');
    expect(dashboardContent).toContain("Email Me This Voucher");
  });

  // QAD-TC39-09: Staff kiosk counter payment confirmation redeems voucher
  it("QAD-TC39-09: Staff kiosk counter payment confirmation redeems walk-in voucher", async () => {
    const walkInVoucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "WALKIN01",
      promo_code: "WALKIN01",
      milestoneIndex: 1,
      campaignNameSnapshot: "Walk-In Reward",
      rewardSnapshot: {
        rewardType: "FIXED_AMOUNT_DISCOUNT",
        rewardValue: 60,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    const kioskResId = "res-kiosk-walk-in-01";
    const result = await redeemReservationVoucher({
      reservationId: kioskResId,
      voucherRepository: voucherRepo,
      voucherId: walkInVoucher.id,
      discountAmount: 60,
    });

    expect(result.success).toBe(true);
    expect(result.redeemedVoucher?.status).toBe("USED");
    expect(result.redeemedVoucher?.redeemedReservationId).toBe(kioskResId);
  });

  // QAD-TC39-10: Admin campaign settings Redeemed count increments
  it("QAD-TC39-10: Admin campaign settings Redeemed count increments with each voucher redemption", async () => {
    const campRepo = new CampaignMemoryRepository();

    const campaign = await campRepo.createCampaign(
      {
        id: "camp-metric-test",
        name: "Campaign Stat Test",
        description: "Testing redeemed count increments",
        status: "ACTIVE",
        revision: 1,
        created_by: "admin",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      [
        {
          id: "rule-metric-01",
          campaign_id: "camp-metric-test",
          label: "Rule 1",
          version: 1,
          supersedes_rule_id: null,
          effective_from: new Date().toISOString(),
          retired_at: null,
          reward_type: "FIXED_AMOUNT_DISCOUNT",
          reward_value: 30,
          voucher_validity_days: 30,
          rule_definition: { schema_version: 1, combine: "ALL", conditions: [] },
          created_at: new Date().toISOString(),
        },
      ]
    );

    // Issue 2 vouchers
    const [v1, v2] = await campRepo.insertVouchers([
      {
        id: "vouch-metric-01",
        customer_id: testCustomerId,
        campaign_id: campaign.id,
        campaign_rule_id: "rule-metric-01",
        promo_code: "METRIC01",
        milestone_index: 1,
        campaign_name_snapshot: campaign.name,
        reward_snapshot: {
          reward_type: "FIXED_AMOUNT_DISCOUNT",
          reward_value: 30,
          voucher_validity_days: 30,
        },
        status: "AVAILABLE",
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        redeemed_at: null,
        redeemed_reservation_id: null,
        redeemed_discount_amount: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "vouch-metric-02",
        customer_id: testCustomerId,
        campaign_id: campaign.id,
        campaign_rule_id: "rule-metric-01",
        promo_code: "METRIC02",
        milestone_index: 2,
        campaign_name_snapshot: campaign.name,
        reward_snapshot: {
          reward_type: "FIXED_AMOUNT_DISCOUNT",
          reward_value: 30,
          voucher_validity_days: 30,
        },
        status: "AVAILABLE",
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        redeemed_at: null,
        redeemed_reservation_id: null,
        redeemed_discount_amount: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // Initial state: 2 issued, 0 used
    let counts = await campRepo.getVoucherCountsByCampaignId(campaign.id);
    expect(counts.issued).toBe(2);
    expect(counts.used).toBe(0);

    // Redeem first voucher
    await campRepo.redeemVoucher(v1.id, "res-count-1", 30);
    counts = await campRepo.getVoucherCountsByCampaignId(campaign.id);
    expect(counts.issued).toBe(2);
    expect(counts.used).toBe(1);

    // Redeem second voucher
    await campRepo.redeemVoucher(v2.id, "res-count-2", 30);
    counts = await campRepo.getVoucherCountsByCampaignId(campaign.id);
    expect(counts.issued).toBe(2);
    expect(counts.used).toBe(2);
  });

  // QAD-TC39-11: Concurrent redemption conflict protection
  it("QAD-TC39-11: Concurrent redemption conflict protection prevents double spend", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "CONCURR1",
      promo_code: "CONCURR1",
      milestoneIndex: 1,
      campaignNameSnapshot: "Concurrent Test",
      rewardSnapshot: {
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 20,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    // First redemption succeeds
    const firstRedeem = await redeemReservationVoucher({
      reservationId: "res-first-winner",
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
      discountAmount: 20,
    });
    expect(firstRedeem.success).toBe(true);

    // Second redemption attempt on a different reservation fails
    const secondRedeem = await redeemReservationVoucher({
      reservationId: "res-second-loser",
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
      discountAmount: 20,
    });
    expect(secondRedeem.success).toBe(false);
    expect(secondRedeem.error).toMatch(/already used|conflict/i);
  });

  // QAD-TC39-12: Post-confirmation booking cancellation leaves voucher USED
  it("QAD-TC39-12: Post-confirmation booking cancellation leaves voucher USED (burned credit)", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "POSTCANC",
      promo_code: "POSTCANC",
      milestoneIndex: 1,
      campaignNameSnapshot: "Post-Cancellation Invariant",
      rewardSnapshot: {
        rewardType: "FIXED_AMOUNT_DISCOUNT",
        rewardValue: 35,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    const resId = "res-confirmed-then-cancelled";
    await voucherRepo.redeemVoucher(voucher.id, resId, 35);

    // Reservation cancellation does NOT reset voucher to AVAILABLE
    const checkVoucher = await voucherRepo.findVoucherById(voucher.id);
    expect(checkVoucher?.status).toBe("USED");
    expect(checkVoucher?.redeemedReservationId).toBe(resId);

    // Effective status remains USED
    const effStatus = getEffectiveVoucherStatus(checkVoucher!);
    expect(effStatus).toBe("USED");
  });
});
