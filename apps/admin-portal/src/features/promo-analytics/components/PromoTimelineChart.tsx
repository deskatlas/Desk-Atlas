import React from 'react';
import { formatPromoCurrency, type PromoTimelineBar } from '@deskatlas/domain';
import s from './promoAnalytics.module.css';

// MS-74: PRD-F15, DSD-UI11, QAD-TC43. Vanilla CSS activity timeline bar chart.
export function PromoTimelineChart({ bars }: { bars: PromoTimelineBar[] }) {
  return (
    <section className={s.card}>
      <h2>Promotional Activity Timeline</h2>
      <p className={s.muted}>Dark green: promotional bookings · Amber: discounts granted (₱)</p>
      <div className={s.chart}>
        {bars.map((bar) => {
          const description = `${bar.label} | Bookings: ${bar.bookingsCount} | Discount: ${formatPromoCurrency(
            bar.discountAmount
          )} | Attributed: ${formatPromoCurrency(bar.attributedRevenue)}`;

          return (
            <div
              key={bar.date}
              className={s.bucket}
              title={description}
              aria-label={description}
              tabIndex={0}
            >
              <div className={s.bars}>
                <div
                  className={s.bar}
                  style={{ height: `${bar.bookingsHeightPercentage}%` }}
                />
                <div
                  className={`${s.bar} ${s.accent}`}
                  style={{ height: `${bar.discountHeightPercentage}%` }}
                />
              </div>
              <span className={s.muted}>{bar.label}</span>
            </div>
          );
        })}
      </div>
      {bars.every((b) => !b.bookingsCount && !b.discountAmount) && (
        <p className={s.muted} style={{ marginTop: 12 }}>
          No promotional booking activity in this period.
        </p>
      )}
    </section>
  );
}
