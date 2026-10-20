'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  promoAnalyticsRanges,
  type PromoAnalyticsRange,
  type PromoAnalyticsSnapshot,
} from '@deskatlas/domain';
import { useActiveTabPolling } from '@deskatlas/ui';
import { useAuth } from '../../auth';
import { PromoKpiGrid } from './PromoKpiGrid';
import { PromoTimelineChart } from './PromoTimelineChart';
import { PromoChannelBreakdown } from './PromoChannelBreakdown';
import { PromoPerformanceTable } from './PromoPerformanceTable';
import { RecentPromoBookingsFeed } from './RecentPromoBookingsFeed';
import { PromoExportModal } from './PromoExportModal';
import s from './promoAnalytics.module.css';

// MS-74: PRD-F10, PRD-F15, PRD-F16, PRD-F25, SDD-C7, SDD-C11, SDD-C19, DSD-UI4, DSD-UI11, ERD-E9/E10/E19, QAD-TC43.
export function PromoAnalyticsDashboard() {
  const { user } = useAuth();
  const [range, setRange] = useState<PromoAnalyticsRange>('30d');
  const [snapshot, setSnapshot] = useState<PromoAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportType, setExportType] = useState<'summary' | 'bookings'>('summary');
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);
  const exportButton = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/promotions/analytics?range=${range}`, {
        headers: { Authorization: `Bearer ${user?.token ?? ''}` },
        cache: 'no-store',
        signal: active.signal,
      });

      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? 'We could not verify your administrator session. Please sign out and sign in again to refresh it.'
            : 'Unable to load promo analytics. Please refresh to try again.'
        );
      }

      const data: PromoAnalyticsSnapshot = await response.json();
      if (!active.signal.aborted) setSnapshot(data);
    } catch (failure) {
      if (!active.signal.aborted) {
        setError(failure instanceof Error ? failure.message : 'Unable to load promo analytics.');
      }
    } finally {
      if (!active.signal.aborted) setLoading(false);
    }
  }, [range, user?.token]);

  useEffect(() => {
    setSnapshot(null);
    void load();
    return () => controller.current?.abort();
  }, [load]);

  useActiveTabPolling(load, 60000, { immediate: false, enabled: Boolean(user?.token) });

  const handleDownload = async () => {
    setExporting(true);
    setExportError(null);

    try {
      const params = new URLSearchParams({
        range,
        type: exportType,
        format: exportFormat,
      });

      const response = await fetch(`/api/admin/promotions/analytics/export?${params}`, {
        headers: { Authorization: `Bearer ${user?.token ?? ''}` },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('Unable to export promo analytics. Please check your session and try again.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `promo-${exportType}-${range}.${exportFormat}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportOpen(false);
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <main data-screen-label="PromoAnalytics" className={s.page}>
      <nav aria-label="Dashboard views" className={s.actions} style={{ marginBottom: 20 }}>
        <Link className={s.button} href="/manage">
          Operational Overview
        </Link>
        <Link className={s.button} href="/manage/campaign-analytics">
          Campaign Analytics
        </Link>
        <Link
          className={`${s.button} ${s.active}`}
          aria-current="page"
          href="/manage/promo-analytics"
        >
          Promo Analytics
        </Link>
      </nav>

      <header className={s.header}>
        <div>
          <h1>Promo Analytics</h1>
          <p className={s.muted}>
            Promotional rates telemetry, discount utilization, and booking ROI reports
          </p>
        </div>
        <div className={s.actions}>
          <span
            className={s.badge}
            data-status={!loading && !error ? 'LIVE' : undefined}
            role="status"
          >
            {loading ? 'Updating ...' : error ? 'Live Update Unavailable' : 'Refreshes every minute'}
          </span>
          <button className={s.button} disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            className={s.button}
            ref={exportButton}
            onClick={() => {
              setExportError(null);
              setExportOpen(true);
            }}
          >
            Export Reports
          </button>
        </div>
      </header>

      <div className={s.actions} aria-label="Time range">
        {Object.entries(promoAnalyticsRanges).map(([id, label]) => (
          <button
            key={id}
            className={s.button}
            aria-pressed={range === id}
            onClick={() => setRange(id as PromoAnalyticsRange)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" style={{ color: '#DC2626', marginTop: 16 }}>
          {error} <Link href="/manage/login">Sign in</Link>
        </p>
      )}

      {loading && !snapshot && (
        <p role="status" style={{ marginTop: 20 }}>
          Loading promo analytics…
        </p>
      )}

      {snapshot && (
        <>
          <p className={`${s.muted} ${s.metadata}`}>
            {snapshot.rangeLabel} · {snapshot.timeZone} · Updated{' '}
            {new Date(snapshot.generatedAt).toLocaleString('en-PH', {
              timeZone: snapshot.timeZone,
            })}
          </p>

          <PromoKpiGrid snapshot={snapshot} />

          <PromoTimelineChart bars={snapshot.timelineBars} />

          <PromoChannelBreakdown snapshot={snapshot} />

          <PromoPerformanceTable rows={snapshot.promotionsPerformance} />

          <RecentPromoBookingsFeed
            items={snapshot.recentBookings}
            timeZone={snapshot.timeZone}
          />

          <p className={s.muted} style={{ marginTop: 20 }}>
            Discounts granted calculate the difference between standard rack price and promotional price for confirmed bookings. Previous period compares an equal elapsed window. ROI measures attributed gross revenue divided by discounts granted.
          </p>
        </>
      )}

      <PromoExportModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        onExport={() => void handleDownload()}
        range={range}
        exportType={exportType}
        setExportType={setExportType}
        exportFormat={exportFormat}
        setExportFormat={setExportFormat}
        exporting={exporting}
        error={exportError}
      />
    </main>
  );
}
