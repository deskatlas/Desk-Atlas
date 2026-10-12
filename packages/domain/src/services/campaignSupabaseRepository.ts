import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Campaign,
  CampaignRule,
  CampaignStatus,
  QualifyingBookingFact,
  RewardWork,
  RuleDefinitionV1,
  Voucher,
  VoucherRewardSnapshot,
  VoucherStatus,
} from '../models/campaign';
import type { CampaignListFilter, CampaignRepository } from './campaignRepository';
import { calculateEffectiveVoucherStatus } from './campaignRuleEvaluator';

// SPEC-2 Traceability: PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  activated_at: string | null;
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface CampaignRuleRow {
  id: string;
  campaign_id: string;
  label: string;
  version: number;
  supersedes_rule_id: string | null;
  effective_from: string;
  retired_at: string | null;
  rule_definition: RuleDefinitionV1;
  reward_type: 'PERCENTAGE_DISCOUNT' | 'FIXED_AMOUNT_DISCOUNT';
  reward_value: number | string;
  max_discount_amount: number | string | null;
  voucher_validity_days: number;
  created_at: string;
}

interface VoucherRow {
  id: string;
  customer_id: string;
  campaign_id: string;
  campaign_rule_id: string;
  promo_code: string;
  milestone_index: number;
  campaign_name_snapshot: string;
  reward_snapshot: VoucherRewardSnapshot;
  status: 'AVAILABLE' | 'USED' | 'EXPIRED';
  issued_at: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_reservation_id: string | null;
  redeemed_discount_amount: number | string | null;
  created_at: string;
  updated_at: string;
}

interface QualifyingFactRow {
  reservation_id: string;
  customer_id: string;
  confirmed_at: string;
  source: 'WEB' | 'KIOSK';
  workspace_type_id: string;
  net_paid_amount: number | string;
  booked_minutes: number;
  is_qualifying: boolean;
  created_at: string;
}

interface RewardWorkRow {
  id: string;
  dedupe_key: string;
  kind: 'EVALUATE_CUSTOMER' | 'RECONCILE_CAMPAIGN';
  customer_id: string | null;
  campaign_rule_id: string | null;
  campaign_id: string | null;
  source_reservation_id: string | null;
  rule_ids_snapshot: string[] | null;
  cursor_customer_id: string | null;
  evaluation_cutoff_at: string;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'RETRY' | 'FAILED';
  attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  last_error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

export class CampaignSupabaseRepository implements CampaignRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // --- Campaigns ---

  async createCampaign(campaign: Campaign, rules: CampaignRule[]): Promise<Campaign> {
    const { error: cErr } = await this.supabase.from('campaigns').insert({
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      starts_at: campaign.starts_at,
      ends_at: campaign.ends_at,
      activated_at: campaign.activated_at,
      revision: campaign.revision,
      created_by: campaign.created_by,
      created_at: campaign.created_at,
      updated_at: campaign.updated_at,
    });

    if (cErr) {
      throw new Error(`Failed to insert campaign: ${cErr.message}`);
    }

    if (rules.length > 0) {
      const ruleRows = rules.map((r) => ({
        id: r.id,
        campaign_id: campaign.id,
        label: r.label,
        version: r.version,
        supersedes_rule_id: r.supersedes_rule_id,
        effective_from: r.effective_from,
        retired_at: r.retired_at,
        rule_definition: r.rule_definition,
        reward_type: r.reward_type,
        reward_value: r.reward_value,
        max_discount_amount: r.max_discount_amount,
        voucher_validity_days: r.voucher_validity_days,
        created_at: r.created_at,
      }));

      const { error: rErr } = await this.supabase.from('campaign_rules').insert(ruleRows);
      if (rErr) {
        throw new Error(`Failed to insert campaign rules: ${rErr.message}`);
      }
    }

    return (await this.getCampaignById(campaign.id)) as Campaign;
  }

