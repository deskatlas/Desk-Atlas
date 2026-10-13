import React from 'react';
import Link from 'next/link';
import type { RecentRedemptionItem } from '@deskatlas/domain';
import s from './analytics.module.css';

export function RecentRedemptionsFeed({ items, timeZone }: { items: RecentRedemptionItem[]; timeZone: string }) {
  return <section className={s.card}><h2>Recent Voucher Redemptions</h2><p className={s.muted}>Latest 20 redemptions. Export the full audit log for this period.</p><div className={s.scroll}><table className={s.table}><thead><tr>{['Timestamp', 'Promo Code', 'Customer ID', 'Reservation Ref', 'Discount Amount', 'Net Paid Amount', 'Channel'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{items.map(r => <tr key={r.voucherId}><td>{new Intl.DateTimeFormat('en-PH', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.redeemedAt))}</td><td><code>{r.promoCode}</code></td><td><code>{r.customerCode}</code></td><td><Link href={`/manage/reservations/${encodeURIComponent(r.reservationId)}`}>{r.reservationReference}</Link></td><td>-{r.formattedDiscountAmount}</td><td>{r.formattedNetPaidAmount}</td><td><span className={s.badge}>{r.channel}</span></td></tr>)}</tbody></table></div>{!items.length && <p className={s.muted}>No realized redemptions in this period.</p>}</section>;
}
