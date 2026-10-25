import type { RewardType, CombineOperator as RuleCombineOperator, MetricType as RuleMetric } from './campaign';

export type VoucherStatus = 'AVAILABLE' | 'PENDING_REDEMPTION' | 'USED' | 'EXPIRED';

export interface VoucherRewardSnapshot {
  rewardType: RewardType;
  rewardValue: number;
  maxDiscountAmount?: number | null;
  voucherValidityDays: number;
  redemptionChannels?: ('WEB' | 'KIOSK')[];
  redemptionWorkspaceTypeIds?: string[];
  minimumBookingAmount?: number;
}

export interface Voucher {
  id: string;
  customerId: string;
  customer_id?: string;
  campaignId: string;
  campaign_id?: string;
  campaignRuleId: string;
  campaign_rule_id?: string;
  promoCode: string;
  promo_code?: string;
  milestoneIndex: number;
  milestone_index?: number;
  campaignNameSnapshot: string;
  campaign_name_snapshot?: string;
  rewardSnapshot: VoucherRewardSnapshot;
  reward_snapshot?: VoucherRewardSnapshot;
  status: VoucherStatus;
  issuedAt: string;
  issued_at?: string;
  expiresAt: string;
  expires_at?: string;
  pendingReservationId?: string | null;
  pending_reservation_id?: string | null;
  heldAt?: string | null;
  held_at?: string | null;
  redeemedAt?: string | null;
  redeemed_at?: string | null;
  redeemedReservationId?: string | null;
  redeemed_reservation_id?: string | null;
  redeemedReservationReference?: string | null;
  redeemedDiscountAmount?: number | null;
  redeemed_discount_amount?: number | null;
  actualDiscountAmount?: number | null;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

export interface QualifyingBookingFact {
  id?: string;
  reservationId: string;
  reservation_id?: string;
  customerId: string;
  customer_id?: string;
  confirmedAt: string;
  confirmed_at?: string;
  source: 'WEB' | 'KIOSK';
  workspaceTypeId?: string | null;
  workspace_type_id?: string;
  netPaidAmount: number;
  net_paid_amount?: number;
  bookedMinutes: number;
  booked_minutes?: number;
  isQualifying: boolean;
  is_qualifying?: boolean;
  reservationReference?: string;
  createdAt: string;
  created_at?: string;
}

export interface RewardProcessingJob {
  id: string;
  dedupeKey: string;
  kind: 'EVALUATE_CUSTOMER' | 'RECONCILE_CAMPAIGN';
  customerId?: string | null;
  campaignRuleId?: string | null;
  campaignId?: string | null;
  sourceReservationId?: string | null;
  ruleIdsSnapshot?: string[] | null;
  cursorCustomerId?: string | null;
  evaluationCutoffAt: string;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'RETRY' | 'FAILED';
  attempts: number;
  nextAttemptAt: string;
  leaseUntil?: string | null;
  lastErrorCode?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface NotificationOutboxItem {
  id: string;
  dedupeKey: string;
  kind: 'BOOKING_CONFIRMED' | 'SAVE_CUSTOMER_ID' | 'VOUCHER_EMAIL' | 'PAID_CANDIDATE_EXHAUSTED';
  customerId?: string | null;
  reservationId?: string | null;
  voucherId?: string | null;
  recipientEmail: string;
  payload: Record<string, unknown>;
  dependsOnId?: string | null;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRY' | 'FAILED';
  attempts: number;
  nextAttemptAt: string;
  leaseUntil?: string | null;
  providerMessageId?: string | null;
  lastErrorCode?: string | null;
  createdAt: string;
  sentAt?: string | null;
}

export interface PromoQuoteSnapshot {
  voucherId: string;
  promoCode: string;
  rewardType: RewardType;
  rewardValue: number;
  maxDiscountAmount?: number | null;
  grossAmount: number;
  discountAmount: number;
  amountDue: number;
  quotedAt: string;
  channel: 'WEB' | 'KIOSK';
  workspaceTemplateId?: string | null;
}

export interface RuleConditionProgress {
  metric: RuleMetric;
  current: number;
  threshold: number;
  remaining: number;
}

export interface RuleProgress {
  campaignId: string;
  ruleId: string;
  label: string;
  combine: RuleCombineOperator;
  conditions: RuleConditionProgress[];
  nextMilestone: number;
  completed: boolean;
}

export interface EligibilityResult {
  newVouchers: Voucher[];
  existingVouchers: Voucher[];
  progress: RuleProgress[];
  reconciliationPending: boolean;
  serverNow: string;
}
