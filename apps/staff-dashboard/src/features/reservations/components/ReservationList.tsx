"use client";

import React, { useState, useEffect, useTransition } from 'react';
import { useReservations } from '../hooks/useReservations';
import { format } from 'date-fns';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSearch, useLiveCountdownClock, WorkspaceCountdownBadge } from '@deskatlas/ui';
import {
  filterReservationsBySearch,
  filterStaffReservationsByTab,
  getStaffReservationTabCounts,
  STAFF_RESERVATIONS_TAB_FILTERS,
  STAFF_OPERATIONS_TAB_FILTERS,
  STAFF_COMPLETED_TAB_FILTERS,
  STAFF_EXPIRED_TAB_FILTERS,
  sortStaffReservationsBySchedule,
  paginateList,
  getPaginationPageNumbers,
  type StaffOperationalReservation,
  type ReservationStatus,
  type ReservationSortDirection,
  type ReservationTabType,
  type StaffReservationsSubFilter,
  type StaffOperationsSubFilter,
  type StaffCompletedSubFilter,
  type StaffExpiredSubFilter,
} from '@deskatlas/domain';

function getStatusDisplay(status: ReservationStatus) {
  switch (status) {
    case 'CONFIRMED':
      return { label: 'Confirmed', color: 'var(--da-primary)', bg: 'var(--da-info)' };
    case 'CHECKED_IN':
      return { label: 'Checked In', color: 'var(--da-primary)', bg: 'var(--da-info)' };
    case 'COMPLETED':
      return { label: 'Completed', color: 'var(--da-text-secondary)', bg: 'var(--da-canvas)' };
    case 'PENDING_COUNTER_CONFIRMATION':
      return { label: 'Counter Queue', color: 'var(--da-brand-dark)', bg: 'var(--da-soft)' };
    case 'EXPIRED':
      return { label: 'Expired', color: 'var(--da-text-secondary)', bg: 'var(--da-canvas)' };
    case 'CANCELLED':
      return { label: 'Cancelled', color: 'var(--da-danger)', bg: '#FEE2E2' };
    default:
      return { label: status, color: 'var(--da-text-secondary)', bg: 'var(--da-canvas)' };
  }
}