  async getCampaignById(id: string): Promise<Campaign | null> {
    const { data: cData, error: cErr } = await this.supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (cErr) throw new Error(cErr.message);
    if (!cData) return null;

    const row = cData as CampaignRow;
    const rules = await this.getRulesByCampaignId(id);
    const voucher_counts = await this.getVoucherCountsByCampaignId(id);

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      activated_at: row.activated_at,
      revision: row.revision,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      rules,
      voucher_counts,
    };
  }

  async listCampaigns(filter?: CampaignListFilter): Promise<{ campaigns: Campaign[]; total: number }> {
    let query = this.supabase.from('campaigns').select('*', { count: 'exact' });

    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    if (filter?.search) {
      const term = `%${filter.search.trim()}%`;
      query = query.or(`name.ilike.${term},description.ilike.${term}`);
    }

    query = query.order('created_at', { ascending: false });

    const offset = filter?.offset || 0;
    const limit = filter?.limit || 20;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data || []) as CampaignRow[];
    const campaigns = await Promise.all(
      rows.map(async (row) => {
        const rules = await this.getRulesByCampaignId(row.id);
        const voucher_counts = await this.getVoucherCountsByCampaignId(row.id);
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          status: row.status,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          activated_at: row.activated_at,
          revision: row.revision,
          created_by: row.created_by,
          created_at: row.created_at,
          updated_at: row.updated_at,
          rules,
          voucher_counts,
        };
      })
    );

    return { campaigns, total: count || 0 };
  }

  async updateCampaign(
    id: string,
    updates: Partial<Campaign>,
    expectedRevision: number
  ): Promise<Campaign> {
    const { data, error } = await this.supabase
      .from('campaigns')
      .update({
        ...updates,
        revision: expectedRevision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('revision', expectedRevision)
      .select('*')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(`Optimistic locking conflict on campaign ${id}: revision mismatch or row not found`);
    }

    return (await this.getCampaignById(id)) as Campaign;
  }

  async deleteDraftCampaign(id: string): Promise<boolean> {
    const existing = await this.getCampaignById(id);
    if (!existing) return false;
    if (existing.status !== 'DRAFT') {
      throw new Error('Only DRAFT campaigns can be deleted');
    }
    if (existing.activated_at) {
      throw new Error('Activated campaigns cannot be deleted');
    }

    // Delete associated rules first
    await this.supabase.from('campaign_rules').delete().eq('campaign_id', id);

    const { error } = await this.supabase.from('campaigns').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  }

  async updateCampaignStatus(
    id: string,
    newStatus: CampaignStatus,
    expectedRevision: number
  ): Promise<Campaign> {
    const existing = await this.getCampaignById(id);
    if (!existing) throw new Error(`Campaign not found: ${id}`);

    const activated_at = existing.activated_at || (newStatus === 'ACTIVE' ? new Date().toISOString() : null);

    const { data, error } = await this.supabase
      .from('campaigns')
      .update({
        status: newStatus,
        activated_at,
        revision: expectedRevision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('revision', expectedRevision)
      .select('*')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(`Optimistic locking conflict on campaign ${id}: revision mismatch or row not found`);
    }

    return (await this.getCampaignById(id)) as Campaign;
  }

  // --- Rules ---

  async getRulesByCampaignId(campaignId: string): Promise<CampaignRule[]> {
    const { data, error } = await this.supabase
      .from('campaign_rules')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('version', { ascending: true });

    if (error) throw new Error(error.message);
    const rows = (data || []) as CampaignRuleRow[];
    return rows.map((r) => ({
      id: r.id,
      campaign_id: r.campaign_id,
      label: r.label,
      version: r.version,
      supersedes_rule_id: r.supersedes_rule_id,
      effective_from: r.effective_from,
      retired_at: r.retired_at,
      rule_definition: r.rule_definition,
      reward_type: r.reward_type,
      reward_value: Number(r.reward_value),
      max_discount_amount: r.max_discount_amount !== null ? Number(r.max_discount_amount) : null,
      voucher_validity_days: r.voucher_validity_days,
      created_at: r.created_at,
    }));
  }

  async getRuleById(ruleId: string): Promise<CampaignRule | null> {
    const { data, error } = await this.supabase
      .from('campaign_rules')
      .select('*')
      .eq('id', ruleId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    const r = data as CampaignRuleRow;
    return {
      id: r.id,
      campaign_id: r.campaign_id,
      label: r.label,
      version: r.version,
      supersedes_rule_id: r.supersedes_rule_id,
      effective_from: r.effective_from,
      retired_at: r.retired_at,
      rule_definition: r.rule_definition,
      reward_type: r.reward_type,
      reward_value: Number(r.reward_value),
      max_discount_amount: r.max_discount_amount !== null ? Number(r.max_discount_amount) : null,
      voucher_validity_days: r.voucher_validity_days,
      created_at: r.created_at,
    };
  }

  async getActiveRulesForEvent(eventTimeIso: string): Promise<CampaignRule[]> {
    // Select rules for ACTIVE campaigns whose windows cover eventTimeIso
    const { data, error } = await this.supabase
      .from('campaign_rules')
      .select('*, campaigns!inner(status, starts_at, ends_at)')
      .eq('campaigns.status', 'ACTIVE')
      .lte('effective_from', eventTimeIso);

    if (error) throw new Error(error.message);

    const eventTime = new Date(eventTimeIso).getTime();
    const rows = (data || []) as Array<
      CampaignRuleRow & { campaigns: { status: string; starts_at: string | null; ends_at: string | null } }
    >;

    return rows
      .filter((r) => {
        if (r.retired_at && eventTime >= new Date(r.retired_at).getTime()) return false;
        if (r.campaigns.starts_at && eventTime < new Date(r.campaigns.starts_at).getTime()) return false;
        if (r.campaigns.ends_at && eventTime >= new Date(r.campaigns.ends_at).getTime()) return false;
        return true;
      })
      .map((r) => ({
        id: r.id,
        campaign_id: r.campaign_id,
        label: r.label,
        version: r.version,
        supersedes_rule_id: r.supersedes_rule_id,
        effective_from: r.effective_from,
        retired_at: r.retired_at,
        rule_definition: r.rule_definition,
        reward_type: r.reward_type,
        reward_value: Number(r.reward_value),
        max_discount_amount: r.max_discount_amount !== null ? Number(r.max_discount_amount) : null,
        voucher_validity_days: r.voucher_validity_days,
        created_at: r.created_at,
      }));
  }

  async createSuccessorRule(predecessorRuleId: string, successorRule: CampaignRule): Promise<CampaignRule> {
    const pred = await this.getRuleById(predecessorRuleId);
    if (!pred) throw new Error(`Predecessor rule not found: ${predecessorRuleId}`);

    const nowIso = new Date().toISOString();

    // Retire predecessor if not retired
    if (!pred.retired_at) {
      await this.supabase
        .from('campaign_rules')
        .update({ retired_at: nowIso })
        .eq('id', predecessorRuleId);
    }

    const { error: insErr } = await this.supabase.from('campaign_rules').insert({
      id: successorRule.id,
      campaign_id: pred.campaign_id,
      label: successorRule.label,
      version: pred.version + 1,
      supersedes_rule_id: pred.id,
      effective_from: successorRule.effective_from || nowIso,
      retired_at: null,
      rule_definition: successorRule.rule_definition,
      reward_type: successorRule.reward_type,
      reward_value: successorRule.reward_value,
      max_discount_amount: successorRule.max_discount_amount,
      voucher_validity_days: successorRule.voucher_validity_days,
      created_at: nowIso,
    });

    if (insErr) throw new Error(insErr.message);

    return (await this.getRuleById(successorRule.id)) as CampaignRule;
  }

  // --- Vouchers ---

  async listVouchersByCustomerId(customerId: string): Promise<Voucher[]> {
    const { data, error } = await this.supabase
      .from('vouchers')
      .select('*')
      .eq('customer_id', customerId)
      .order('issued_at', { ascending: false });

    if (error) throw new Error(error.message);
    const rows = (data || []) as VoucherRow[];
    return rows.map((v) => ({
      id: v.id,
      customer_id: v.customer_id,
      campaign_id: v.campaign_id,
      campaign_rule_id: v.campaign_rule_id,
      promo_code: v.promo_code,
      milestone_index: v.milestone_index,
      campaign_name_snapshot: v.campaign_name_snapshot,
      reward_snapshot: v.reward_snapshot,
      status: calculateEffectiveVoucherStatus(v),
      issued_at: v.issued_at,
      expires_at: v.expires_at,
      redeemed_at: v.redeemed_at,
      redeemed_reservation_id: v.redeemed_reservation_id,
      redeemed_discount_amount: v.redeemed_discount_amount !== null ? Number(v.redeemed_discount_amount) : null,
      created_at: v.created_at,
      updated_at: v.updated_at,
    }));
  }

  async getVoucherById(voucherId: string): Promise<Voucher | null> {
    const { data, error } = await this.supabase
      .from('vouchers')
      .select('*')
      .eq('id', voucherId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    const v = data as VoucherRow;
    return {
      id: v.id,
      customer_id: v.customer_id,
      campaign_id: v.campaign_id,
      campaign_rule_id: v.campaign_rule_id,
      promo_code: v.promo_code,
      milestone_index: v.milestone_index,
      campaign_name_snapshot: v.campaign_name_snapshot,
      reward_snapshot: v.reward_snapshot,
      status: calculateEffectiveVoucherStatus(v),
      issued_at: v.issued_at,
      expires_at: v.expires_at,
      redeemed_at: v.redeemed_at,
      redeemed_reservation_id: v.redeemed_reservation_id,
      redeemed_discount_amount: v.redeemed_discount_amount !== null ? Number(v.redeemed_discount_amount) : null,
      created_at: v.created_at,
      updated_at: v.updated_at,
    };
  }

  async getVoucherByCode(promoCode: string): Promise<Voucher | null> {
    const { data, error } = await this.supabase
      .from('vouchers')
      .select('*')
      .eq('promo_code', promoCode.trim().toUpperCase())
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    const v = data as VoucherRow;
    return {
      id: v.id,
      customer_id: v.customer_id,
      campaign_id: v.campaign_id,
      campaign_rule_id: v.campaign_rule_id,
      promo_code: v.promo_code,
      milestone_index: v.milestone_index,
      campaign_name_snapshot: v.campaign_name_snapshot,
      reward_snapshot: v.reward_snapshot,
      status: calculateEffectiveVoucherStatus(v),
      issued_at: v.issued_at,
      expires_at: v.expires_at,
      redeemed_at: v.redeemed_at,
      redeemed_reservation_id: v.redeemed_reservation_id,
      redeemed_discount_amount: v.redeemed_discount_amount !== null ? Number(v.redeemed_discount_amount) : null,
      created_at: v.created_at,
      updated_at: v.updated_at,
    };
  }

  async findExistingVoucherByMilestone(
    customerId: string,
    ruleId: string,
    milestoneIndex: number
  ): Promise<Voucher | null> {
    const { data, error } = await this.supabase
      .from('vouchers')
      .select('*')
      .eq('customer_id', customerId)
      .eq('campaign_rule_id', ruleId)
      .eq('milestone_index', milestoneIndex)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    const v = data as VoucherRow;
    return {
      id: v.id,
      customer_id: v.customer_id,
      campaign_id: v.campaign_id,
      campaign_rule_id: v.campaign_rule_id,
      promo_code: v.promo_code,
      milestone_index: v.milestone_index,
      campaign_name_snapshot: v.campaign_name_snapshot,
      reward_snapshot: v.reward_snapshot,
      status: calculateEffectiveVoucherStatus(v),
      issued_at: v.issued_at,
      expires_at: v.expires_at,
      redeemed_at: v.redeemed_at,
      redeemed_reservation_id: v.redeemed_reservation_id,
      redeemed_discount_amount: v.redeemed_discount_amount !== null ? Number(v.redeemed_discount_amount) : null,
      created_at: v.created_at,
      updated_at: v.updated_at,
    };
  }

  async insertVouchers(vouchers: Voucher[]): Promise<Voucher[]> {
    if (vouchers.length === 0) return [];
    const rows = vouchers.map((v) => ({
      id: v.id,
      customer_id: v.customer_id,
      campaign_id: v.campaign_id,
      campaign_rule_id: v.campaign_rule_id,
      promo_code: v.promo_code,
      milestone_index: v.milestone_index,
      campaign_name_snapshot: v.campaign_name_snapshot,
      reward_snapshot: v.reward_snapshot,
      status: v.status,
      issued_at: v.issued_at,
      expires_at: v.expires_at,
      redeemed_at: v.redeemed_at,
      redeemed_reservation_id: v.redeemed_reservation_id,
      redeemed_discount_amount: v.redeemed_discount_amount,
      created_at: v.created_at,
      updated_at: v.updated_at,
    }));

    const { error } = await this.supabase.from('vouchers').insert(rows);
    if (error) throw new Error(error.message);

    return vouchers;
  }

  async redeemVoucher(
    voucherId: string,
    reservationId: string,
    discountAmount: number,
    nowIso?: string
  ): Promise<Voucher> {
    const timestamp = nowIso || new Date().toISOString();
    const { data, error } = await this.supabase
      .from('vouchers')
      .update({
        status: 'USED',
        redeemed_at: timestamp,
        redeemed_reservation_id: reservationId,
        redeemed_discount_amount: discountAmount,
        updated_at: timestamp,
      })
      .eq('id', voucherId)
      .eq('status', 'AVAILABLE')
      .is('redeemed_at', null)
      .select('*')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(`Voucher ${voucherId} could not be redeemed (already used or concurrent conflict)`);
    }

    const v = data as VoucherRow;
    return {
      id: v.id,
      customer_id: v.customer_id,
      campaign_id: v.campaign_id,
      campaign_rule_id: v.campaign_rule_id,
      promo_code: v.promo_code,
      milestone_index: v.milestone_index,
      campaign_name_snapshot: v.campaign_name_snapshot,
      reward_snapshot: v.reward_snapshot,
      status: 'USED',
      issued_at: v.issued_at,
      expires_at: v.expires_at,
      redeemed_at: v.redeemed_at,
      redeemed_reservation_id: v.redeemed_reservation_id,
      redeemed_discount_amount: v.redeemed_discount_amount !== null ? Number(v.redeemed_discount_amount) : null,
      created_at: v.created_at,
      updated_at: v.updated_at,
    };
  }

  async getVoucherCountsByCampaignId(campaignId: string): Promise<{ issued: number; used: number; expired: number }> {
    const { data, error } = await this.supabase
      .from('vouchers')
      .select('status, expires_at, redeemed_at')
      .eq('campaign_id', campaignId);

    if (error) throw new Error(error.message);
    const rows = (data || []) as Array<{ status: VoucherStatus; expires_at: string; redeemed_at: string | null; pending_reservation_id?: string | null }>;

    let issued = 0;
    let used = 0;
    let expired = 0;

    for (const r of rows) {
      issued++;
      const eff = calculateEffectiveVoucherStatus(r);
      if (eff === 'USED') used++;
      else if (eff === 'EXPIRED') expired++;
    }

    return { issued, used, expired };
  }

  // --- Qualifying Booking Facts ---

  async insertQualifyingFact(fact: QualifyingBookingFact): Promise<QualifyingBookingFact> {
    const { error } = await this.supabase.from('qualifying_booking_facts').insert({
      reservation_id: fact.reservation_id,
      customer_id: fact.customer_id,
      confirmed_at: fact.confirmed_at,
      source: fact.source,
      workspace_type_id: fact.workspace_type_id,
      net_paid_amount: fact.net_paid_amount,
      booked_minutes: fact.booked_minutes,
      is_qualifying: fact.is_qualifying,
      created_at: fact.created_at,
    });

    if (error) throw new Error(error.message);
    return fact;
  }

  async getQualifyingFactsByCustomerId(customerId: string): Promise<QualifyingBookingFact[]> {
    const { data, error } = await this.supabase
      .from('qualifying_booking_facts')
      .select('*')
      .eq('customer_id', customerId)
      .order('confirmed_at', { ascending: true });

    if (error) throw new Error(error.message);
    const rows = (data || []) as QualifyingFactRow[];
    return rows.map((f) => ({
      reservation_id: f.reservation_id,
      customer_id: f.customer_id,
      confirmed_at: f.confirmed_at,
      source: f.source,
      workspace_type_id: f.workspace_type_id,
      net_paid_amount: Number(f.net_paid_amount),
      booked_minutes: f.booked_minutes,
      is_qualifying: f.is_qualifying,
      created_at: f.created_at,
    }));
  }

  async invalidateQualifyingFact(reservationId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('qualifying_booking_facts')
      .update({ is_qualifying: false })
      .eq('reservation_id', reservationId);

    if (error) throw new Error(error.message);
    return true;
  }

  // --- Reward Work ---

  async enqueueRewardWork(work: RewardWork[]): Promise<RewardWork[]> {
    if (work.length === 0) return [];
    const rows = work.map((w) => ({
      id: w.id,
      dedupe_key: w.dedupe_key,
      kind: w.kind,
      customer_id: w.customer_id,
      campaign_rule_id: w.campaign_rule_id,
      campaign_id: w.campaign_id,
      source_reservation_id: w.source_reservation_id,
      rule_ids_snapshot: w.rule_ids_snapshot,
      cursor_customer_id: w.cursor_customer_id,
      evaluation_cutoff_at: w.evaluation_cutoff_at,
      status: w.status,
      attempts: w.attempts,
      next_attempt_at: w.next_attempt_at,
      lease_until: w.lease_until,
      last_error_code: w.last_error_code,
      created_at: w.created_at,
      completed_at: w.completed_at,
    }));

    // Use ignoreDuplicates on dedupe_key conflict
    const { error } = await this.supabase
      .from('reward_work')
      .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });

    if (error) throw new Error(error.message);
    return work;
  }

  async claimDueRewardWork(limit: number, leaseSeconds: number): Promise<RewardWork[]> {
    const nowIso = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();

    // Query pending/retry work that is due
    const { data, error } = await this.supabase
      .from('reward_work')
      .select('*')
      .or(`status.eq.PENDING,status.eq.RETRY,and(status.eq.PROCESSING,lease_until.lte.${nowIso})`)
      .lte('next_attempt_at', nowIso)
      .order('next_attempt_at', { ascending: true })
      .limit(limit);

    if (error) throw new Error(error.message);
    const rows = (data || []) as RewardWorkRow[];

    const claimed: RewardWork[] = [];
    for (const r of rows) {
      const { error: uErr } = await this.supabase
        .from('reward_work')
        .update({
          status: 'PROCESSING',
          attempts: r.attempts + 1,
          lease_until: leaseUntil,
        })
        .eq('id', r.id);

      if (!uErr) {
        claimed.push({
          id: r.id,
          dedupe_key: r.dedupe_key,
          kind: r.kind,
          customer_id: r.customer_id,
          campaign_rule_id: r.campaign_rule_id,
          campaign_id: r.campaign_id,
          source_reservation_id: r.source_reservation_id,
          rule_ids_snapshot: r.rule_ids_snapshot,
          cursor_customer_id: r.cursor_customer_id,
          evaluation_cutoff_at: r.evaluation_cutoff_at,
          status: 'PROCESSING',
          attempts: r.attempts + 1,
          next_attempt_at: r.next_attempt_at,
          lease_until: leaseUntil,
          last_error_code: r.last_error_code,
          created_at: r.created_at,
          completed_at: r.completed_at,
        });
      }
    }

    return claimed;
  }

  async completeRewardWork(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('reward_work')
      .update({
        status: 'DONE',
        completed_at: new Date().toISOString(),
        lease_until: null,
      })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async failRewardWork(id: string, errorCode: string): Promise<void> {
    const { data } = await this.supabase
      .from('reward_work')
      .select('attempts')
      .eq('id', id)
      .maybeSingle();

    const attempts = data?.attempts || 1;
    const isTerminal = attempts >= 5;
    const delays = [60, 300, 900, 3600];
    const delaySeconds = delays[Math.min(attempts - 1, delays.length - 1)];

    const { error } = await this.supabase
      .from('reward_work')
      .update({
        status: isTerminal ? 'FAILED' : 'RETRY',
        last_error_code: errorCode,
        next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        lease_until: null,
      })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async listCustomerIdsPaged(limit: number, afterId?: string): Promise<string[]> {
    let query = this.supabase
      .from('customers')
      .select('id')
      .order('id', { ascending: true })
      .limit(limit);

    if (afterId) {
      query = query.gt('id', afterId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []).map((row: { id: string }) => row.id);
  }
}
