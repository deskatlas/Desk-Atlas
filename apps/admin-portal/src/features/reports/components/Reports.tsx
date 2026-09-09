"use client";

import React, { useCallback, useEffect, useState } from 'react';
import type {
  AdminReportExportType,
  AdminReportRange,
  AdminReportsSnapshot,
} from '@deskatlas/domain';
import { getRevenueBarLabelInfo } from '@deskatlas/domain';
import {
  downloadAdminReport,
  fetchAdminReportsSnapshot,
} from '../../../app/lib/adminReportsApi';

export function Reports() {
  const [range, setRange] = useState<AdminReportRange>('30days');
  const [snapshot, setSnapshot] = useState<AdminReportsSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingType, setExportingType] = useState<string | null>(null);

  const loadData = useCallback(async (selectedRange: AdminReportRange) => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAdminReportsSnapshot(selectedRange);
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(range);
  }, [range, loadData]);

  const handleDownload = async (exportType: AdminReportExportType, format: 'xlsx' | 'csv' = 'xlsx') => {
    try {
      setExportingType(exportType);
      await downloadAdminReport(exportType, range, format);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export report.');
    } finally {
      setExportingType(null);
    }
  };

  const metrics = snapshot?.summaryMetrics ?? [
    { label: 'Total Revenue', value: '₱ 0.00', trend: '0% vs previous period', positive: true, rawValue: 0 },
    { label: 'Occupancy Rate', value: '0%', trend: '0% vs previous period', positive: true, rawValue: 0 },
    { label: 'Total Bookings', value: '0', trend: '0% vs previous period', positive: true, rawValue: 0 },
    { label: 'No Shows & Cancellations', value: '0', trend: '0% vs previous period', positive: true, rawValue: 0 },
  ];

  return (
    <main data-screen-label="Reports" style={{ padding: '26px 28px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '22px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>Reports & Analytics</h1>
          <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>Operational metrics and financial performance</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => handleDownload('operations-summary', 'xlsx')}
            disabled={loading || Boolean(exportingType)}
            style={{
              background: 'var(--da-brand-dark)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '9px 16px',
              fontSize: '13px',
              fontWeight: 700,
              fontFamily: 'var(--da-font-family)',
              cursor: loading || Boolean(exportingType) ? 'not-allowed' : 'pointer',
              opacity: loading || Boolean(exportingType) ? 0.7 : 1,
              transition: 'opacity 0.15s ease',
            }}
          >
            {exportingType === 'operations-summary' ? 'Exporting...' : 'Export Summary (Excel)'}
          </button>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as AdminReportRange)}
            disabled={loading}
            style={{
              border: '1px solid var(--da-border)',
              borderRadius: '8px',
              padding: '9px 14px',
              fontSize: '13px',
              fontWeight: 700,
              fontFamily: 'var(--da-font-family)',
              background: '#fff',
              color: 'var(--da-text-primary)',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <option value="30days">Last 30 Days</option>
            <option value="7days">Last 7 Days</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
            <option value="today">Today</option>
          </select>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#b91c1c', fontSize: '13px', fontWeight: 600 }}>{error}</span>
          <button
            onClick={() => loadData(range)}
            style={{ background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '24px' }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '20px', boxShadow: 'var(--da-shadow-sm)', opacity: loading ? 0.7 : 1 }}>
            <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '8px' }}>{m.label}</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--da-brand-dark)', marginBottom: '8px', lineHeight: 1 }}>{m.value}</div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: m.positive !== false ? 'var(--da-success)' : 'var(--da-attention)', fontFamily: 'var(--da-font-family)' }}>
              {m.trend ?? 'Live database data'}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '20px', boxShadow: 'var(--da-shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0 }}>Revenue Overview</h3>
            {snapshot?.revenueOverview && (
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-text-secondary)' }}>
                7-Day Total: <strong style={{ color: 'var(--da-brand-dark)' }}>{snapshot.revenueOverview.formattedTotalAmount}</strong>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', height: '200px', gap: '10px', paddingTop: '20px' }}>
            {(snapshot?.revenueOverview?.bars ?? [
              { label: 'Sun', heightPercentage: 0, amount: 0, formattedAmount: '₱ 0.00', date: '' },
              { label: 'Mon', heightPercentage: 0, amount: 0, formattedAmount: '₱ 0.00', date: '' },
              { label: 'Tue', heightPercentage: 0, amount: 0, formattedAmount: '₱ 0.00', date: '' },
              { label: 'Wed', heightPercentage: 0, amount: 0, formattedAmount: '₱ 0.00', date: '' },
              { label: 'Thu', heightPercentage: 0, amount: 0, formattedAmount: '₱ 0.00', date: '' },
              { label: 'Fri', heightPercentage: 0, amount: 0, formattedAmount: '₱ 0.00', date: '' },
              { label: 'Sat', heightPercentage: 0, amount: 0, formattedAmount: '₱ 0.00', date: '' },
            ]).map((bar, i) => {
              const labelInfo = getRevenueBarLabelInfo(
                bar.heightPercentage,
                bar.amount,
                snapshot?.revenueOverview?.currency ?? 'PHP'
              );

              return (
                <div
                  key={i}
                  title={`${bar.label}: ${bar.formattedAmount}`}
                  data-testid={`revenue-bar-col-${i}`}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    height: '100%',
                    justifyContent: 'flex-end',
                    minWidth: 0,
                  }}
                >
                  {/* Label above bar for small bars (<25% height) or zero-value bars */}
                  {!labelInfo.isInsideBar && (
                    <span
                      data-testid={`revenue-bar-label-${i}`}
                      style={{
                        fontSize: '10px',
                        fontWeight: labelInfo.isZero ? 500 : 700,
                        color: labelInfo.isZero ? 'var(--da-text-secondary)' : 'var(--da-brand-dark)',
                        fontFamily: 'var(--da-font-family)',
                        whiteSpace: 'nowrap',
                        lineHeight: 1,
                        opacity: labelInfo.isZero ? 0.6 : 1,
                        pointerEvents: 'none',
                      }}
                    >
                      {labelInfo.formattedValue}
                    </span>
                  )}

                  {/* Bar element */}
                  <div
                    data-testid={`revenue-bar-${i}`}
                    style={{
                      width: '100%',
                      height: `${Math.max(bar.heightPercentage, 4)}%`,
                      background: 'var(--da-brand-dark)',
                      borderRadius: '4px 4px 0 0',
                      opacity: i === 6 ? 1 : 0.8,
                      transition: 'height 0.3s ease',
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'center',
                      paddingTop: labelInfo.isInsideBar ? '6px' : '0px',
                      boxSizing: 'border-box',
                      minHeight: '8px',
                    }}
                  >
                    {/* Label inside bar for tall bars (>= 25% height) */}
                    {labelInfo.isInsideBar && (
                      <span
                        data-testid={`revenue-bar-label-${i}`}
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#ffffff',
                          fontFamily: 'var(--da-font-family)',
                          whiteSpace: 'nowrap',
                          lineHeight: 1,
                          textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                          pointerEvents: 'none',
                        }}
                      >
                        {labelInfo.formattedValue}
                      </span>
                    )}
                  </div>

                  {/* Day of week label */}
                  <div style={{ fontSize: '10px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
                    {bar.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '20px', boxShadow: 'var(--da-shadow-sm)' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 16px' }}>Top Workspaces</h3>
          {(snapshot?.topWorkspaces && snapshot.topWorkspaces.length > 0) ? (
            snapshot.topWorkspaces.map((ws, i) => (
              <div key={ws.id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i === (snapshot.topWorkspaces.length - 1) ? 'none' : '1px solid var(--da-border-light)' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)' }}>{ws.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>{ws.templateName} &bull; {ws.floorName}</div>
                </div>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-brand-dark)', fontFamily: 'var(--da-font-family)' }}>
                  {ws.reservationCount} {ws.reservationCount === 1 ? 'booking' : 'bookings'}
                </span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', padding: '20px 0', textAlign: 'center' }}>
              No workspace usage recorded yet.
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px' }}>
        <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '20px', boxShadow: 'var(--da-shadow-sm)' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 16px' }}>Operational Reports & Exports</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            {(snapshot?.reportCategories ?? [
              { id: 'workspace', name: 'Workspace Utilization', count: 0, exportType: 'workspace' as const },
              { id: 'reservations', name: 'Reservation History', count: 0, exportType: 'reservations' as const },
              { id: 'payment', name: 'Payment Records', count: 0, exportType: 'payment' as const },
              { id: 'booking-activity', name: 'Customer Booking Activity', count: 0, exportType: 'booking-activity' as const },
              { id: 'cancellation', name: 'Cancellation & Rescheduling', count: 0, exportType: 'cancellation' as const },
              { id: 'checkin', name: 'Check-in / Checkout Records', count: 0, exportType: 'checkin' as const },
            ]).map((cat) => (
              <div
                key={cat.id}
                style={{
                  border: '1px solid var(--da-border-light)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#fafafa',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)' }}>{cat.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>{cat.count} records</div>
                </div>
                <button
                  onClick={() => handleDownload(cat.exportType, 'xlsx')}
                  disabled={exportingType === cat.exportType}
                  style={{
                    background: '#fff',
                    border: '1px solid var(--da-border)',
                    borderRadius: '6px',
                    padding: '5px 9px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--da-brand-dark)',
                    cursor: exportingType === cat.exportType ? 'not-allowed' : 'pointer',
                    opacity: exportingType === cat.exportType ? 0.6 : 1,
                  }}
                >
                  {exportingType === cat.exportType ? '...' : 'Excel'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '20px', boxShadow: 'var(--da-shadow-sm)' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 16px' }}>Frequent Bookers</h3>
          {(snapshot?.topUsers && snapshot.topUsers.length > 0) ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--da-border)', color: 'var(--da-text-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 0', fontWeight: 700, width: '40px' }}>Rank</th>
                  <th style={{ padding: '6px 0', fontWeight: 700 }}>Customer</th>
                  <th style={{ padding: '6px 0', fontWeight: 700, textAlign: 'center' }}>Bookings</th>
                  <th style={{ padding: '6px 0', fontWeight: 700, textAlign: 'right' }}>Total Payment</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.topUsers.map((user, i) => (
                  <tr key={i} style={{ borderBottom: i === (snapshot.topUsers.length - 1) ? 'none' : '1px solid var(--da-border-light)' }}>
                    <td style={{ padding: '8px 0', fontWeight: 700, color: 'var(--da-text-secondary)' }}>#{i + 1}</td>
                    <td style={{ padding: '8px 0', fontWeight: 700, color: 'var(--da-text-primary)' }}>{user.name}</td>
                    <td style={{ padding: '8px 0', textAlign: 'center', color: 'var(--da-brand-dark)', fontWeight: 600 }}>{user.bookings}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 700, color: 'var(--da-text-primary)' }}>{user.spent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', padding: '20px 0', textAlign: 'center' }}>
              No bookings recorded in this period.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
