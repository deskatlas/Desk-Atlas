"use client";

import React, { useState } from 'react';
import { useReservationDetail } from '../hooks/useReservations';
import { useCheckInActions, EarlyCheckInModal, isEarlyCheckInError } from '@/features/check-in';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';

export function ReservationDetail({ id }: { id: string }) {
  const { reservation, loading, error, refetch } = useReservationDetail(id);
  const { checkIn, checkOut, loading: actionLoading, error: actionError, clearError } = useCheckInActions();
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showEarlyModal, setShowEarlyModal] = useState(false);
  const router = useRouter();

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>;
  if (error || !reservation) return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--da-danger)' }}>
      {error || 'Not found'}
    </div>
  );

  const handleConfirmCounterPayment = async () => {
    setConfirmLoading(true);
    setConfirmError(null);
    try {
      const res = await fetch(`/api/payments/${encodeURIComponent(reservation.referenceCode)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: reservation.referenceCode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to confirm counter payment');
      }
      refetch();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Failed to confirm counter payment');
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleCheckIn = async () => {
    try {
      await checkIn(id);
      refetch();
    } catch (e: any) {
      if (isEarlyCheckInError(e)) {
        setShowEarlyModal(true);
        clearError();
      }
    }
  };

  const handleCheckOut = async () => {
    try {
      await checkOut(id);
      refetch();
    } catch (e) {
      // Error handled in UI
    }
  };

  return (
    <main style={{ padding: '26px 28px 40px', maxWidth: '800px' }}>
      <button
        onClick={() => router.back()}
        style={{ background: 'transparent', border: 'none', color: 'var(--da-text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', fontSize: '13px', fontWeight: 600 }}
      >
        &larr; Back
      </button>

      <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '24px', borderBottom: '1px solid var(--da-border)', background: 'var(--da-canvas)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px' }}>
                {reservation.customerFirstName} {reservation.customerLastName}
              </h1>
              <div style={{ color: 'var(--da-text-secondary)', fontSize: '14px', fontFamily: "'Inter', sans-serif" }}>
                {reservation.referenceCode} • {reservation.customerEmail}
              </div>
            </div>
            <div style={{ padding: '6px 12px', background: reservation.reservationStatus === 'PENDING_COUNTER_CONFIRMATION' ? 'var(--da-soft)' : 'var(--da-primary)', color: reservation.reservationStatus === 'PENDING_COUNTER_CONFIRMATION' ? 'var(--da-brand-dark)' : '#fff', borderRadius: '6px', fontSize: '12px', fontWeight: 700 }}>
              {reservation.reservationStatus === 'PENDING_COUNTER_CONFIRMATION' ? 'Counter Queue' : reservation.reservationStatus}
            </div>
          </div>
        </div>

        <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '8px' }}>WORKSPACE</div>
            <div style={{ fontSize: '15px', color: 'var(--da-text-primary)' }}>
              {reservation.workspaceDisplayName || 'Not assigned'}
              {reservation.workspaceInstanceCode && ` (${reservation.workspaceInstanceCode})`}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '8px' }}>SCHEDULE</div>
            <div style={{ fontSize: '15px', color: 'var(--da-text-primary)' }}>
              {reservation.bookingStartAt ? format(new Date(reservation.bookingStartAt), 'MMM d, h:mm a') : '-'}
              {' to '}
              {reservation.bookingEndAt ? format(new Date(reservation.bookingEndAt), 'h:mm a') : '-'}
            </div>
          </div>
        </div>

        <div style={{ padding: '24px', borderTop: '1px solid var(--da-border)', background: 'var(--da-canvas)' }}>
          {(() => {
            const displayActionError = isEarlyCheckInError(actionError) ? null : actionError;
            return (displayActionError || confirmError) ? (
              <div style={{ color: 'var(--da-danger)', fontSize: '13px', marginBottom: '16px', background: '#FEE2E2', padding: '12px', borderRadius: '6px' }}>
                {displayActionError || confirmError}
              </div>
            ) : null;
          })()}

          <div style={{ display: 'flex', gap: '12px' }}>
            {reservation.reservationStatus === 'PENDING_COUNTER_CONFIRMATION' && (
              <button
                onClick={handleConfirmCounterPayment}
                disabled={confirmLoading}
                style={{ padding: '10px 20px', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: confirmLoading ? 'not-allowed' : 'pointer', flex: 1 }}
              >
                {confirmLoading ? 'Confirming Payment...' : 'Confirm Counter Payment'}
              </button>
            )}

            {reservation.reservationStatus === 'CONFIRMED' && reservation.checkInState !== 'CHECKED_IN' && (
              <button
                onClick={handleCheckIn}
                disabled={actionLoading}
                style={{ padding: '10px 20px', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer', flex: 1 }}
              >
                {actionLoading ? 'Checking In...' : 'Check In'}
              </button>
            )}

            {reservation.checkInState === 'CHECKED_IN' && (
              <button
                onClick={handleCheckOut}
                disabled={actionLoading}
                style={{ padding: '10px 20px', background: '#fff', color: 'var(--da-danger)', border: '1px solid var(--da-danger)', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer', flex: 1 }}
              >
                {actionLoading ? 'Checking Out...' : 'Check Out'}
              </button>
            )}

            {/* Display message if no actions available */}
            {(reservation.reservationStatus !== 'CONFIRMED' && reservation.reservationStatus !== 'PENDING_COUNTER_CONFIRMATION' && reservation.reservationStatus !== 'CHECKED_IN' && reservation.checkInState !== 'CHECKED_IN') && (
              <div style={{ fontSize: '14px', color: 'var(--da-text-secondary)', flex: 1, textAlign: 'center', padding: '8px 0' }}>
                No actions available for this status.
              </div>
            )}
          </div>
        </div>
      </div>

      <EarlyCheckInModal
        isOpen={showEarlyModal}
        onClose={() => {
          setShowEarlyModal(false);
          clearError();
        }}
        customerName={`${reservation.customerFirstName} ${reservation.customerLastName}`.trim()}
        referenceCode={reservation.referenceCode}
        workspaceName={reservation.workspaceDisplayName || reservation.workspaceInstanceCode || undefined}
        bookingStartAt={reservation.bookingStartAt}
        bookingEndAt={reservation.bookingEndAt}
      />
    </main>
  );
}
