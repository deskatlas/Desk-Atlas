import React from 'react';
import type { PromoAnalyticsSnapshot } from '@deskatlas/domain';
import s from './promoAnalytics.module.css';

// MS-74: PRD-F15, PRD-F25, DSD-UI11, QAD-TC43. Channel split and rate type distribution cards.
export function PromoChannelBreakdown({ snapshot }: { snapshot: PromoAnalyticsSnapshot }) {
  const c = snapshot.channelBreakdown;
  const rates = snapshot.rateTypeBreakdown;
  const m = snapshot.summaryMetrics;
  const max = Math.max(1, m.attributedGrossRevenue, m.totalDiscountsGranted);

  return (
    <div className={s.panels}>
      <section className={s.card}>
        <h2>Booking Channel Split</h2>
        <div className={s.meter} aria-hidden="true">
          <span style={{ width: `${c.webBookingsPercentage}%` }} />
          <span className={s.accent} style={{ width: `${c.kioskBookingsPercentage}%` }} />
        </div>
        <p className={s.muted}>
          Web: {c.webBookingsPercentage}% ({c.webBookingsCount} bookings · {c.webRevenueTotal ? `₱ ${c.webRevenueTotal.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '₱ 0.00'})
        </p>
        <p className={s.muted}>
          Kiosk: {c.kioskBookingsPercentage}% ({c.kioskBookingsCount} bookings · {c.kioskRevenueTotal ? `₱ ${c.kioskRevenueTotal.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '₱ 0.00'})
        </p>
        <p className={s.muted}>Tracks where guests book promotional pricing.</p>
      </section>

      <section className={s.card}>
        <h2>Rate Type Distribution</h2>
        <div className={s.meter} aria-hidden="true">
          {rates.map((r, i) => (
            <span
              key={r.rateType}
              className={i % 2 === 1 ? s.accent : undefined}
              style={{ width: `${r.percentage}%` }}
              title={`${r.rateType}: ${r.percentage}%`}
            />
          ))}
        </div>
        {rates.length > 0 ? (
          rates.map((r) => (
            <p className={s.muted} key={r.rateType}>
              {r.rateType.replace('_', ' ')}: {r.percentage}% ({r.bookingsCount} bookings)
            </p>
          ))
        ) : (
          <p className={s.muted}>No rate type breakdown available.</p>
        )}
      </section>

      <section className={s.card}>
        <h2>Discount Burn vs Gross Revenue</h2>
        <p className={s.muted}>Discounts Granted: {m.formattedTotalDiscountsGranted}</p>
        <div className={s.meter} aria-hidden="true">
          <span
            className={s.accent}
            style={{ width: `${(m.totalDiscountsGranted / max) * 100}%` }}
          />
        </div>
        <p className={s.muted}>Gross Revenue: {m.formattedAttributedGrossRevenue}</p>
        <div className={s.meter} aria-hidden="true">
          <span style={{ width: `${(m.attributedGrossRevenue / max) * 100}%` }} />
        </div>
      </section>
    </div>
  );
}
