import type {
  AnalyticsVoucher, CampaignAnalyticsData, CampaignAnalyticsRange, CampaignAnalyticsRepository,
  CampaignAnalyticsSnapshot, CampaignSummaryMetric, RecentRedemptionItem,
} from '../models/campaignAnalytics';

// MS-43: PRD-F25, SDD-C14/C19, QAD-TC43. Event counts use their own timestamps.
const DAY = 86400000;
export const campaignAnalyticsRanges: Record<CampaignAnalyticsRange, string> = {
  today: 'Today', '7d': 'Last 7 Days', '30d': 'Last 30 Days', month: 'This Month', year: 'This Year', all: 'All Time',
};
export function isCampaignAnalyticsRange(value: string): value is CampaignAnalyticsRange {
  return Object.hasOwn(campaignAnalyticsRanges, value);
}
export const formatCampaignCurrency = (value: number): string => `₱ ${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (value: number) => Math.round(value * 100) / 100;
const ratio = (n: number, d: number) => d ? money(n / d) : 0;
const percent = (n: number, d: number) => ratio(n * 100, d);
const dateKey = (time: number, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);

function midnight(key: string, timeZone: string): number {
  const target = Date.parse(`${key}T00:00:00Z`);
  let result = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(result);
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    result += target - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  }
  return result;
}

export class CampaignAnalyticsService {
  constructor(private readonly repository: CampaignAnalyticsRepository, private readonly now: () => Date = () => new Date()) {}

  async getSnapshot(range: CampaignAnalyticsRange = '30d'): Promise<CampaignAnalyticsSnapshot> {
    const data = await this.repository.load();
    const end = this.now().getTime();
    const today = dateKey(end, data.timeZone);
    const shifted = new Date(`${today}T00:00:00Z`);
    if (range === '7d' || range === '30d') shifted.setUTCDate(shifted.getUTCDate() - (range === '7d' ? 6 : 29));
    if (range === 'month') shifted.setUTCDate(1);
    if (range === 'year') shifted.setUTCMonth(0, 1);
    const start = range === 'all' ? -Infinity : midnight(shifted.toISOString().slice(0, 10), data.timeZone);
    const current = this.aggregate(data, start, end);
    const previous = range === 'all' ? null : this.aggregate(data, start - (end - start), start - 1).summary;
    const eventTimes = [...current.issued.map(v => Date.parse(v.issued_at)), ...current.redeemed.map(v => Date.parse(v.redeemed_at!))];
    const chartStart = Number.isFinite(start) ? start : eventTimes.reduce((earliest, time) => Math.min(earliest, time), end);
    const firstDay = Date.parse(`${dateKey(chartStart, data.timeZone)}T00:00:00Z`);
    const lastDay = Date.parse(`${today}T00:00:00Z`);
    const days = Math.round((lastDay - firstDay) / DAY) + 1;
    const bucketDays = Math.max(1, Math.ceil(days / 14));
    const bars = Array.from({ length: Math.ceil(days / bucketDays) }, (_, i) => {
      const date = new Date(firstDay + i * bucketDays * DAY).toISOString().slice(0, 10);
      return { date, label: new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)), issuedCount: 0, redeemedCount: 0, discountAmount: 0, attributedRevenue: 0, issuedHeightPercentage: 0, redeemedHeightPercentage: 0 };
    });
    const bucket = (timestamp: string) => bars[Math.floor((Date.parse(`${dateKey(Date.parse(timestamp), data.timeZone)}T00:00:00Z`) - firstDay) / DAY / bucketDays)];
    current.issued.forEach(v => { bucket(v.issued_at).issuedCount++; });
    current.redeemed.forEach(v => {
      const bar = bucket(v.redeemed_at!);
      bar.redeemedCount++;
      bar.discountAmount = money(bar.discountAmount + Number(v.redeemed_discount_amount));
      bar.attributedRevenue = money(bar.attributedRevenue + Number(current.reservations.get(v.redeemed_reservation_id!)!.gross_amount_due));
    });
    const max = Math.max(1, ...bars.flatMap(b => [b.issuedCount, b.redeemedCount]));
    bars.forEach(b => { b.issuedHeightPercentage = percent(b.issuedCount, max); b.redeemedHeightPercentage = percent(b.redeemedCount, max); });
    const web = current.redeemed.filter(v => current.reservations.get(v.redeemed_reservation_id!)!.source === 'WEB');
    const kiosk = current.redeemed.filter(v => current.reservations.get(v.redeemed_reservation_id!)!.source === 'KIOSK');
    const sumDiscount = (vouchers: AnalyticsVoucher[]) => money(vouchers.reduce((sum, v) => sum + Number(v.redeemed_discount_amount), 0));
    const percentageRewards = current.redeemed.filter(v => (v.reward_snapshot.rewardType ?? v.reward_snapshot.reward_type) === 'PERCENTAGE_DISCOUNT');
    const standard = data.reservations.filter(r => !r.requested_voucher_id && !current.redeemed.some(v => v.redeemed_reservation_id === r.id) && ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(r.status) && r.confirmed_at && Date.parse(r.confirmed_at) >= start && Date.parse(r.confirmed_at) <= end);
    return {
      range, rangeLabel: campaignAnalyticsRanges[range], timeZone: data.timeZone,
      summaryMetrics: current.summary, previousSummaryMetrics: previous,
      standardAverageOrderValue: ratio(standard.reduce((sum, r) => sum + Number(r.gross_amount_due), 0), standard.length),
      rewardDistribution: { percentageCount: percentageRewards.length, fixedCount: current.redeemed.length - percentageRewards.length, averagePercentage: ratio(percentageRewards.reduce((sum, v) => sum + Number(v.reward_snapshot.rewardValue ?? v.reward_snapshot.reward_value ?? 0), 0), percentageRewards.length) },
      timelineBars: bars,
      channelBreakdown: { webRedemptionsCount: web.length, kioskRedemptionsCount: kiosk.length, webRedemptionsPercentage: percent(web.length, current.redeemed.length), kioskRedemptionsPercentage: percent(kiosk.length, current.redeemed.length), webDiscountTotal: sumDiscount(web), kioskDiscountTotal: sumDiscount(kiosk) },
      campaignPerformance: data.rules.map(rule => {
        const campaign = data.campaigns.find(c => c.id === rule.campaign_id)!;
        const issued = current.issued.filter(v => v.campaign_rule_id === rule.id);
        const redeemed = current.redeemed.filter(v => v.campaign_rule_id === rule.id);
        const discounts = sumDiscount(redeemed);
        const revenue = money(redeemed.reduce((sum, v) => sum + Number(current.reservations.get(v.redeemed_reservation_id!)!.gross_amount_due), 0));
        return { campaignId: campaign.id, campaignName: campaign.name, status: campaign.status, startsAt: campaign.starts_at, endsAt: campaign.ends_at, createdAt: campaign.created_at, ruleId: rule.id, ruleLabel: rule.label, ruleVersion: rule.version,
          conditionSummary: rule.rule_definition.conditions.map(c => `${c.threshold} ${c.metric.toLowerCase().replaceAll('_', ' ')}`).join(rule.rule_definition.combine === 'ALL' ? ' + ' : ' or '), rewardType: rule.reward_type, rewardValue: Number(rule.reward_value), vouchersIssued: issued.length, vouchersRedeemed: redeemed.length, redemptionRatePercentage: percent(redeemed.length, issued.length), discountsGranted: discounts, formattedDiscountsGranted: formatCampaignCurrency(discounts), attributedRevenue: revenue, formattedAttributedRevenue: formatCampaignCurrency(revenue), roiMultiple: ratio(revenue, discounts) };
      }),
      recentRedemptions: [...current.redeemed].sort((a, b) => Date.parse(b.redeemed_at!) - Date.parse(a.redeemed_at!) || a.id.localeCompare(b.id)).map(v => {
        const r = current.reservations.get(v.redeemed_reservation_id!)!;
        const masked = `***${v.customer_id.replaceAll('-', '').slice(-6).toUpperCase()}`;
        const discount = Number(v.redeemed_discount_amount);
        return { voucherId: v.id, promoCode: v.promo_code, customerId: masked, customerCode: masked, reservationId: r.id, reservationReference: r.reference_code, redeemedAt: v.redeemed_at!, discountAmount: discount, formattedDiscountAmount: formatCampaignCurrency(discount), netPaidAmount: Number(r.amount_due), formattedNetPaidAmount: formatCampaignCurrency(Number(r.amount_due)), channel: r.source } satisfies RecentRedemptionItem;
      }), generatedAt: new Date(end).toISOString(),
    };
  }

  private aggregate(data: CampaignAnalyticsData, start: number, end: number) {
    const within = (time: string | null) => time !== null && Date.parse(time) >= start && Date.parse(time) <= end;
    const reservations = new Map(data.reservations.map(r => [r.id, r]));
    const issued = data.vouchers.filter(v => within(v.issued_at));
    const redeemed = data.vouchers.filter(v => {
      const r = reservations.get(v.redeemed_reservation_id ?? '');
      return v.status === 'USED' && within(v.redeemed_at) && r && ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(r.status);
    });
    const expired = data.vouchers.filter(v => (v.status === 'EXPIRED' || (v.status === 'AVAILABLE' && Date.parse(v.expires_at) <= end)) && within(v.expires_at));
    const discount = money(redeemed.reduce((sum, v) => sum + Number(v.redeemed_discount_amount), 0));
    const gross = money(redeemed.reduce((sum, v) => sum + Number(reservations.get(v.redeemed_reservation_id!)!.gross_amount_due), 0));
    const summary: CampaignSummaryMetric = { vouchersIssued: issued.length, vouchersRedeemed: redeemed.length, redemptionRatePercentage: percent(redeemed.length, issued.length), totalDiscountsGranted: discount, formattedTotalDiscountsGranted: formatCampaignCurrency(discount), attributedGrossRevenue: gross, formattedAttributedGrossRevenue: formatCampaignCurrency(gross), marketingRoiMultiple: ratio(gross, discount), averageOrderValue: ratio(gross, redeemed.length), formattedAverageOrderValue: formatCampaignCurrency(ratio(gross, redeemed.length)), uniqueParticipantsCount: new Set([...issued, ...redeemed].map(v => v.customer_id)).size, vouchersExpired: expired.length, breakageRatePercentage: percent(expired.length, issued.length) };
    return { summary, issued, redeemed, reservations };
  }
}
