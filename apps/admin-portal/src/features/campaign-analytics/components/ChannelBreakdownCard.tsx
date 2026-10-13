import React from 'react';
import type { CampaignAnalyticsSnapshot } from '@deskatlas/domain';
import s from './analytics.module.css';

export function ChannelBreakdownCard({ snapshot }: { snapshot: CampaignAnalyticsSnapshot }) {
  const c = snapshot.channelBreakdown;
  const r = snapshot.rewardDistribution;
  const total = r.percentageCount + r.fixedCount;
  const m = snapshot.summaryMetrics;
  const max = Math.max(1, m.attributedGrossRevenue, m.totalDiscountsGranted);
  return <div className={s.panels}>
    <section className={s.card}><h2>Redemption Channel Split</h2><div className={s.meter} aria-hidden="true"><span style={{ width: `${c.webRedemptionsPercentage}%` }} /><span className={s.accent} style={{ width: `${c.kioskRedemptionsPercentage}%` }} /></div><p className={s.muted}>Web: {c.webRedemptionsPercentage}% ({c.webRedemptionsCount} redemptions)</p><p className={s.muted}>Kiosk: {c.kioskRedemptionsPercentage}% ({c.kioskRedemptionsCount} redemptions)</p><p className={s.muted}>Tracks where customers apply promo discounts.</p></section>
    <section className={s.card}><h2>Reward Value Distribution</h2><div className={s.meter} aria-hidden="true"><span style={{ width: `${total ? r.percentageCount / total * 100 : 0}%` }} /><span className={s.accent} style={{ width: `${total ? r.fixedCount / total * 100 : 0}%` }} /></div><p className={s.muted}>Percentage discounts: {r.percentageCount} · Fixed discounts: {r.fixedCount}</p><p className={s.muted}>Average percentage reward: {r.averagePercentage}% off</p></section>
    <section className={s.card}><h2>Discount Burn vs. Attributed Revenue</h2><p className={s.muted}>Discounts: {m.formattedTotalDiscountsGranted}</p><div className={s.meter} aria-hidden="true"><span className={s.accent} style={{ width: `${m.totalDiscountsGranted / max * 100}%` }} /></div><p className={s.muted}>Gross revenue: {m.formattedAttributedGrossRevenue}</p><div className={s.meter} aria-hidden="true"><span style={{ width: `${m.attributedGrossRevenue / max * 100}%` }} /></div></section>
  </div>;
}
