import type { CampaignStatus, RewardType, RuleDefinitionV1, VoucherStatus } from './campaign';

// MS-43: PRD-F23, PRD-F25, SDD-C14, SDD-C19, ERD-E10/E16-E19, QAD-TC43.
export type CampaignAnalyticsRange = 'today' | '7d' | '30d' | 'month' | 'year' | 'all';
export interface CampaignSummaryMetric {
  vouchersIssued: number;
  vouchersRedeemed: number;
  redemptionRatePercentage: number;
  totalDiscountsGranted: number;
  formattedTotalDiscountsGranted: string;
  attributedGrossRevenue: number;
  formattedAttributedGrossRevenue: string;
  marketingRoiMultiple: number;
  averageOrderValue: number;
  formattedAverageOrderValue: string;
  uniqueParticipantsCount: number;
  vouchersExpired: number;
  breakageRatePercentage: number;
}
export interface CampaignTimelineBar {
  date: string; label: string; issuedCount: number; redeemedCount: number;
  discountAmount: number; attributedRevenue: number;
  issuedHeightPercentage: number; redeemedHeightPercentage: number;
}
export interface CampaignChannelBreakdown {
  webRedemptionsCount: number; webRedemptionsPercentage: number;
  kioskRedemptionsCount: number; kioskRedemptionsPercentage: number;
  webDiscountTotal: number; kioskDiscountTotal: number;
}
export interface CampaignPerformanceRow {
  campaignId: string; campaignName: string; status: CampaignStatus;
  startsAt: string | null; endsAt: string | null; createdAt: string;
  ruleId: string; ruleLabel: string; ruleVersion: number; conditionSummary: string;
  rewardType: RewardType; rewardValue: number;
  vouchersIssued: number; vouchersRedeemed: number; redemptionRatePercentage: number;
  discountsGranted: number; formattedDiscountsGranted: string;
  attributedRevenue: number; formattedAttributedRevenue: string; roiMultiple: number;
}
export interface RecentRedemptionItem {
  voucherId: string; promoCode: string; customerId: string; customerCode: string;
  reservationId: string; reservationReference: string; redeemedAt: string;
  discountAmount: number; formattedDiscountAmount: string;
  netPaidAmount: number; formattedNetPaidAmount: string; channel: 'WEB' | 'KIOSK';
}
export interface CampaignAnalyticsSnapshot {
  range: CampaignAnalyticsRange; rangeLabel: string; timeZone: string;
  summaryMetrics: CampaignSummaryMetric; previousSummaryMetrics: CampaignSummaryMetric | null;
  standardAverageOrderValue: number;
  rewardDistribution: { percentageCount: number; fixedCount: number; averagePercentage: number };
  timelineBars: CampaignTimelineBar[]; channelBreakdown: CampaignChannelBreakdown;
  campaignPerformance: CampaignPerformanceRow[]; recentRedemptions: RecentRedemptionItem[];
  generatedAt: string;
}

// Narrow persistence records deliberately exclude customer contact information.
export interface AnalyticsVoucher {
  id: string; campaign_id: string; campaign_rule_id: string; customer_id: string;
  promo_code: string; status: VoucherStatus; issued_at: string; expires_at: string;
  redeemed_at: string | null; redeemed_reservation_id: string | null;
  redeemed_discount_amount: number | null;
  reward_snapshot: { rewardType?: RewardType; reward_type?: RewardType; rewardValue?: number; reward_value?: number };
}
export interface AnalyticsReservation {
  id: string; reference_code: string; source: 'WEB' | 'KIOSK'; status: string;
  requested_voucher_id: string | null; confirmed_at: string | null;
  gross_amount_due: number; amount_due: number;
}
export interface AnalyticsRule {
  id: string; campaign_id: string; label: string; version: number;
  reward_type: RewardType; reward_value: number; rule_definition: RuleDefinitionV1;
}
export interface CampaignAnalyticsData {
  timeZone: string;
  campaigns: Array<{ id: string; name: string; status: CampaignStatus; starts_at: string | null; ends_at: string | null; created_at: string }>;
  rules: AnalyticsRule[]; vouchers: AnalyticsVoucher[]; reservations: AnalyticsReservation[];
}
export interface CampaignAnalyticsRepository { load(): Promise<CampaignAnalyticsData> }
