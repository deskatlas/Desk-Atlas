/**
 * Supabase PostgreSQL Voucher, Campaign, and Qualifying Booking Fact Repository
 * Traceability: MS-36, SPEC-2, SPEC-3, PRD-F23, PRD-F24, SDD-C14, SDD-C15, ERD-E16 through ERD-E20, QAD-TC36
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import type { Campaign, CampaignRule } from '../models/campaign';
import type {
  NotificationOutboxItem,
  QualifyingBookingFact,
  Voucher,
  VoucherRewardSnapshot,
  VoucherStatus,
} from '../models/voucher';
import type { VoucherRepository } from './voucherRepository';

export interface VoucherSupabaseConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
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

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
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
  rule_definition: unknown;
  reward_type: 'PERCENTAGE_DISCOUNT' | 'FIXED_AMOUNT_DISCOUNT';
  reward_value: number | string;
  max_discount_amount: number | string | null;
  voucher_validity_days: number;
  created_at: string;
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

interface ReservationCandidateQueryItem {
  rank: number;
  is_assigned: boolean;
  start_at: string;
  end_at: string;
  workspace_instances: { template_id?: string | null } | Array<{ template_id?: string | null }> | null;
}

interface ReservationHistoryQueryRow {
  id: string;
  source: 'WEB' | 'KIOSK';
  amount_due: number | string | null;
  confirmed_at: string | null;
  status: string;
  reservation_candidates?: ReservationCandidateQueryItem[] | null;
}

interface OutboxRow {
  id: string;
  dedupe_key: string;
  kind: string;
  customer_id: string | null;
  reservation_id: string | null;
  voucher_id: string | null;
  recipient_email: string;
  payload: Record<string, unknown>;
  depends_on_id: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  created_at: string;
  sent_at: string | null;
}

function isVoucherSupabaseConfig(item: unknown): item is VoucherSupabaseConfig {
  return (
    typeof item === 'object' &&
    item !== null &&
    'supabaseUrl' in item &&
    typeof (item as VoucherSupabaseConfig).supabaseUrl === 'string'
  );
}

export class VoucherSupabaseRepository implements VoucherRepository {
  private readonly supabase: SupabaseClient;

  constructor(clientOrConfig: SupabaseClient | VoucherSupabaseConfig) {
    if (isVoucherSupabaseConfig(clientOrConfig)) {
      this.supabase = createClient(
        clientOrConfig.supabaseUrl.replace(/\/$/, ''),
        clientOrConfig.serviceRoleKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );
    } else {
      this.supabase = clientOrConfig;
    }
  }

  // --- Vouchers ---

  async findVoucherByCode(promoCode: string): Promise<Voucher | null> {
    const normalized = promoCode.trim().toUpperCase();
    const { data, error } = await this.supabase
      .from('vouchers')
      .select('*')
      .eq('promo_code', normalized)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find voucher by code: ${error.message}`);
    }
    if (!data) return null;

    return this.mapVoucher(data as VoucherRow);
  }

  async findVouchersByCustomerId(customerId: string, status?: VoucherStatus): Promise<Voucher[]> {
    const { data, error } = await this.supabase
      .from('vouchers')
      .select('*')
      .eq('customer_id', customerId)
      .order('issued_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list vouchers for customer: ${error.message}`);
    }

    const rows = (data || []) as VoucherRow[];
    const vouchers = rows.map((r) => this.mapVoucher(r));

    if (status) {
      return vouchers.filter((v) => v.status === status);
    }
    return vouchers;
  }

  async findVoucherById(id: string): Promise<Voucher | null> {
    const { data, error } = await this.supabase
      .from('vouchers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find voucher by id: ${error.message}`);
    }
    if (!data) return null;

    return this.mapVoucher(data as VoucherRow);
  }

  async createVoucher(data: Omit<Voucher, 'id' | 'createdAt' | 'updatedAt'>): Promise<Voucher> {
    const customer_id = data.customerId || data.customer_id;
    const campaign_id = data.campaignId || data.campaign_id;
    const campaign_rule_id = data.campaignRuleId || data.campaign_rule_id;
    const promo_code = data.promoCode || data.promo_code;
    const milestone_index = data.milestoneIndex ?? data.milestone_index ?? 1;
    const campaign_name_snapshot = data.campaignNameSnapshot || data.campaign_name_snapshot || '';
    const reward_snapshot = data.rewardSnapshot || data.reward_snapshot || {};
    const status = data.status || 'AVAILABLE';
    const issued_at = data.issuedAt || data.issued_at || new Date().toISOString();
    const expires_at = data.expiresAt || data.expires_at || new Date(Date.now() + 30 * 86400000).toISOString();

    const insertPayload = {
      customer_id,
      campaign_id,
      campaign_rule_id,
      promo_code,
      milestone_index,
      campaign_name_snapshot,
      reward_snapshot,
      status,
      issued_at,
      expires_at,
      redeemed_at: data.redeemedAt || data.redeemed_at || null,
      redeemed_reservation_id: data.redeemedReservationId || data.redeemed_reservation_id || null,
      redeemed_discount_amount: data.redeemedDiscountAmount ?? data.redeemed_discount_amount ?? null,
    };

    const { data: row, error } = await this.supabase
      .from('vouchers')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create voucher: ${error.message}`);
    }

    return this.mapVoucher(row as VoucherRow);
  }

  async updateVoucher(id: string, updates: Partial<Voucher>): Promise<Voucher> {
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.status !== undefined) updatePayload.status = updates.status;
    if (updates.redeemedAt !== undefined || updates.redeemed_at !== undefined) {
      updatePayload.redeemed_at = updates.redeemedAt || updates.redeemed_at || null;
    }
    if (updates.redeemedReservationId !== undefined || updates.redeemed_reservation_id !== undefined) {
      updatePayload.redeemed_reservation_id = updates.redeemedReservationId || updates.redeemed_reservation_id || null;
    }
    if (updates.redeemedDiscountAmount !== undefined || updates.redeemed_discount_amount !== undefined) {
      updatePayload.redeemed_discount_amount = updates.redeemedDiscountAmount ?? updates.redeemed_discount_amount ?? null;
    }

    const { data: row, error } = await this.supabase
      .from('vouchers')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to update voucher ${id}: ${error.message}`);
    }

    return this.mapVoucher(row as VoucherRow);
  }

  async redeemVoucher(
    voucherId: string,
    reservationId: string,
    discountAmount: number,
    redeemedAt?: string
  ): Promise<Voucher> {
    const timestamp = redeemedAt || new Date().toISOString();
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

    if (error) {
      throw new Error(`Failed to redeem voucher ${voucherId}: ${error.message}`);
    }
    if (!data) {
      throw new Error(`Voucher ${voucherId} could not be redeemed (already used or concurrent conflict)`);
    }

    return this.mapVoucher(data as VoucherRow);
  }

  // --- Campaigns and Rules ---

  async listActiveCampaigns(now: Date = new Date()): Promise<Campaign[]> {
    const { data, error } = await this.supabase
      .from('campaigns')
      .select('*')
      .eq('status', 'ACTIVE');

    if (error) {
      throw new Error(`Failed to list active campaigns: ${error.message}`);
    }

    const rows = (data || []) as CampaignRow[];
    const active = rows.filter((r) => {
      const starts = r.starts_at ? new Date(r.starts_at) : null;
      const ends = r.ends_at ? new Date(r.ends_at) : null;
      if (starts && starts > now) return false;
      if (ends && ends <= now) return false;
      return true;
    });

    return active.map((r) => this.mapCampaign(r));
  }

  async listRulesForCampaign(campaignId: string): Promise<CampaignRule[]> {
    const { data, error } = await this.supabase
      .from('campaign_rules')
      .select('*')
      .eq('campaign_id', campaignId)
      .is('retired_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to list rules for campaign ${campaignId}: ${error.message}`);
    }

    const rows = (data || []) as CampaignRuleRow[];
    return rows.map((r) => this.mapCampaignRule(r));
  }

  // --- Qualifying Booking Facts ---

  async listQualifyingFactsForCustomer(customerId: string): Promise<QualifyingBookingFact[]> {
    const { data, error } = await this.supabase
      .from('qualifying_booking_facts')
      .select('*')
      .eq('customer_id', customerId)
      .eq('is_qualifying', true)
      .order('confirmed_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to list qualifying facts for customer: ${error.message}`);
    }

    const rows = (data || []) as QualifyingFactRow[];
    const recordedIds = new Set(rows.map((r) => r.reservation_id));

    // Self-healing: if any confirmed, checked-in, or completed reservations exist without a qualifying fact, backfill them.
    try {
      const { data: resData } = await this.supabase
        .from('reservations')
        .select(`
          id,
          source,
          amount_due,
          confirmed_at,
          status,
          reservation_candidates (
            rank,
            is_assigned,
            start_at,
            end_at,
            workspace_instances (
              template_id
            )
          )
        `)
        .eq('customer_id', customerId)
        .in('status', ['CONFIRMED', 'CHECKED_IN', 'COMPLETED']);

      if (resData && Array.isArray(resData)) {
        const unrecorded = (resData as unknown as ReservationHistoryQueryRow[]).filter(
          (r) => !recordedIds.has(r.id)
        );

        for (const res of unrecorded) {
          const cands = res.reservation_candidates || [];
          const assigned = cands.find((c) => c.is_assigned) || cands[0];
          let templateId: string | null = null;
          let bookedMinutes = 60;

          if (assigned) {
            const start = new Date(assigned.start_at).getTime();
            const end = new Date(assigned.end_at).getTime();
            bookedMinutes = Math.max(1, Math.round((end - start) / 60000));
            const wi = assigned.workspace_instances;
            if (wi) {
              if (Array.isArray(wi)) {
                templateId = wi[0]?.template_id || null;
              } else {
                templateId = wi.template_id || null;
              }
            }
          }

          if (templateId) {
            const confirmed_at = res.confirmed_at || new Date().toISOString();
            const net_paid_amount = Number(res.amount_due || 0);
            const source = res.source || 'WEB';

            await this.supabase.from('qualifying_booking_facts').upsert(
              {
                reservation_id: res.id,
                customer_id: customerId,
                confirmed_at,
                source,
                workspace_type_id: templateId,
                net_paid_amount,
                booked_minutes: bookedMinutes,
                is_qualifying: true,
              },
              { onConflict: 'reservation_id', ignoreDuplicates: true }
            );

            rows.push({
              reservation_id: res.id,
              customer_id: customerId,
              confirmed_at,
              source,
              workspace_type_id: templateId,
              net_paid_amount,
              booked_minutes: bookedMinutes,
              is_qualifying: true,
              created_at: new Date().toISOString(),
            });
            recordedIds.add(res.id);
          }
        }
      }
    } catch (backfillErr) {
      console.warn('[VoucherRepository] Qualifying facts self-healing skipped:', backfillErr);
    }

    return rows.map((r) => this.mapQualifyingFact(r));
  }

  async recordQualifyingFact(fact: QualifyingBookingFact): Promise<void> {
    const reservation_id = fact.reservationId || fact.reservation_id;
    const customer_id = fact.customerId || fact.customer_id;
    const confirmed_at = fact.confirmedAt || fact.confirmed_at || new Date().toISOString();
    const source = fact.source;
    const workspace_type_id = fact.workspaceTypeId || fact.workspace_type_id;
    const net_paid_amount = fact.netPaidAmount ?? fact.net_paid_amount ?? 0;
    const booked_minutes = fact.bookedMinutes ?? fact.booked_minutes ?? 60;
    const is_qualifying = fact.isQualifying ?? fact.is_qualifying ?? true;

    if (!reservation_id || !customer_id || !workspace_type_id) {
      throw new Error('reservation_id, customer_id, and workspace_type_id are required for qualifying fact');
    }

    const { error } = await this.supabase
      .from('qualifying_booking_facts')
      .upsert(
        {
          reservation_id,
          customer_id,
          confirmed_at,
          source,
          workspace_type_id,
          net_paid_amount,
          booked_minutes,
          is_qualifying,
        },
        { onConflict: 'reservation_id', ignoreDuplicates: true }
      );

    if (error) {
      throw new Error(`Failed to record qualifying booking fact: ${error.message}`);
    }
  }

  // --- Notification Outbox ---

  async queueNotification(
    item: Omit<NotificationOutboxItem, 'id' | 'createdAt'>
  ): Promise<NotificationOutboxItem> {
    const { data, error } = await this.supabase
      .from('notification_outbox')
      .insert({
        dedupe_key: item.dedupeKey,
        kind: item.kind,
        customer_id: item.customerId || null,
        reservation_id: item.reservationId || null,
        voucher_id: item.voucherId || null,
        recipient_email: item.recipientEmail,
        payload: item.payload,
        depends_on_id: item.dependsOnId || null,
        status: item.status || 'PENDING',
        attempts: item.attempts || 0,
        next_attempt_at: item.nextAttemptAt || new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to queue notification: ${error.message}`);
    }

    return this.mapOutboxItem(data as OutboxRow);
  }

  async findNotificationById(id: string): Promise<NotificationOutboxItem | null> {
    const { data, error } = await this.supabase
      .from('notification_outbox')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find notification by id: ${error.message}`);
    }
    if (!data) return null;

    return this.mapOutboxItem(data as OutboxRow);
  }

  async findNotificationByDedupeKey(dedupeKey: string): Promise<NotificationOutboxItem | null> {
    const { data, error } = await this.supabase
      .from('notification_outbox')
      .select('*')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find notification by dedupeKey: ${error.message}`);
    }
    if (!data) return null;

    return this.mapOutboxItem(data as OutboxRow);
  }

  async updateNotificationStatus(
    id: string,
    status: 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRY' | 'FAILED',
    providerMessageId?: string,
    error?: string
  ): Promise<void> {
    const updatePayload: Record<string, unknown> = {
      status,
    };
    if (providerMessageId) updatePayload.provider_message_id = providerMessageId;
    if (error) updatePayload.last_error_code = error;
    if (status === 'SENT') updatePayload.sent_at = new Date().toISOString();

    const { error: patchError } = await this.supabase
      .from('notification_outbox')
      .update(updatePayload)
      .eq('id', id);

    if (patchError) {
      throw new Error(`Failed to update notification status for ${id}: ${patchError.message}`);
    }
  }

  // --- Customer Booking History Helper ---

  async findCustomerReservations(
    customerId: string,
    limit: number = 20
  ): Promise<
    Array<{
      id: string;
      reference_code: string;
      source: string;
      status: string;
      start_at: string;
      end_at: string;
      workspace_name: string | null;
      amount_due: number;
      currency: string;
      created_at: string;
      is_pre_cutover: boolean;
    }>
  > {
    const { data: resData, error: resError } = await this.supabase
      .from('reservations')
      .select('id, reference_code, source, status, amount_due, currency, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (resError) {
      throw new Error(`Failed to list reservations for customer: ${resError.message}`);
    }

    const reservations = (resData || []) as Array<{
      id: string;
      reference_code: string;
      source: string;
      status: string;
      amount_due: number | string;
      currency: string;
      created_at: string;
    }>;

    if (reservations.length === 0) return [];

    const resIds = reservations.map((r) => r.id);
    const { data: candData } = await this.supabase
      .from('reservation_candidates')
      .select('reservation_id, rank, is_assigned, start_at, end_at, workspace_instance_id')
      .in('reservation_id', resIds)
      .order('rank', { ascending: true });

    const candidates = (candData || []) as Array<{
      reservation_id: string;
      rank: number;
      is_assigned: boolean;
      start_at: string;
      end_at: string;
      workspace_instance_id: string;
    }>;

    const candidateByResId = new Map<string, typeof candidates[0]>();
    for (const c of candidates) {
      const existing = candidateByResId.get(c.reservation_id);
      if (!existing || (c.is_assigned && !existing.is_assigned) || (!existing.is_assigned && c.rank < existing.rank)) {
        candidateByResId.set(c.reservation_id, c);
      }
    }

    return reservations.map((r) => {
      const cand = candidateByResId.get(r.id);
      return {
        id: r.id,
        reference_code: r.reference_code,
        source: r.source,
        status: r.status,
        start_at: cand?.start_at || r.created_at,
        end_at: cand?.end_at || r.created_at,
        workspace_name: null,
        amount_due: Number(r.amount_due),
        currency: r.currency || 'PHP',
        created_at: r.created_at,
        is_pre_cutover: false,
      };
    });
  }

  // --- Internal Mapping Helpers ---

  private mapVoucher(row: VoucherRow, now: Date = new Date()): Voucher {
    const issuedAt = row.issued_at;
    const expiresAt = row.expires_at;
    const rawStatus = row.status;
    let effectiveStatus: VoucherStatus = rawStatus;
    if (rawStatus === 'USED' || row.redeemed_at) {
      effectiveStatus = 'USED';
    } else if (new Date(expiresAt) <= now) {
      effectiveStatus = 'EXPIRED';
    } else {
      effectiveStatus = 'AVAILABLE';
    }

    const rewardSnapshot = row.reward_snapshot || {
      rewardType: 'FIXED_AMOUNT_DISCOUNT',
      rewardValue: 0,
      voucherValidityDays: 30,
    };

    return {
      id: row.id,
      customerId: row.customer_id,
      customer_id: row.customer_id,
      campaignId: row.campaign_id,
      campaign_id: row.campaign_id,
      campaignRuleId: row.campaign_rule_id,
      campaign_rule_id: row.campaign_rule_id,
      promoCode: row.promo_code,
      promo_code: row.promo_code,
      milestoneIndex: row.milestone_index,
      milestone_index: row.milestone_index,
      campaignNameSnapshot: row.campaign_name_snapshot,
      campaign_name_snapshot: row.campaign_name_snapshot,
      rewardSnapshot: rewardSnapshot as VoucherRewardSnapshot,
      reward_snapshot: rewardSnapshot as VoucherRewardSnapshot,
      status: effectiveStatus,
      issuedAt,
      issued_at: issuedAt,
      expiresAt,
      expires_at: expiresAt,
      redeemedAt: row.redeemed_at,
      redeemed_at: row.redeemed_at,
      redeemedReservationId: row.redeemed_reservation_id,
      redeemed_reservation_id: row.redeemed_reservation_id,
      redeemedDiscountAmount: row.redeemed_discount_amount != null ? Number(row.redeemed_discount_amount) : null,
      redeemed_discount_amount: row.redeemed_discount_amount != null ? Number(row.redeemed_discount_amount) : null,
      actualDiscountAmount: row.redeemed_discount_amount != null ? Number(row.redeemed_discount_amount) : null,
      createdAt: row.created_at,
      created_at: row.created_at,
      updatedAt: row.updated_at,
      updated_at: row.updated_at,
    };
  }

  private mapCampaign(row: CampaignRow): Campaign {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      startsAt: row.starts_at,
      starts_at: row.starts_at,
      endsAt: row.ends_at,
      ends_at: row.ends_at,
      activated_at: row.activated_at,
      revision: row.revision,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapCampaignRule(row: CampaignRuleRow): CampaignRule {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      campaign_id: row.campaign_id,
      label: row.label,
      version: row.version,
      supersedes_rule_id: row.supersedes_rule_id,
      effective_from: row.effective_from,
      retiredAt: row.retired_at,
      retired_at: row.retired_at,
      ruleDefinition: row.rule_definition,
      rule_definition: row.rule_definition as CampaignRule['rule_definition'],
      rewardType: row.reward_type,
      reward_type: row.reward_type,
      rewardValue: Number(row.reward_value),
      reward_value: Number(row.reward_value),
      maxDiscountAmount: row.max_discount_amount != null ? Number(row.max_discount_amount) : null,
      max_discount_amount: row.max_discount_amount != null ? Number(row.max_discount_amount) : null,
      voucherValidityDays: row.voucher_validity_days,
      voucher_validity_days: row.voucher_validity_days,
      createdAt: row.created_at,
      created_at: row.created_at,
    };
  }

  private mapQualifyingFact(row: QualifyingFactRow): QualifyingBookingFact {
    return {
      id: row.reservation_id,
      reservationId: row.reservation_id,
      reservation_id: row.reservation_id,
      customerId: row.customer_id,
      customer_id: row.customer_id,
      confirmedAt: row.confirmed_at,
      confirmed_at: row.confirmed_at,
      source: row.source,
      workspaceTypeId: row.workspace_type_id,
      workspace_type_id: row.workspace_type_id,
      netPaidAmount: Number(row.net_paid_amount),
      net_paid_amount: Number(row.net_paid_amount),
      bookedMinutes: row.booked_minutes,
      booked_minutes: row.booked_minutes,
      isQualifying: row.is_qualifying,
      is_qualifying: row.is_qualifying,
      createdAt: row.created_at,
      created_at: row.created_at,
    };
  }

  private mapOutboxItem(row: OutboxRow): NotificationOutboxItem {
    return {
      id: row.id,
      dedupeKey: row.dedupe_key,
      kind: row.kind as NotificationOutboxItem['kind'],
      customerId: row.customer_id,
      reservationId: row.reservation_id,
      voucherId: row.voucher_id,
      recipientEmail: row.recipient_email,
      payload: row.payload || {},
      dependsOnId: row.depends_on_id,
      status: row.status as NotificationOutboxItem['status'],
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      leaseUntil: row.lease_until,
      providerMessageId: row.provider_message_id,
      lastErrorCode: row.last_error_code,
      createdAt: row.created_at,
      sentAt: row.sent_at,
    };
  }
}
