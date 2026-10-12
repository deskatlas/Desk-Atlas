import type { CampaignRule, RewardType } from '../models/campaign';
import type {
  EligibilityResult,
  PromoQuoteSnapshot,
  QualifyingBookingFact,
  RuleProgress,
  Voucher,
  VoucherStatus,
} from '../models/voucher';
import type { CustomerRepository } from './customerRepository';
import type { VoucherRepository } from './voucherRepository';
import { generatePromoCode } from './campaignRuleEvaluator';
import { normalizeEmail, normalizePromoCode } from '@deskatlas/validation';
import type { TransactionalEmailService } from './transactionalEmailService';

export class PromoValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PromoValidationError';
  }
}

export interface PromoValidationResult {
  grossAmount: number;
  discountAmount: number;
  amountDue: number;
  currency: 'PHP';
  terms: {
    rewardType: RewardType;
    rewardValue: number;
    maxDiscountAmount?: number | null;
    promoCode: string;
    campaignName: string;
  };
  voucherId: string;
  serverNow: string;
}

export function getEffectiveVoucherStatus(voucher: Voucher, now: Date = new Date()): VoucherStatus {
  if (voucher.status === 'USED' || voucher.redeemedAt) {
    return 'USED';
  }
  if (new Date(voucher.expiresAt) <= now) {
    return 'EXPIRED';
  }
  return 'AVAILABLE';
}

export function calculateVoucherDiscount(
  grossAmount: number,
  rewardType: RewardType,
  rewardValue: number,
  maxDiscountAmount?: number | null
): { rawDiscount: number; effectiveDiscount: number; amountDue: number } {
  let rawDiscount = 0;
  if (rewardType === 'PERCENTAGE_DISCOUNT') {
    // Round half-up to centavos
    rawDiscount = Math.round(grossAmount * (rewardValue / 100) * 100) / 100;
    if (maxDiscountAmount && maxDiscountAmount > 0) {
      rawDiscount = Math.min(rawDiscount, maxDiscountAmount);
    }
  } else {
    // FIXED_AMOUNT_DISCOUNT
    rawDiscount = rewardValue;
  }

  // Minimum PHP 0.01 payable floor
  const maxAllowableDiscount = Math.max(0, grossAmount - 0.01);
  const effectiveDiscount = Math.round(Math.min(rawDiscount, maxAllowableDiscount) * 100) / 100;
  const amountDue = Math.round((grossAmount - effectiveDiscount) * 100) / 100;

  return { rawDiscount, effectiveDiscount, amountDue };
}

export class VoucherService {
  constructor(
    private readonly voucherRepository: VoucherRepository,
    private readonly customerRepository: CustomerRepository,
    private readonly emailService?: TransactionalEmailService
  ) {}

