"use client";

import React, { useState } from 'react';
import { useReservationDetail } from '../hooks/useReservations';
import { useCheckInActions, EarlyCheckInModal, isEarlyCheckInError } from '@/features/check-in';
import { ExtendReservationModal } from './ExtendReservationModal';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';

export function ReservationDetail({ id }: { id: string }) {
  const { reservation, loading, error, refetch } = useReservationDetail(id);
  const { checkIn, checkOut, loading: actionLoading, error: actionError, clearError } = useCheckInActions();
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showEarlyModal, setShowEarlyModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);

  // Relocation modal states
  const [showRelocateModal, setShowRelocateModal] = useState<boolean>(false);
  const [relocationSpots, setRelocationSpots] = useState<any[]>([]);
  const [selectedRelocationSpotId, setSelectedRelocationSpotId] = useState<string>("");
  const [relocationReason, setRelocationReason] = useState<string>("Spot Maintenance / Repairs");
  const [relocationNotes, setRelocationNotes] = useState<string>("");
  const [isRelocating, setIsRelocating] = useState<boolean>(false);
  const [isLoadingRelocationSpots, setIsLoadingRelocationSpots] = useState<boolean>(false);
  const [relocateError, setRelocateError] = useState<string | null>(null);

  const router = useRouter();

  // Load available relocation spots when relocate modal opens
  React.useEffect(() => {
    const resId = reservation?.reservationId || id;
    if (showRelocateModal && resId) {
      let isMounted = true;
      setIsLoadingRelocationSpots(true);
      setRelocateError(null);
      fetch(`/api/operations/reservations/${encodeURIComponent(resId)}/available-relocation-spots`, { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to load available relocation spots');
          }
          return res.json();
        })
        .then((data) => {
          if (!isMounted) return;
          const spots = data.spots || [];
          setRelocationSpots(spots);
          if (spots.length > 0) {
            setSelectedRelocationSpotId(spots[0].id);
          } else {
            setSelectedRelocationSpotId("");
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          setRelocateError(err.message || 'Failed to load available relocation spots');
        })
        .finally(() => {
          if (isMounted) {
            setIsLoadingRelocationSpots(false);
          }
        });

      return () => {
        isMounted = false;
      };
    }
  }, [showRelocateModal, reservation?.reservationId, id]);

  const handleConfirmRelocation = async () => {
    if (!selectedRelocationSpotId) {
      setRelocateError("Please select an available target spot.");
      return;
    }
    if (!relocationReason) {
      setRelocateError("Please select a relocation reason.");
      return;
    }

    const resId = reservation?.reservationId || id;
    setIsRelocating(true);
    setRelocateError(null);
    try {
      const response = await fetch(`/api/operations/reservations/${encodeURIComponent(resId)}/relocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetWorkspaceInstanceId: selectedRelocationSpotId,
          reason: relocationReason,
          notes: relocationNotes || undefined,
          actorRole: "STAFF",
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to relocate reservation");
      }

      await refetch();
      setShowRelocateModal(false);
    } catch (err: any) {
      setRelocateError(err?.message || "Failed to relocate reservation");
    } finally {
      setIsRelocating(false);
    }
  };

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

            {(reservation.reservationStatus === 'CONFIRMED' || reservation.checkInState === 'CHECKED_IN' || reservation.reservationStatus === 'CHECKED_IN') && (
              <>
                <button
                  data-testid="extend-booking-button"
                  onClick={() => setShowExtendModal(true)}
                  style={{ padding: '10px 20px', background: '#fff', color: 'var(--da-brand-dark)', border: '1px solid var(--da-brand-dark)', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', flex: 1 }}
                >
                  Extend Time
                </button>
                <button
                  data-testid="relocate-booking-button"
                  onClick={() => setShowRelocateModal(true)}
                  style={{ padding: '10px 20px', background: '#fff', color: '#0D9488', border: '1px solid #0D9488', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', flex: 1 }}
                >
                  Relocate Spot
                </button>
              </>
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

      <ExtendReservationModal
        isOpen={showExtendModal}
        onClose={() => setShowExtendModal(false)}
        onSuccess={() => {
          refetch();
        }}
        reservationId={reservation.reservationId || id}
        referenceCode={reservation.referenceCode}
        customerName={`${reservation.customerFirstName} ${reservation.customerLastName}`.trim()}
        spotDisplayName={reservation.workspaceDisplayName || reservation.workspaceInstanceCode || 'Spot'}
        templateName={reservation.workspaceTemplateName || undefined}
        currentSchedule={
          reservation.bookingStartAt && reservation.bookingEndAt
            ? `${format(new Date(reservation.bookingStartAt), 'h:mm a')} – ${format(new Date(reservation.bookingEndAt), 'h:mm a')}`
            : undefined
        }
        currentEndAt={reservation.bookingEndAt || undefined}
        hourlyRate={150}
        apiPrefix="/api/operations/reservations"
        actorRole="STAFF"
      />

      {/* Relocate Spot Modal */}
      {showRelocateModal && (
        <div
          data-modal="relocate-booking-modal"
          data-testid="relocate-booking-modal"
          onClick={() => !isRelocating && setShowRelocateModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
              border: '1px solid var(--da-border)',
              boxSizing: 'border-box',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                  Relocate Spot
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--da-text-secondary)', margin: 0 }}>
                  Relocate reservation <strong>#{reservation.referenceCode}</strong> to an available spot (same template &amp; preserved schedule).
                </p>
              </div>
              <button
                data-testid="close-relocate-modal-x-button"
                onClick={() => !isRelocating && setShowRelocateModal(false)}
                aria-label="Close modal"
                disabled={isRelocating}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--da-text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {relocateError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', marginBottom: '14px' }}>
                {relocateError}
              </div>
            )}

            <div style={{ background: '#F8FAFC', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Customer:</span>
                <span style={{ fontWeight: 700 }}>{reservation.customerFirstName} {reservation.customerLastName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Current Spot:</span>
                <span style={{ fontWeight: 700 }}>{reservation.workspaceDisplayName || reservation.workspaceInstanceCode || 'Spot'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Workspace Template:</span>
                <span style={{ fontWeight: 700 }}>{reservation.workspaceTemplateName || "Standard"}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Preserved Schedule:</span>
                <span style={{ fontWeight: 700 }}>
                  {reservation.bookingStartAt && reservation.bookingEndAt
                    ? `${format(new Date(reservation.bookingStartAt), 'MMM d, h:mm a')} – ${format(new Date(reservation.bookingEndAt), 'h:mm a')}`
                    : '-'}
                </span>
              </div>
            </div>

            {isLoadingRelocationSpots ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px' }}>
                Checking available sibling spots for this time slot...
              </div>
            ) : relocationSpots.length === 0 ? (
              <div
                data-testid="no-relocation-spots-alert"
                style={{
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  marginBottom: '16px',
                  fontSize: '12px',
                  color: '#991B1B',
                  lineHeight: 1.4,
                }}
              >
                ⚠️ <strong>No Available Sibling Spots</strong>: All other spots of this template tier have overlapping bookings or are currently inactive/under maintenance during this time window.
              </div>
            ) : (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                  Select Available Target Spot <span style={{ color: 'var(--da-danger)' }}>*</span>
                </label>
                <select
                  data-testid="relocate-spot-select"
                  value={selectedRelocationSpotId}
                  onChange={(e) => setSelectedRelocationSpotId(e.target.value)}
                  disabled={isRelocating}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--da-border)',
                    fontSize: '13px',
                    background: '#fff',
                    color: 'var(--da-text-primary)',
                    boxSizing: 'border-box',
                  }}
                >
                  {relocationSpots.map((spot) => (
                    <option key={spot.id} value={spot.id}>
                      {spot.displayName} ({spot.instanceCode}) {spot.floorName ? `• ${spot.floorName}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                Relocation Reason <span style={{ color: 'var(--da-danger)' }}>*</span>
              </label>
              <select
                data-testid="relocate-reason-select"
                value={relocationReason}
                onChange={(e) => setRelocationReason(e.target.value)}
                disabled={isRelocating}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--da-border)',
                  fontSize: '13px',
                  background: '#fff',
                  color: 'var(--da-text-primary)',
                  boxSizing: 'border-box',
                }}
              >
                <option value="Spot Maintenance / Repairs">Spot Maintenance / Repairs</option>
                <option value="Spot Inactive / Out of Order">Spot Inactive / Out of Order</option>
                <option value="Facility Issue">Facility Issue</option>
                <option value="Customer Request / Operational Adjustment">Customer Request / Operational Adjustment</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                Internal Notes (Optional)
              </label>
              <textarea
                data-testid="relocate-notes-input"
                value={relocationNotes}
                onChange={(e) => setRelocationNotes(e.target.value)}
                placeholder="e.g. Broken desk chair or AC leak at previous spot."
                rows={2}
                disabled={isRelocating}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--da-border)',
                  fontSize: '13px',
                  background: '#fff',
                  color: 'var(--da-text-primary)',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                data-testid="cancel-relocate-modal-button"
                onClick={() => !isRelocating && setShowRelocateModal(false)}
                disabled={isRelocating}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid var(--da-border)',
                  background: '#fff',
                  color: 'var(--da-text-secondary)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-relocate-button"
                onClick={handleConfirmRelocation}
                disabled={isRelocating || isLoadingRelocationSpots || relocationSpots.length === 0 || !selectedRelocationSpotId}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  background: (isRelocating || isLoadingRelocationSpots || relocationSpots.length === 0 || !selectedRelocationSpotId)
                    ? 'var(--da-border)'
                    : '#0D9488',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: (isRelocating || isLoadingRelocationSpots || relocationSpots.length === 0 || !selectedRelocationSpotId)
                    ? 'not-allowed'
                    : 'pointer',
                }}
              >
                {isRelocating ? 'Relocating...' : 'Confirm Relocation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );

}
