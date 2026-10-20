import React from 'react';
import type { PromoAnalyticsSnapshot, PromoSummaryMetrics } from '@deskatlas/domain';
import s from './promoAnalytics.module.css';

// MS-74: PRD-F15, PRD-F25, DSD-UI11, QAD-TC43. 8-card executive metric grid.
export function PromoKpiGrid({ snapshot }: { snapshot: PromoAnalyticsSnapshot }) {
  const m = snapshot.summaryMetrics;

  const cards: Array<{
    label: string;
    key: keyof PromoSummaryMetrics;
    value: string | number;
    note: string;
  }> = [
    {
      label: 'Active Promotions',
      key: 'activePromotionsCount',
      value: m.activePromotionsCount,
      note: 'Currently within active schedule',
    },
    {
      label: 'Total Promo Bookings',
      key: 'totalPromoBookings',
      value: m.totalPromoBookings,
      note: 'Confirmed bookings availing promo',
    },
    {
      label: 'Discounts Granted',
      key: 'totalDiscountsGranted',
      value: m.formattedTotalDiscountsGranted,
      note: 'Realized promo budget burn',
    },
    {
      label: 'Attributed Gross Revenue',
      key: 'attributedGrossRevenue',
      value: m.formattedAttributedGrossRevenue,
      note: 'Gross booking revenue collected',
    },
    {
      label: 'Promo ROI Multiple',
      key: 'promoRoiMultiple',
      value: `${m.promoRoiMultiple.toFixed(2)}x`,
      note: 'Gross revenue per peso discount',
    },
    {
      label: 'Average Order Value (Promo)',
      key: 'averageOrderValue',
      value: m.formattedAverageOrderValue,
      note: 'Average booking order value',
    },
    {
      label: 'Unique Customers',
      key: 'uniqueCustomersCount',
      value: m.uniqueCustomersCount,
      note: 'Unique guests availing promos',
    },
    {
      label: 'Expired & Inactive Promos',
      key: 'expiredPromotionsCount',
      value: m.expiredPromotionsCount,
      note: 'Past or deactivated promo rates',
    },
  ];

  return (
    <div className={s.grid}>
      {cards.map((card) => {
        const previous = snapshot.previousSummaryMetrics?.[card.key];
        const current = m[card.key];
        const trend =
          typeof previous === 'number' && typeof current === 'number'
            ? previous
              ? `${(((current - previous) / previous) * 100).toFixed(1)}% vs previous period`
              : current
              ? 'New activity vs previous period'
              : 'No change vs previous period'
            : 'Lifetime total';

        return (
          <section className={s.card} key={card.label}>
            <div className={s.muted}>{card.label}</div>
            <strong className={s.value}>{card.value}</strong>
            <div className={s.muted}>{card.note}</div>
            <div className={s.muted} style={{ marginTop: 8 }}>
              {trend}
            </div>
          </section>
        );
      })}
    </div>
  );
}