  async validatePromoForBooking(input: {
    promoCode: string;
    email: string;
    channel: 'WEB' | 'KIOSK';
    grossAmount: number;
    workspaceTemplateId?: string | null;
    now?: Date;
  }): Promise<PromoValidationResult> {
    const now = input.now || new Date();
    const code = normalizePromoCode(input.promoCode);
    const email = normalizeEmail(input.email);

    const voucher = await this.voucherRepository.findVoucherByCode(code);
    const customer = (this.customerRepository.findCustomerByEmail
      ? await this.customerRepository.findCustomerByEmail(email)
      : await this.customerRepository.findByEmail?.(email)) ?? null;

    // Mismatch or non-existent owner returns generic PROMO_INVALID without enumeration
    if (!voucher || !customer || voucher.customerId !== customer.id) {
      throw new PromoValidationError('PROMO_INVALID', 'Invalid promo code. Please check and try again.');
    }

    const effectiveStatus = getEffectiveVoucherStatus(voucher, now);
    if (effectiveStatus === 'USED') {
      throw new PromoValidationError('PROMO_USED', 'This promo code has already been redeemed.');
    }
    if (effectiveStatus === 'EXPIRED') {
      throw new PromoValidationError('PROMO_EXPIRED', 'This promo code has expired.');
    }

    const rawSnapshot = voucher.rewardSnapshot || voucher.reward_snapshot || {
      rewardType: (voucher as any).rewardType || (voucher as any).reward_type || 'FIXED_AMOUNT_DISCOUNT',
      rewardValue: (voucher as any).rewardValue ?? (voucher as any).reward_value ?? 0,
      maxDiscountAmount: (voucher as any).maxDiscountAmount ?? (voucher as any).max_discount_amount,
      redemptionChannels: (voucher as any).redemptionChannels ?? (voucher as any).redemption_channels,
      redemptionWorkspaceTypeIds: (voucher as any).redemptionWorkspaceTypeIds ?? (voucher as any).redemption_workspace_type_ids,
      minimumBookingAmount: (voucher as any).minimumBookingAmount ?? (voucher as any).minimum_booking_amount,
    };

    const rewardType = (rawSnapshot as any).rewardType || (rawSnapshot as any).reward_type || 'FIXED_AMOUNT_DISCOUNT';
    const rewardValue = (rawSnapshot as any).rewardValue ?? (rawSnapshot as any).reward_value ?? 0;
    const maxDiscountAmount = (rawSnapshot as any).maxDiscountAmount ?? (rawSnapshot as any).max_discount_amount;
    const redemptionChannels = (rawSnapshot as any).redemptionChannels ?? (rawSnapshot as any).redemption_channels;
    const redemptionWorkspaceTypeIds = (rawSnapshot as any).redemptionWorkspaceTypeIds ?? (rawSnapshot as any).redemption_workspace_type_ids;
    const minimumBookingAmount = (rawSnapshot as any).minimumBookingAmount ?? (rawSnapshot as any).minimum_booking_amount;

    // Check channel eligibility
    if (
      redemptionChannels &&
      redemptionChannels.length > 0 &&
      !redemptionChannels.includes(input.channel)
    ) {
      throw new PromoValidationError('PROMO_INELIGIBLE', 'This promo code is not eligible for this booking.');
    }

    // Check workspace template eligibility
    if (
      redemptionWorkspaceTypeIds &&
      redemptionWorkspaceTypeIds.length > 0 &&
      input.workspaceTemplateId &&
      !redemptionWorkspaceTypeIds.includes(input.workspaceTemplateId)
    ) {
      throw new PromoValidationError('PROMO_INELIGIBLE', 'This promo code is not eligible for this booking.');
    }

    // Check minimum booking amount
    if (
      minimumBookingAmount &&
      input.grossAmount < minimumBookingAmount
    ) {
      throw new PromoValidationError('PROMO_INELIGIBLE', 'This promo code is not eligible for this booking.');
    }

    const { effectiveDiscount, amountDue } = calculateVoucherDiscount(
      input.grossAmount,
      rewardType,
      rewardValue,
      maxDiscountAmount
    );

    return {
      grossAmount: input.grossAmount,
      discountAmount: effectiveDiscount,
      amountDue,
      currency: 'PHP',
      terms: {
        rewardType,
        rewardValue,
        maxDiscountAmount,
        promoCode: voucher.promoCode,
        campaignName: voucher.campaignNameSnapshot,
      },
      voucherId: voucher.id,
      serverNow: now.toISOString(),
    };
  }

