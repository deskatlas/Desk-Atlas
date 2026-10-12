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
  calculateEffectiveVoucherStatus,
  holdReservationVoucher,
  releaseHeldReservationVoucher,
  redeemReservationVoucher,
  type Voucher,
  ReservationService,
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  createPaymentSessionService,
  ReservationError,
} from "@deskatlas/domain";

// MS-40 Quality Assurance & Verification Test Suite
// Traceability: MS-40, BRD-M1, BRD-M2, BRD-M3, BRD-M5, PRD-F4, PRD-F6, PRD-F8, PRD-F23, PRD-F24, SDD-C5, SDD-C6, SDD-C14, SDD-C15, DSD-UI13, DSD-UI14, ERD-E10, ERD-E16, ERD-E18, QAD-TC40
// Test Cases: QAD-TC40-01 through QAD-TC40-14

describe("MS-40: Voucher Pending Redemption Lock, Multi-Booking Concurrency Abuse Prevention, Admin Rejection Reactivation, and Customer Portal Hold State Lifecycle (QAD-TC40)", () => {
  const root = resolve(__dirname, "..");

  const migration013Path = resolve(
    root,
    "supabase/migrations/013_voucher_pending_redemption_hold.sql"
  );
  const adminDecisionRoutePath = resolve(
    root,
    "apps/admin-portal/src/app/api/admin/payments/reviews/[paymentAttemptId]/decision/route.ts"
  );
  const customerReservationsRoutePath = resolve(
    root,
    "apps/customer-website/src/app/api/reservations/route.ts"
  );
  const kioskReservationsRoutePath = resolve(
    root,
    "apps/kiosk/src/app/api/reservations/route.ts"
  );
  const customerVouchersRoutePath = resolve(
    root,
    "apps/customer-website/src/app/api/customer/vouchers/route.ts"
  );
  const customerRewardsDashboardPath = resolve(
    root,
    "apps/customer-website/src/features/tracking/components/RewardsVoucherDashboard.tsx"
  );
  const customerReservationPagePath = resolve(
    root,
    "apps/customer-website/src/features/reservation/components/ReservationPage.tsx"
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
  const reservationServicePath = resolve(
    root,
    "packages/domain/src/services/reservationService.ts"
  );

  let voucherRepo: VoucherMemoryRepository;
  let customerRepo: CustomerMemoryRepository;
  let voucherService: VoucherService;

  let testCustomerId = "cust-1111-2222-3333";
  const testCustomerEmail = "guest@example.com";
  const testPromoCode = "4K9M2P7X";

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

  // Architectural & Structural Assertions
  it("MS-40 Architecture: Migration 013 and contracts satisfy specifications", () => {
    expect(existsSync(migration013Path)).toBe(true);
    const migContent = readFileSync(migration013Path, "utf-8");
    expect(migContent).toContain("public.hold_voucher_for_pending_reservation");
    expect(migContent).toContain("public.release_held_voucher_for_reservation");
    expect(migContent).toContain("public.redeem_voucher_for_confirmed_reservation");
    expect(migContent).toContain("trg_reservation_voucher_pending_hold");
    expect(migContent).toContain("trg_reservation_voucher_release_on_terminal_state");
    expect(migContent).toContain("reject_online_payment_attempt");
    expect(migContent).toContain("expire_web_payment_session");
    expect(migContent).toContain("vouchers_status_check");
    expect(migContent).toContain("vouchers_lifecycle_fields_consistency");
    expect(migContent).toContain("uq_vouchers_pending_reservation");
    expect(migContent).toContain("PENDING_REDEMPTION");

    // Ban on em-dashes across migration and helper files
    expect(migContent).not.toMatch(/\u2014/);
    const helperContent = readFileSync(voucherHelperPath, "utf-8");
    expect(helperContent).not.toMatch(/\u2014/);
  });

  it("MS-40 Architecture: Domain repositories and helpers expose holdVoucher and releaseVoucher", () => {
    const ifaceContent = readFileSync(voucherRepoInterfacePath, "utf-8");
    expect(ifaceContent).toContain("holdVoucher(");
    expect(ifaceContent).toContain("releaseVoucher(");

    const supaContent = readFileSync(voucherSupabaseRepoPath, "utf-8");
    expect(supaContent).toContain("async holdVoucher(");
    expect(supaContent).toContain("async releaseVoucher(");
    expect(supaContent).toContain(".eq('status', 'AVAILABLE')");
    expect(supaContent).toContain(".is('redeemed_at', null)");

    const helperContent = readFileSync(voucherHelperPath, "utf-8");
    expect(helperContent).toContain("holdReservationVoucher");
    expect(helperContent).toContain("releaseHeldReservationVoucher");
  });

  it("MS-40 Architecture: Route handlers and UI components wired with pending hold contracts", () => {
    const adminDecisionContent = readFileSync(adminDecisionRoutePath, "utf-8");
    expect(adminDecisionContent).toContain("releaseHeldReservationVoucher");

    const custReservationsContent = readFileSync(customerReservationsRoutePath, "utf-8");
    expect(custReservationsContent).toContain("voucherRepository");

    const kioskReservationsContent = readFileSync(kioskReservationsRoutePath, "utf-8");
    expect(kioskReservationsContent).toContain("voucherRepository");

    const custVouchersContent = readFileSync(customerVouchersRoutePath, "utf-8");
    expect(custVouchersContent).toContain("PENDING_REDEMPTION");

    const dashboardContent = readFileSync(customerRewardsDashboardPath, "utf-8");
    expect(dashboardContent).toContain('data-testid="voucher-status-pending"');

    const reservationPageContent = readFileSync(customerReservationPagePath, "utf-8");
    expect(reservationPageContent).toContain("PROMO_PENDING");
    expect(reservationPageContent).toContain('data-testid="promo-error-message"');

    const resServiceContent = readFileSync(reservationServicePath, "utf-8");
    expect(resServiceContent).toContain("PROMO_PENDING");
    expect(resServiceContent).toContain("holdVoucher");
  });

  // QAD-TC40-01: Reservation submission transitions voucher to PENDING_REDEMPTION
  it("QAD-TC40-01: Reservation submission transitions voucher to PENDING_REDEMPTION", async () => {
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

    const testReservationId = "res-uuid-hold-001";
    const held = await holdReservationVoucher({
      reservationId: testReservationId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
    });

    expect(held.success).toBe(true);
    expect(held.heldVoucher?.status).toBe("PENDING_REDEMPTION");
    expect(held.heldVoucher?.pendingReservationId).toBe(testReservationId);
    expect(held.heldVoucher?.heldAt).toBeTruthy();

    const inRepo = await voucherRepo.findVoucherById(voucher.id);
    expect(inRepo?.status).toBe("PENDING_REDEMPTION");
    expect(inRepo?.pendingReservationId).toBe(testReservationId);
    expect(getEffectiveVoucherStatus(inRepo!)).toBe("PENDING_REDEMPTION");
  });

  // QAD-TC40-02: Concurrent promo validation rejected with PROMO_PENDING
  it("QAD-TC40-02: Concurrent promo validation rejected with PROMO_PENDING", async () => {
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

    // Hold voucher for first booking
    await voucherRepo.holdVoucher(voucher.id, "res-uuid-first-booking");

    // Second booking attempt validating the same code
    await expect(
      voucherService.validatePromoForBooking({
        promoCode: testPromoCode,
        email: testCustomerEmail,
        channel: "WEB",
        grossAmount: 500,
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "PROMO_PENDING",
        message: expect.stringContaining("currently in use by a pending reservation"),
      })
    );
  });

  // QAD-TC40-03: Concurrent reservation submission rejected
  it("QAD-TC40-03: Concurrent reservation submission rejected with concurrency error", async () => {
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

    // Acquire hold for Booking 1
    await holdReservationVoucher({
      reservationId: "res-uuid-booking-1",
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
    });

    // Booking 2 attempts to hold the same voucher
    const secondHold = await holdReservationVoucher({
      reservationId: "res-uuid-booking-2",
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
    });

    expect(secondHold.success).toBe(false);
    expect(secondHold.error).toContain("already held or used");
  });

  // QAD-TC40-04: Admin payment approval finalizes hold to USED
  it("QAD-TC40-04: Admin payment approval finalizes hold to USED", async () => {
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

    const resId = "res-uuid-approval-001";
    await holdReservationVoucher({
      reservationId: resId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
    });

    // Admin approves payment: transition from PENDING_REDEMPTION to USED
    const confirmedTime = new Date().toISOString();
    const result = await redeemReservationVoucher({
      reservationId: resId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
      discountAmount: 150,
      confirmedAt: confirmedTime,
    });

    expect(result.success).toBe(true);
    expect(result.redeemedVoucher?.status).toBe("USED");
    expect(result.redeemedVoucher?.redeemedReservationId).toBe(resId);
    expect(result.redeemedVoucher?.redeemedDiscountAmount).toBe(150);
    expect(result.redeemedVoucher?.pendingReservationId).toBeNull();
    expect(result.redeemedVoucher?.heldAt).toBeNull();

    const stored = await voucherRepo.findVoucherById(voucher.id);
    expect(stored?.status).toBe("USED");
    expect(stored?.pendingReservationId).toBeNull();
    expect(stored?.heldAt).toBeNull();
  });

  // QAD-TC40-05: Kiosk counter payment confirmation finalizes hold to USED
  it("QAD-TC40-05: Kiosk counter payment confirmation finalizes walk-in held voucher to USED", async () => {
    const walkInVoucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "WALK40KI",
      promo_code: "WALK40KI",
      milestoneIndex: 1,
      campaignNameSnapshot: "Walk-In 20%",
      rewardSnapshot: {
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 20,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    const kioskResId = "res-kiosk-walkin-001";
    await voucherRepo.holdVoucher(walkInVoucher.id, kioskResId);

    const redeemed = await voucherRepo.redeemVoucher(walkInVoucher.id, kioskResId, 80);
    expect(redeemed.status).toBe("USED");
    expect(redeemed.redeemedReservationId).toBe(kioskResId);
    expect(redeemed.pendingReservationId).toBeNull();
    expect(redeemed.heldAt).toBeNull();
  });

  // QAD-TC40-06: Admin payment rejection reactivates held voucher
  it("QAD-TC40-06: Admin payment rejection reactivates held voucher back to AVAILABLE", async () => {
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

    const resId = "res-uuid-reject-001";
    await holdReservationVoucher({
      reservationId: resId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
    });

    // Admin rejects payment proof
    const releaseResult = await releaseHeldReservationVoucher({
      reservationId: resId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
    });

    expect(releaseResult.success).toBe(true);
    expect(releaseResult.releasedVoucher?.status).toBe("AVAILABLE");
    expect(releaseResult.releasedVoucher?.pendingReservationId).toBeNull();
    expect(releaseResult.releasedVoucher?.heldAt).toBeNull();

    const stored = await voucherRepo.findVoucherById(voucher.id);
    expect(stored?.status).toBe("AVAILABLE");
    expect(stored?.pendingReservationId).toBeNull();
    expect(stored?.heldAt).toBeNull();
    expect(stored?.redeemedAt).toBeNull();
  });

  // QAD-TC40-07: Reactivated voucher immediately reusable
  it("QAD-TC40-07: Reactivated voucher immediately reusable after rejection", async () => {
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

    const resId = "res-uuid-failed-booking";
    await voucherRepo.holdVoucher(voucher.id, resId);

    // Validation fails while held
    await expect(
      voucherService.validatePromoForBooking({
        promoCode: testPromoCode,
        email: testCustomerEmail,
        channel: "WEB",
        grossAmount: 300,
      })
    ).rejects.toThrowError(
      expect.objectContaining({ code: "PROMO_PENDING" })
    );

    // Released back on rejection
    await releaseHeldReservationVoucher({
      reservationId: resId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
    });

    // Now validatePromoForBooking succeeds!
    const quote = await voucherService.validatePromoForBooking({
      promoCode: testPromoCode,
      email: testCustomerEmail,
      channel: "WEB",
      grossAmount: 300,
    });

    expect(quote.discountAmount).toBe(90);
    expect(quote.amountDue).toBe(210);
  });

  // QAD-TC40-08: Payment session expiry reactivates held voucher
  it("QAD-TC40-08: Payment session expiry reactivates held voucher", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "EXPIR40V",
      promo_code: "EXPIR40V",
      milestoneIndex: 1,
      campaignNameSnapshot: "Expiry Test",
      rewardSnapshot: {
        rewardType: "FIXED_AMOUNT_DISCOUNT",
        rewardValue: 50,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    const expiredResId = "res-uuid-session-expired";
    await voucherRepo.holdVoucher(voucher.id, expiredResId);

    // When payment session expires, release hold
    const release = await releaseHeldReservationVoucher({
      reservationId: expiredResId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
    });

    expect(release.success).toBe(true);
    const restored = await voucherRepo.findVoucherById(voucher.id);
    expect(restored?.status).toBe("AVAILABLE");
    expect(restored?.pendingReservationId).toBeNull();
  });

  // QAD-TC40-09: Unconfirmed reservation cancellation reactivates held voucher
  it("QAD-TC40-09: Unconfirmed reservation cancellation reactivates held voucher", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "CANCEL40",
      promo_code: "CANCEL40",
      milestoneIndex: 1,
      campaignNameSnapshot: "Cancel Test",
      rewardSnapshot: {
        rewardType: "FIXED_AMOUNT_DISCOUNT",
        rewardValue: 40,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    const pendingResId = "res-uuid-unconfirmed-cancel";
    await voucherRepo.holdVoucher(voucher.id, pendingResId);

    const released = await releaseHeldReservationVoucher({
      reservationId: pendingResId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
    });

    expect(released.success).toBe(true);
    expect(released.releasedVoucher?.status).toBe("AVAILABLE");
  });

  // QAD-TC40-10: Post-confirmation cancellation leaves voucher USED
  it("QAD-TC40-10: Post-confirmation cancellation leaves voucher USED (no unearned replenishment)", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "POSTCONF",
      promo_code: "POSTCONF",
      milestoneIndex: 1,
      campaignNameSnapshot: "Post-Conf Test",
      rewardSnapshot: {
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 25,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    const confirmedResId = "res-uuid-confirmed-then-cancelled";
    await voucherRepo.redeemVoucher(voucher.id, confirmedResId, 50);

    // Attempting to release a voucher that has reached USED status must skip and leave it USED
    const attempt = await releaseHeldReservationVoucher({
      reservationId: confirmedResId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
    });

    expect(attempt.success).toBe(true);
    expect(attempt.skipped).toBe(true);

    const afterCheck = await voucherRepo.findVoucherById(voucher.id);
    expect(afterCheck?.status).toBe("USED");
    expect(afterCheck?.redeemedReservationId).toBe(confirmedResId);
  });

  // QAD-TC40-11: Relational consistency constraints satisfied
  it("QAD-TC40-11: Relational consistency constraints satisfied across lifecycle states", async () => {
    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "REL40CON",
      promo_code: "REL40CON",
      milestoneIndex: 1,
      campaignNameSnapshot: "Lifecycle Consistency",
      rewardSnapshot: {
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 15,
        voucherValidityDays: 30,
      },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    // 1. In AVAILABLE: all hold and redemption fields are null
    expect(voucher.status).toBe("AVAILABLE");
    expect(voucher.pendingReservationId).toBeNull();
    expect(voucher.heldAt).toBeNull();
    expect(voucher.redeemedAt).toBeNull();
    expect(voucher.redeemedReservationId).toBeNull();

    // 2. In PENDING_REDEMPTION: pending fields populated, redeemed fields null
    const held = await voucherRepo.holdVoucher(voucher.id, "res-uuid-cons-1");
    expect(held.status).toBe("PENDING_REDEMPTION");
    expect(held.pendingReservationId).toBe("res-uuid-cons-1");
    expect(held.heldAt).toBeTruthy();
    expect(held.redeemedAt).toBeNull();
    expect(held.redeemedReservationId).toBeNull();
    expect(held.redeemedDiscountAmount).toBeNull();

    // 3. In USED: pending fields null, redeemed fields populated
    const used = await voucherRepo.redeemVoucher(voucher.id, "res-uuid-cons-1", 45);
    expect(used.status).toBe("USED");
    expect(used.pendingReservationId).toBeNull();
    expect(used.heldAt).toBeNull();
    expect(used.redeemedAt).toBeTruthy();
    expect(used.redeemedReservationId).toBe("res-uuid-cons-1");
    expect(used.redeemedDiscountAmount).toBe(45);
  });

  // QAD-TC40-12: Unique partial hold index prevents multiple vouchers per reservation
  it("QAD-TC40-12: Partial unique hold index logic enforces at most one voucher held per pending reservation", async () => {
    const voucherA = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: "camp-01",
      campaign_id: "camp-01",
      campaignRuleId: "rule-01",
      campaign_rule_id: "rule-01",
      promoCode: "PARTIAL1",
      promo_code: "PARTIAL1",
      milestoneIndex: 1,
      campaignNameSnapshot: "Index Test A",
      rewardSnapshot: { rewardType: "PERCENTAGE_DISCOUNT", rewardValue: 10, voucherValidityDays: 30 },
      status: "AVAILABLE",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    const resId = "res-uuid-single-hold";
    await voucherRepo.holdVoucher(voucherA.id, resId);

    // Verify migration 013 defines uq_vouchers_pending_reservation
    const migContent = readFileSync(migration013Path, "utf-8");
    expect(migContent).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_pending_reservation");
    expect(migContent).toContain("ON public.vouchers (pending_reservation_id)");
    expect(migContent).toContain("WHERE pending_reservation_id IS NOT NULL");
  });

  // QAD-TC40-13: Customer rewards portal renders ON HOLD badge
  it("QAD-TC40-13: Customer rewards portal renders ON HOLD / PENDING badge and pending booking reference", () => {
    const dashboardContent = readFileSync(customerRewardsDashboardPath, "utf-8");
    expect(dashboardContent).toContain('data-testid="voucher-status-pending"');
    expect(dashboardContent).toContain("ON HOLD / PENDING");
    expect(dashboardContent).toContain("Reserved for booking awaiting review");
    expect(dashboardContent).toContain("This code is currently on hold for an unconfirmed reservation.");
  });

  // QAD-TC40-14: Admin campaign settings "Redeemed" count excludes held vouchers
  it("QAD-TC40-14: Admin campaign settings Redeemed count excludes vouchers in PENDING_REDEMPTION", async () => {
    const campaignRepo = new CampaignMemoryRepository();
    const campaign = await campaignRepo.createCampaign(
      {
        id: "camp-stat-01",
        name: "Hold Stat Isolation Campaign",
        description: "Stat test",
        status: "ACTIVE",
        created_by: "admin-1",
        starts_at: null,
        ends_at: null,
        revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      []
    );

    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + 30 * 86400000).toISOString();

    // 1. Used voucher
    await campaignRepo.insertVouchers([
      {
        id: "v-used-1",
        customer_id: testCustomerId,
        campaign_id: campaign.id,
        campaign_rule_id: "rule-1",
        promo_code: "USEDCOUNT",
        milestone_index: 1,
        campaign_name_snapshot: campaign.name,
        reward_snapshot: { reward_type: "PERCENTAGE_DISCOUNT", reward_value: 20 },
        status: "USED",
        issued_at: nowIso,
        expires_at: expiresIso,
        redeemed_at: nowIso,
        redeemed_reservation_id: "res-confirmed",
        redeemed_discount_amount: 50,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ]);

    // 2. Pending held voucher
    await campaignRepo.insertVouchers([
      {
        id: "v-held-1",
        customer_id: testCustomerId,
        campaign_id: campaign.id,
        campaign_rule_id: "rule-1",
        promo_code: "HELDCOUNT",
        milestone_index: 2,
        campaign_name_snapshot: campaign.name,
        reward_snapshot: { reward_type: "PERCENTAGE_DISCOUNT", reward_value: 20 },
        status: "PENDING_REDEMPTION",
        issued_at: nowIso,
        expires_at: expiresIso,
        pending_reservation_id: "res-pending-1",
        created_at: nowIso,
        updated_at: nowIso,
      },
    ]);

    // 3. Available voucher
    await campaignRepo.insertVouchers([
      {
        id: "v-avail-1",
        customer_id: testCustomerId,
        campaign_id: campaign.id,
        campaign_rule_id: "rule-1",
        promo_code: "AVAILCOUNT",
        milestone_index: 3,
        campaign_name_snapshot: campaign.name,
        reward_snapshot: { reward_type: "PERCENTAGE_DISCOUNT", reward_value: 20 },
        status: "AVAILABLE",
        issued_at: nowIso,
        expires_at: expiresIso,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ]);

    const counts = await campaignRepo.getVoucherCountsByCampaignId(campaign.id);
    expect(counts.issued).toBe(3);
    // Strictly only 1 redeemed voucher counted (held is excluded)
    expect(counts.used).toBe(1);
    expect(counts.expired).toBe(0);
  });
});
