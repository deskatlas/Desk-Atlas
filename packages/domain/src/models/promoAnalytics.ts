import type { PromotionalRate, RateTargetType } from './promotionalRate';

// MS-74: PRD-F10, PRD-F15, PRD-F16, PRD-F25, SDD-C7, SDD-C11, SDD-C19, DSD-UI4, DSD-UI11, ERD-E9, ERD-E10, ERD-E19, QAD-TC43.
export type PromoAnalyticsRange = 'today' | '7d' | '30d' | 'month' | 'year' | 'all';

export interface PromoSummaryMetrics {
  activePromotionsCount: number;
  totalPromoBookings: number;
  totalDiscountsGranted: number;
  formattedTotalDiscountsGranted: string;
  attributedGrossRevenue: number;
  formattedAttributedGrossRevenue: string;
  promoRoiMultiple: number;
  averageOrderValue: number;
  formattedAverageOrderValue: string;
  uniqueCustomersCount: number;
  expiredPromotionsCount: number;
}

export interface PromoTimelineBar {
  date: string;
  label: string;
  bookingsCount: number;
  discountAmount: number;
  attributedRevenue: number;
  bookingsHeightPercentage: number;
  discountHeightPercentage: number;
}

export interface PromoChannelBreakdown {
  webBookingsCount: number;
  webBookingsPercentage: number;
  kioskBookingsCount: number;
  kioskBookingsPercentage: number;
  webDiscountTotal: number;
  kioskDiscountTotal: number;
  webRevenueTotal: number;
  kioskRevenueTotal: number;
}

export interface PromoRateTypeBreakdown {
  rateType: RateTargetType;
  bookingsCount: number;
  percentage: number;
  revenueTotal: number;
}

export interface PromoPerformanceRow {
  promotionId: string;
  name: string;
  rateType: RateTargetType;
  workspaceTemplateNames: string[];
  regularPrice: number;
  promotionalPrice: number;
  bookingsCount: number;
  discountsGranted: number;
  formattedDiscountsGranted: string;
  attributedRevenue: number;
  formattedAttributedRevenue: string;
  roiMultiple: number;
  startAt: string;
  endAt: string;
  isActive: boolean;
  status: 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'INACTIVE';
}

export interface RecentPromoBookingItem {
  reservationId: string;
  referenceCode: string;
  customerName: string;
  customerEmail: string;
  workspaceName: string;
  rateType: RateTargetType;
  promotionName: string;
  regularPrice: number;
  promotionalPrice: number;
  discountGranted: number;
  formattedDiscountGranted: string;
  amountDue: number;
  formattedAmountDue: string;
  channel: 'WEB' | 'KIOSK';
  bookedAt: string;
}

export interface PromoAnalyticsSnapshot {
  range: PromoAnalyticsRange;
  rangeLabel: string;
  timeZone: string;
  summaryMetrics: PromoSummaryMetrics;
  previousSummaryMetrics: PromoSummaryMetrics | null;
  timelineBars: PromoTimelineBar[];
  channelBreakdown: PromoChannelBreakdown;
  rateTypeBreakdown: PromoRateTypeBreakdown[];
  promotionsPerformance: PromoPerformanceRow[];
  recentBookings: RecentPromoBookingItem[];
  generatedAt: string;
}

export interface PromoAnalyticsBookingRecord {
  id: string;
  referenceCode: string;
  source: 'WEB' | 'KIOSK';
  status: string;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  amountDue: number;
  rateSnapshot: number;
  createdAt: string;
  confirmedAt: string | null;
  workspaceTemplateId?: string;
  workspaceTemplateName?: string;
  rateType?: RateTargetType;
  startAt?: string;
  endAt?: string;
  durationHours?: number;
  promotionalRateId?: string | null;
  promotionName?: string | null;
  regularPrice?: number;
  discountGranted?: number;
  isPromotional?: boolean;
}

export interface PromoAnalyticsTemplateRecord {
  id: string;
  name: string;
  rateAmount: number;
  dayPassPrice?: number | null;
  nightPassPrice?: number | null;
}

export interface PromoAnalyticsData {
  timeZone: string;
  promotions: PromotionalRate[];
  templates: PromoAnalyticsTemplateRecord[];
  reservations: PromoAnalyticsBookingRecord[];
}

export interface PromoAnalyticsRepository {
  load(): Promise<PromoAnalyticsData>;
}
