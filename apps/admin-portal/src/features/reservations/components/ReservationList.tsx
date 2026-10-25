"use client";

import React, { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSearch, useLiveCountdownClock, WorkspaceCountdownBadge, useActiveTabPolling } from '@deskatlas/ui';
import { useRealtimeTable } from '@/app/lib/useRealtimeTable';
import {
  filterReservationsBySearch,
  filterReservations,
  countActiveFilters,
  generateReservationsCsv,
  generateReservationsCsvFilename,
  sortAdminReservationsBySchedule,
  paginateList,
  getPaginationPageNumbers,
  filterAdminReservationsByTab,
  getAdminReservationTabCounts,
  ADMIN_RESERVATIONS_TAB_FILTERS,
  ADMIN_OPERATIONS_TAB_FILTERS,
  ADMIN_EXPIRED_TAB_FILTERS,
  type AdminReservationSummary,
  type AdminReservationAdvancedFilters,
  type ReservationSortDirection,
  type ReservationTabType,
  type AdminReservationsSubFilter,
  type AdminOperationsSubFilter,
  type AdminExpiredSubFilter,
} from '@deskatlas/domain';
import { useAuth } from '@/features/auth';
import { parseReservationNavigation } from '../reservationNavigation';
import { ReservationFilterModal } from './ReservationFilterModal';
import { ProcessCancellationRefundModal } from './ProcessCancellationRefundModal';

