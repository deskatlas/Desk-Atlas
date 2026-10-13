import React from 'react';
import { formatCampaignCurrency, type CampaignAnalyticsSnapshot, type CampaignSummaryMetric } from '@deskatlas/domain';
import s from './analytics.module.css';

export function KpiMetricsGrid({ snapshot }: { snapshot: CampaignAnalyticsSnapshot }) {
  const m = snapshot.summaryMetrics;
  const cards: Array<{ label: string; key: keyof CampaignSummaryMetric; value: string | number; note: string }> = [
    { label: 'Vouchers Issued', key: 'vouchersIssued', value: m.vouchersIssued, note: 'Vouchers earned in this period' },
    { label: 'Vouchers Redeemed', key: 'vouchersRedeemed', value: m.vouchersRedeemed, note: `${m.redemptionRatePercentage}% redemption rate` },
    { label: 'Total Discounts Granted', key: 'totalDiscountsGranted', value: m.formattedTotalDiscountsGranted, note: 'Realized promo budget burn' },
    { label: 'Attributed Gross Revenue', key: 'attributedGrossRevenue', value: m.formattedAttributedGrossRevenue, note: 'Gross booking revenue before discounts' },
    { label: 'Marketing ROI Multiple', key: 'marketingRoiMultiple', value: `${m.marketingRoiMultiple.toFixed(2)}x`, note: 'Gross revenue per peso of discount' },
    { label: 'Average Order Value (Promo)', key: 'averageOrderValue', value: m.formattedAverageOrderValue, note: `Standard AOV: ${formatCampaignCurrency(snapshot.standardAverageOrderValue)}` },
    { label: 'Active Customer Participants', key: 'uniqueParticipantsCount', value: m.uniqueParticipantsCount, note: 'Unique guests earning or redeeming' },
    { label: 'Expired & Unclaimed', key: 'vouchersExpired', value: m.vouchersExpired, note: `${m.breakageRatePercentage}% breakage rate` },
  ];
  return <div className={s.grid}>{cards.map(card => {
    const previous = snapshot.previousSummaryMetrics?.[card.key];
    const current = m[card.key];
    const trend = typeof previous === 'number' && typeof current === 'number'
      ? previous ? `${((current - previous) / previous * 100).toFixed(1)}% vs previous period` : current ? 'New activity vs previous period' : 'No change vs previous period'
      : 'Lifetime total';
    return <section className={s.card} key={card.label}><div className={s.muted}>{card.label}</div><strong className={s.value}>{card.value}</strong><div className={s.muted}>{card.note}</div><div className={s.muted} style={{ marginTop: 8 }}>{trend}</div></section>;
  })}</div>;
}
