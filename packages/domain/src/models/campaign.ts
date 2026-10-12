// SPEC-2 Traceability: PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export type RewardType = 'PERCENTAGE_DISCOUNT' | 'FIXED_AMOUNT_DISCOUNT';

export type VoucherStatus = 'AVAILABLE' | 'PENDING_REDEMPTION' | 'USED' | 'EXPIRED';

export type ReservationChannel = 'WEB' | 'KIOSK';

export type MetricType = 'BOOKING_COUNT' | 'NET_SPEND' | 'BOOKED_MINUTES';

export type CombineOperator = 'ALL' | 'ANY';

export type RewardWorkKind = 'EVALUATE_CUSTOMER' | 'RECONCILE_CAMPAIGN';

export type RewardWorkStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'RETRY' | 'FAILED';

export interface RuleCondition {
  metric: MetricType;
  threshold: number;
}

export interface RuleDefinitionV1 {
  schema_version: 1;
  combine: CombineOperator;
  conditions: RuleCondition[];
  recurring: boolean;
  qualification_start_at: string;
  qualification_end_at?: string | null;
  earning_channels: ReservationChannel[];
  earning_workspace_type_ids: string[];
  redemption_channels: ReservationChannel[];
  redemption_workspace_type_ids: string[];
  minimum_booking_amount: number;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  activated_at: string | null;
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  rules?: CampaignRule[];
  voucher_counts?: {
    issued: number;
    used: number;
    expired: number;
  };
}

export interface CampaignRule {
  id: string;
  campaign_id: string;
  campaignId?: string;
  label: string;
  version?: number;
  supersedes_rule_id?: string | null;
  effective_from?: string;
  retired_at?: string | null;
  retiredAt?: string | null;
  rule_definition?: RuleDefinitionV1;
  ruleDefinition?: any;
  reward_type: RewardType;
  rewardType?: RewardType;
  reward_value: number;
  rewardValue?: number;
  max_discount_amount?: number | null;
  maxDiscountAmount?: number | null;
  voucher_validity_days: number;
  voucherValidityDays?: number;
  created_at?: string;
  createdAt?: Date | string;
}

export interface VoucherRewardSnapshot {
  reward_type: RewardType;
  rewardType?: RewardType;
  reward_value: number;
  rewardValue?: number;
  max_discount_amount: number | null;
  maxDiscountAmount?: number | null;
  voucher_validity_days: number;
  voucherValidityDays?: number;
  redemption_channels: ReservationChannel[];
  redemptionChannels?: ('WEB' | 'KIOSK')[];
  redemption_workspace_type_ids: string[];
  redemptionWorkspaceTypeIds?: string[];
  minimum_booking_amount: number;
  minimumBookingAmount?: number;
  campaign_rule_id?: string;
  campaign_rule_version?: number;
}

export interface Voucher {
  id: string;
  customer_id: string;
  customerId?: string;
  campaign_id: string;
  campaignId?: string;
  campaign_rule_id: string;
  campaignRuleId?: string;
  promo_code: string;
  promoCode?: string;
  milestone_index: number;
  milestoneIndex?: number;
  campaign_name_snapshot: string;
  campaignNameSnapshot?: string;
  reward_snapshot: VoucherRewardSnapshot;
  rewardSnapshot?: VoucherRewardSnapshot;
  status: VoucherStatus;
  issued_at: string;
  issuedAt?: string;
  expires_at: string;
  expiresAt?: string;
  startsAt?: Date | string;
  pending_reservation_id?: string | null;
  pendingReservationId?: string | null;
  held_at?: string | null;
  heldAt?: Date | string | null;
  redeemed_at: string | null;
  redeemedAt?: Date | string | null;
  redeemed_reservation_id: string | null;
  redeemedReservationId?: string | null;
  redeemedReservationReference?: string | null;
  redeemed_discount_amount: number | null;
  redeemedDiscountAmount?: number | null;
  actualDiscountAmount?: number | null;
  created_at: string;
  createdAt?: string;
  updated_at: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface QualifyingBookingFact {
  id?: string;
  reservation_id: string;
  reservationId?: string;
  customer_id: string;
  customerId?: string;
  confirmed_at: string;
  confirmedAt?: string;
  source: ReservationChannel;
  workspace_type_id: string;
  workspaceTypeId?: string | null;
  net_paid_amount: number;
  netPaidAmount?: number;
  booked_minutes: number;
  bookedMinutes?: number;
  is_qualifying: boolean;
  isQualifying?: boolean;
  reservationReference?: string;
  created_at: string;
}

export interface RewardWork {
  id: string;
  dedupe_key: string;
  kind: RewardWorkKind;
  customer_id: string | null;
  campaign_rule_id: string | null;
  campaign_id: string | null;
  source_reservation_id: string | null;
  rule_ids_snapshot: string[] | null;
  cursor_customer_id: string | null;
  evaluation_cutoff_at: string;
  status: RewardWorkStatus;
  attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  last_error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ConditionProgress {
  metric: MetricType;
  current: number;
  threshold: number;
  remaining_to_next: number;
  cycles: number;
}

export interface RuleEvaluationProgress {
  rule_id: string;
  rule_label: string;
  combine: CombineOperator;
  conditions: ConditionProgress[];
  earned_milestones: number;
  next_milestone: number | null;
  is_completed: boolean;
}

export interface CustomerEvaluationResult {
  customer_id: string;
  rule_id: string;
  milestone_cycles: number;
  new_vouchers_issued: Voucher[];
  existing_vouchers: Voucher[];
  progress: RuleEvaluationProgress;
}