  async checkEligibility(customerId: string, now: Date = new Date()): Promise<EligibilityResult> {
    const customer = (this.customerRepository.findCustomerById
      ? await this.customerRepository.findCustomerById(customerId)
      : await this.customerRepository.findById?.(customerId)) ?? null;
    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const campaigns = await this.voucherRepository.listActiveCampaigns(now);
    const facts = await this.voucherRepository.listQualifyingFactsForCustomer(customerId);
    const existingVouchers = await this.voucherRepository.findVouchersByCustomerId(customerId);

    const newVouchers: Voucher[] = [];
    const progress: RuleProgress[] = [];

    for (const campaign of campaigns) {
      const rules = await this.voucherRepository.listRulesForCampaign(campaign.id);

      for (const rule of rules) {
        const { ruleDefinition } = rule;
        const qStart = new Date(ruleDefinition.qualification_start_at);
        const qEnd = ruleDefinition.qualification_end_at
          ? new Date(ruleDefinition.qualification_end_at)
          : null;

        // Filter facts for this rule
        const eligibleFacts = facts.filter((f) => {
          const confDate = new Date(f.confirmedAt);
          if (confDate < qStart) return false;
          if (qEnd && confDate >= qEnd) return false;
          if (
            ruleDefinition.earning_channels &&
            ruleDefinition.earning_channels.length > 0 &&
            !ruleDefinition.earning_channels.includes(f.source)
          ) {
            return false;
          }
          if (
            ruleDefinition.earning_workspace_type_ids &&
            ruleDefinition.earning_workspace_type_ids.length > 0 &&
            f.workspaceTypeId &&
            !ruleDefinition.earning_workspace_type_ids.includes(f.workspaceTypeId)
          ) {
            return false;
          }
          return true;
        });

        // Compute metrics
        const bookingCount = eligibleFacts.length;
        const netSpend = eligibleFacts.reduce((sum, f) => sum + f.netPaidAmount, 0);
        const bookedMinutes = eligibleFacts.reduce((sum, f) => sum + f.bookedMinutes, 0);

        const conditionProgressList = ruleDefinition.conditions.map((cond) => {
          let current = 0;
          if (cond.metric === 'BOOKING_COUNT') current = bookingCount;
          else if (cond.metric === 'NET_SPEND') current = netSpend;
          else if (cond.metric === 'BOOKED_MINUTES') current = bookedMinutes;

          const cycles = Math.floor(current / cond.threshold);
          const nextTarget = (cycles + 1) * cond.threshold;
          const remaining = Math.max(0, nextTarget - current);

          return {
            metric: cond.metric,
            current,
            threshold: cond.threshold,
            remaining,
            cycles,
          };
        });

        const cyclesArray = conditionProgressList.map((cp) => cp.cycles);
        let ruleCycles =
          ruleDefinition.combine === 'ALL'
            ? Math.min(...cyclesArray)
            : Math.max(...cyclesArray);

        if (!ruleDefinition.recurring) {
          ruleCycles = Math.min(1, ruleCycles);
        }

        // Check milestones already issued
        const ruleVouchers = existingVouchers.filter((v) => v.campaignRuleId === rule.id);
        const issuedMilestones = new Set(ruleVouchers.map((v) => v.milestoneIndex));

        // Issue missing milestones up to 100 per execution
        let issuedThisRun = 0;
        for (let m = 1; m <= ruleCycles && issuedThisRun < 100; m++) {
          if (!issuedMilestones.has(m)) {
            const promoCode = generatePromoCode();
            const expiresAt = new Date(
              now.getTime() + rule.voucherValidityDays * 24 * 60 * 60 * 1000
            ).toISOString();

            const newVoucher = await this.voucherRepository.createVoucher({
              customerId: customer.id,
              campaignId: campaign.id,
              campaignRuleId: rule.id,
              promoCode,
              milestoneIndex: m,
              campaignNameSnapshot: campaign.name,
              rewardSnapshot: {
                rewardType: rule.rewardType,
                rewardValue: rule.rewardValue,
                maxDiscountAmount: rule.maxDiscountAmount,
                voucherValidityDays: rule.voucherValidityDays,
                redemptionChannels: ruleDefinition.redemption_channels,
                redemptionWorkspaceTypeIds: ruleDefinition.redemption_workspace_type_ids,
                minimumBookingAmount: ruleDefinition.minimum_booking_amount,
              },
              status: 'AVAILABLE',
              issuedAt: now.toISOString(),
              expiresAt,
            });

            newVouchers.push(newVoucher);
            existingVouchers.push(newVoucher);
            issuedMilestones.add(m);
            issuedThisRun++;
          }
        }

        const isCompleted = !ruleDefinition.recurring && issuedMilestones.has(1);

        progress.push({
          campaignId: campaign.id,
          ruleId: rule.id,
          label: rule.label,
          combine: ruleDefinition.combine,
          conditions: conditionProgressList.map((c) => ({
            metric: c.metric,
            current: c.current,
            threshold: c.threshold,
            remaining: c.remaining,
          })),
          nextMilestone: ruleCycles + 1,
          completed: isCompleted,
        });
      }
    }

    return {
      newVouchers,
      existingVouchers: existingVouchers.map((v) => ({
        ...v,
        status: getEffectiveVoucherStatus(v, now),
      })),
      progress,
      reconciliationPending: false,
      serverNow: now.toISOString(),
    };
  }