export function ReservationList() {
  const { reservations, loading, error, refetch } = useReservations();
  const { searchQuery } = useSearch();
  const searchParams = useSearchParams();
  const currentTick = useLiveCountdownClock(1000);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const tabParam = searchParams.get('tab');
  const initialTab: ReservationTabType =
    tabParam === 'operations'
      ? 'operations'
      : tabParam === 'completed'
      ? 'completed'
      : tabParam === 'expired'
      ? 'expired'
      : 'reservations';

  const [activeTab, setActiveTab] = useState<ReservationTabType>(initialTab);
  const [reservationsSubFilter, setReservationsSubFilter] = useState<StaffReservationsSubFilter>('all');
  const [operationsSubFilter, setOperationsSubFilter] = useState<StaffOperationsSubFilter>('all');
  const [completedSubFilter, setCompletedSubFilter] = useState<StaffCompletedSubFilter>('all');
  const [expiredSubFilter, setExpiredSubFilter] = useState<StaffExpiredSubFilter>('all');
  const [timeSort, setTimeSort] = useState<ReservationSortDirection | 'none'>('none');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Sync tab state from URL search params if changed externally
  useEffect(() => {
    if (tabParam === 'operations' && activeTab !== 'operations') {
      setActiveTab('operations');
    } else if (tabParam === 'completed' && activeTab !== 'completed') {
      setActiveTab('completed');
    } else if (tabParam === 'expired' && activeTab !== 'expired') {
      setActiveTab('expired');
    } else if ((!tabParam || tabParam === 'reservations') && activeTab !== 'reservations') {
      setActiveTab('reservations');
    }
  }, [tabParam, activeTab]);

  const handleTabChange = (newTab: ReservationTabType) => {
    setActiveTab(newTab);
    setCurrentPage(1);
    startTransition(() => {
      const url =
        newTab === 'operations'
          ? '/manage/reservations?tab=operations'
          : newTab === 'completed'
          ? '/manage/reservations?tab=completed'
          : newTab === 'expired'
          ? '/manage/reservations?tab=expired'
          : '/manage/reservations?tab=reservations';
      router.replace(url);
    });
  };

  const tabCounts = getStaffReservationTabCounts(reservations, currentTick);
  const currentSubFilter =
    activeTab === 'reservations'
      ? reservationsSubFilter
      : activeTab === 'operations'
      ? operationsSubFilter
      : activeTab === 'completed'
      ? completedSubFilter
      : expiredSubFilter;

  const tabFiltered = filterStaffReservationsByTab(reservations, activeTab, currentSubFilter, currentTick);
  const searchFiltered = filterReservationsBySearch(tabFiltered, searchQuery);
  const displayedReservations = timeSort !== 'none'
    ? sortStaffReservationsBySchedule(searchFiltered, timeSort)
    : searchFiltered;
  const totalCount = reservations.length;
  const isFiltered = currentSubFilter !== 'all' || Boolean(searchQuery.trim()) || timeSort !== 'none';

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, reservationsSubFilter, operationsSubFilter, completedSubFilter, expiredSubFilter, searchQuery, timeSort]);

  const pagination = paginateList(displayedReservations, currentPage, 15);
  const paginatedReservations = pagination.items;
  const pageNumbers = getPaginationPageNumbers(pagination.page, pagination.totalPages);

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading reservations...</div>;
  if (error) return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--da-danger)' }}>
      {error}
      <div style={{ marginTop: '12px' }}><button onClick={refetch}>Retry</button></div>
    </div>
  );

  const getEmptyMessage = () => {
    if (searchQuery.trim()) {
      return `No reservations match "${searchQuery}".`;
    }
    if (activeTab === 'reservations') {
      switch (reservationsSubFilter) {
        case 'upcoming':
          return 'No upcoming reservations scheduled.';
        case 'confirmed':
          return 'No confirmed reservations found.';
        case 'counter_queue':
          return 'No counter queue reservations found.';
        case 'all':
        default:
          return 'No reservation records found for today.';
      }
    } else if (activeTab === 'operations') {
      switch (operationsSubFilter) {
        case 'active':
          return 'No active reservations currently occupying workspaces.';
        case 'checked_in':
          return 'No checked-in guests found.';
        case 'all':
        default:
          return 'No active operational records found for today.';
      }
    } else if (activeTab === 'completed') {
      return 'No completed reservations found for today.';
    } else {
      return 'No expired reservation records found for today.';
    }
  };

  return (
    <main data-screen-label="Reservations" style={{ padding: '26px 28px 40px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>Reservations</h1>
        <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: "'Inter', sans-serif" }}>
          Today's operational, booking management, completed, and expired records
        </div>
      </div>

      {/* Tabs Selector: 4 Tabs (Reservations, Active Operations, Completed, Expired) */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
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
            fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
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
            fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
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
            fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
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
            fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
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
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', overflow: 'hidden', boxShadow: 'var(--da-shadow-sm, 0 1px 3px rgba(0,0,0,0.05))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '14px 20px', borderBottom: '1px solid var(--da-border-light, var(--da-border))', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ fontSize: '19px', fontWeight: 800, color: 'var(--da-brand-dark)' }}>{displayedReservations.length}</span>
            <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: "var(--da-font-family, 'Inter', sans-serif)" }}>
              {activeTab === 'reservations' ? 'reservation records' : activeTab === 'operations' ? 'active operational records' : activeTab === 'completed' ? 'completed records' : 'expired records'} {isFiltered ? `(filtered from ${totalCount})` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {activeTab === 'reservations'
              ? STAFF_RESERVATIONS_TAB_FILTERS.map((f, i) => {
                  const isActive = reservationsSubFilter === f.filter;
                  const filterStyle = isActive
                    ? { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' }
                    : { background: 'transparent', color: 'var(--da-text-secondary)', border: '1px solid var(--da-border)' };
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setReservationsSubFilter(f.filter)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '9999px',
                        whiteSpace: 'nowrap',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
                        ...filterStyle,
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })
              : activeTab === 'operations'
              ? STAFF_OPERATIONS_TAB_FILTERS.map((f, i) => {
                  const isActive = operationsSubFilter === f.filter;
                  const filterStyle = isActive
                    ? { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' }
                    : { background: 'transparent', color: 'var(--da-text-secondary)', border: '1px solid var(--da-border)' };
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setOperationsSubFilter(f.filter)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '9999px',
                        whiteSpace: 'nowrap',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
                        ...filterStyle,
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })
              : activeTab === 'completed'
              ? STAFF_COMPLETED_TAB_FILTERS.map((f, i) => {
                  const isActive = completedSubFilter === f.filter;
                  const filterStyle = isActive
                    ? { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' }
                    : { background: 'transparent', color: 'var(--da-text-secondary)', border: '1px solid var(--da-border)' };
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setCompletedSubFilter(f.filter)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '9999px',
                        whiteSpace: 'nowrap',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
                        ...filterStyle,
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })
              : STAFF_EXPIRED_TAB_FILTERS.map((f, i) => {
                  const isActive = expiredSubFilter === f.filter;
                  const filterStyle = isActive
                    ? { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' }
                    : { background: 'transparent', color: 'var(--da-text-secondary)', border: '1px solid var(--da-border)' };
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setExpiredSubFilter(f.filter)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '9999px',
                        whiteSpace: 'nowrap',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
                        ...filterStyle,
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: 'var(--da-canvas)', borderBottom: '1px solid var(--da-border)' }}>
              <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--da-text-secondary)' }}>Guest</th>
              <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--da-text-secondary)' }}>
                {activeTab === 'reservations' ? 'Workspace' : activeTab === 'operations' ? 'Workspace / Spot' : 'Workspace'}
              </th>
              <th
                data-testid="sort-time-header"
                onClick={() => {
                  setTimeSort((prev) => (prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none'));
                }}
                style={{
                  padding: '12px 16px',
                  fontWeight: timeSort !== 'none' ? 800 : 700,
                  color: timeSort !== 'none' ? 'var(--da-brand-dark)' : 'var(--da-text-secondary)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                title="Sort by time (Ascending / Descending)"
              >
                {activeTab === 'reservations' ? 'Time' : activeTab === 'operations' ? 'Time / Session' : 'Time'} {timeSort === 'asc' ? '↑' : timeSort === 'desc' ? '↓' : '⇅'}
              </th>
              <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--da-text-secondary)' }}>Status</th>
              <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--da-text-secondary)', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayedReservations.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px' }}>{getEmptyMessage()}</td></tr>
            ) : (
              paginatedReservations.map((res: StaffOperationalReservation) => {
                const statusDisp = getStatusDisplay(res.reservationStatus);
                const isCheckedInOrActive =
                  (res.reservationStatus === 'CHECKED_IN' ||
                   res.checkInState === 'CHECKED_IN' ||
                   res.reservationStatus === 'CONFIRMED') &&
                  res.checkInState !== 'CHECKED_OUT';

                return (
                  <tr key={res.reservationId} style={{ borderBottom: '1px solid var(--da-border)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--da-brand-dark)' }}>{res.customerFirstName} {res.customerLastName}</div>
                      <div style={{ color: 'var(--da-text-secondary)', fontSize: '12px' }}>{res.referenceCode}</div>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--da-brand-dark)' }}>
                      {res.workspaceDisplayName || 'Pending'}
                      {res.workspaceInstanceCode && <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)' }}>{res.workspaceInstanceCode}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--da-text-secondary)' }}>
                      <div style={{ fontWeight: 600, color: 'var(--da-text-primary)' }}>
                        {res.bookingStartAt ? format(new Date(res.bookingStartAt), 'h:mm a') : '-'} to {res.bookingEndAt ? format(new Date(res.bookingEndAt), 'h:mm a') : '-'}
                      </div>
                      {isCheckedInOrActive && res.bookingEndAt && (
                        <div style={{ marginTop: '4px' }}>
                          <WorkspaceCountdownBadge bookingEndAt={res.bookingEndAt} nowMs={currentTick} />
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ background: statusDisp.bg, color: statusDisp.color, padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                        {statusDisp.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => router.push(`/manage/reservations/${res.reservationId}`)}
                        style={{ padding: '6px 12px', background: 'var(--da-canvas)', color: 'var(--da-brand-dark)', border: '1px solid var(--da-border)', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 20px', borderTop: '1px solid var(--da-border-light, var(--da-border))', flexWrap: 'wrap', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: "var(--da-font-family, 'Inter', sans-serif)" }}>
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
                fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
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
                    fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
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
                fontFamily: "var(--da-font-family, 'Inter', sans-serif)",
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
    </main>
  );
}
