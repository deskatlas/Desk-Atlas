import type {
  ReservationChannel,
  Voucher,
} from '../models/campaign';
import type { CampaignRepository } from './campaignRepository';
import {
  calculateDiscountAmount,
  calculateEffectiveVoucherStatus,
} from './campaignRuleEvaluator';

// SPEC-2 Traceability: PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37

export interface VoucherQuoteValidationInput {
  promoCode: string;
  customerEmail: string;
  channel: ReservationChannel;
  grossAmount: number;
  workspaceTypeId?: string;
  nowIso?: string;
}

export interface VoucherQuoteResult {
  isValid: boolean;
  errorCode?:
    | 'PROMO_NOT_FOUND'
    | 'PROMO_NOT_OWNED'
    | 'PROMO_EXPIRED'
    | 'PROMO_ALREADY_USED'
    | 'PROMO_CHANNEL_INELIGIBLE'
    | 'PROMO_WORKSPACE_INELIGIBLE'
    | 'PROMO_MINIMUM_SPEND_NOT_MET'
    | 'PROMO_REVALIDATION_REQUIRED'
    | 'PROMO_PENDING';
  errorMessage?: string;
  voucher?: Voucher;
  discountAmount?: number;
  payableAmount?: number;
}

export class VoucherRedemptionService {
  constructor(private readonly repository: CampaignRepository) {}

  /**
   * Quote a promo code for a pending reservation.
   * Applying/quoting a voucher neither holds inventory nor reserves/consumes the voucher.
   */
  async quotePromoCode(input: VoucherQuoteValidationInput): Promise<VoucherQuoteResult> {
    const code = input.promoCode.trim().toUpperCase();
    const voucher = await this.repository.getVoucherByCode(code);

    if (!voucher) {
      return {
        isValid: false,
        errorCode: 'PROMO_NOT_FOUND',
        errorMessage: 'Invalid promo code. Please check and try again.',
      };
    }

    // Check effective status
    const effectiveStatus = calculateEffectiveVoucherStatus(voucher, input.nowIso);
    if (effectiveStatus === 'USED') {
      return {
        isValid: false,
        errorCode: 'PROMO_ALREADY_USED',
        errorMessage: 'This promo code has already been redeemed.',
      };
    }
    if (effectiveStatus === 'PENDING_REDEMPTION') {
      return {
        isValid: false,
        errorCode: 'PROMO_PENDING',
        errorMessage: 'This promo code is currently in use by a pending reservation.',
      };
    }
    if (effectiveStatus === 'EXPIRED') {
      return {
        isValid: false,
        errorCode: 'PROMO_EXPIRED',
        errorMessage: 'This promo code has expired and is no longer valid.',
      };
    }

    const terms = voucher.reward_snapshot;

    // Check channel eligibility
    if (terms.redemption_channels && terms.redemption_channels.length > 0) {
      if (!terms.redemption_channels.includes(input.channel)) {
        return {
          isValid: false,
          errorCode: 'PROMO_CHANNEL_INELIGIBLE',
          errorMessage: `This promo code is only valid for ${terms.redemption_channels.join(', ')} bookings.`,
        };
      }
    }

    // Check workspace template eligibility
    if (input.workspaceTypeId && terms.redemption_workspace_type_ids && terms.redemption_workspace_type_ids.length > 0) {
      if (!terms.redemption_workspace_type_ids.includes(input.workspaceTypeId)) {
        return {
          isValid: false,
          errorCode: 'PROMO_WORKSPACE_INELIGIBLE',
          errorMessage: 'This promo code cannot be applied to the selected workspace type.',
        };
      }
    }

    // Check minimum booking amount
    if (terms.minimum_booking_amount && terms.minimum_booking_amount > 0) {
      if (input.grossAmount < terms.minimum_booking_amount) {
        return {
          isValid: false,
          errorCode: 'PROMO_MINIMUM_SPEND_NOT_MET',
          errorMessage: `This promo code requires a minimum booking amount of ₱${terms.minimum_booking_amount.toFixed(2)}.`,
        };
      }
    }

    // Calculate effective discount with PHP 0.01 payable floor
    const { effectiveDiscount, payableAmount } = calculateDiscountAmount({
      grossAmount: input.grossAmount,
      rewardType: terms.reward_type,
      rewardValue: terms.reward_value,
      maxDiscountAmount: terms.max_discount_amount,
    });

    return {
      isValid: true,
      voucher,
      discountAmount: effectiveDiscount,
      payableAmount,
    };
  }

