'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import type { CampaignPerformanceRow } from '@deskatlas/domain';
import s from './analytics.module.css';

export type CampaignPerformanceSort = 'revenue' | 'redemptions' | 'roi' | 'created';
export function filterCampaignPerformance(rows: CampaignPerformanceRow[], search: string, status = 'ALL', sort: CampaignPerformanceSort = 'revenue') {
  const query = search.trim().toLowerCase();
  return rows.filter(r => (status === 'ALL' || r.status === status) && `${r.campaignName} ${r.ruleLabel}`.toLowerCase().includes(query))
    .sort((a, b) => sort === 'created' ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : sort === 'redemptions' ? b.vouchersRedeemed - a.vouchersRedeemed : sort === 'roi' ? b.roiMultiple - a.roiMultiple : b.attributedRevenue - a.attributedRevenue);
}
export function CampaignPerformanceTable({ rows }: { rows: CampaignPerformanceRow[] }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sort, setSort] = useState<CampaignPerformanceSort>('revenue');
  const filtered = filterCampaignPerformance(rows, search, status, sort);
  return <section className={s.card}><h2>Campaign & Rule Performance</h2><div className={s.toolbar}>
    <input className={s.input} aria-label="Search campaigns or rules" placeholder="Search campaigns or rules" value={search} onChange={e => setSearch(e.target.value)} />
    <select className={s.input} aria-label="Campaign status" value={status} onChange={e => setStatus(e.target.value)}>{['ALL', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'DRAFT'].map(value => <option key={value} value={value}>{value === 'ALL' ? 'All Statuses' : value}</option>)}</select>
    <select className={s.input} aria-label="Sort campaign performance" value={sort} onChange={e => setSort(e.target.value as CampaignPerformanceSort)}><option value="revenue">Attributed Revenue (High to Low)</option><option value="redemptions">Redemptions</option><option value="roi">ROI Multiple</option><option value="created">Creation Date</option></select>
  </div><div className={s.scroll}><table className={s.table}><thead><tr>{['Campaign & Rule', 'Status', 'Issued', 'Redeemed', 'Conversion Rate', 'Discounts Given', 'Attributed Revenue', 'ROI Multiple', 'Action'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{filtered.map(r => <tr key={r.ruleId}>
    <td><strong>{r.campaignName}</strong><div>{r.ruleLabel} <span className={s.badge}>v{r.ruleVersion}</span></div><div className={s.muted}>{r.conditionSummary} → {r.rewardValue}{r.rewardType === 'PERCENTAGE_DISCOUNT' ? '% off' : ' PHP off'}</div></td><td><span className={s.badge} data-status={r.status}>{r.status}</span></td><td>{r.vouchersIssued}</td><td>{r.vouchersRedeemed}</td><td>{r.redemptionRatePercentage}%<div className={s.meter}><span style={{ width: `${Math.min(100, r.redemptionRatePercentage)}%` }} /></div></td><td>{r.formattedDiscountsGranted}</td><td><strong>{r.formattedAttributedRevenue}</strong></td><td><span className={s.badge}>{r.roiMultiple.toFixed(2)}x · {r.roiMultiple > 3 ? 'Strong' : r.roiMultiple >= 1 ? 'Moderate' : 'Low'}</span></td><td><Link href="/manage/settings?tab=campaigns">View Rules in Settings</Link></td>
  </tr>)}</tbody></table></div>{!filtered.length && <p className={s.muted}>No campaigns match these filters.</p>}</section>;
}