export function ReservationList() {
  const router = useRouter();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const currentTick = useLiveCountdownClock(1000);
  const [, startTransition] = useTransition();

  const navigation = parseReservationNavigation(searchParams);
  const activeTab = navigation.tab;
  const closureOnly = navigation.filter === 'closure_impacted';
  const requestVersion = React.useRef(0);
  const [loadedScope, setLoadedScope] = useState<boolean | null>(null);
  const [reservationsSubFilter, setReservationsSubFilter] = useState<AdminReservationsSubFilter>('all');
  const [operationsSubFilter, setOperationsSubFilter] = useState<AdminOperationsSubFilter>('all');
  const [expiredSubFilter, setExpiredSubFilter] = useState<AdminExpiredSubFilter>('all');
  const [selectedRefundReservation, setSelectedRefundReservation] = useState<AdminReservationSummary | null>(null);
  const [scheduleSort, setScheduleSort] = useState<ReservationSortDirection | 'none'>('none');
  const [reservations, setReservations] = useState<AdminReservationSummary[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState<boolean>(false);
  const [advancedFilters, setAdvancedFilters] = useState<AdminReservationAdvancedFilters>({});
  const [exporting, setExporting] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const { searchQuery, clearSearch } = useSearch();

  const handleTabChange = (newTab: ReservationTabType) => {
    setCurrentPage(1);
    startTransition(() => {
      const url =
        newTab === 'operations'
          ? '/manage/reservations?tab=operations'
          : newTab === 'completed'
          ? '/manage/reservations?tab=completed'
          : newTab === 'expired'
          ? '/manage/reservations?tab=expired'
          : newTab === 'cancelled_refund_eligible'
          ? '/manage/reservations?tab=cancelled_refund_eligible'
          : newTab === 'refunded'
          ? '/manage/reservations?tab=refunded'
          : '/manage/reservations?tab=reservations';
      router.push(url);
    });
  };

  const activeFilterCount = countActiveFilters(advancedFilters);

  // Calculate tab badge counts
  const tabCounts = getAdminReservationTabCounts(reservations, currentTick);

  // Sub-filter counts for reservations tab
  const reservationSubFilterCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of ADMIN_RESERVATIONS_TAB_FILTERS) {
      counts[f.filter] = filterAdminReservationsByTab(reservations, 'reservations', f.filter, currentTick).length;
    }
    return counts;
  }, [reservations, currentTick]);

  // Tab and sub-filter logic
  const currentSubFilter =
    activeTab === 'reservations'
      ? reservationsSubFilter
      : activeTab === 'operations'
      ? operationsSubFilter
      : activeTab === 'completed'
      ? 'all'
      : activeTab === 'cancelled_refund_eligible'
      ? 'all'
      : activeTab === 'refunded'
      ? 'all'
      : expiredSubFilter;

  const isClosureView = closureOnly;
  const tabFiltered = isClosureView
    ? reservations
    : filterAdminReservationsByTab(reservations, activeTab, currentSubFilter, currentTick);
  const searchFiltered = filterReservationsBySearch(tabFiltered, searchQuery);
  const filtered = filterReservations(searchFiltered, advancedFilters, new Date(currentTick));
  const scopedReservations = loadedScope === closureOnly ? filtered : [];
  const displayedReservations = scheduleSort !== 'none'
    ? sortAdminReservationsBySchedule(scopedReservations, scheduleSort)
    : scopedReservations;

  useEffect(() => {
    setCurrentPage(1);
  }, [closureOnly, activeTab, reservationsSubFilter, operationsSubFilter, expiredSubFilter, searchQuery, advancedFilters, scheduleSort]);

  const pagination = paginateList(displayedReservations, currentPage, 15);
  const paginatedReservations = pagination.items;
  const pageNumbers = getPaginationPageNumbers(pagination.page, pagination.totalPages);

  // Extract unique available template names from loaded reservations
  const availableTemplates = Array.from(
    new Set(
      reservations
        .map((r) => r.workspaceTemplateName)
        .filter((t): t is string => Boolean(t && t.trim() !== ""))
    )
  );

  const loadReservations = React.useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const response = await fetch(`/api/admin/reservations?filter=${closureOnly ? 'closure_impacted' : 'all'}`, {
        cache: 'no-store',
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {},
      });
      if (!response.ok) {
        throw new Error(`Failed to load reservations (${response.status})`);
      }
      const data = await response.json();
      if (version !== requestVersion.current) return;
      setReservations(data.reservations ?? []);
      setLoadedScope(closureOnly);
      setTotalCount(data.total ?? 0);
      setError(null);
    } catch (err: unknown) {
      if (version !== requestVersion.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load reservations');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [closureOnly, user?.token]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void loadReservations();
    return () => { requestVersion.current += 1; };
  }, [loadReservations]);

  useActiveTabPolling(loadReservations, 30000, { immediate: false });
  useRealtimeTable('reservations', loadReservations);

  const handleExport = () => {
    try {
      setExporting(true);
      const csv = generateReservationsCsv(displayedReservations);
      const filename = generateReservationsCsvFilename();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <main data-screen-label="Reservations" style={{ padding: '26px 28px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>{isClosureView ? 'Closure Impacted' : 'Reservations'}</h1>
          <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
            All bookings, operational activity, completed sessions, and historical records across floors
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setIsFilterModalOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              border: activeFilterCount > 0 ? '1.5px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
              background: activeFilterCount > 0 ? '#ECFDF5' : '#fff',
              borderRadius: '9px',
              padding: '9px 14px',
              fontSize: '12px',
              fontWeight: 700,
              color: activeFilterCount > 0 ? 'var(--da-brand-dark)' : 'var(--da-text-primary)',
              cursor: 'pointer',
              fontFamily: 'var(--da-font-family)',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ width: '11px', height: '11px', border: `2px solid ${activeFilterCount > 0 ? 'var(--da-brand-dark)' : 'var(--da-text-secondary)'}`, borderRadius: '2px' }}></div>
            Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading || Boolean(error) || displayedReservations.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)',
              color: '#fff',
              border: 'none',
              borderRadius: '9px',
              padding: '9px 16px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: exporting || displayedReservations.length === 0 ? 'not-allowed' : 'pointer',
              opacity: exporting || displayedReservations.length === 0 ? 0.7 : 1,
              boxShadow: '0 4px 10px 1px rgba(12,59,39,.16)',
            }}
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>

      {isClosureView && (
        <div style={{ padding: '14px 20px', marginBottom: '16px', border: '1px solid var(--da-border)', borderRadius: '14px', background: '#fff' }} role="status">
          <p>Closure Impacted: all current unresolved facility closure impacts across floors.</p>
          <p>Search and advanced filters may narrow these results.</p>
          <button type="button" className="da-secondary-button" onClick={() => {
            clearSearch();
            setAdvancedFilters({});
            setReservationsSubFilter('all');
            handleTabChange('reservations');
          }}>View ordinary reservations</button>
        </div>
      )}

      {/* Tabs Selector: 6 Tabs (Reservations, Active Operations, Cancelled (Refund Eligible), Refunded, Completed, Expired) */}
      {!isClosureView && loadedScope === false && <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="tab-reservations"
          onClick={() => handleTabChange('reservations')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 18px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: activeTab === 'reservations' ? 800 : 600,
            background: activeTab === 'reservations' ? 'var(--da-brand-dark)' : '#fff',
            color: activeTab === 'reservations' ? '#fff' : 'var(--da-text-secondary)',
            border: activeTab === 'reservations' ? '1px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
            cursor: 'pointer',
            fontFamily: 'var(--da-font-family)',
            boxShadow: activeTab === 'reservations' ? '0 2px 6px rgba(12,59,39,.15)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span>Reservations</span>
          <span
            data-testid="badge-reservations-count"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px 7px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 800,
              background: activeTab === 'reservations' ? 'rgba(255,255,255,0.22)' : 'var(--da-canvas, #F1F8F3)',
              color: activeTab === 'reservations' ? '#fff' : 'var(--da-text-primary)',
            }}
          >
            {tabCounts.reservationsBadgeCount}
          </span>
        </button>

        <button
          type="button"
          data-testid="tab-active-operations"
          onClick={() => handleTabChange('operations')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 18px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: activeTab === 'operations' ? 800 : 600,
            background: activeTab === 'operations' ? 'var(--da-brand-dark)' : '#fff',
            color: activeTab === 'operations' ? '#fff' : 'var(--da-text-secondary)',
            border: activeTab === 'operations' ? '1px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
            cursor: 'pointer',
            fontFamily: 'var(--da-font-family)',
            boxShadow: activeTab === 'operations' ? '0 2px 6px rgba(12,59,39,.15)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          <span>Active Operations</span>
          <span
            data-testid="badge-operations-count"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px 7px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 800,
              background: activeTab === 'operations' ? 'rgba(255,255,255,0.22)' : 'var(--da-canvas, #F1F8F3)',
              color: activeTab === 'operations' ? '#fff' : 'var(--da-text-primary)',
            }}
          >
            {tabCounts.operationsBadgeCount}
          </span>
        </button>

        <button
          type="button"
          data-testid="tab-cancelled-refund-eligible"
          onClick={() => handleTabChange('cancelled_refund_eligible')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 18px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: activeTab === 'cancelled_refund_eligible' ? 800 : 600,
            background: activeTab === 'cancelled_refund_eligible' ? '#B45309' : '#fff',
            color: activeTab === 'cancelled_refund_eligible' ? '#fff' : 'var(--da-text-secondary)',
            border: activeTab === 'cancelled_refund_eligible' ? '1px solid #B45309' : '1px solid var(--da-border)',
            cursor: 'pointer',
            fontFamily: 'var(--da-font-family)',
            boxShadow: activeTab === 'cancelled_refund_eligible' ? '0 2px 6px rgba(180,83,9,.2)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          <span>Cancelled (Refund Eligible)</span>
          <span
            data-testid="badge-cancelled-refund-eligible-count"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px 7px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 800,
              background: activeTab === 'cancelled_refund_eligible'
                ? 'rgba(255,255,255,0.25)'
                : tabCounts.cancelledRefundEligibleBadgeCount > 0
                ? '#FEF3C7'
                : 'var(--da-canvas, #F1F8F3)',
              color: activeTab === 'cancelled_refund_eligible'
                ? '#fff'
                : tabCounts.cancelledRefundEligibleBadgeCount > 0
                ? '#B45309'
                : 'var(--da-text-primary)',
            }}
          >
            {tabCounts.cancelledRefundEligibleBadgeCount}
          </span>
        </button>

        <button
          type="button"
          data-testid="tab-refunded"
          onClick={() => handleTabChange('refunded')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 18px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: activeTab === 'refunded' ? 800 : 600,
            background: activeTab === 'refunded' ? '#047857' : '#fff',
            color: activeTab === 'refunded' ? '#fff' : 'var(--da-text-secondary)',
            border: activeTab === 'refunded' ? '1px solid #047857' : '1px solid var(--da-border)',
            cursor: 'pointer',
            fontFamily: 'var(--da-font-family)',
            boxShadow: activeTab === 'refunded' ? '0 2px 6px rgba(4,120,87,.2)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Refunded</span>
          <span
            data-testid="badge-refunded-count"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px 7px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 800,
              background: activeTab === 'refunded'
                ? 'rgba(255,255,255,0.25)'
                : tabCounts.refundedBadgeCount > 0
                ? '#ECFDF5'
                : 'var(--da-canvas, #F1F8F3)',
              color: activeTab === 'refunded'
                ? '#fff'
                : tabCounts.refundedBadgeCount > 0
                ? '#047857'
                : 'var(--da-text-primary)',
            }}
          >
            {tabCounts.refundedBadgeCount}
          </span>
        </button>

        <button
          type="button"
          data-testid="tab-completed"
          onClick={() => handleTabChange('completed')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 18px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: activeTab === 'completed' ? 800 : 600,
            background: activeTab === 'completed' ? 'var(--da-brand-dark)' : '#fff',
            color: activeTab === 'completed' ? '#fff' : 'var(--da-text-secondary)',
            border: activeTab === 'completed' ? '1px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
            cursor: 'pointer',
            fontFamily: 'var(--da-font-family)',
            boxShadow: activeTab === 'completed' ? '0 2px 6px rgba(12,59,39,.15)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>Completed</span>
          <span
            data-testid="badge-completed-count"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px 7px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 800,
              background: activeTab === 'completed' ? 'rgba(255,255,255,0.22)' : 'var(--da-canvas, #F1F8F3)',
              color: activeTab === 'completed' ? '#fff' : 'var(--da-text-primary)',
            }}
          >
            {tabCounts.completedBadgeCount}
          </span>
        </button>

        <button
          type="button"
          data-testid="tab-expired"
          onClick={() => handleTabChange('expired')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 18px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: activeTab === 'expired' ? 800 : 600,
            background: activeTab === 'expired' ? 'var(--da-brand-dark)' : '#fff',
            color: activeTab === 'expired' ? '#fff' : 'var(--da-text-secondary)',
            border: activeTab === 'expired' ? '1px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
            cursor: 'pointer',
            fontFamily: 'var(--da-font-family)',
            boxShadow: activeTab === 'expired' ? '0 2px 6px rgba(12,59,39,.15)' : 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>Expired</span>
          <span
            data-testid="badge-expired-count"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px 7px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 800,
              background: activeTab === 'expired' ? 'rgba(255,255,255,0.22)' : 'var(--da-canvas, #F1F8F3)',
              color: activeTab === 'expired' ? '#fff' : 'var(--da-text-primary)',
            }}
          >
            {tabCounts.expiredBadgeCount}
          </span>
        </button>
      </div>}

      <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', boxShadow: 'var(--da-shadow-sm)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '14px 20px', borderBottom: '1px solid var(--da-border-light)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ fontSize: '19px', fontWeight: 800, color: 'var(--da-brand-dark)' }}>{error ? 'Unavailable' : loading || loadedScope !== closureOnly ? 'Loading...' : displayedReservations.length}</span>
            <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
              {isClosureView ? 'unresolved closure records' : activeTab === 'reservations'
                ? 'reservation records'
                : activeTab === 'operations'
                ? 'active operational records'
                : activeTab === 'completed'
                ? 'completed records'
                : activeTab === 'cancelled_refund_eligible'
                ? 'cancellation refund eligible records'
                : activeTab === 'refunded'
                ? 'refunded records'
                : 'expired records'} {activeFilterCount > 0 || searchQuery.trim() || currentSubFilter !== 'all' ? `(filtered from ${totalCount})` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {isClosureView ? null : activeTab === 'reservations'
              ? ADMIN_RESERVATIONS_TAB_FILTERS.map((f, i) => {
                  const isActive = reservationsSubFilter === f.filter;
                  const isRefundEligible = f.filter === 'cancelled_refund_eligible';
                  const isRefunded = f.filter === 'refunded';

                  let filterStyle: React.CSSProperties = {
                    background: 'transparent',
                    color: 'var(--da-text-secondary)',
                    border: '1px solid var(--da-border)',
                  };

                  if (isActive) {
                    if (isRefundEligible) {
                      filterStyle = { background: '#B45309', color: '#fff', border: 'none' };
                    } else if (isRefunded) {
                      filterStyle = { background: '#047857', color: '#fff', border: 'none' };
                    } else {
                      filterStyle = { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' };
                    }
                  }

                  const count = reservationSubFilterCounts[f.filter] ?? 0;

                  return (
                    <button
                      key={i}
                      type="button"
                      data-testid={`filter-pill-${f.filter}`}
                      onClick={() => {
                        if (f.filter === 'closure_impacted') router.push('/manage/reservations?filter=closure_impacted');
                        else setReservationsSubFilter(f.filter);
                      }}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '9999px',
                        whiteSpace: 'nowrap',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'var(--da-font-family)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        ...filterStyle,
                      }}
                    >
                      <span>{f.label}</span>
                      {f.filter !== 'closure_impacted' && count > 0 && (
                        <span
                          data-testid={`badge-count-${f.filter}`}
                          style={{
                            fontSize: '10px',
                            padding: '1px 6px',
                            borderRadius: '9999px',
                            background: isActive
                              ? 'rgba(255,255,255,0.25)'
                              : isRefundEligible
                              ? '#FEF3C7'
                              : isRefunded
                              ? '#ECFDF5'
                              : '#F1F5F9',
                            color: isActive
                              ? '#fff'
                              : isRefundEligible
                              ? '#B45309'
                              : isRefunded
                              ? '#047857'
                              : 'var(--da-text-secondary)',
                            fontWeight: 800,
                          }}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })
              : activeTab === 'operations'
              ? ADMIN_OPERATIONS_TAB_FILTERS.map((f, i) => {
                  const isActive = operationsSubFilter === f.filter;
                  const filterStyle = isActive
                    ? { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' }
                    : { background: 'transparent', color: 'var(--da-text-secondary)', border: '1px solid var(--da-border)' };
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setOperationsSubFilter(f.filter)}
                      style={{ padding: '7px 14px', borderRadius: '9999px', whiteSpace: 'nowrap', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--da-font-family)', ...filterStyle }}
                    >
                      {f.label}
                    </button>
                  );
                })
              : activeTab === 'completed'
              ? null
              : activeTab === 'cancelled_refund_eligible'
              ? null
              : activeTab === 'refunded'
              ? null
              : ADMIN_EXPIRED_TAB_FILTERS.map((f, i) => {
                  const isActive = expiredSubFilter === f.filter;
                  const filterStyle = isActive
                    ? { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' }
                    : { background: 'transparent', color: 'var(--da-text-secondary)', border: '1px solid var(--da-border)' };
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setExpiredSubFilter(f.filter)}
                      style={{ padding: '7px 14px', borderRadius: '9999px', whiteSpace: 'nowrap', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--da-font-family)', ...filterStyle }}
                    >
                      {f.label}
                    </button>
                  );
                })}
          </div>
        </div>

        {(activeTab === 'cancelled_refund_eligible' || (activeTab === 'reservations' && reservationsSubFilter === 'cancelled_refund_eligible')) && (
          <div
            data-testid="admin-reservations-refund-eligible-notice"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: '#FFFBEB',
              border: '1px solid #FCD34D',
              borderRadius: '8px',
              padding: '12px 16px',
              margin: '16px 20px',
              fontSize: '12px',
              color: '#92400E',
              fontFamily: 'var(--da-font-family)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" style={{ color: '#D97706', flexShrink: 0 }}>
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <strong>Customer Cancellation Refund Queue:</strong> These reservations were cancelled by customers within the allowable cancellation notice window and are entitled to a full refund. Please verify the original payment proof, disburse the refund via your payment provider, and click <strong>Process Refund</strong> to record the transaction.
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.1fr 1.4fr .9fr 1.1fr .5fr', padding: '11px 20px', background: '#F1F8F3', fontSize: '10px', fontWeight: 800, color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', letterSpacing: '.06em', alignItems: 'center' }}>
          <span>REFERENCE ⇅</span>
          <span>CUSTOMER ⇅</span>
          <span>{activeTab === 'reservations' ? 'WORKSPACE' : activeTab === 'operations' ? 'WORKSPACE / SPOT' : 'WORKSPACE'}</span>
          <span
            data-testid="sort-schedule-header"
            onClick={() => {
              setScheduleSort((prev) => (prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none'));
            }}
            style={{
              cursor: 'pointer',
              userSelect: 'none',
              color: scheduleSort !== 'none' ? 'var(--da-brand-dark)' : undefined,
              fontWeight: scheduleSort !== 'none' ? 900 : undefined,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              width: 'fit-content',
            }}
            title="Sort by schedule/time (Ascending / Descending)"
          >
            {activeTab === 'reservations' ? 'SCHEDULE' : activeTab === 'operations' ? 'SCHEDULE / TIME' : 'SCHEDULE'} {scheduleSort === 'asc' ? '↑' : scheduleSort === 'desc' ? '↓' : '⇅'}
          </span>
          <span>PAYMENT</span>
          <span>{activeTab === 'reservations' ? 'STATUS' : activeTab === 'operations' ? 'OPERATIONAL STATUS' : 'STATUS'}</span>
          <span style={{ textAlign: 'right' }}>ACTIONS</span>
        </div>

        {loading || (loadedScope !== closureOnly && !error) ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
            Loading reservations...
          </div>
        ) : error ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--da-danger)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
            {error}
            <button type="button" className="da-secondary-button" onClick={loadReservations}>Retry</button>
          </div>
        ) : displayedReservations.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
            {isClosureView ? (totalCount === 0
              ? 'No reservations currently require closure action.'
              : 'No closure impacted reservations match your search and filters.') : <>No {activeTab === 'reservations' ? 'reservation' : activeTab === 'operations' ? 'active operational' : activeTab === 'completed' ? 'completed' : activeTab === 'cancelled_refund_eligible' ? 'cancellation refund eligible' : activeTab === 'refunded' ? 'refunded' : 'expired'} records match your filters.</>}
          </div>
        ) : (
          paginatedReservations.map((r, i) => {
            const isCheckedInOrActive =
              Boolean(
                r.reservationStatus === 'CHECKED_IN' ||
                r.reservationStatus === 'CONFIRMED' ||
                r.status?.toLowerCase().includes('checked') ||
                r.status?.toLowerCase().includes('confirmed')
              );

            return (
              <div
                key={r.id || i}
                onClick={() => router.push(`/manage/reservations/${r.referenceCode}`)}
                style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.1fr 1.4fr .9fr 1.1fr .5fr', padding: '13px 20px', borderTop: '1px solid var(--da-border-light)', fontSize: '12px', color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)', cursor: 'pointer', alignItems: 'center' }}
              >
                <span style={{ fontWeight: 800, color: 'var(--da-brand-dark)' }}>{r.referenceCode}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--da-canvas)', color: 'var(--da-text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 800, flexShrink: 0 }}>{r.customerInitials}</div>
                  <span style={{ fontWeight: 600 }}>{r.customerName}</span>
                </div>
                <span>{r.workspaceDisplayName}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ color: 'var(--da-text-primary)' }}>{r.schedule}</span>
                  {isCheckedInOrActive && r.endAt && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <WorkspaceCountdownBadge bookingEndAt={r.endAt} nowMs={currentTick} />
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: r.refundStatus === 'REQUIRED' ? '#B45309' : r.paymentColor }}>
                  {r.refundStatus === 'REQUIRED' ? `₱${r.amountDue} (Refund Pending)` : r.paymentStatus}
                </span>
                {r.refundStatus === 'REQUIRED' ? (
                  <span
                    data-testid={`status-badge-${r.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '10px',
                      fontWeight: 800,
                      padding: '4px 9px',
                      borderRadius: '9999px',
                      whiteSpace: 'nowrap',
                      width: 'fit-content',
                      background: '#FEF3C7',
                      color: '#B45309',
                      border: '1px solid #FCD34D',
                    }}
                  >
                    CANCELLED (REFUND ELIGIBLE)
                  </span>
                ) : r.refundStatus === 'REFUNDED' ? (
                  <span
                    data-testid={`status-badge-${r.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '10px',
                      fontWeight: 800,
                      padding: '4px 9px',
                      borderRadius: '9999px',
                      whiteSpace: 'nowrap',
                      width: 'fit-content',
                      background: '#ECFDF5',
                      color: '#047857',
                      border: '1px solid #A7F3D0',
                    }}
                  >
                    REFUNDED
                  </span>
                ) : (
                  <span
                    data-testid={`status-badge-${r.id}`}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: 800, padding: '4px 9px', borderRadius: '9999px', whiteSpace: 'nowrap', width: 'fit-content', ...r.statusStyle }}
                  >
                    <span aria-hidden="true" style={{ fontSize: '10px', lineHeight: 1 }}>{r.mark}</span>{r.status}
                  </span>
                )}
                {r.refundStatus === 'REQUIRED' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      data-testid="process-refund-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRefundReservation(r);
                      }}
                      style={{
                        background: '#B45309',
                        color: '#fff',
                        border: 'none',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'var(--da-font-family)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Process Refund
                    </button>
                    <span style={{ color: 'var(--da-text-secondary)', fontWeight: 800, letterSpacing: '1px' }}>⋯</span>
                  </div>
                ) : (
                  <span style={{ textAlign: 'right', color: 'var(--da-text-secondary)', fontWeight: 800, letterSpacing: '1px' }}>⋯</span>
                )}
              </div>
            );
          })
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 20px', borderTop: '1px solid var(--da-border-light)', flexWrap: 'wrap', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
            Showing {pagination.startIndex} to {pagination.endIndex} of {pagination.totalItems} entries
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              style={{
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: pagination.page <= 1 ? 'not-allowed' : 'pointer',
                opacity: pagination.page <= 1 ? 0.5 : 1,
                whiteSpace: 'nowrap',
                fontFamily: 'var(--da-font-family)',
                background: 'transparent',
                color: 'var(--da-text-secondary)',
                border: '1px solid var(--da-border)',
              }}
            >
              Prev
            </button>
            {pageNumbers.map((pg, i) => {
              if (typeof pg === 'string') {
                return (
                  <span
                    key={`ellipsis-${i}`}
                    style={{
                      width: '36px',
                      height: '36px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '13px',
                      color: 'var(--da-text-secondary)',
                    }}
                  >
                    …
                  </span>
                );
              }
              const isActive = pg === pagination.page;
              return (
                <button
                  key={pg}
                  type="button"
                  onClick={() => setCurrentPage(pg)}
                  style={{
                    width: '36px',
                    height: '36px',
                    padding: 0,
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontFamily: 'var(--da-font-family)',
                    background: isActive ? 'var(--da-brand-dark)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--da-text-secondary)',
                    border: isActive ? 'none' : '1px solid var(--da-border)',
                  }}
                >
                  {pg}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page >= pagination.totalPages}
              style={{
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer',
                opacity: pagination.page >= pagination.totalPages ? 0.5 : 1,
                whiteSpace: 'nowrap',
                fontFamily: 'var(--da-font-family)',
                background: 'transparent',
                color: 'var(--da-text-secondary)',
                border: '1px solid var(--da-border)',
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <ReservationFilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        filters={advancedFilters}
        onApply={(newFilters) => setAdvancedFilters(newFilters)}
        onReset={() => setAdvancedFilters({})}
        availableTemplates={availableTemplates.length > 0 ? availableTemplates : undefined}
      />

      {selectedRefundReservation && (
        <ProcessCancellationRefundModal
          isOpen={Boolean(selectedRefundReservation)}
          onClose={() => setSelectedRefundReservation(null)}
          onSuccess={() => {
            setSelectedRefundReservation(null);
            loadReservations();
          }}
          reservationId={selectedRefundReservation.id}
          referenceCode={selectedRefundReservation.referenceCode}
          customerName={selectedRefundReservation.customerName}
          customerEmail={selectedRefundReservation.customerEmail}
          formattedSchedule={selectedRefundReservation.schedule}
          amountDue={selectedRefundReservation.amountDue}
        />
      )}
    </main>
  );
}