  async emailVoucher(input: {
    customerId: string;
    voucherId: string;
    requestId: string;
    emailService?: TransactionalEmailService;
  }): Promise<{ notificationId: string; status: 'QUEUED' | 'SENT' | 'FAILED' }> {
    const customer = (this.customerRepository.findCustomerById
      ? await this.customerRepository.findCustomerById(input.customerId)
      : await this.customerRepository.findById?.(input.customerId)) ?? null;
    if (!customer) {
      throw new Error('Customer not found');
    }

    const voucher = await this.voucherRepository.findVoucherById(input.voucherId);
    if (!voucher || voucher.customerId !== customer.id) {
      throw new Error('Voucher not found or access denied');
    }

    const effectiveStatus = getEffectiveVoucherStatus(voucher);
    if (effectiveStatus !== 'AVAILABLE') {
      throw new PromoValidationError('VOUCHER_UNAVAILABLE', 'This voucher is not available for emailing.');
    }

    const dedupeKey = `voucher-email:${customer.id}:${voucher.id}:${input.requestId}`;

    const existingNotif = await this.voucherRepository.findNotificationByDedupeKey(dedupeKey);
    if (existingNotif) {
      return {
        notificationId: existingNotif.id,
        status: existingNotif.status === 'SENT' ? 'SENT' : existingNotif.status === 'FAILED' ? 'FAILED' : 'QUEUED',
      };
    }

    if (this.customerRepository.countRateLimitEvents && this.customerRepository.recordRateLimitEvent) {
      const voucherScope = 'EMAIL_VOUCHER';
      const voucherSubject = `${customer.id}:${voucher.id}`;
      const count = await this.customerRepository.countRateLimitEvents(voucherScope, voucherSubject, 5 * 60);
      if (count >= 1) {
        throw new Error('Too many email requests for this voucher. Please wait 5 minutes.');
      }
      await this.customerRepository.recordRateLimitEvent(voucherScope, voucherSubject, input.requestId);
    }

    const rewardSnapshot = voucher.rewardSnapshot || {
      rewardType: (voucher as any).rewardType || 'FIXED_DISCOUNT',
      rewardValue: (voucher as any).rewardValue || 0,
      maxDiscountAmount: (voucher as any).maxDiscountAmount,
    };

    const discountDesc =
      rewardSnapshot.rewardType === 'PERCENTAGE_DISCOUNT'
        ? `${rewardSnapshot.rewardValue}% OFF`
        : `PHP ${rewardSnapshot.rewardValue} OFF`;

    const notification = await this.voucherRepository.queueNotification({
      dedupeKey,
      kind: 'VOUCHER_EMAIL',
      customerId: customer.id,
      voucherId: voucher.id,
      recipientEmail: customer.email,
      payload: {
        customerFirstName: customer.firstName,
        promoCode: voucher.promoCode,
        discountDescription: discountDesc,
        campaignName: voucher.campaignNameSnapshot,
        rewardSnapshot: (voucher.rewardSnapshot || {}) as any,
        expiresAt: voucher.expiresAt,
      },
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
    });

    // If an emailService is provided, attempt dispatch asynchronously
    if (input.emailService) {
      try {
        const sendResult = await input.emailService.sendVoucherEmail({
          to: customer.email,
          customerFirstName: customer.firstName,
          promoCode: voucher.promoCode,
          discountDescription: discountDesc,
          campaignName: voucher.campaignNameSnapshot,
          expiresAt: voucher.expiresAt,
          terms: (voucher.rewardSnapshot || {}) as any,
        });

        if (sendResult.success) {
          await this.voucherRepository.updateNotificationStatus(notification.id, 'SENT', sendResult.id);
          return { notificationId: notification.id, status: 'SENT' };
        } else {
          await this.voucherRepository.updateNotificationStatus(notification.id, 'FAILED', undefined, sendResult.error);
          return { notificationId: notification.id, status: 'FAILED' };
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Provider error';
        await this.voucherRepository.updateNotificationStatus(notification.id, 'FAILED', undefined, errorMsg);
        return { notificationId: notification.id, status: 'FAILED' };
      }
    }

    return { notificationId: notification.id, status: 'QUEUED' };
  }

  async getNotificationStatus(notificationId: string, customerId: string): Promise<{ status: 'QUEUED' | 'SENT' | 'FAILED' }> {
    const notification = await this.voucherRepository.findNotificationById(notificationId);
    if (!notification || notification.customerId !== customerId) {
      throw new Error('Notification not found');
    }

    const status =
      notification.status === 'SENT' ? 'SENT' : notification.status === 'FAILED' ? 'FAILED' : 'QUEUED';
    return { status };
  }

  async getVouchersForCustomer(
    customerId: string,
    status?: VoucherStatus,
    cursor?: string,
    limit: number = 20,
    now: Date = new Date()
  ): Promise<{ items: Voucher[]; nextCursor?: string; serverNow: string }> {
    const all = await this.voucherRepository.findVouchersByCustomerId(customerId);
    const effectiveList = all.map((v) => ({
      ...v,
      status: getEffectiveVoucherStatus(v, now),
    }));

    const filtered = status
      ? effectiveList.filter((v) => v.status === status)
      : effectiveList;

    return {
      items: filtered.slice(0, limit),
      serverNow: now.toISOString(),
    };
  }

  async requestVoucherEmail(input: {
    customerId: string;
    voucherId: string;
    requestId: string;
    emailService?: TransactionalEmailService;
  }): Promise<{ notificationId: string; status: 'QUEUED' | 'SENT' | 'FAILED' }> {
    return this.emailVoucher(input);
  }

  async getVoucherEmailStatus(
    notificationId: string,
    customerId: string
  ): Promise<{ status: 'QUEUED' | 'SENT' | 'FAILED' }> {
    return this.getNotificationStatus(notificationId, customerId);
  }
}
