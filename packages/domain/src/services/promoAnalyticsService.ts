import type {
  PromoAnalyticsBookingRecord,
  PromoAnalyticsData,
  PromoAnalyticsRange,
  PromoAnalyticsRepository,
  PromoAnalyticsSnapshot,
  PromoChannelBreakdown,
  PromoPerformanceRow,
  PromoRateTypeBreakdown,
  PromoSummaryMetrics,
  PromoTimelineBar,
  RecentPromoBookingItem,
} from '../models/promoAnalytics';
import type { PromotionalRate, RateTargetType } from '../models/promotionalRate';

// MS-74: PRD-F10/F15/F16/F25, SDD-C7/C11/C19, DSD-UI4/UI11, ERD-E9/E10/E19, QAD-TC43.
const DAY = 86400000;

export const promoAnalyticsRanges: Record<PromoAnalyticsRange, string> = {
  today: 'Today',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  month: 'This Month',
  year: 'This Year',
  all: 'All Time',
};

export function isPromoAnalyticsRange(value: string): value is PromoAnalyticsRange {
  return Object.hasOwn(promoAnalyticsRanges, value);
}

export const formatPromoCurrency = (value: number): string =>
  `₱ ${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const money = (value: number): number => Math.round(value * 100) / 100;
const ratio = (n: number, d: number): number => (d ? money(n / d) : 0);
const percent = (n: number, d: number): number => ratio(n * 100, d);

const dateKey = (time: number, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(time);

function midnight(key: string, timeZone: string): number {
  const target = Date.parse(`${key}T00:00:00Z`);
  let result = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(result);
    const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    result += target - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  }
  return result;
}

interface QualifiedPromoBooking {
  record: PromoAnalyticsBookingRecord;
  promotion: PromotionalRate | null;
  promotionId: string;
  promotionName: string;
  workspaceName: string;
  rateType: RateTargetType;
  regularPrice: number;
  promotionalPrice: number;
  discountGranted: number;
  attributedRevenue: number;
  bookedAt: string;
  timestamp: number;
}

export class PromoAnalyticsService {
  constructor(
    private readonly repository: PromoAnalyticsRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getSnapshot(range: PromoAnalyticsRange = '30d'): Promise<PromoAnalyticsSnapshot> {
    const data = await this.repository.load();
    const end = this.now().getTime();
    const today = dateKey(end, data.timeZone);
    const shifted = new Date(`${today}T00:00:00Z`);

    if (range === '7d' || range === '30d') {
      shifted.setUTCDate(shifted.getUTCDate() - (range === '7d' ? 6 : 29));
    }
    if (range === 'month') {
      shifted.setUTCDate(1);
    }
    if (range === 'year') {
      shifted.setUTCMonth(0, 1);
    }

    const start =
      range === 'all'
        ? -Infinity
        : midnight(shifted.toISOString().slice(0, 10), data.timeZone);

    const qualifiedBookings = this.qualifyBookings(data);

    const currentBookings = qualifiedBookings.filter(
      (b) => b.timestamp >= start && b.timestamp <= end
    );

    const previousWindowDuration = Number.isFinite(start) ? end - start : 0;
    const previousBookings =
      range === 'all'
        ? null
        : qualifiedBookings.filter(
            (b) => b.timestamp >= start - previousWindowDuration && b.timestamp < start
          );

    const currentMetrics = this.computeSummaryMetrics(data.promotions, currentBookings, end);
    const previousMetrics = previousBookings
      ? this.computeSummaryMetrics(data.promotions, previousBookings, start - 1)
      : null;

    const timelineBars = this.buildTimelineBars(currentBookings, start, end, today, data.timeZone);
    const channelBreakdown = this.computeChannelBreakdown(currentBookings);
    const rateTypeBreakdown = this.computeRateTypeBreakdown(currentBookings);
    const promotionsPerformance = this.computePromotionsPerformance(data, currentBookings, end);
    const recentBookings = this.buildRecentBookings(currentBookings);

    return {
      range,
      rangeLabel: promoAnalyticsRanges[range],
      timeZone: data.timeZone,
      summaryMetrics: currentMetrics,
      previousSummaryMetrics: previousMetrics,
      timelineBars,
      channelBreakdown,
      rateTypeBreakdown,
      promotionsPerformance,
      recentBookings,
      generatedAt: new Date(end).toISOString(),
    };
  }

  private qualifyBookings(data: PromoAnalyticsData): QualifiedPromoBooking[] {
    const templateMap = new Map(data.templates.map((t) => [t.id, t]));
    const qualified: QualifiedPromoBooking[] = [];

    for (const res of data.reservations) {
      const statusUpper = res.status.toUpperCase();
      if (!['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(statusUpper)) {
        continue;
      }

      const bookedAt = res.confirmedAt || res.createdAt;
      const timestamp = Date.parse(bookedAt);
      const template = res.workspaceTemplateId ? templateMap.get(res.workspaceTemplateId) : undefined;

      // Check if booking was already explicitly flagged as promotional
      if (res.isPromotional || res.promotionalRateId || res.discountGranted !== undefined) {
        const promo = data.promotions.find((p) => p.id === res.promotionalRateId) || null;
        const rateType = res.rateType || promo?.rateType || 'HOURLY';
        const regularPrice = res.regularPrice ?? (template ? this.resolveTemplateRegularPrice(template, rateType) : res.rateSnapshot);
        const promoPrice = promo?.promotionalPrice ?? res.rateSnapshot;
        const duration = res.durationHours ?? (rateType === 'HOURLY' ? 1 : 1);
        const discount =
          res.discountGranted !== undefined
            ? res.discountGranted
            : Math.max(0, regularPrice - promoPrice) * duration;

        qualified.push({
          record: res,
          promotion: promo,
          promotionId: promo?.id ?? res.promotionalRateId ?? 'UNKNOWN_PROMO',
          promotionName: promo?.name ?? res.promotionName ?? 'Promotional Discount',
          workspaceName: res.workspaceTemplateName || template?.name || 'Workspace',
          rateType,
          regularPrice: money(regularPrice),
          promotionalPrice: money(promoPrice),
          discountGranted: money(discount),
          attributedRevenue: money(res.amountDue),
          bookedAt,
          timestamp,
        });
        continue;
      }

      // If not explicitly flagged, check for correlation with active promotions
      const matchingPromo = data.promotions.find((promo) => {
        if (res.workspaceTemplateId && !promo.workspaceTemplateIds.includes(res.workspaceTemplateId)) {
          return false;
        }
        if (res.rateType && promo.rateType !== res.rateType) {
          return false;
        }
        const startMs = Date.parse(promo.startAt);
        const endMs = Date.parse(promo.endAt);
        if (timestamp < startMs || timestamp > endMs) {
          return false;
        }
        // Match rate snapshot
        return Math.abs(res.rateSnapshot - promo.promotionalPrice) < 0.01;
      });

      if (matchingPromo) {
        const rateType = res.rateType || matchingPromo.rateType;
        const regularPrice = template ? this.resolveTemplateRegularPrice(template, rateType) : res.rateSnapshot;
        const duration = res.durationHours ?? (rateType === 'HOURLY' ? 1 : 1);
        const discount = Math.max(0, regularPrice - matchingPromo.promotionalPrice) * duration;

        qualified.push({
          record: res,
          promotion: matchingPromo,
          promotionId: matchingPromo.id,
          promotionName: matchingPromo.name,
          workspaceName: res.workspaceTemplateName || template?.name || 'Workspace',
          rateType,
          regularPrice: money(regularPrice),
          promotionalPrice: money(matchingPromo.promotionalPrice),
          discountGranted: money(discount),
          attributedRevenue: money(res.amountDue),
          bookedAt,
          timestamp,
        });
      }
    }

    return qualified;
  }

  private resolveTemplateRegularPrice(
    tpl: PromoAnalyticsData['templates'][number],
    rateType: RateTargetType
  ): number {
    if (rateType === 'DAY_PASS' && tpl.dayPassPrice !== null && tpl.dayPassPrice !== undefined) {
      return Number(tpl.dayPassPrice);
    }
    if (rateType === 'NIGHT_PASS' && tpl.nightPassPrice !== null && tpl.nightPassPrice !== undefined) {
      return Number(tpl.nightPassPrice);
    }
    return Number(tpl.rateAmount);
  }

  private computeSummaryMetrics(
    promotions: PromotionalRate[],
    bookings: QualifiedPromoBooking[],
    nowMs: number
  ): PromoSummaryMetrics {
    const activePromos = promotions.filter((p) => {
      const startMs = Date.parse(p.startAt);
      const endMs = Date.parse(p.endAt);
      return p.isActive && nowMs >= startMs && nowMs <= endMs;
    });

    const expiredPromos = promotions.filter((p) => {
      const endMs = Date.parse(p.endAt);
      return !p.isActive || nowMs > endMs;
    });

    const totalPromoBookings = bookings.length;
    const totalDiscountsGranted = money(bookings.reduce((sum, b) => sum + b.discountGranted, 0));
    const attributedGrossRevenue = money(bookings.reduce((sum, b) => sum + b.attributedRevenue, 0));
    const promoRoiMultiple = ratio(attributedGrossRevenue, totalDiscountsGranted);
    const averageOrderValue = ratio(attributedGrossRevenue, totalPromoBookings);

    const uniqueEmails = new Set(bookings.map((b) => b.record.customerEmail.toLowerCase().trim()));

    return {
      activePromotionsCount: activePromos.length,
      totalPromoBookings,
      totalDiscountsGranted,
      formattedTotalDiscountsGranted: formatPromoCurrency(totalDiscountsGranted),
      attributedGrossRevenue,
      formattedAttributedGrossRevenue: formatPromoCurrency(attributedGrossRevenue),
      promoRoiMultiple,
      averageOrderValue,
      formattedAverageOrderValue: formatPromoCurrency(averageOrderValue),
      uniqueCustomersCount: uniqueEmails.size,
      expiredPromotionsCount: expiredPromos.length,
    };
  }

  private buildTimelineBars(
    bookings: QualifiedPromoBooking[],
    start: number,
    end: number,
    today: string,
    timeZone: string
  ): PromoTimelineBar[] {
    const eventTimes = bookings.map((b) => b.timestamp);
    const chartStart = Number.isFinite(start)
      ? start
      : eventTimes.reduce((earliest, time) => Math.min(earliest, time), end);

    const firstDay = Date.parse(`${dateKey(chartStart, timeZone)}T00:00:00Z`);
    const lastDay = Date.parse(`${today}T00:00:00Z`);
    const days = Math.max(1, Math.round((lastDay - firstDay) / DAY) + 1);
    const bucketDays = Math.max(1, Math.ceil(days / 14));

    const bars: PromoTimelineBar[] = Array.from(
      { length: Math.ceil(days / bucketDays) },
      (_, i) => {
        const date = new Date(firstDay + i * bucketDays * DAY).toISOString().slice(0, 10);
        return {
          date,
          label: new Intl.DateTimeFormat('en-PH', {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(`${date}T00:00:00Z`)),
          bookingsCount: 0,
          discountAmount: 0,
          attributedRevenue: 0,
          bookingsHeightPercentage: 0,
          discountHeightPercentage: 0,
        };
      }
    );

    const getBucket = (time: number) => {
      const bookingDay = Date.parse(`${dateKey(time, timeZone)}T00:00:00Z`);
      const index = Math.floor((bookingDay - firstDay) / DAY / bucketDays);
      return bars[Math.min(bars.length - 1, Math.max(0, index))];
    };

    for (const b of bookings) {
      const bar = getBucket(b.timestamp);
      bar.bookingsCount++;
      bar.discountAmount = money(bar.discountAmount + b.discountGranted);
      bar.attributedRevenue = money(bar.attributedRevenue + b.attributedRevenue);
    }

    const maxBookings = Math.max(1, ...bars.map((b) => b.bookingsCount));
    const maxDiscount = Math.max(1, ...bars.map((b) => b.discountAmount));

    for (const bar of bars) {
      bar.bookingsHeightPercentage = percent(bar.bookingsCount, maxBookings);
      bar.discountHeightPercentage = percent(bar.discountAmount, maxDiscount);
    }

    return bars;
  }

  private computeChannelBreakdown(bookings: QualifiedPromoBooking[]): PromoChannelBreakdown {
    const web = bookings.filter((b) => b.record.source === 'WEB');
    const kiosk = bookings.filter((b) => b.record.source === 'KIOSK');
    const total = bookings.length;

    return {
      webBookingsCount: web.length,
      webBookingsPercentage: percent(web.length, total),
      kioskBookingsCount: kiosk.length,
      kioskBookingsPercentage: percent(kiosk.length, total),
      webDiscountTotal: money(web.reduce((sum, b) => sum + b.discountGranted, 0)),
      kioskDiscountTotal: money(kiosk.reduce((sum, b) => sum + b.discountGranted, 0)),
      webRevenueTotal: money(web.reduce((sum, b) => sum + b.attributedRevenue, 0)),
      kioskRevenueTotal: money(kiosk.reduce((sum, b) => sum + b.attributedRevenue, 0)),
    };
  }

  private computeRateTypeBreakdown(bookings: QualifiedPromoBooking[]): PromoRateTypeBreakdown[] {
    const map = new Map<RateTargetType, { count: number; revenue: number }>();

    for (const b of bookings) {
      const cur = map.get(b.rateType) ?? { count: 0, revenue: 0 };
      cur.count++;
      cur.revenue = money(cur.revenue + b.attributedRevenue);
      map.set(b.rateType, cur);
    }

    const total = bookings.length;
    return Array.from(map.entries()).map(([rateType, data]) => ({
      rateType,
      bookingsCount: data.count,
      percentage: percent(data.count, total),
      revenueTotal: data.revenue,
    }));
  }

  private computePromotionsPerformance(
    data: PromoAnalyticsData,
    bookings: QualifiedPromoBooking[],
    nowMs: number
  ): PromoPerformanceRow[] {
    const templateMap = new Map(data.templates.map((t) => [t.id, t]));

    return data.promotions
      .map((promo) => {
        const promoBookings = bookings.filter((b) => b.promotionId === promo.id);
        const bookingsCount = promoBookings.length;
        const discountsGranted = money(promoBookings.reduce((sum, b) => sum + b.discountGranted, 0));
        const attributedRevenue = money(promoBookings.reduce((sum, b) => sum + b.attributedRevenue, 0));
        const roiMultiple = ratio(attributedRevenue, discountsGranted);

        const workspaceNames = promo.workspaceTemplateIds.map(
          (id) => templateMap.get(id)?.name || id
        );

        const firstTemplate = templateMap.get(promo.workspaceTemplateIds[0]);
        const regularPrice = firstTemplate
          ? this.resolveTemplateRegularPrice(firstTemplate, promo.rateType)
          : promo.promotionalPrice;

        const startMs = Date.parse(promo.startAt);
        const endMs = Date.parse(promo.endAt);
        let status: PromoPerformanceRow['status'] = 'ACTIVE';
        if (!promo.isActive) {
          status = 'INACTIVE';
        } else if (nowMs < startMs) {
          status = 'UPCOMING';
        } else if (nowMs > endMs) {
          status = 'EXPIRED';
        }

        return {
          promotionId: promo.id,
          name: promo.name,
          rateType: promo.rateType,
          workspaceTemplateNames: workspaceNames,
          regularPrice: money(regularPrice),
          promotionalPrice: money(promo.promotionalPrice),
          bookingsCount,
          discountsGranted,
          formattedDiscountsGranted: formatPromoCurrency(discountsGranted),
          attributedRevenue,
          formattedAttributedRevenue: formatPromoCurrency(attributedRevenue),
          roiMultiple,
          startAt: promo.startAt,
          endAt: promo.endAt,
          isActive: promo.isActive,
          status,
        };
      })
      .sort(
        (a, b) =>
          b.attributedRevenue - a.attributedRevenue ||
          b.bookingsCount - a.bookingsCount ||
          a.name.localeCompare(b.name)
      );
  }

  private buildRecentBookings(bookings: QualifiedPromoBooking[]): RecentPromoBookingItem[] {
    return [...bookings]
      .sort((a, b) => b.timestamp - a.timestamp || a.record.id.localeCompare(b.record.id))
      .slice(0, 20)
      .map((b) => {
        const email = b.record.customerEmail;
        const parts = email.split('@');
        const maskedEmail =
          parts.length === 2 && parts[0].length > 1
            ? `${parts[0][0]}***@${parts[1]}`
            : email;

        const fullName = `${b.record.customerFirstName} ${b.record.customerLastName}`.trim();

        return {
          reservationId: b.record.id,
          referenceCode: b.record.referenceCode,
          customerName: fullName || 'Guest Customer',
          customerEmail: maskedEmail,
          workspaceName: b.workspaceName,
          rateType: b.rateType,
          promotionName: b.promotionName,
          regularPrice: b.regularPrice,
          promotionalPrice: b.promotionalPrice,
          discountGranted: b.discountGranted,
          formattedDiscountGranted: formatPromoCurrency(b.discountGranted),
          amountDue: b.attributedRevenue,
          formattedAmountDue: formatPromoCurrency(b.attributedRevenue),
          channel: b.record.source,
          bookedAt: b.bookedAt,
        };
      });
  }
}
