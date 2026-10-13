import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CampaignMemoryRepository,
  CampaignService,
  renderVoucherEmail,
  renderVoucherAwardedEmail,
  resolveCustomerAppBaseUrl,
  type Campaign,
  type CampaignRule,
} from '@deskatlas/domain';
import {
  handleNumericChange,
} from '../apps/admin-portal/src/features/settings/components/CampaignsSettings';

// MS-41 Quality Assurance & Acceptance Test Suite
// Traceability: MS-41, BRD-M1, BRD-M3, BRD-M5, PRD-F23, PRD-F24, SDD-C14, SDD-C17, DSD-UI14, ERD-E16, ERD-E17, ERD-E18, QAD-TC41
// Test Cases: QAD-TC41.1 through QAD-TC41.10

describe('MS-41: Admin Campaign Settings Polish, Leading-Zero Numeric Input, Archived Rewards Restoration, Successor Rule Full-Fidelity Editing, and Deployed Voucher Email CTA Resolution (QAD-TC41)', () => {
  const root = resolve(__dirname, '..');
  const campaignsSettingsPath = resolve(
    root,
    'apps/admin-portal/src/features/settings/components/CampaignsSettings.tsx'
  );
  const transactionalEmailServicePath = resolve(
    root,
    'packages/domain/src/services/transactionalEmailService.ts'
  );
  const campaignMemoryRepositoryPath = resolve(
    root,
    'packages/domain/src/services/campaignMemoryRepository.ts'
  );
  const statusRoutePath = resolve(
    root,
    'apps/admin-portal/src/app/api/admin/campaigns/[id]/status/route.ts'
  );
  const rulesRoutePath = resolve(
    root,
    'apps/admin-portal/src/app/api/admin/campaigns/[id]/rules/route.ts'
  );

  let campaignsSettingsContent: string;
  let transactionalEmailServiceContent: string;
  let campaignMemoryRepositoryContent: string;
  let statusRouteContent: string;
  let rulesRouteContent: string;

  beforeEach(() => {
    campaignsSettingsContent = readFileSync(campaignsSettingsPath, 'utf-8');
    transactionalEmailServiceContent = readFileSync(transactionalEmailServicePath, 'utf-8');
    campaignMemoryRepositoryContent = readFileSync(campaignMemoryRepositoryPath, 'utf-8');
    statusRouteContent = readFileSync(statusRoutePath, 'utf-8');
    rulesRouteContent = readFileSync(rulesRoutePath, 'utf-8');
  });

  describe('Pillar 1: Fluid Leading-Zero Elimination in Numeric Form Inputs', () => {
    it('QAD-TC41.1: handleNumericChange handles empty strings, normal integers, and leading zeros without snap-back to 0', () => {
      // Clearing field produces empty string
      expect(handleNumericChange('')).toBe('');

      // Typing positive integer produces number
      expect(handleNumericChange('5')).toBe(5);
      expect(handleNumericChange('100')).toBe(100);

      // Typing leading zero followed by digit strips leading zero (e.g. "05" -> 5)
      expect(handleNumericChange('05')).toBe(5);
      expect(handleNumericChange('007')).toBe(7);

      // Value of "0" parses as 0
      expect(handleNumericChange('0')).toBe(0);
    });

    it('QAD-TC41.2: handleNumericChange handles decimals properly while preserving 0 before decimal point and cleaning extra leading zeros', () => {
      // Typing 0.5 preserves leading zero before decimal
      expect(handleNumericChange('0.5', true)).toBe(0.5);
      expect(handleNumericChange('0.25', true)).toBe(0.25);

      // Typing 00.5 cleans extra leading zeros to 0.5
      expect(handleNumericChange('00.5', true)).toBe(0.5);
      expect(handleNumericChange('000.75', true)).toBe(0.75);

      // Typing integers in decimal mode
      expect(handleNumericChange('05', true)).toBe(5);
      expect(handleNumericChange('12.5', true)).toBe(12.5);
    });
  });

  describe('Pillar 2: Archived Campaign & Reward Restoration Lifecycle', () => {
    let repo: CampaignMemoryRepository;
    let service: CampaignService;
    let seededArchivedCampaign: Campaign;
    let seededRule: CampaignRule;

    beforeEach(async () => {
      repo = new CampaignMemoryRepository();
      service = new CampaignService(repo);
      const adminId = '00000000-0000-0000-0000-000000000001';
      const created = await service.createCampaign(
        {
          name: 'Summer Promo 2026',
          description: 'Seasonal promotion',
          created_by: adminId,
        },
        [
          {
            label: 'Summer 10% Off',
            reward_type: 'PERCENTAGE_DISCOUNT',
            reward_value: 10,
            max_discount_amount: 500,
            voucher_validity_days: 30,
            rule_definition: {
              schema_version: 1,
              combine: 'ALL',
              conditions: [{ metric: 'BOOKING_COUNT', threshold: 3 }],
              recurring: true,
              qualification_start_at: new Date().toISOString(),
              qualification_end_at: null,
              earning_channels: ['WEB', 'KIOSK'],
              earning_workspace_type_ids: [],
              redemption_channels: ['WEB', 'KIOSK'],
              redemption_workspace_type_ids: [],
              minimum_booking_amount: 0,
            },
          },
        ]
      );

      // Transition to ACTIVE then ARCHIVED
      await service.transitionCampaignStatus(created.id, 'ACTIVE', 1);
      seededArchivedCampaign = await service.transitionCampaignStatus(created.id, 'ARCHIVED', 2);
      const rules = await repo.getRulesByCampaignId(created.id);
      seededRule = rules[0];
    });

    it('QAD-TC41.3: CampaignMemoryRepository allows restoring campaign from ARCHIVED to PAUSED and increments revision', async () => {
      expect(seededArchivedCampaign.status).toBe('ARCHIVED');
      expect(seededArchivedCampaign.revision).toBe(3);

      const restored = await repo.updateCampaignStatus(seededArchivedCampaign.id, 'PAUSED', 3);
      expect(restored.status).toBe('PAUSED');
      expect(restored.revision).toBe(4);
    });

    it('QAD-TC41.4: CampaignMemoryRepository disallows restoring campaign directly from ARCHIVED to ACTIVE', async () => {
      expect(seededArchivedCampaign.status).toBe('ARCHIVED');

      await expect(
        repo.updateCampaignStatus(seededArchivedCampaign.id, 'ACTIVE', 3)
      ).rejects.toThrow('Archived campaigns can only be restored to PAUSED status');
    });

    it('QAD-TC41.5: POST /api/admin/campaigns/[id]/status contract and CampaignService restore an archived campaign with status PAUSED', async () => {
      expect(statusRouteContent).toContain('CampaignStatusTransitionSchema.safeParse(rawBody)');
      expect(statusRouteContent).toContain('service.transitionCampaignStatus(id, status, expected_revision)');

      // Execute status transition via CampaignService simulating route behavior
      const updated = await service.transitionCampaignStatus(
        seededArchivedCampaign.id,
        'PAUSED',
        seededArchivedCampaign.revision
      );

      expect(updated.status).toBe('PAUSED');
      expect(updated.revision).toBe(seededArchivedCampaign.revision + 1);
    });
  });

  describe('Pillar 3: Full-Fidelity Successor Rule Modal with Recurring Toggle and Channels', () => {
    it('QAD-TC41.6: CampaignsSettings.tsx pre-fills and presents recurring toggle, channels, and label in the successor modal', () => {
      // Verifies source code contracts in CampaignsSettings.tsx
      expect(campaignsSettingsContent).toContain('Add Successor Rule (Version');
      expect(campaignsSettingsContent).toContain('successor-recurring-toggle');
      expect(campaignsSettingsContent).toContain('Recurring (Award vouchers at every threshold multiple');
      expect(campaignsSettingsContent).toContain('Earning Channels');
      expect(campaignsSettingsContent).toContain('Redemption Channels');
      expect(campaignsSettingsContent).toContain('toggleEarningChannel');
      expect(campaignsSettingsContent).toContain('toggleRedemptionChannel');
      expect(campaignsSettingsContent).toContain('Restore to Paused');
      expect(campaignsSettingsContent).toContain('handleRestoreCampaign');
    });

    it('QAD-TC41.7: POST /api/admin/campaigns/[id]/rules accepts and persists full successor rule payload with updated recurring boolean', async () => {
      expect(rulesRouteContent).toContain('CampaignRuleInputSchema.safeParse(rawBody)');
      expect(rulesRouteContent).toContain('service.addSuccessorRule(');

      const repo = new CampaignMemoryRepository();
      const service = new CampaignService(repo);
      const adminId = '00000000-0000-0000-0000-000000000001';
      const created = await service.createCampaign(
        {
          name: 'Milestone Rewards',
          created_by: adminId,
        },
        [
          {
            label: 'Initial Rule v1',
            reward_type: 'PERCENTAGE_DISCOUNT',
            reward_value: 15,
            max_discount_amount: 300,
            voucher_validity_days: 14,
            rule_definition: {
              schema_version: 1,
              combine: 'ALL',
              conditions: [{ metric: 'BOOKING_COUNT', threshold: 5 }],
              recurring: true,
              qualification_start_at: new Date().toISOString(),
              qualification_end_at: null,
              earning_channels: ['WEB', 'KIOSK'],
              earning_workspace_type_ids: [],
              redemption_channels: ['WEB', 'KIOSK'],
              redemption_workspace_type_ids: [],
              minimum_booking_amount: 0,
            },
          },
        ]
      );

      await service.transitionCampaignStatus(created.id, 'ACTIVE', 1);
      const rules = await repo.getRulesByCampaignId(created.id);
      const predecessorRuleId = rules[0].id;

      // Add successor rule with recurring: false
      const successor = await service.addSuccessorRule(predecessorRuleId, {
        label: 'Successor Rule v2 (One-off)',
        reward_type: 'PERCENTAGE_DISCOUNT',
        reward_value: 20,
        max_discount_amount: 500,
        voucher_validity_days: 45,
        rule_definition: {
          schema_version: 1,
          combine: 'ALL',
          conditions: [{ metric: 'BOOKING_COUNT', threshold: 10 }],
          recurring: false,
          qualification_start_at: new Date().toISOString(),
          qualification_end_at: null,
          earning_channels: ['WEB'],
          earning_workspace_type_ids: [],
          redemption_channels: ['WEB'],
          redemption_workspace_type_ids: [],
          minimum_booking_amount: 0,
        },
      });

      expect(successor.version).toBe(2);
      expect(successor.supersedes_rule_id).toBe(predecessorRuleId);
      expect(successor.rule_definition.recurring).toBe(false);
      expect(successor.rule_definition.earning_channels).toEqual(['WEB']);
    });
  });

  describe('Pillar 4: Production-Safe Deployed URL Resolution in Voucher Emails', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('QAD-TC41.8: renderVoucherEmail CTA link "Book a Desk Now" resolves to configured DESKATLAS_PUBLIC_APP_URL/reserve instead of localhost', () => {
      process.env.DESKATLAS_PUBLIC_APP_URL = 'https://portal.thedeskatlas.com';

      const rendered = renderVoucherEmail({
        to: 'customer@example.com',
        customerFirstName: 'Alice',
        promoCode: 'LOYALTY1',
        discountDescription: '10% Off Desk Pass',
        campaignName: 'Loyalty Rewards',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(rendered.html).toContain('href="https://portal.thedeskatlas.com/reserve"');
      expect(rendered.text).toContain('https://portal.thedeskatlas.com/reserve');
      expect(rendered.html).not.toContain('localhost:3001');
      expect(rendered.text).not.toContain('localhost:3001');
    });

    it('QAD-TC41.9: renderVoucherAwardedEmail CTA link "Book a Desk Now" and "View My Rewards" resolve to configured deployed domain', () => {
      process.env.DESKATLAS_PUBLIC_APP_URL = 'https://app.thedeskatlas.com';

      const rendered = renderVoucherAwardedEmail({
        to: 'bob@example.com',
        customerFirstName: 'Bob',
        promoCode: 'REWARD20',
        discountText: '20% Off',
        campaignName: 'VIP Milestone',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(rendered.html).toContain('href="https://app.thedeskatlas.com/reserve"');
      expect(rendered.html).toContain('href="https://app.thedeskatlas.com/track/rewards"');
      expect(rendered.text).toContain('https://app.thedeskatlas.com/reserve');
      expect(rendered.text).toContain('https://app.thedeskatlas.com/track/rewards');
      expect(rendered.html).not.toContain('localhost:3001');
      expect(rendered.text).not.toContain('localhost:3001');
    });

    it('QAD-TC41.10: resolveCustomerAppBaseUrl prioritizes profile.appUrl > DESKATLAS_PUBLIC_APP_URL > NEXT_PUBLIC_CUSTOMER_URL > production fallback', () => {
      // 1. Highest priority: profile.appUrl
      delete process.env.DESKATLAS_PUBLIC_APP_URL;
      delete process.env.NEXT_PUBLIC_CUSTOMER_URL;
      const url1 = resolveCustomerAppBaseUrl({ appUrl: 'https://custom-domain.com/' });
      expect(url1).toBe('https://custom-domain.com');

      // 2. Second priority: DESKATLAS_PUBLIC_APP_URL
      process.env.DESKATLAS_PUBLIC_APP_URL = 'https://deskatlas-env.com/';
      const url2 = resolveCustomerAppBaseUrl();
      expect(url2).toBe('https://deskatlas-env.com');

      // 3. Third priority: NEXT_PUBLIC_CUSTOMER_URL
      delete process.env.DESKATLAS_PUBLIC_APP_URL;
      process.env.NEXT_PUBLIC_CUSTOMER_URL = 'https://customer-env.com/';
      const url3 = resolveCustomerAppBaseUrl();
      expect(url3).toBe('https://customer-env.com');

      // 4. Fallback: production domain
      delete process.env.NEXT_PUBLIC_CUSTOMER_URL;
      const url4 = resolveCustomerAppBaseUrl();
      expect(url4).toBe('https://www.thedeskatlas.com');
    });
  });
});
