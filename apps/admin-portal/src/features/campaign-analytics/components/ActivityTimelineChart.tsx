import React from 'react';
import { formatCampaignCurrency, type CampaignTimelineBar } from '@deskatlas/domain';
import s from './analytics.module.css';

export function ActivityTimelineChart({ bars }: { bars: CampaignTimelineBar[] }) {
  return <section className={s.card}><h2>Campaign Activity Timeline</h2><p className={s.muted}>Dark blue: issued · Amber: redeemed</p><div className={s.chart}>{bars.map(bar => {
    const description = `${bar.label} | Issued: ${bar.issuedCount} | Redeemed: ${bar.redeemedCount} | Discount: ${formatCampaignCurrency(bar.discountAmount)}`;
    return <div key={bar.date} className={s.bucket} title={description} aria-label={description} tabIndex={0}><div className={s.bars}><div className={s.bar} style={{ height: `${bar.issuedHeightPercentage}%` }} /><div className={`${s.bar} ${s.accent}`} style={{ height: `${bar.redeemedHeightPercentage}%` }} /></div><span className={s.muted}>{bar.label}</span></div>;
  })}</div>{bars.every(b => !b.issuedCount && !b.redeemedCount) && <p className={s.muted}>No voucher activity in this period.</p>}</section>;
}