  /**
   * Final atomic redemption upon payment verification and allocation.
   * If voucher becomes used, expired, or incompatible with the assigned candidate, returns PROMO_REVALIDATION_REQUIRED.
   */
  async redeemVoucherForReservation(params: {
    voucherId: string;
    reservationId: string;
    customerId: string;
    channel: ReservationChannel;
    grossAmount: number;
    assignedWorkspaceTypeId: string;
    quotedDiscountAmount: number;
    nowIso?: string;
  }): Promise<{
    success: boolean;
    redeemedVoucher?: Voucher;
    errorCode?: string;
    errorMessage?: string;
  }> {
    const voucher = await this.repository.getVoucherById(params.voucherId);
    if (!voucher) {
      return {
        success: false,
        errorCode: 'PROMO_REVALIDATION_REQUIRED',
        errorMessage: 'Voucher not found for redemption.',
      };
    }

    // Verify ownership
    if (voucher.customer_id !== params.customerId) {
      return {
        success: false,
        errorCode: 'PROMO_REVALIDATION_REQUIRED',
        errorMessage: 'Voucher does not belong to the reservation customer.',
      };
    }

    // Check status
    const effectiveStatus = calculateEffectiveVoucherStatus(voucher, params.nowIso);
    const voucherWithPending = voucher as unknown as { pending_reservation_id?: string | null; pendingReservationId?: string | null };
    const isAvailableOrHeldByThis =
      effectiveStatus === 'AVAILABLE' ||
      (effectiveStatus === 'PENDING_REDEMPTION' &&
        (voucherWithPending.pending_reservation_id === params.reservationId ||
          voucherWithPending.pendingReservationId === params.reservationId));

    if (!isAvailableOrHeldByThis) {
      return {
        success: false,
        errorCode: 'PROMO_REVALIDATION_REQUIRED',
        errorMessage: `Voucher is no longer available (${effectiveStatus}).`,
      };
    }

    const terms = voucher.reward_snapshot;

    // Check channel and template compatibility with the final assigned candidate
    if (terms.redemption_channels && !terms.redemption_channels.includes(params.channel)) {
      return {
        success: false,
        errorCode: 'PROMO_REVALIDATION_REQUIRED',
        errorMessage: 'Voucher is ineligible for this booking channel.',
      };
    }

    if (
      terms.redemption_workspace_type_ids &&
      terms.redemption_workspace_type_ids.length > 0 &&
      !terms.redemption_workspace_type_ids.includes(params.assignedWorkspaceTypeId)
    ) {
      return {
        success: false,
        errorCode: 'PROMO_REVALIDATION_REQUIRED',
        errorMessage: 'Voucher is incompatible with the assigned workspace type.',
      };
    }

    // Revalidate discount amount
    const { effectiveDiscount } = calculateDiscountAmount({
      grossAmount: params.grossAmount,
      rewardType: terms.reward_type,
      rewardValue: terms.reward_value,
      maxDiscountAmount: terms.max_discount_amount,
    });

    if (Math.abs(effectiveDiscount - params.quotedDiscountAmount) > 0.001) {
      return {
        success: false,
        errorCode: 'PROMO_REVALIDATION_REQUIRED',
        errorMessage: 'Quoted discount does not match current calculation.',
      };
    }

    // Commit single-use redemption
    try {
      const redeemed = await this.repository.redeemVoucher(
        voucher.id,
        params.reservationId,
        effectiveDiscount,
        params.nowIso
      );
      return {
        success: true,
        redeemedVoucher: redeemed,
      };
    } catch (err: unknown) {
      return {
        success: false,
        errorCode: 'PROMO_REVALIDATION_REQUIRED',
        errorMessage: err instanceof Error ? err.message : 'Voucher redemption failed.',
      };
    }
  }
}
