import type {
  Campaign,
  CampaignRule,
  CampaignStatus,
  QualifyingBookingFact,
  RewardWork,
  Voucher,
} from '../models/campaign';
import type { CampaignListFilter, CampaignRepository } from './campaignRepository';
import { calculateEffectiveVoucherStatus } from './campaignRuleEvaluator';

// SPEC-2 Traceability: PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37

export class CampaignMemoryRepository implements CampaignRepository {
  private campaigns: Map<string, Campaign> = new Map();
  private campaignRules: Map<string, CampaignRule> = new Map();
  private vouchers: Map<string, Voucher> = new Map();
  private qualifyingFacts: Map<string, QualifyingBookingFact> = new Map();
  private rewardWork: Map<string, RewardWork> = new Map();
  private customerIds: Set<string> = new Set();

  constructor() {}

  // Helper for test population
  public registerCustomerId(customerId: string): void {
    this.customerIds.add(customerId);
  }

  // --- Campaigns ---

  async createCampaign(campaign: Campaign, rules: CampaignRule[]): Promise<Campaign> {
    if (this.campaigns.has(campaign.id)) {
      throw new Error(`Campaign with id ${campaign.id} already exists`);
    }
    const storedCampaign: Campaign = {
      ...campaign,
      revision: 1,
      created_at: campaign.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.campaigns.set(storedCampaign.id, storedCampaign);

    for (const rule of rules) {
      const storedRule: CampaignRule = {
        ...rule,
        campaign_id: storedCampaign.id,
        created_at: rule.created_at || new Date().toISOString(),
      };
      this.campaignRules.set(storedRule.id, storedRule);
    }

    return {
      ...storedCampaign,
      rules: await this.getRulesByCampaignId(storedCampaign.id),
      voucher_counts: { issued: 0, used: 0, expired: 0 },
    };
  }

  async getCampaignById(id: string): Promise<Campaign | null> {
    const campaign = this.campaigns.get(id);
    if (!campaign) return null;
    const rules = await this.getRulesByCampaignId(id);
    const voucher_counts = await this.getVoucherCountsByCampaignId(id);
    return {
      ...campaign,
      rules,
      voucher_counts,
    };
  }

  async listCampaigns(filter?: CampaignListFilter): Promise<{ campaigns: Campaign[]; total: number }> {
    let list = Array.from(this.campaigns.values());

    if (filter?.status) {
      list = list.filter((c) => c.status === filter.status);
    }

    if (filter?.search) {
      const q = filter.search.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q))
      );
    }

    // Sort by created_at DESC
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const total = list.length;
    const offset = filter?.offset || 0;
    const limit = filter?.limit || 20;
    const paged = list.slice(offset, offset + limit);

    const campaignsWithDetails = await Promise.all(
      paged.map(async (c) => ({
        ...c,
        rules: await this.getRulesByCampaignId(c.id),
        voucher_counts: await this.getVoucherCountsByCampaignId(c.id),
      }))
    );

    return { campaigns: campaignsWithDetails, total };
  }

  async updateCampaign(
    id: string,
    updates: Partial<Campaign>,
    expectedRevision: number
  ): Promise<Campaign> {
    const existing = this.campaigns.get(id);
    if (!existing) {
      throw new Error(`Campaign not found: ${id}`);
    }
    if (existing.revision !== expectedRevision) {
      throw new Error(`Optimistic locking conflict: expected revision ${expectedRevision}, got ${existing.revision}`);
    }

    const updated: Campaign = {
      ...existing,
      ...updates,
      id: existing.id,
      revision: existing.revision + 1,
      updated_at: new Date().toISOString(),
    };
    this.campaigns.set(id, updated);
    return this.getCampaignById(id) as Promise<Campaign>;
  }

  async deleteDraftCampaign(id: string): Promise<boolean> {
    const existing = this.campaigns.get(id);
    if (!existing) return false;
    if (existing.status !== 'DRAFT') {
      throw new Error('Only DRAFT campaigns can be deleted');
    }
    if (existing.activated_at) {
      throw new Error('Activated campaigns cannot be deleted');
    }

    // Check if any vouchers exist
    const voucherCount = Array.from(this.vouchers.values()).filter((v) => v.campaign_id === id).length;
    if (voucherCount > 0) {
      throw new Error('Campaign with issued vouchers cannot be deleted');
    }

    // Check if any reward work exists
    const workCount = Array.from(this.rewardWork.values()).filter((w) => w.campaign_id === id).length;
    if (workCount > 0) {
      throw new Error('Campaign with reward work cannot be deleted');
    }

    // Delete associated rules
    for (const [rId, rule] of this.campaignRules.entries()) {
      if (rule.campaign_id === id) {
        this.campaignRules.delete(rId);
      }
    }

    return this.campaigns.delete(id);
  }

  async updateCampaignStatus(
    id: string,
    newStatus: CampaignStatus,
    expectedRevision: number
  ): Promise<Campaign> {
    const existing = this.campaigns.get(id);
    if (!existing) {
      throw new Error(`Campaign not found: ${id}`);
    }
    if (existing.revision !== expectedRevision) {
      throw new Error(`Optimistic locking conflict: expected revision ${expectedRevision}, got ${existing.revision}`);
    }

    // Validate lifecycle transitions
    if (existing.status === 'ARCHIVED') {
      throw new Error('ARCHIVED status is terminal');
    }

    if (newStatus === 'ACTIVE') {
      if (existing.status !== 'DRAFT' && existing.status !== 'PAUSED') {
        throw new Error(`Invalid transition from ${existing.status} to ACTIVE`);
      }
      const rules = await this.getRulesByCampaignId(id);
      if (rules.length === 0) {
        throw new Error('Campaign must have at least one valid rule before activation');
      }
    } else if (newStatus === 'PAUSED') {
      if (existing.status !== 'ACTIVE') {
        throw new Error(`Invalid transition from ${existing.status} to PAUSED`);
      }
    }

    const activated_at = existing.activated_at || (newStatus === 'ACTIVE' ? new Date().toISOString() : null);

    const updated: Campaign = {
      ...existing,
      status: newStatus,
      activated_at,
      revision: existing.revision + 1,
      updated_at: new Date().toISOString(),
    };
    this.campaigns.set(id, updated);
    return this.getCampaignById(id) as Promise<Campaign>;
  }

  // --- Rules ---

  async getRulesByCampaignId(campaignId: string): Promise<CampaignRule[]> {
    return Array.from(this.campaignRules.values())
      .filter((r) => r.campaign_id === campaignId)
      .sort((a, b) => a.version - b.version);
  }

  async getRuleById(ruleId: string): Promise<CampaignRule | null> {
    return this.campaignRules.get(ruleId) || null;
  }

  async getActiveRulesForEvent(eventTimeIso: string): Promise<CampaignRule[]> {
    const eventTime = new Date(eventTimeIso).getTime();
    const activeRules: CampaignRule[] = [];

    for (const rule of this.campaignRules.values()) {
      const campaign = this.campaigns.get(rule.campaign_id);
      if (!campaign || campaign.status !== 'ACTIVE') continue;

      // Check campaign window
      if (campaign.starts_at && eventTime < new Date(campaign.starts_at).getTime()) continue;
      if (campaign.ends_at && eventTime >= new Date(campaign.ends_at).getTime()) continue;

      // Check rule window
      if (eventTime < new Date(rule.effective_from).getTime()) continue;
      if (rule.retired_at && eventTime >= new Date(rule.retired_at).getTime()) continue;

      activeRules.push(rule);
    }

    return activeRules;
  }

  async createSuccessorRule(predecessorRuleId: string, successorRule: CampaignRule): Promise<CampaignRule> {
    const pred = this.campaignRules.get(predecessorRuleId);
    if (!pred) {
      throw new Error(`Predecessor rule not found: ${predecessorRuleId}`);
    }

    const nowIso = new Date().toISOString();

    // Retire predecessor if not already retired
    if (!pred.retired_at) {
      pred.retired_at = nowIso;
      this.campaignRules.set(pred.id, pred);
    }

    const storedSuccessor: CampaignRule = {
      ...successorRule,
      campaign_id: pred.campaign_id,
      version: pred.version + 1,
      supersedes_rule_id: pred.id,
      effective_from: successorRule.effective_from || nowIso,
      created_at: nowIso,
    };
    this.campaignRules.set(storedSuccessor.id, storedSuccessor);
    return storedSuccessor;
  }

  // --- Vouchers ---

  async listVouchersByCustomerId(customerId: string): Promise<Voucher[]> {
    const list = Array.from(this.vouchers.values()).filter((v) => v.customer_id === customerId);
    return list.map((v) => ({
      ...v,
      status: calculateEffectiveVoucherStatus(v),
    })).sort((a, b) => new Date(b.issued_at).getTime() - new Date(a.issued_at).getTime());
  }

  async getVoucherById(voucherId: string): Promise<Voucher | null> {
    const v = this.vouchers.get(voucherId);
    if (!v) return null;
    return {
      ...v,
      status: calculateEffectiveVoucherStatus(v),
    };
  }

  async getVoucherByCode(promoCode: string): Promise<Voucher | null> {
    const codeUpper = promoCode.trim().toUpperCase();
    for (const v of this.vouchers.values()) {
      if (v.promo_code.toUpperCase() === codeUpper) {
        return {
          ...v,
          status: calculateEffectiveVoucherStatus(v),
        };
      }
    }
    return null;
  }

  async findExistingVoucherByMilestone(
    customerId: string,
    ruleId: string,
    milestoneIndex: number
  ): Promise<Voucher | null> {
    for (const v of this.vouchers.values()) {
      if (
        v.customer_id === customerId &&
        v.campaign_rule_id === ruleId &&
        v.milestone_index === milestoneIndex
      ) {
        return {
          ...v,
          status: calculateEffectiveVoucherStatus(v),
        };
      }
    }
    return null;
  }

  async insertVouchers(vouchers: Voucher[]): Promise<Voucher[]> {
    const inserted: Voucher[] = [];
    for (const v of vouchers) {
      // Check milestone unique constraint (customer_id, campaign_rule_id, milestone_index)
      const existing = await this.findExistingVoucherByMilestone(
        v.customer_id,
        v.campaign_rule_id,
        v.milestone_index
      );
      if (existing) {
        inserted.push(existing);
        continue;
      }

      // Check code collision
      if (await this.getVoucherByCode(v.promo_code)) {
        throw new Error(`Promo code collision for code: ${v.promo_code}`);
      }

      this.vouchers.set(v.id, v);
      inserted.push(v);
    }
    return inserted;
  }

  async redeemVoucher(
    voucherId: string,
    reservationId: string,
    discountAmount: number,
    nowIso?: string
  ): Promise<Voucher> {
    const v = this.vouchers.get(voucherId);
    if (!v) {
      throw new Error(`Voucher not found: ${voucherId}`);
    }

    const effectiveStatus = calculateEffectiveVoucherStatus(v, nowIso);
    if (effectiveStatus !== 'AVAILABLE') {
      throw new Error(`Voucher is not AVAILABLE (current status: ${effectiveStatus})`);
    }

    // Check if reservation already has a voucher redeemed
    for (const other of this.vouchers.values()) {
      if (other.redeemed_reservation_id === reservationId) {
        throw new Error(`Reservation ${reservationId} already has a redeemed voucher`);
      }
    }

    const timestamp = nowIso || new Date().toISOString();
    const updated: Voucher = {
      ...v,
      status: 'USED',
      redeemed_at: timestamp,
      redeemed_reservation_id: reservationId,
      redeemed_discount_amount: discountAmount,
      updated_at: timestamp,
    };
    this.vouchers.set(voucherId, updated);
    return updated;
  }

  async getVoucherCountsByCampaignId(campaignId: string): Promise<{ issued: number; used: number; expired: number }> {
    let issued = 0;
    let used = 0;
    let expired = 0;

    for (const v of this.vouchers.values()) {
      if (v.campaign_id === campaignId) {
        issued++;
        const eff = calculateEffectiveVoucherStatus(v);
        if (eff === 'USED') used++;
        else if (eff === 'EXPIRED') expired++;
      }
    }

    return { issued, used, expired };
  }

  // --- Qualifying Booking Facts ---

  async insertQualifyingFact(fact: QualifyingBookingFact): Promise<QualifyingBookingFact> {
    this.customerIds.add(fact.customer_id);
    this.qualifyingFacts.set(fact.reservation_id, fact);
    return fact;
  }

  async getQualifyingFactsByCustomerId(customerId: string): Promise<QualifyingBookingFact[]> {
    return Array.from(this.qualifyingFacts.values())
      .filter((f) => f.customer_id === customerId)
      .sort((a, b) => new Date(a.confirmed_at).getTime() - new Date(b.confirmed_at).getTime());
  }

  async invalidateQualifyingFact(reservationId: string): Promise<boolean> {
    const fact = this.qualifyingFacts.get(reservationId);
    if (!fact) return false;
    fact.is_qualifying = false;
    this.qualifyingFacts.set(reservationId, fact);
    return true;
  }

  // --- Reward Work ---

  async enqueueRewardWork(work: RewardWork[]): Promise<RewardWork[]> {
    const enqueued: RewardWork[] = [];
    for (const item of work) {
      // Check dedupe_key uniqueness
      let exists = false;
      for (const w of this.rewardWork.values()) {
        if (w.dedupe_key === item.dedupe_key) {
          exists = true;
          enqueued.push(w);
          break;
        }
      }
      if (!exists) {
        this.rewardWork.set(item.id, item);
        enqueued.push(item);
      }
    }
    return enqueued;
  }

  async claimDueRewardWork(limit: number, leaseSeconds: number): Promise<RewardWork[]> {
    const now = Date.now();
    const claimed: RewardWork[] = [];

    for (const work of this.rewardWork.values()) {
      if (claimed.length >= limit) break;

      const isDue =
        (work.status === 'PENDING' || work.status === 'RETRY') &&
        new Date(work.next_attempt_at).getTime() <= now;

      const isExpiredLease =
        work.status === 'PROCESSING' &&
        work.lease_until !== null &&
        new Date(work.lease_until).getTime() <= now;

      if (isDue || isExpiredLease) {
        work.status = 'PROCESSING';
        work.attempts += 1;
        work.lease_until = new Date(now + leaseSeconds * 1000).toISOString();
        this.rewardWork.set(work.id, work);
        claimed.push({ ...work });
      }
    }

    return claimed;
  }

  async completeRewardWork(id: string): Promise<void> {
    const work = this.rewardWork.get(id);
    if (work) {
      work.status = 'DONE';
      work.completed_at = new Date().toISOString();
      work.lease_until = null;
      this.rewardWork.set(id, work);
    }
  }

  async failRewardWork(id: string, errorCode: string): Promise<void> {
    const work = this.rewardWork.get(id);
    if (work) {
      if (work.attempts >= 5) {
        work.status = 'FAILED';
      } else {
        work.status = 'RETRY';
        // Exponential backoff: 1 min, 5 min, 15 min, 60 min
        const delays = [60, 300, 900, 3600];
        const delaySeconds = delays[Math.min(work.attempts - 1, delays.length - 1)];
        work.next_attempt_at = new Date(Date.now() + delaySeconds * 1000).toISOString();
      }
      work.last_error_code = errorCode;
      work.lease_until = null;
      this.rewardWork.set(id, work);
    }
  }

  setRewardWorkLease(id: string, leaseUntil: string | null): void {
    const work = this.rewardWork.get(id);
    if (work) {
      work.lease_until = leaseUntil;
      this.rewardWork.set(id, work);
    }
  }

  // --- Customer IDs for reconciliation ---

  async listCustomerIdsPaged(limit: number, afterId?: string): Promise<string[]> {
    const sorted = Array.from(this.customerIds).sort();
    let filtered = sorted;
    if (afterId) {
      filtered = sorted.filter((id) => id > afterId);
    }
    return filtered.slice(0, limit);
  }
}
