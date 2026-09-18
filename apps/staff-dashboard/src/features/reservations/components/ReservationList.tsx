"use client";

import React, { useState } from 'react';
import { useReservations } from '../hooks/useReservations';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useSearch, useLiveCountdownClock, WorkspaceCountdownBadge } from '@deskatlas/ui';
import {
  filterReservationsBySearch,
  filterStaffReservationsByStatus,
  STAFF_RESERVATION_FILTERS,
  type StaffOperationalReservation,
  type StaffReservationFilter,
  type ReservationStatus
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
    default:
      return { label: status, color: 'var(--da-text-secondary)', bg: 'var(--da-canvas)' };
  }
}

export function ReservationList() {
  const { reservations, loading, error, refetch } = useReservations();
  const { searchQuery } = useSearch();
  const currentTick = useLiveCountdownClock(1000);
  const [activeFilter, setActiveFilter] = useState<StaffReservationFilter>('active');
  const router = useRouter();

  const statusFiltered = filterStaffReservationsByStatus(reservations, activeFilter);
  const displayedReservations = filterReservationsBySearch(statusFiltered, searchQuery);
  const totalCount = reservations.length;
  const isFiltered = activeFilter !== 'all' || Boolean(searchQuery.trim());

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>;
  if (error) return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--da-danger)' }}>
      {error}
      <div><button onClick={refetch}>Retry</button></div>
    </div>
  );

  const getEmptyMessage = () => {
    if (searchQuery.trim()) {
      return `No reservations match "${searchQuery}".`;
    }
    switch (activeFilter) {
      case 'active':
        return 'No active reservations found for today.';
      case 'checked_in':
        return 'No checked-in reservations found for today.';
      case 'upcoming':
        return 'No upcoming reservations scheduled.';
      case 'confirmed':
        return 'No confirmed reservations found for today.';
      case 'counter_queue':
        return 'No counter queue reservations found.';
      case 'all':
      default:
        return 'No reservations found for today.';
    }
  };

  return (
    <main data-screen-label="Reservations" style={{ padding: '26px 28px 40px' }}>
      <div style={{ marginBottom: '22px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>Reservations</h1>
        <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: "'Inter', sans-serif" }}>Today's operational view</div>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', overflow: 'hidden', boxShadow: 'var(--da-shadow-sm, 0 1px 3px rgba(0,0,0,0.05))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '14px 20px', borderBottom: '1px solid var(--da-border-light, var(--da-border))', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ fontSize: '19px', fontWeight: 800, color: 'var(--da-brand-dark)' }}>{displayedReservations.length}</span>
            <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: "var(--da-font-family, 'Inter', sans-serif)" }}>
              reservations {isFiltered ? `(filtered from ${totalCount})` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {STAFF_RESERVATION_FILTERS.map((f, i) => {
              const isActive = activeFilter === f.filter;
              const filterStyle = isActive
                ? { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' }
                : { background: 'transparent', color: 'var(--da-text-secondary)', border: '1px solid var(--da-border)' };
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveFilter(f.filter)}
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
              <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--da-text-secondary)' }}>Workspace</th>
              <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--da-text-secondary)' }}>Time</th>
              <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--da-text-secondary)' }}>Status</th>
              <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--da-text-secondary)', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayedReservations.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px' }}>{getEmptyMessage()}</td></tr>
            ) : (
              displayedReservations.map((res: StaffOperationalReservation) => {
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
      </div>
    </main>
  );
}

