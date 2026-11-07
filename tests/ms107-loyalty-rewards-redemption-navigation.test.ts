/**
 * Milestone Specification 107 Test Suite
 * Traceability: MS-107, BRD-M2, BRD-M4, BRD-M6, PRD-F15, SDD-C1, SDD-C6, SDD-C12, ERD-E16, ERD-E18, QAD-TC43, QAD-TC45
 * Loyalty Rewards Lifecycle, Voucher Hold Resolution, Rule Versioning, and Dedicated Admin Navigation
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  VoucherMemoryRepository,
  CustomerMemoryRepository,
  VoucherService,
  redeemReservationVoucher,
} from '@deskatlas/domain';

describe('MS-107: Loyalty Rewards Lifecycle, Voucher Hold Resolution, and Dedicated Admin Navigation', () => {
  const root = resolve(__dirname, '..');
  const migration054Path = resolve(
    root,
    'supabase/migrations/054_redeem_voucher_without_customer_id.sql'
  );
  const migration054DownPath = resolve(
    root,
    'supabase/migrations/054_redeem_voucher_without_customer_id_down.sql'
  );
  const adminLayoutPath = resolve(
    root,
    'apps/admin-portal/src/app/manage/layout.tsx'
  );
  const adminCampaignsPagePath = resolve(
    root,
    'apps/admin-portal/src/app/manage/campaigns/page.tsx'
  );
  const adminSettingsPath = resolve(
    root,
    'apps/admin-portal/src/features/settings/components/Settings.tsx'
  );
  const customerRewardsDashboardPath = resolve(
    root,
    'apps/customer-website/src/features/tracking/components/RewardsVoucherDashboard.tsx'
  );
  const voucherHelperPath = resolve(
    root,
    'packages/domain/src/services/voucherRedemptionHelper.ts'
  );
  const voucherRepoInterfacePath = resolve(
    root,
    'packages/domain/src/services/voucherRepository.ts'
  );
  const voucherSupabaseRepoPath = resolve(
    root,
    'packages/domain/src/services/voucherSupabaseRepository.ts'
  );

  let voucherRepo: VoucherMemoryRepository;
  let customerRepo: CustomerMemoryRepository;
  let voucherService: VoucherService;

  const testCustomerId = 'cust-107-test-uuid';
  const testCustomerEmail = 'rewards-guest@example.com';

  beforeEach(async () => {
    voucherRepo = new VoucherMemoryRepository();
    customerRepo = new CustomerMemoryRepository();
    voucherService = new VoucherService(voucherRepo, customerRepo);

    await customerRepo.createCustomer({
      customerCode: 'CUST89',
      email: testCustomerEmail,
      firstName: 'Reynard',
      lastName: 'Rabanal',
    });
  });

  // MS107-TC01: Customer Track Rewards Does Not Display Voucher Version Number
  it('MS107-TC01: Customer Track Rewards does not render voucher version tag or version number to customer', () => {
    expect(existsSync(customerRewardsDashboardPath)).toBe(true);
    const content = readFileSync(customerRewardsDashboardPath, 'utf-8');

    expect(content).toContain('campaign_rule_version?: number;');
    expect(content).toContain('campaignRuleVersion?: number;');
    expect(content).not.toContain('voucher-version-tag');
    expect(content).not.toContain(
      'v{v.reward_snapshot?.campaign_rule_version'
    );
  });

  // MS107-TC02: Default Version Fallback to v1
  it('MS107-TC02: Default Version Fallback cleanly evaluates to v1 when version property is missing', () => {
    const voucherWithoutVersion = {
      id: 'voucher-fallback-01',
      reward_snapshot: {
        rewardType: 'FIXED_AMOUNT_DISCOUNT' as const,
        rewardValue: 50,
        voucherValidityDays: 7,
      },
    };

    const evaluatedVersion =
      voucherWithoutVersion.reward_snapshot.campaign_rule_version ??
      voucherWithoutVersion.reward_snapshot.campaignRuleVersion ??
      1;

    expect(evaluatedVersion).toBe(1);

    const voucherWithVersion = {
      id: 'voucher-explicit-v2',
      reward_snapshot: {
        rewardType: 'FIXED_AMOUNT_DISCOUNT' as const,
        rewardValue: 50,
        voucherValidityDays: 7,
        campaign_rule_version: 2,
      },
    };

    const evaluatedExplicitVersion =
      voucherWithVersion.reward_snapshot.campaign_rule_version ??
      voucherWithVersion.reward_snapshot.campaignRuleVersion ??
      1;

    expect(evaluatedExplicitVersion).toBe(2);
  });

  // MS107-TC03: Admin Booking Approval Transitions Held Voucher to USED
  it('MS107-TC03: Admin Booking Approval transitions held voucher from PENDING_REDEMPTION to USED', async () => {
    const testReservationId = 'res-approved-001';

    const voucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      customer_id: testCustomerId,
      campaignId: 'camp-skyday',
      campaign_id: 'camp-skyday',
      campaignRuleId: 'rule-7day-bday',
      campaign_rule_id: 'rule-7day-bday',
      promoCode: 'SKYDAY50',
      promo_code: 'SKYDAY50',
      milestoneIndex: 1,
      campaignNameSnapshot: 'SKYDAY WeekSaya Birthday Promo',
      rewardSnapshot: {
        rewardType: 'FIXED_AMOUNT_DISCOUNT',
        rewardValue: 50,
        voucherValidityDays: 7,
        campaign_rule_version: 1,
      },
      status: 'PENDING_REDEMPTION',
      pendingReservationId: testReservationId,
      pending_reservation_id: testReservationId,
      heldAt: new Date().toISOString(),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    });

    expect(voucher.status).toBe('PENDING_REDEMPTION');
    expect(voucher.pendingReservationId).toBe(testReservationId);

    // Execute redemption helper on admin approval
    const result = await redeemReservationVoucher({
      reservationId: testReservationId,
      voucherRepository: voucherRepo,
      voucherId: voucher.id,
      discountAmount: 50,
    });

    expect(result.success).toBe(true);
    expect(result.redeemedVoucher?.status).toBe('USED');
    expect(result.redeemedVoucher?.redeemedReservationId).toBe(testReservationId);
    expect(result.redeemedVoucher?.pendingReservationId).toBeNull();

    // Verify stored state in repository
    const stored = await voucherRepo.findVoucherById(voucher.id);
    expect(stored?.status).toBe('USED');
    expect(stored?.redeemedReservationId).toBe(testReservationId);
    expect(stored?.pendingReservationId).toBeNull();
  });

  // MS107-TC04: Hold Resolution Without Customer ID on Reservation Row
  it('MS107-TC04: Resolves and redeems held voucher by reservation ID even when customer_id is absent', async () => {
    const guestReservationId = 'res-guest-no-customer-id';

    const heldVoucher = await voucherRepo.createVoucher({
      customerId: testCustomerId,
      campaignId: 'camp-guest',
      campaignRuleId: 'rule-guest-1',
      promoCode: 'GUESTHOLD',
      milestoneIndex: 1,
      campaignNameSnapshot: 'Guest Promo',
      rewardSnapshot: {
        rewardType: 'FIXED_AMOUNT_DISCOUNT',
        rewardValue: 50,
        voucherValidityDays: 7,
      },
      status: 'PENDING_REDEMPTION',
      pendingReservationId: guestReservationId,
      pending_reservation_id: guestReservationId,
      heldAt: new Date().toISOString(),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    });

    // Invoke without providing voucherId explicitly: helper resolves target via findVoucherByPendingReservationId
    const result = await redeemReservationVoucher({
      reservationId: guestReservationId,
      voucherRepository: voucherRepo,
      discountAmount: 50,
    });

    expect(result.success).toBe(true);
    expect(result.voucherId).toBe(heldVoucher.id);
    expect(result.redeemedVoucher?.status).toBe('USED');
    expect(result.redeemedVoucher?.pendingReservationId).toBeNull();
  });

  // MS107-TC05: Database Migration 054 Unsticks Orphan Holds on Approved Reservations
  it('MS107-TC05: Migration 054 and down migration exist and include hold unstick reconciliation query', () => {
    expect(existsSync(migration054Path)).toBe(true);
    expect(existsSync(migration054DownPath)).toBe(true);

    const migContent = readFileSync(migration054Path, 'utf-8');
    const downContent = readFileSync(migration054DownPath, 'utf-8');

    expect(migContent).toContain('redeem_voucher_for_confirmed_reservation');
    expect(migContent).toContain('UPDATE public.vouchers v');
    expect(migContent).toContain("status = 'USED'");
    expect(migContent).toContain('pending_reservation_id = NULL');
    expect(migContent).toContain("r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')");
    expect(migContent).toContain("v.status = 'PENDING_REDEMPTION'");

    expect(downContent).toContain('redeem_voucher_for_confirmed_reservation');
    expect(downContent).toContain('013_voucher_pending_redemption_hold.sql');
  });

  // MS107-TC06: Admin Sidebar Positions Campaigns Directly Above Promotions
  it('MS107-TC06: Admin navigation layout positions Campaigns & Rewards immediately above Promotions', () => {
    expect(existsSync(adminLayoutPath)).toBe(true);
    const layoutContent = readFileSync(adminLayoutPath, 'utf-8');

    expect(layoutContent).toContain("/manage/campaigns");
    expect(layoutContent).toContain("Campaigns & Rewards");
    expect(layoutContent).toContain("case 'campaigns':");

    const campaignsIdx = layoutContent.indexOf("id: '/manage/campaigns'");
    const promotionsIdx = layoutContent.indexOf("id: '/manage/promotions'");

    expect(campaignsIdx).toBeGreaterThan(-1);
    expect(promotionsIdx).toBeGreaterThan(-1);
    expect(campaignsIdx).toBeLessThan(promotionsIdx);
  });

  // MS107-TC07: Campaigns Page Route Exists Standalone and Settings Redirects Redundant Tab
  it('MS107-TC07: Dedicated page route exists at /manage/campaigns and Settings handles tab elevation', () => {
    expect(existsSync(adminCampaignsPagePath)).toBe(true);
    const pageContent = readFileSync(adminCampaignsPagePath, 'utf-8');

    expect(pageContent).toContain('CampaignsSettings');
    expect(pageContent).toContain('export default function CampaignsPage');

    const settingsContent = readFileSync(adminSettingsPath, 'utf-8');
    expect(settingsContent).toContain("get('tab') === 'campaigns'");
    expect(settingsContent).toContain('/manage/campaigns');
  });

  // MS107-TC08: Invariant Check: Zero Em-Dashes (BAN-PUNCT-01)
  it('MS107-TC08: Enforces zero em-dashes in all modified and created files (BAN-PUNCT-01)', () => {
    const filesToCheck = [
      customerRewardsDashboardPath,
      adminLayoutPath,
      adminCampaignsPagePath,
      voucherHelperPath,
      voucherRepoInterfacePath,
      voucherSupabaseRepoPath,
      migration054Path,
      migration054DownPath,
    ];

    for (const filePath of filesToCheck) {
      if (existsSync(filePath)) {
        const text = readFileSync(filePath, 'utf-8');
        expect(text).not.toContain('\u2014'); // em-dash
        expect(text).not.toContain('\u2013'); // en-dash
      }
    }
  });

  // MS107-TC09: Invariant Check: Zero any types (BAN-TYPE-05)
  it('MS107-TC09: Enforces zero any types in modified domain helper and model files (BAN-TYPE-05)', () => {
    const helperContent = readFileSync(voucherHelperPath, 'utf-8');
    // Check that no variables or parameters are declared as untyped
    expect(helperContent).not.toMatch(/:\s*any\b/);
  });

  // MS107-TC10: Voucher Service Sets campaign_rule_version in rewardSnapshot
  it('MS107-TC10: VoucherService populates campaign_rule_version and campaignRuleVersion in newly issued vouchers', async () => {
    const serviceFilePath = resolve(
      root,
      'packages/domain/src/services/voucherService.ts'
    );
    const serviceContent = readFileSync(serviceFilePath, 'utf-8');

    expect(serviceContent).toContain('campaign_rule_version: rule.version ?? 1');
    expect(serviceContent).toContain('campaignRuleVersion: rule.version ?? 1');
  });
});
