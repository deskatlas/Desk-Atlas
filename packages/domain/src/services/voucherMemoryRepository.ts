import type { Campaign, CampaignRule } from '../models/campaign';
import type {
  NotificationOutboxItem,
  QualifyingBookingFact,
  Voucher,
  VoucherStatus,
} from '../models/voucher';
import type { VoucherRepository } from './voucherRepository';

export class VoucherMemoryRepository implements VoucherRepository {
  private vouchers: Map<string, Voucher> = new Map();
  private campaigns: Map<string, Campaign> = new Map();
  private campaignRules: Map<string, CampaignRule> = new Map();
  private qualifyingFacts: QualifyingBookingFact[] = [];
  private outbox: Map<string, NotificationOutboxItem> = new Map();

  async findVoucherByCode(promoCode: string): Promise<Voucher | null> {
    const normalized = promoCode.trim().toUpperCase();
    for (const voucher of this.vouchers.values()) {
      if (voucher.promoCode.toUpperCase() === normalized) {
        return voucher;
      }
    }
    return null;
  }

  async findVouchersByCustomerId(
    customerId: string,
    status?: VoucherStatus
  ): Promise<Voucher[]> {
    const results: Voucher[] = [];
    for (const voucher of this.vouchers.values()) {
      if (voucher.customerId === customerId) {
        if (!status || voucher.status === status) {
          results.push(voucher);
        }
      }
    }
    return results.sort(
      (a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime()
    );
  }

  async findVoucherById(id: string): Promise<Voucher | null> {
    return this.vouchers.get(id) || null;
  }

  async createVoucher(
    data: Omit<Voucher, 'id' | 'createdAt' | 'updatedAt'> | (Partial<Voucher> & Record<string, unknown>)
  ): Promise<Voucher> {
    const payload = data as Partial<Voucher> & Record<string, unknown>;
    const id = `vouch-${Math.random().toString(36).substring(2, 10)}`;
    const now = new Date().toISOString();
    const customer_id = String(payload.customer_id || payload.customerId || '');
    const campaign_id = String(payload.campaign_id || payload.campaignId || '');
    const campaign_rule_id = String(payload.campaign_rule_id || payload.campaignRuleId || '');
    const promo_code = String(payload.promo_code || payload.promoCode || '');
    const milestone_index = typeof payload.milestone_index === 'number'
      ? payload.milestone_index
      : typeof payload.milestoneIndex === 'number'
      ? payload.milestoneIndex
      : 0;
    const campaign_name_snapshot = String(payload.campaign_name_snapshot || payload.campaignNameSnapshot || '');
    let reward_snapshot = (payload.reward_snapshot || payload.rewardSnapshot) as Voucher['rewardSnapshot'] | undefined;
    if (!reward_snapshot) {
      reward_snapshot = {
        rewardType: (payload.rewardType || payload.reward_type || 'FIXED_AMOUNT_DISCOUNT') as Voucher['rewardSnapshot']['rewardType'],
        rewardValue: typeof payload.rewardValue === 'number'
          ? payload.rewardValue
          : typeof payload.reward_value === 'number'
          ? payload.reward_value
          : 0,
        maxDiscountAmount: typeof payload.maxDiscountAmount === 'number'
          ? payload.maxDiscountAmount
          : typeof payload.max_discount_amount === 'number'
          ? payload.max_discount_amount
          : null,
        voucherValidityDays: typeof payload.voucherValidityDays === 'number'
          ? payload.voucherValidityDays
          : typeof payload.voucher_validity_days === 'number'
          ? payload.voucher_validity_days
          : 30,
        redemptionChannels: (payload.redemptionChannels || payload.redemption_channels) as Voucher['rewardSnapshot']['redemptionChannels'],
        redemptionWorkspaceTypeIds: (payload.redemptionWorkspaceTypeIds || payload.redemption_workspace_type_ids) as Voucher['rewardSnapshot']['redemptionWorkspaceTypeIds'],
        minimumBookingAmount: typeof payload.minimumBookingAmount === 'number'
          ? payload.minimumBookingAmount
          : typeof payload.minimum_booking_amount === 'number'
          ? payload.minimum_booking_amount
          : undefined,
      };
    }
    const issued_at = String(payload.issued_at || payload.issuedAt || now);
    const startsAtStr = typeof payload.startsAt === 'string' ? payload.startsAt : undefined;
    const expires_at = String(
      payload.expires_at ||
      payload.expiresAt ||
      (startsAtStr
        ? new Date(new Date(startsAtStr).getTime() + 30 * 86400000).toISOString()
        : new Date(Date.now() + 30 * 86400000).toISOString())
    );

    const voucher: Voucher = {
      id,
      customer_id,
      customerId: customer_id,
      campaign_id,
      campaignId: campaign_id,
      campaign_rule_id,
      campaignRuleId: campaign_rule_id,
      promo_code,
      promoCode: promo_code,
      milestone_index,
      milestoneIndex: milestone_index,
      campaign_name_snapshot,
      campaignNameSnapshot: campaign_name_snapshot,
      reward_snapshot,
      rewardSnapshot: reward_snapshot,
      status: data.status || 'AVAILABLE',
      issued_at,
      issuedAt: issued_at,
      expires_at,
      expiresAt: expires_at,
      pending_reservation_id: data.pending_reservation_id ?? data.pendingReservationId ?? null,
      pendingReservationId: data.pending_reservation_id ?? data.pendingReservationId ?? null,
      held_at: data.held_at ?? data.heldAt ?? null,
      heldAt: data.held_at ?? data.heldAt ?? null,
      redeemed_at: data.redeemed_at ?? data.redeemedAt ?? null,
      redeemedAt: data.redeemed_at ?? data.redeemedAt ?? null,
      redeemed_reservation_id: data.redeemed_reservation_id ?? data.redeemedReservationId ?? null,
      redeemedReservationId: data.redeemed_reservation_id ?? data.redeemedReservationId ?? null,
      redeemed_discount_amount: data.redeemed_discount_amount ?? data.redeemedDiscountAmount ?? null,
      redeemedDiscountAmount: data.redeemed_discount_amount ?? data.redeemedDiscountAmount ?? null,
      actualDiscountAmount: data.actualDiscountAmount ?? data.redeemed_discount_amount ?? null,
      created_at: now,
      createdAt: now,
      updated_at: now,
      updatedAt: now,
      metadata: data.metadata || {},
    };
    this.vouchers.set(id, voucher);
    return voucher;
  }

  async updateVoucher(id: string, updates: Partial<Voucher>): Promise<Voucher> {
    const existing = this.vouchers.get(id);
    if (!existing) {
      throw new Error(`Voucher ${id} not found`);
    }
    const updated: Voucher = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.vouchers.set(id, updated);
    return updated;
  }

  async redeemVoucher(
    voucherId: string,
    reservationId: string,
    discountAmount: number,
    redeemedAt?: string
  ): Promise<Voucher> {
    const existing = this.vouchers.get(voucherId);
    if (!existing) {
      throw new Error(`Voucher ${voucherId} not found`);
    }
    const isAvailable = existing.status === 'AVAILABLE' && !existing.redeemedAt;
    const isHeldByRes =
      existing.status === 'PENDING_REDEMPTION' &&
      !existing.redeemedAt &&
      (!existing.pendingReservationId ||
        existing.pendingReservationId === reservationId ||
        existing.pending_reservation_id === reservationId);

    if (!isAvailable && !isHeldByRes) {
      throw new Error(`Voucher ${voucherId} could not be redeemed (already used or concurrent conflict)`);
    }
    const timestamp = redeemedAt || new Date().toISOString();
    const updated: Voucher = {
      ...existing,
      status: 'USED',
      pendingReservationId: null,
      pending_reservation_id: null,
      heldAt: null,
      held_at: null,
      redeemedAt: timestamp,
      redeemed_at: timestamp,
      redeemedReservationId: reservationId,
      redeemed_reservation_id: reservationId,
      redeemedDiscountAmount: discountAmount,
      redeemed_discount_amount: discountAmount,
      actualDiscountAmount: discountAmount,
      updatedAt: timestamp,
      updated_at: timestamp,
    };
    this.vouchers.set(voucherId, updated);
    return updated;
  }

  async holdVoucher(
    voucherId: string,
    reservationId: string,
    heldAt?: string
  ): Promise<Voucher> {
    const existing = this.vouchers.get(voucherId);
    if (!existing) {
      throw new Error(`Voucher ${voucherId} not found`);
    }
    if (
      existing.status === 'PENDING_REDEMPTION' &&
      (existing.pendingReservationId === reservationId || existing.pending_reservation_id === reservationId)
    ) {
      return existing;
    }
    if (existing.status !== 'AVAILABLE' || existing.pendingReservationId || existing.pending_reservation_id) {
      throw new Error(`Voucher ${voucherId} could not be held (already held or used)`);
    }
    const timestamp = heldAt || new Date().toISOString();
    const updated: Voucher = {
      ...existing,
      status: 'PENDING_REDEMPTION',
      pendingReservationId: reservationId,
      pending_reservation_id: reservationId,
      heldAt: timestamp,
      held_at: timestamp,
      updatedAt: timestamp,
      updated_at: timestamp,
    };
    this.vouchers.set(voucherId, updated);
    return updated;
  }

  async releaseVoucher(
    voucherId: string,
    reservationId: string
  ): Promise<Voucher> {
    const existing = this.vouchers.get(voucherId);
    if (!existing) {
      throw new Error(`Voucher ${voucherId} not found`);
    }
    if (
      existing.status !== 'PENDING_REDEMPTION' ||
      (existing.pendingReservationId !== reservationId &&
        existing.pending_reservation_id !== reservationId)
    ) {
      throw new Error(
        `Voucher ${voucherId} could not be released (not held by reservation ${reservationId})`
      );
    }
    const timestamp = new Date().toISOString();
    const updated: Voucher = {
      ...existing,
      status: 'AVAILABLE',
      pendingReservationId: null,
      pending_reservation_id: null,
      heldAt: null,
      held_at: null,
      updatedAt: timestamp,
      updated_at: timestamp,
    };
    this.vouchers.set(voucherId, updated);
    return updated;
  }

  async listActiveCampaigns(now: Date = new Date()): Promise<Campaign[]> {
    const results: Campaign[] = [];
    for (const campaign of this.campaigns.values()) {
      if (campaign.status === 'ACTIVE') {
        const starts = campaign.startsAt ? new Date(campaign.startsAt) : null;
        const ends = campaign.endsAt ? new Date(campaign.endsAt) : null;
        if ((!starts || starts <= now) && (!ends || ends > now)) {
          results.push(campaign);
        }
      }
    }
    return results;
  }

  async listRulesForCampaign(campaignId: string): Promise<CampaignRule[]> {
    const results: CampaignRule[] = [];
    for (const rule of this.campaignRules.values()) {
      if (rule.campaignId === campaignId && !rule.retiredAt) {
        results.push(rule);
      }
    }
    return results;
  }

  async listQualifyingFactsForCustomer(
    customerId: string
  ): Promise<QualifyingBookingFact[]> {
    return this.qualifyingFacts.filter(
      (f) => f.customerId === customerId && f.isQualifying
    );
  }

  async recordQualifyingFact(fact: QualifyingBookingFact): Promise<void> {
    this.qualifyingFacts.push(fact);
  }

  async queueNotification(
    item: Omit<NotificationOutboxItem, 'id' | 'createdAt'>
  ): Promise<NotificationOutboxItem> {
    const id = `notif-${Math.random().toString(36).substring(2, 10)}`;
    const notification: NotificationOutboxItem = {
      id,
      ...item,
      createdAt: new Date().toISOString(),
    };
    this.outbox.set(id, notification);
    return notification;
  }

  async findNotificationById(id: string): Promise<NotificationOutboxItem | null> {
    return this.outbox.get(id) || null;
  }

  async findNotificationByDedupeKey(
    dedupeKey: string
  ): Promise<NotificationOutboxItem | null> {
    for (const notif of this.outbox.values()) {
      if (notif.dedupeKey === dedupeKey) {
        return notif;
      }
    }
    return null;
  }

  async updateNotificationStatus(
    id: string,
    status: 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRY' | 'FAILED',
    providerMessageId?: string,
    error?: string
  ): Promise<void> {
    const existing = this.outbox.get(id);
    if (existing) {
      existing.status = status;
      if (providerMessageId) existing.providerMessageId = providerMessageId;
      if (error) existing.lastErrorCode = error;
      if (status === 'SENT') existing.sentAt = new Date().toISOString();
    }
  }

  // Setup helpers for testing
  async markVoucherUsed(
    id: string,
    reservationReference: string,
    redeemedAt: Date = new Date(),
    discountAmount: number = 0
  ): Promise<Voucher> {
    return this.updateVoucher(id, {
      status: 'USED',
      redeemedAt: redeemedAt.toISOString(),
      redeemedReservationReference: reservationReference,
      actualDiscountAmount: discountAmount,
    });
  }

  setBookingCount(customerId: string, count: number): void {
    this.qualifyingFacts = [];
    for (let i = 0; i < count; i++) {
      this.qualifyingFacts.push({
        id: `fact-${i}`,
        reservation_id: `res-${i}`,
        reservationId: `res-${i}`,
        customer_id: customerId,
        customerId,
        confirmed_at: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        source: 'WEB',
        workspace_type_id: 'type-1',
        workspaceTypeId: 'type-1',
        net_paid_amount: 100,
        netPaidAmount: 100,
        booked_minutes: 60,
        bookedMinutes: 60,
        is_qualifying: true,
        isQualifying: true,
        created_at: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    }
  }

  addCampaign(campaign: Campaign): void {
    this.campaigns.set(campaign.id, campaign);
  }

  addRule(rule: CampaignRule): void {
    this.campaignRules.set(rule.id, rule);
    const ruleCampId = rule.campaignId || rule.campaign_id;
    if (ruleCampId && !this.campaigns.has(ruleCampId)) {
      this.addCampaign({
        id: ruleCampId,
        name: rule.label,
        description: null,
        status: 'ACTIVE',
        starts_at: new Date(Date.now() - 86400000).toISOString(),
        ends_at: null,
        activated_at: null,
        revision: 1,
        created_by: 'system',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  private customerReservations: Map<string, Array<{
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
  }>> = new Map();

  addReservation(customerId: string, res: {
    id: string;
    reference_code: string;
    source: string;
    status: string;
    start_at: string;
    end_at: string;
    workspace_name?: string | null;
    amount_due: number;
    currency?: string;
    created_at?: string;
    is_pre_cutover?: boolean;
  }): void {
    const list = this.customerReservations.get(customerId) || [];
    list.push({
      id: res.id,
      reference_code: res.reference_code,
      source: res.source,
      status: res.status,
      start_at: res.start_at,
      end_at: res.end_at,
      workspace_name: res.workspace_name || null,
      amount_due: res.amount_due,
      currency: res.currency || 'PHP',
      created_at: res.created_at || new Date().toISOString(),
      is_pre_cutover: res.is_pre_cutover || false,
    });
    this.customerReservations.set(customerId, list);
  }

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
    const list = this.customerReservations.get(customerId) || [];
    return list
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  clear(): void {
    this.vouchers.clear();
    this.campaigns.clear();
    this.campaignRules.clear();
    this.qualifyingFacts = [];
    this.outbox.clear();
    this.customerReservations.clear();
  }
}

