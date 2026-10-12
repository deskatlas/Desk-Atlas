import type {
  Campaign,
  CampaignRule,
  CampaignStatus,
  CustomerEvaluationResult,
  QualifyingBookingFact,
  RewardWork,
  RuleEvaluationProgress,
  Voucher,
  VoucherRewardSnapshot,
} from '../models/campaign';
import type { CampaignListFilter, CampaignRepository } from './campaignRepository';
import {
  evaluateRuleProgress,
  generatePromoCode,
} from './campaignRuleEvaluator';

// SPEC-2 Traceability: PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37

export class CampaignService {
  constructor(private readonly repository: CampaignRepository) {}

  // --- Campaign Admin CRUD ---

  async createCampaign(
    campaignData: {
      name: string;
      description?: string | null;
      starts_at?: string | null;
      ends_at?: string | null;
      created_by: string;
    },
    rulesData: Array<{
      label: string;
      reward_type: 'PERCENTAGE_DISCOUNT' | 'FIXED_AMOUNT_DISCOUNT';
      reward_value: number;
      max_discount_amount?: number | null;
      voucher_validity_days?: number;
      rule_definition: CampaignRule['rule_definition'];
    }>
  ): Promise<Campaign> {
    const campaignId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const campaign: Campaign = {
      id: campaignId,
      name: campaignData.name.trim(),
      description: campaignData.description?.trim() || null,
      status: 'DRAFT',
      starts_at: campaignData.starts_at || null,
      ends_at: campaignData.ends_at || null,
      activated_at: null,
      revision: 1,
      created_by: campaignData.created_by,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const rules: CampaignRule[] = rulesData.map((rd) => ({
      id: crypto.randomUUID(),
      campaign_id: campaignId,
      label: rd.label.trim(),
      version: 1,
      supersedes_rule_id: null,
      effective_from: rd.rule_definition?.qualification_start_at || nowIso,
      retired_at: null,
      rule_definition: rd.rule_definition,
      reward_type: rd.reward_type,
      reward_value: rd.reward_value,
      max_discount_amount: rd.max_discount_amount || null,
      voucher_validity_days: rd.voucher_validity_days || 30,
      created_at: nowIso,
    }));

    return this.repository.createCampaign(campaign, rules);
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    return this.repository.getCampaignById(id);
  }

  async listCampaigns(filter?: CampaignListFilter): Promise<{ campaigns: Campaign[]; total: number }> {
    return this.repository.listCampaigns(filter);
  }

  async updateCampaign(
    id: string,
    updates: {
      name?: string;
      description?: string | null;
      starts_at?: string | null;
      ends_at?: string | null;
    },
    expectedRevision: number
  ): Promise<Campaign> {
    return this.repository.updateCampaign(id, updates, expectedRevision);
  }

  async deleteDraftCampaign(id: string): Promise<boolean> {
    return this.repository.deleteDraftCampaign(id);
  }

  async transitionCampaignStatus(
    id: string,
    newStatus: CampaignStatus,
    expectedRevision: number
  ): Promise<Campaign> {
    const updated = await this.repository.updateCampaignStatus(id, newStatus, expectedRevision);

    // If activating or resuming, atomically enqueue durable reconciliation for existing customers
    if (newStatus === 'ACTIVE') {
      await this.enqueueCampaignReconciliation(updated);
    }

    return updated;
  }

  async addSuccessorRule(
    predecessorRuleId: string,
    ruleData: {
      label: string;
      reward_type: 'PERCENTAGE_DISCOUNT' | 'FIXED_AMOUNT_DISCOUNT';
      reward_value: number;
      max_discount_amount?: number | null;
      voucher_validity_days?: number;
      rule_definition: CampaignRule['rule_definition'];
      effective_from?: string;
    }
  ): Promise<CampaignRule> {
    const nowIso = new Date().toISOString();
    const successor: CampaignRule = {
      id: crypto.randomUUID(),
      campaign_id: '', // Filled by repository from predecessor
      label: ruleData.label.trim(),
      version: 1, // Will be set to predecessor.version + 1
      supersedes_rule_id: predecessorRuleId,
      effective_from: ruleData.effective_from || nowIso,
      retired_at: null,
      rule_definition: ruleData.rule_definition,
      reward_type: ruleData.reward_type,
      reward_value: ruleData.reward_value,
      max_discount_amount: ruleData.max_discount_amount || null,
      voucher_validity_days: ruleData.voucher_validity_days || 30,
      created_at: nowIso,
    };

    const published = await this.repository.createSuccessorRule(predecessorRuleId, successor);

    // If the campaign is currently active, queue reconciliation for this rule at effective_from
    const campaign = await this.repository.getCampaignById(published.campaign_id);
    if (campaign && campaign.status === 'ACTIVE') {
      await this.repository.enqueueRewardWork([
        {
          id: crypto.randomUUID(),
          dedupe_key: `reconcile-rule:${published.id}:${published.version}`,
          kind: 'RECONCILE_CAMPAIGN',
          customer_id: null,
          campaign_rule_id: published.id,
          campaign_id: published.campaign_id,
          source_reservation_id: null,
          rule_ids_snapshot: [published.id],
          cursor_customer_id: null,
          evaluation_cutoff_at: published.effective_from,
          status: 'PENDING',
          attempts: 0,
          next_attempt_at: published.effective_from,
          lease_until: null,
          last_error_code: null,
          created_at: nowIso,
          completed_at: null,
        },
      ]);
    }

    return published;
  }

  // --- Automatic Triggers on Confirmation ---

  async handleBookingConfirmation(params: {
    reservationId: string;
    customerId: string;
    confirmedAt: string;
    source: 'WEB' | 'KIOSK';
    workspaceTypeId: string;
    netPaidAmount: number;
    bookedMinutes: number;
  }): Promise<{
    fact: QualifyingBookingFact;
    evaluationJobs: RewardWork[];
  }> {
    const nowIso = new Date().toISOString();

    // 1. Capture qualifying fact
    const fact: QualifyingBookingFact = {
      reservation_id: params.reservationId,
      customer_id: params.customerId,
      confirmed_at: params.confirmedAt,
      source: params.source,
      workspace_type_id: params.workspaceTypeId,
      net_paid_amount: params.netPaidAmount,
      booked_minutes: params.bookedMinutes,
      is_qualifying: true,
      created_at: nowIso,
    };
    await this.repository.insertQualifyingFact(fact);

    // 2. Find active published rules matching the event time
    const activeRules = await this.repository.getActiveRulesForEvent(params.confirmedAt);

    // 3. Enqueue evaluation work for each active rule
    const jobs: RewardWork[] = activeRules.map((rule) => ({
      id: crypto.randomUUID(),
      dedupe_key: `eval:${params.customerId}:${rule.id}:${params.reservationId}`,
      kind: 'EVALUATE_CUSTOMER',
      customer_id: params.customerId,
      campaign_rule_id: rule.id,
      campaign_id: rule.campaign_id,
      source_reservation_id: params.reservationId,
      rule_ids_snapshot: null,
      cursor_customer_id: null,
      evaluation_cutoff_at: params.confirmedAt,
      status: 'PENDING',
      attempts: 0,
      next_attempt_at: nowIso,
      lease_until: null,
      last_error_code: null,
      created_at: nowIso,
      completed_at: null,
    }));

    const enqueued = await this.repository.enqueueRewardWork(jobs);

    return {
      fact,
      evaluationJobs: enqueued,
    };
  }

  // --- Automatic Triggers on Cancellation ---

  async handleBookingCancellation(reservationId: string): Promise<boolean> {
    return this.repository.invalidateQualifyingFact(reservationId);
  }

  // --- Customer Reward Evaluator (used by worker and Am I Eligible button) ---

  async evaluateCustomerRule(params: {
    customerId: string;
    ruleId: string;
    cutoffTimeIso?: string;
  }): Promise<CustomerEvaluationResult> {
    const nowIso = new Date().toISOString();
    const cutoff = params.cutoffTimeIso || nowIso;

    const rule = await this.repository.getRuleById(params.ruleId);
    if (!rule) {
      throw new Error(`Rule not found: ${params.ruleId}`);
    }

    const campaign = await this.repository.getCampaignById(rule.campaign_id);
    if (!campaign) {
      throw new Error(`Campaign not found: ${rule.campaign_id}`);
    }

    // Load customer facts
    const facts = await this.repository.getQualifyingFactsByCustomerId(params.customerId);

    // Evaluate progress and cycles
    const { targetCycles, progress } = evaluateRuleProgress(rule, facts, cutoff);

    // Check which vouchers already exist
    const allCustomerVouchers = await this.repository.listVouchersByCustomerId(params.customerId);
    const existingVouchers = allCustomerVouchers.filter((v) => v.campaign_rule_id === rule.id);
    const existingMilestoneSet = new Set(existingVouchers.map((v) => v.milestone_index));

    const missingMilestones: number[] = [];
    for (let milestone = 1; milestone <= targetCycles; milestone++) {
      if (!existingMilestoneSet.has(milestone)) {
        missingMilestones.push(milestone);
      }
    }

    // Limit evaluation batch to at most 100 new vouchers (SPEC-2 invariant)
    const milestonesToIssue = missingMilestones.slice(0, 100);
    const newVouchersToInsert: Voucher[] = [];

    const validityMs = (rule.voucher_validity_days || 30) * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + validityMs).toISOString();

    const rewardSnapshot: VoucherRewardSnapshot = {
      reward_type: rule.reward_type,
      reward_value: rule.reward_value,
      max_discount_amount: rule.max_discount_amount,
      voucher_validity_days: rule.voucher_validity_days,
      redemption_channels: rule.rule_definition.redemption_channels,
      redemption_workspace_type_ids: rule.rule_definition.redemption_workspace_type_ids,
      minimum_booking_amount: rule.rule_definition.minimum_booking_amount,
      campaign_rule_id: rule.id,
      campaign_rule_version: rule.version,
    };

    for (const milestone of milestonesToIssue) {
      // Unbiased code generation with collision retry up to 20 attempts
      let promoCode = '';
      let attempts = 0;
      while (attempts < 20) {
        attempts++;
        const candidate = generatePromoCode();
        const collision = await this.repository.getVoucherByCode(candidate);
        if (!collision) {
          promoCode = candidate;
          break;
        }
      }

      if (!promoCode) {
        throw new Error('Promo code collision limit reached after 20 attempts');
      }

      const voucher: Voucher = {
        id: crypto.randomUUID(),
        customer_id: params.customerId,
        campaign_id: campaign.id,
        campaign_rule_id: rule.id,
        promo_code: promoCode,
        milestone_index: milestone,
        campaign_name_snapshot: campaign.name,
        reward_snapshot: rewardSnapshot,
        status: 'AVAILABLE',
        issued_at: nowIso,
        expires_at: expiresAt,
        redeemed_at: null,
        redeemed_reservation_id: null,
        redeemed_discount_amount: null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      newVouchersToInsert.push(voucher);
    }

    const insertedVouchers = await this.repository.insertVouchers(newVouchersToInsert);

    return {
      customer_id: params.customerId,
      rule_id: rule.id,
      milestone_cycles: targetCycles,
      new_vouchers_issued: insertedVouchers,
      existing_vouchers: existingVouchers,
      progress,
    };
  }

  // --- Campaign Reconciliation ---

  private async enqueueCampaignReconciliation(campaign: Campaign): Promise<void> {
    const rules = await this.repository.getRulesByCampaignId(campaign.id);
    const activeRules = rules.filter((r) => !r.retired_at);
    if (activeRules.length === 0) return;

    const nowIso = new Date().toISOString();
    let nextAttemptAt = nowIso;

    // Honor future starts_at
    if (campaign.starts_at) {
      const startTime = new Date(campaign.starts_at).getTime();
      if (startTime > Date.now()) {
        nextAttemptAt = campaign.starts_at;
      }
    }

    const work: RewardWork = {
      id: crypto.randomUUID(),
      dedupe_key: `reconcile-campaign:${campaign.id}:${campaign.revision}`,
      kind: 'RECONCILE_CAMPAIGN',
      customer_id: null,
      campaign_rule_id: null,
      campaign_id: campaign.id,
      source_reservation_id: null,
      rule_ids_snapshot: activeRules.map((r) => r.id),
      cursor_customer_id: null,
      evaluation_cutoff_at: nextAttemptAt,
      status: 'PENDING',
      attempts: 0,
      next_attempt_at: nextAttemptAt,
      lease_until: null,
      last_error_code: null,
      created_at: nowIso,
      completed_at: null,
    };

    await this.repository.enqueueRewardWork([work]);
  }

  /**
   * Process a single reconciliation job step.
   * Pages customers 100 per step and enqueues evaluation jobs.
   */
  async processReconciliationStep(work: RewardWork): Promise<boolean> {
    if (!work.campaign_id || !work.rule_ids_snapshot) {
      throw new Error('Invalid reconciliation job payload');
    }

    const pageSize = 100;
    const customerIds = await this.repository.listCustomerIdsPaged(
      pageSize,
      work.cursor_customer_id || undefined
    );

    if (customerIds.length === 0) {
      // Reconciliation complete!
      await this.repository.completeRewardWork(work.id);
      return true;
    }

    const childJobs: RewardWork[] = [];
    const nowIso = new Date().toISOString();

    for (const customerId of customerIds) {
      for (const ruleId of work.rule_ids_snapshot) {
        childJobs.push({
          id: crypto.randomUUID(),
          dedupe_key: `eval:${customerId}:${ruleId}:${work.id}`,
          kind: 'EVALUATE_CUSTOMER',
          customer_id: customerId,
          campaign_rule_id: ruleId,
          campaign_id: work.campaign_id,
          source_reservation_id: null,
          rule_ids_snapshot: null,
          cursor_customer_id: null,
          evaluation_cutoff_at: work.evaluation_cutoff_at,
          status: 'PENDING',
          attempts: 0,
          next_attempt_at: nowIso,
          lease_until: null,
          last_error_code: null,
          created_at: nowIso,
          completed_at: null,
        });
      }
    }

    await this.repository.enqueueRewardWork(childJobs);

    // Advance cursor to last customer in page
    const lastId = customerIds[customerIds.length - 1];
    work.cursor_customer_id = lastId;

    if (customerIds.length < pageSize) {
      // Reached end of customers
      await this.repository.completeRewardWork(work.id);
      return true;
    }

    return false; // More pages remain
  }

  // --- Background Worker Runner ---

  async runWorkerCycle(limit: number = 50, leaseSeconds: number = 60): Promise<{
    processed: number;
    failed: number;
  }> {
    const claimed = await this.repository.claimDueRewardWork(limit, leaseSeconds);
    let processed = 0;
    let failed = 0;

    for (const job of claimed) {
      try {
        if (job.kind === 'EVALUATE_CUSTOMER') {
          if (!job.customer_id || !job.campaign_rule_id) {
            throw new Error('Missing customer_id or campaign_rule_id on EVALUATE_CUSTOMER job');
          }
          await this.evaluateCustomerRule({
            customerId: job.customer_id,
            ruleId: job.campaign_rule_id,
            cutoffTimeIso: job.evaluation_cutoff_at,
          });
          await this.repository.completeRewardWork(job.id);
          processed++;
        } else if (job.kind === 'RECONCILE_CAMPAIGN') {
          await this.processReconciliationStep(job);
          processed++;
        }
      } catch (err: unknown) {
        failed++;
        const message = err instanceof Error ? err.message : 'Unknown evaluation error';
        await this.repository.failRewardWork(job.id, message);
      }
    }

    return { processed, failed };
  }
}
