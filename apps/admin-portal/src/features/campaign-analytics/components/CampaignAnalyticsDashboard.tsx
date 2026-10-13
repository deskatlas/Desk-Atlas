'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { campaignAnalyticsRanges, type CampaignAnalyticsRange, type CampaignAnalyticsSnapshot } from '@deskatlas/domain';
import { useActiveTabPolling } from '@deskatlas/ui';
import { useAuth } from '../../auth';
import { KpiMetricsGrid } from './KpiMetricsGrid';
import { ActivityTimelineChart } from './ActivityTimelineChart';
import { ChannelBreakdownCard } from './ChannelBreakdownCard';
import { CampaignPerformanceTable } from './CampaignPerformanceTable';
import { RecentRedemptionsFeed } from './RecentRedemptionsFeed';
import s from './analytics.module.css';

// MS-43: PRD-F25, SDD-C19, QAD-TC43. Supports signed RPC and Supabase login sessions.
export function CampaignAnalyticsDashboard() {
  const { user } = useAuth();
  const [range, setRange] = useState<CampaignAnalyticsRange>('30d');
  const [snapshot, setSnapshot] = useState<CampaignAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportType, setExportType] = useState<'summary' | 'redemptions'>('summary');
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [exporting, setExporting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const exportButton = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/campaigns/analytics?range=${range}`, { headers: { Authorization: `Bearer ${user?.token ?? ''}` }, cache: 'no-store', signal: active.signal });
      if (!response.ok) throw new Error(response.status === 403 ? 'We could not verify your administrator session. Please sign out and sign in again to refresh it.' : 'Unable to load analytics. Please refresh to try again.');
      const data: CampaignAnalyticsSnapshot = await response.json();
      if (!active.signal.aborted) setSnapshot(data);
    } catch (failure) {
      if (!active.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load analytics.');
    } finally { if (!active.signal.aborted) setLoading(false); }
  }, [range, user?.token]);
  useEffect(() => { setSnapshot(null); void load(); return () => controller.current?.abort(); }, [load]);
  useActiveTabPolling(load, 60000, { immediate: false, enabled: Boolean(user?.token) });
  useEffect(() => {
    if (!exportOpen) return;
    cancelButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) setExportOpen(false);
      if (event.key === 'Tab') {
        const focusable = document.querySelectorAll<HTMLElement>('[data-export-dialog] button:not(:disabled), [data-export-dialog] select');
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); exportButton.current?.focus(); };
  }, [exportOpen, exporting]);
  const download = async () => {
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range, type: exportType, format: exportFormat });
      const response = await fetch(`/api/admin/campaigns/analytics/export?${params}`, { headers: { Authorization: `Bearer ${user?.token ?? ''}` }, cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to export analytics. Please check your session and try again.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `campaign-${exportType}-${range}.${exportFormat}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportOpen(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Export failed.'); }
    finally { setExporting(false); }
  };
  return <main data-screen-label="PromoAnalytics" className={s.page}>
    <nav aria-label="Dashboard views" className={s.actions} style={{ marginBottom: 20 }}><Link className={s.button} href="/manage">Operational Overview</Link><Link className={`${s.button} ${s.active}`} aria-current="page" href="/manage/campaign-analytics">Campaign Analytics</Link></nav>
    <header className={s.header}><div><h1>Promotional Campaigns Analytics</h1><p className={s.muted}>Campaign telemetry, voucher redemptions, and marketing ROI reports</p></div><div className={s.actions}><span className={s.badge} data-status={!loading && !error ? 'LIVE' : undefined} role="status">{loading ? 'Updating ...' : error ? 'Live Update Unavailable' : 'Refreshes every minute'}</span><button className={s.button} disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button><button className={s.button} ref={exportButton} onClick={() => setExportOpen(true)}>Export Reports</button></div></header>
    <div className={s.actions} aria-label="Time range">{Object.entries(campaignAnalyticsRanges).map(([id, label]) => <button key={id} className={s.button} aria-pressed={range === id} onClick={() => setRange(id as CampaignAnalyticsRange)}>{label}</button>)}</div>
    {error && <p role="alert">{error} <Link href="/manage/login">Sign in</Link></p>}
    {loading && !snapshot && <p role="status">Loading campaign analytics…</p>}
    {snapshot && <><p className={`${s.muted} ${s.metadata}`}>{snapshot.rangeLabel} · {snapshot.timeZone} · Updated {new Date(snapshot.generatedAt).toLocaleString('en-PH', { timeZone: snapshot.timeZone })}</p><KpiMetricsGrid snapshot={snapshot} /><ActivityTimelineChart bars={snapshot.timelineBars} /><ChannelBreakdownCard snapshot={snapshot} /><CampaignPerformanceTable rows={snapshot.campaignPerformance} /><RecentRedemptionsFeed items={snapshot.recentRedemptions} timeZone={snapshot.timeZone} /><p className={s.muted}>Issuance, redemption, and expiry use their own event dates. Rates divide period events by vouchers issued in the period and can exceed 100% when older vouchers are redeemed or expire. Previous period compares an equal elapsed window. ROI measures gross revenue divided by discounts, not incremental profit.</p></>}
    {exportOpen && <div className={s.dialog}><section data-export-dialog className={s.card} role="dialog" aria-modal="true" aria-labelledby="campaign-export-title"><h2 id="campaign-export-title">Export Campaign Reports</h2><p className={s.muted}>Exports all matching records for {campaignAnalyticsRanges[range]}.</p><div className={s.actions}><select aria-label="Report type" className={s.input} value={exportType} onChange={e => setExportType(e.target.value as 'summary' | 'redemptions')}><option value="summary">Campaign Performance Summary</option><option value="redemptions">Detailed Redemptions Audit Log</option></select><select aria-label="Export format" className={s.input} value={exportFormat} onChange={e => setExportFormat(e.target.value as 'xlsx' | 'csv')}><option value="xlsx">Excel XLSX</option><option value="csv">CSV</option></select><button ref={cancelButton} className={s.button} disabled={exporting} onClick={() => setExportOpen(false)}>Cancel</button><button className={s.button} disabled={exporting} onClick={() => void download()}>{exporting ? 'Exporting…' : 'Download'}</button></div>{error && <p role="alert">{error}</p>}</section></div>}
  </main>;
}
