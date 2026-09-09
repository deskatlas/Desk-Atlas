"use client";

import React from 'react';
import { useReservations } from '../hooks/useReservations';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useSearch } from '@deskatlas/ui';
import { filterReservationsBySearch, type StaffOperationalReservation, type ReservationStatus } from '@deskatlas/domain';

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
  const router = useRouter();

  const displayedReservations = filterReservationsBySearch(reservations, searchQuery);

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>;
  if (error) return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--da-danger)' }}>
      {error}
      <div><button onClick={refetch}>Retry</button></div>
    </div>
  );

  return (
    <main style={{ padding: '26px 28px 40px' }}>
      <div style={{ marginBottom: '22px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>Reservations</h1>
        <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: "'Inter', sans-serif" }}>Today's operational view</div>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', overflow: 'hidden' }}>
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
              <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--da-text-secondary)' }}>No reservations found.</td></tr>
            ) : (
              displayedReservations.map((res: StaffOperationalReservation) => {
                const statusDisp = getStatusDisplay(res.reservationStatus);
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
                      {res.bookingStartAt ? format(new Date(res.bookingStartAt), 'h:mm a') : '-'} to {res.bookingEndAt ? format(new Date(res.bookingEndAt), 'h:mm a') : '-'}
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
