"use client";

import React, { useState, useEffect } from 'react';
import { useReservationDetail } from '../hooks/useReservations';
import { useCheckInActions, EarlyCheckInModal, isEarlyCheckInError } from '../../check-in';
import { ExtendReservationModal } from './ExtendReservationModal';
import { ProofImageViewer } from '../../payments/components/ProofImageViewer';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../auth/components/AuthProvider';
import { QRCodeSVG } from 'qrcode.react';
import {
  type AdminReservationDetail as AdminReservationDetailType,
  formatTimelineDate,
} from '@deskatlas/domain';

export function canViewBookingQr(detail: AdminReservationDetailType | any | null): boolean {
  if (!detail) return false;
  const isEligibleStatus = detail.reservationStatus === 'CONFIRMED' || detail.reservationStatus === 'CHECKED_IN';
  if (!isEligibleStatus) return false;
  if (detail.qrRevokedAt) return false;
  return Boolean(detail.bookingToken || detail.bookingAccessUrl || detail.hasBookingQr);
}

export function getBookingQrValue(detail: AdminReservationDetailType | any): string {
  return detail.bookingAccessUrl || detail.bookingToken || detail.referenceCode;
}

export function ReservationDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const { reservation, loading, error, refetch } = useReservationDetail(id);
  const { checkIn, checkOut, loading: actionLoading, error: actionError, clearError } = useCheckInActions();
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showEarlyModal, setShowEarlyModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Relocation modal states
  const [showRelocateModal, setShowRelocateModal] = useState<boolean>(false);
  const [relocationSpots, setRelocationSpots] = useState<any[]>([]);
  const [selectedRelocationSpotId, setSelectedRelocationSpotId] = useState<string>("");
  const [relocationReason, setRelocationReason] = useState<string>("Spot Maintenance / Repairs");
  const [relocationNotes, setRelocationNotes] = useState<string>("");
  const [isRelocating, setIsRelocating] = useState<boolean>(false);
  const [isLoadingRelocationSpots, setIsLoadingRelocationSpots] = useState<boolean>(false);
  const [relocateError, setRelocateError] = useState<string | null>(null);
  const [isDecidingRelocation, setIsDecidingRelocation] = useState<boolean>(false);
  const [relocationDecisionError, setRelocationDecisionError] = useState<string | null>(null);

  // Payment proof inspection modal states
  const [viewingProofAttemptId, setViewingProofAttemptId] = useState<string | null>(null);
  const [viewingProofUrl, setViewingProofUrl] = useState<string | null>(null);
  const [loadingProofUrl, setLoadingProofUrl] = useState<boolean>(false);

  const handleOpenProofModal = async (paymentAttemptId: string) => {
    setViewingProofAttemptId(paymentAttemptId);
    setViewingProofUrl(null);
    setLoadingProofUrl(true);
    try {
      const res = await fetch(`/api/payments/reviews/${encodeURIComponent(paymentAttemptId)}/proof`);
      if (res.ok) {
        const data = await res.json();
        if (data.signedUrl) {
          setViewingProofUrl(data.signedUrl);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingProofUrl(false);
    }
  };

  // Load available relocation spots when relocate modal opens
  useEffect(() => {
    const resId = reservation?.reservationId || reservation?.id || id;
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
  }, [showRelocateModal, reservation?.reservationId, reservation?.id, id]);

  const handleConfirmRelocation = async () => {
    if (!selectedRelocationSpotId) {
      setRelocateError("Please select an available target spot.");
      return;
    }
    if (!relocationReason) {
      setRelocateError("Please select a relocation reason.");
      return;
    }

    const resId = reservation?.reservationId || reservation?.id || id;
    setIsRelocating(true);
    setRelocateError(null);
    try {
      const response = await fetch(`/api/operations/reservations/${encodeURIComponent(resId)}/relocate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.id ? { 'x-user-id': user.id } : {}),
        },
        body: JSON.stringify({
          targetWorkspaceInstanceId: selectedRelocationSpotId,
          reason: relocationReason,
          notes: relocationNotes || undefined,
          actorRole: "STAFF",
          actorUserId: user?.id || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to relocate reservation");
      }

      await refetch();
      setShowRelocateModal(false);
      setToastMessage({ text: "Reservation relocated successfully.", type: "success" });
    } catch (err: any) {
      setRelocateError(err?.message || "Failed to relocate reservation");
    } finally {
      setIsRelocating(false);
    }
  };

  const handleDecideRelocation = async (decision: "APPROVE" | "DECLINE") => {
    let declineNotes = "";
    if (decision === "DECLINE") {
      const inputNotes = window.prompt("Enter optional reason for declining this relocation request:");
      if (inputNotes === null) return;
      declineNotes = inputNotes;
    }

    const resId = reservation?.reservationId || reservation?.id || id;
    setIsDecidingRelocation(true);
    setRelocationDecisionError(null);
    try {
      const res = await fetch(`/api/operations/reservations/${encodeURIComponent(resId)}/relocate/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(user?.id ? { "x-user-id": user.id } : {}),
        },
        body: JSON.stringify({
          decision,
          notes: declineNotes || undefined,
          actorRole: "STAFF",
          actorUserId: user?.id || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to process relocation decision");
      }

      await refetch();
      setToastMessage({
        text: decision === "APPROVE" ? "Customer relocation request approved successfully." : "Customer relocation request declined.",
        type: "success",
      });
    } catch (err: any) {
      setRelocationDecisionError(err?.message || "Failed to process decision");
    } finally {
      setIsDecidingRelocation(false);
    }
  };

  const handleConfirmCounterPayment = async () => {
    setConfirmLoading(true);
    setConfirmError(null);
    try {
      const res = await fetch(`/api/payments/${encodeURIComponent(reservation.referenceCode)}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.id ? {
            'x-actor-user-id': user.id,
            'x-actor-role': (user.role || 'STAFF').toUpperCase(),
            'x-user-id': user.id,
            'x-user-role': (user.role || 'STAFF').toUpperCase(),
          } : {}),
        },
        body: JSON.stringify({
          code: reservation.referenceCode,
          actor: {
            userId: user?.id,
            role: user?.role?.toUpperCase() || 'STAFF',
          },
        }),
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
    } catch {
      // Error handled in UI
    }
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading reservation details...</div>;
  if (error || !reservation) return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--da-danger)' }}>
      {error || 'Reservation not found'}
    </div>
  );

  const customerFullName = reservation.customerName || `${reservation.customerFirstName || ''} ${reservation.customerLastName || ''}`.trim() || 'Guest';
  const customerEmail = reservation.customerEmail || '-';
  const contactNumber = reservation.customerContactNumber || reservation.customerPhone || null;
  const scheduleText = reservation.schedule || (
    reservation.bookingStartAt && reservation.bookingEndAt
      ? (format(new Date(reservation.bookingStartAt), 'yyyy-MM-dd') === format(new Date(reservation.bookingEndAt), 'yyyy-MM-dd')
          ? `${format(new Date(reservation.bookingStartAt), 'MMM d, yyyy, h:mm a')} to ${format(new Date(reservation.bookingEndAt), 'h:mm a')}`
          : `${format(new Date(reservation.bookingStartAt), 'MMM d, yyyy, h:mm a')} to ${format(new Date(reservation.bookingEndAt), 'MMM d, yyyy, h:mm a')}`)
      : '-'
  );
  const durationText = reservation.duration || '-';
  const paymentStatusText = reservation.paymentStatus || reservation.reservationStatus;
  const amountDueText = reservation.amountDue ? `${reservation.currency || 'PHP'} ${reservation.amountDue}` : null;
  const rateSnapshotText = reservation.rateSnapshot ? `${reservation.currency || 'PHP'} ${reservation.rateSnapshot}/hr` : null;

  const detailFields = [
    { label: 'Customer Name', value: customerFullName },
    { label: 'Email', value: customerEmail },
    ...(contactNumber ? [{ label: 'Contact Number', value: contactNumber }] : []),
    { label: 'Schedule', value: scheduleText },
    { label: 'Duration', value: durationText },
    ...(rateSnapshotText ? [{ label: 'Hourly Rate', value: rateSnapshotText }] : []),
    ...(amountDueText ? [{ label: 'Total Amount', value: amountDueText }] : []),
    { label: 'Payment Status', value: paymentStatusText },
    ...(reservation.reservationStatus === 'CANCELLED'
      ? [
          {
            label: 'Cancellation Reason',
            value: reservation.cancellationReason || 'Administrative Cancellation',
          },
          {
            label: 'Cancelled At',
            value: reservation.cancelledAt
              ? formatTimelineDate(reservation.cancelledAt)
              : formatTimelineDate(reservation.updatedAt || new Date().toISOString()),
          },
        ]
      : []),
    ...(reservation.reservationStatus === 'EXPIRED' || (reservation.paymentAttempts && reservation.paymentAttempts.length > 0)
      ? [
          {
            label: 'Payment Attempt',
            value: reservation.paymentAttempts && reservation.paymentAttempts.length > 0
              ? `${reservation.paymentAttempts[0].channel} (${reservation.paymentAttempts[0].status})`
              : 'None',
          },
          {
            label: 'Proof Uploaded',
            value: reservation.proofSubmittedAt
              ? `Yes (${formatTimelineDate(reservation.proofSubmittedAt)})`
              : 'No proof uploaded',
          },
          ...(reservation.expiryReason
            ? [{ label: 'Expiry Reason', value: reservation.expiryReason }]
            : []),
        ]
      : []),
  ];

  const detailCandidates = reservation.candidates && reservation.candidates.length > 0
    ? reservation.candidates.map((c: any) => ({
        tier: (c.tier || `Rank ${c.rank ?? 0}`) + (c.isAssigned ? ' • ALLOCATED' : ''),
        name: c.workspaceDisplayName || c.workspaceInstanceCode || 'Spot',
        color: c.isAssigned ? 'var(--da-brand-dark)' : (c.color || '#64748B'),
      }))
    : reservation.workspaceDisplayName
    ? [
        {
          tier: (reservation.workspaceTemplateName || 'Standard') + ' • ALLOCATED',
          name: reservation.workspaceDisplayName + (reservation.workspaceInstanceCode ? ` (${reservation.workspaceInstanceCode})` : ''),
          color: 'var(--da-brand-dark)',
        },
      ]
    : [];

  const detailTimeline: string[] = reservation.timeline && reservation.timeline.length > 0
    ? reservation.timeline
    : ['Reservation recorded'];

  const isConfirmed = reservation.reservationStatus === 'CONFIRMED' || reservation.reservationStatus === 'CHECKED_IN' || reservation.checkInState === 'CHECKED_IN';
  const showQrButton = canViewBookingQr(reservation);

  return (
    <main data-screen-label="Staff Reservation Detail" style={{ padding: '26px 28px 40px', maxWidth: '1000px' }}>
      <button
        onClick={() => router.back()}
        style={{ background: 'transparent', border: 'none', color: 'var(--da-brand-dark)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '13px', fontWeight: 700, fontFamily: 'var(--da-font-family)' }}
      >
        &larr; Back to Reservations
      </button>

      {toastMessage && (
        <div
          data-testid="toast-notification"
          style={{
            margin: '0 0 16px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: toastMessage.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${toastMessage.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            color: toastMessage.type === 'success' ? '#065F46' : '#991B1B',
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '0 0 20px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0, letterSpacing: '-0.02em' }}>
          {reservation.referenceCode}
        </h1>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            fontWeight: 800,
            padding: '4px 10px',
            borderRadius: '9999px',
            whiteSpace: 'nowrap',
            background: reservation.reservationStatus === 'CONFIRMED' || reservation.reservationStatus === 'CHECKED_IN' ? '#DCFCE7' : reservation.reservationStatus === 'PENDING_COUNTER_CONFIRMATION' ? 'var(--da-soft, #FEF08A)' : '#F1F5F9',
            color: reservation.reservationStatus === 'CONFIRMED' || reservation.reservationStatus === 'CHECKED_IN' ? '#166534' : reservation.reservationStatus === 'PENDING_COUNTER_CONFIRMATION' ? '#854D0E' : '#475569',
            fontFamily: 'var(--da-font-family)',
            ...(reservation.statusStyle || {}),
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '10px', lineHeight: 1 }}>{reservation.mark || '•'}</span>
          {reservation.reservationStatus === 'PENDING_COUNTER_CONFIRMATION' ? 'Counter Queue' : (reservation.status || reservation.reservationStatus)}
        </span>
      </div>

      {reservation.pendingRelocationRequest && reservation.pendingRelocationRequest.status === 'PENDING' && (
        <div
          data-testid="pending-relocation-request-banner"
          style={{
            background: '#FEFCE8',
            border: '1px solid #FEF08A',
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ flex: 1, minWidth: '240px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>⚠️</span>
                <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#854D0E' }}>
                  Pending Customer Relocation Request
                </h4>
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', background: '#FEF08A', color: '#713F12' }}>
                  Awaiting Staff Approval
                </span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#713F12' }}>
                The customer has requested to relocate to <strong>{reservation.pendingRelocationRequest.targetWorkspaceDisplayName}</strong>.
                {reservation.pendingRelocationRequest.reason && <> Reason: <em>{reservation.pendingRelocationRequest.reason}</em>.</>}
                {reservation.pendingRelocationRequest.notes && <> Notes: &quot;{reservation.pendingRelocationRequest.notes}&quot;.</>}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                data-testid="approve-relocation-request-button"
                disabled={isDecidingRelocation}
                onClick={() => handleDecideRelocation('APPROVE')}
                style={{
                  background: '#16A34A',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isDecidingRelocation ? 'not-allowed' : 'pointer',
                }}
              >
                {isDecidingRelocation ? 'Processing...' : 'Approve Relocation'}
              </button>
              <button
                data-testid="decline-relocation-request-button"
                disabled={isDecidingRelocation}
                onClick={() => handleDecideRelocation('DECLINE')}
                style={{
                  background: '#DC2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isDecidingRelocation ? 'not-allowed' : 'pointer',
                }}
              >
                {isDecidingRelocation ? 'Processing...' : 'Decline Request'}
              </button>
            </div>
          </div>
          {relocationDecisionError && (
            <div style={{ color: '#DC2626', fontSize: '12px', fontWeight: 600 }}>
              {relocationDecisionError}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        {/* Left Column: Reservation Information & Payment History */}
        <div style={{ flex: 1.3, minWidth: '320px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '0 0 12px' }}>
            Reservation Details
          </h3>
          {detailFields.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid var(--da-border-light, #F1F5F9)', fontSize: '13px' }}>
              <span style={{ color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>{f.label}</span>
              <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{f.value}</span>
            </div>
          ))}

          {/* Operational Action Buttons for Staff */}
          <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--da-border-light, #F1F5F9)' }}>
            {(() => {
              const displayActionError = isEarlyCheckInError(actionError) ? null : actionError;
              return (displayActionError || confirmError) ? (
                <div style={{ color: 'var(--da-danger)', fontSize: '13px', marginBottom: '14px', background: '#FEE2E2', padding: '10px 12px', borderRadius: '6px' }}>
                  {displayActionError || confirmError}
                </div>
              ) : null;
            })()}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {reservation.reservationStatus === 'PENDING_COUNTER_CONFIRMATION' && (
                <button
                  onClick={handleConfirmCounterPayment}
                  disabled={confirmLoading}
                  style={{ padding: '9px 14px', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: confirmLoading ? 'not-allowed' : 'pointer' }}
                >
                  {confirmLoading ? 'Confirming Payment...' : 'Confirm Counter Payment'}
                </button>
              )}

              {reservation.reservationStatus === 'CONFIRMED' && reservation.checkInState !== 'CHECKED_IN' && (
                <button
                  onClick={handleCheckIn}
                  disabled={actionLoading}
                  style={{ padding: '9px 14px', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer' }}
                >
                  {actionLoading ? 'Checking In...' : 'Check In'}
                </button>
              )}

              {reservation.checkInState === 'CHECKED_IN' && (
                <button
                  onClick={handleCheckOut}
                  disabled={actionLoading}
                  style={{ padding: '9px 14px', background: '#fff', color: 'var(--da-danger)', border: '1px solid var(--da-danger)', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer' }}
                >
                  {actionLoading ? 'Checking Out...' : 'Check Out'}
                </button>
              )}

              {isConfirmed && (
                <>
                  <button
                    data-testid="extend-booking-button"
                    onClick={() => setShowExtendModal(true)}
                    style={{ padding: '9px 14px', background: '#fff', color: 'var(--da-brand-dark)', border: '1px solid var(--da-brand-dark)', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Extend Time
                  </button>
                  <button
                    data-testid="relocate-booking-button"
                    onClick={() => setShowRelocateModal(true)}
                    style={{ padding: '9px 14px', background: '#fff', color: '#0D9488', border: '1px solid #0D9488', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Relocate Spot
                  </button>
                </>
              )}

              {showQrButton && (
                <button
                  data-testid="view-qr-code-button"
                  onClick={() => setShowQrModal(true)}
                  style={{ padding: '9px 14px', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  View QR Code
                </button>
              )}

              {!isConfirmed && reservation.reservationStatus !== 'PENDING_COUNTER_CONFIRMATION' && !showQrButton && (
                <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', padding: '6px 0' }}>
                  No operational actions available for this status.
                </div>
              )}
            </div>
          </div>

          {/* Payment History Panel */}
          {reservation.paymentAttempts && reservation.paymentAttempts.length > 0 && (
            <div style={{ marginTop: '24px', borderTop: '1px solid var(--da-border-light, #F1F5F9)', paddingTop: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '0 0 10px' }}>
                Payment History
              </h3>
              {reservation.paymentAttempts.map((pa: any, i: number) => (
                <div key={pa.id || i} style={{ borderLeft: '3px solid var(--da-border)', padding: '8px 10px', marginBottom: '8px', background: '#F8FAFC', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--da-text-primary)' }}>
                    <span>{pa.channel} Attempt</span>
                    <span style={{ color: pa.status === 'APPROVED' ? 'var(--da-success, #16A34A)' : pa.status === 'EXPIRED' ? 'var(--da-text-secondary)' : pa.status === 'REJECTED' ? 'var(--da-danger)' : 'var(--da-brand-dark)' }}>
                      {pa.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>
                      {pa.proofSubmittedAt ? `Proof uploaded: ${formatTimelineDate(pa.proofSubmittedAt)}` : 'No proof submitted'}
                      {pa.expiresAt ? ` • Expired: ${formatTimelineDate(pa.expiresAt)}` : ''}
                    </div>
                    {pa.id && (pa.proofSubmittedAt || pa.proofStoragePath) && (
                      <button
                        data-testid={`view-payment-proof-${pa.id}`}
                        onClick={() => handleOpenProofModal(pa.id)}
                        style={{
                          background: '#fff',
                          border: '1px solid var(--da-brand-dark)',
                          color: 'var(--da-brand-dark)',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily: 'var(--da-font-family)',
                        }}
                      >
                        View Proof
                      </button>
                    )}
                  </div>
                  {pa.rejectionReason && (
                    <div style={{ fontSize: '11px', color: 'var(--da-danger)', marginTop: '4px', fontWeight: 600 }}>
                      Rejection reason: {pa.rejectionReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Candidates & Timeline */}
        <div style={{ flex: 1, minWidth: '260px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '0 0 12px' }}>
            Candidates
          </h3>
          {detailCandidates.map((c: any, i: number) => (
            <div key={i} style={{ borderLeft: `3px solid ${c.color}`, padding: '8px 10px', marginBottom: '8px', background: '#F1F8F3', borderRadius: '6px' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, color: c.color, fontFamily: 'var(--da-font-family)' }}>{c.tier}</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)' }}>{c.name}</div>
            </div>
          ))}

          <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '20px 0 12px' }}>
            Timeline
          </h3>
          {detailTimeline.map((t, i) => {
            const isReentry = t.toLowerCase().includes("re-entered") || t.toLowerCase().includes("re-entry") || t.toLowerCase().includes("re-check-in");
            const isCancel = t.toLowerCase().includes("cancelled");
            const isReschedule = t.toLowerCase().includes("rescheduled");
            const isRelocate = t.toLowerCase().includes("relocated");
            return (
              <div
                key={i}
                style={{
                  fontSize: '12px',
                  color: isCancel ? 'var(--da-danger)' : isReschedule ? '#0369A1' : isRelocate ? '#0D9488' : isReentry ? '#0369A1' : 'var(--da-text-primary)',
                  fontWeight: isCancel || isReschedule || isRelocate || isReentry ? 600 : 400,
                  fontFamily: 'var(--da-font-family)',
                  padding: '6px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--da-border-light, #F1F5F9)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isReentry && <span aria-hidden="true" style={{ fontSize: '11px', color: '#0284C7', fontWeight: 800 }}>↺</span>}
                {isCancel && <span aria-hidden="true" style={{ fontSize: '11px', color: 'var(--da-danger)', fontWeight: 800 }}>✕</span>}
                {isReschedule && <span aria-hidden="true" style={{ fontSize: '11px', color: '#0284C7', fontWeight: 800 }}>📅</span>}
                {isRelocate && <span aria-hidden="true" style={{ fontSize: '11px', color: '#0D9488', fontWeight: 800 }}>🔀</span>}
                <span>{t}</span>
              </div>
            );
          })}
        </div>
      </div>

      <EarlyCheckInModal
        isOpen={showEarlyModal}
        onClose={() => {
          setShowEarlyModal(false);
          clearError();
        }}
        customerName={customerFullName}
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
          setToastMessage({
            type: 'success',
            text: 'Reservation time extended successfully.',
          });
        }}
        reservationId={reservation.reservationId || reservation.id || id}
        referenceCode={reservation.referenceCode}
        customerName={customerFullName}
        spotDisplayName={reservation.workspaceDisplayName || reservation.workspaceInstanceCode || 'Spot'}
        templateName={reservation.workspaceTemplateName || undefined}
        currentSchedule={scheduleText}
        currentEndAt={reservation.bookingEndAt || undefined}
        hourlyRate={reservation.rateSnapshot || 150}
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

            {(() => {
              if (!reservation) return null;
              const nowMs = Date.now();
              const candStartMs = reservation.bookingStartAt ? new Date(reservation.bookingStartAt).getTime() : 0;
              const candEndMs = reservation.bookingEndAt ? new Date(reservation.bookingEndAt).getTime() : 0;
              const isInSession = candStartMs > 0 && candEndMs > 0 && nowMs >= candStartMs && nowMs < candEndMs && (reservation.reservationStatus === 'CONFIRMED' || reservation.reservationStatus === 'CHECKED_IN');
              if (!isInSession) return null;

              const remainingMinutes = Math.max(0, Math.round((candEndMs - nowMs) / 60000));
              const remainingHours = Math.floor(remainingMinutes / 60);
              const remMins = remainingMinutes % 60;
              const remainingTimeText = remainingHours > 0
                ? `${remainingHours} hour${remainingHours > 1 ? 's' : ''}${remMins > 0 ? ` ${remMins} min${remMins > 1 ? 's' : ''}` : ''}`
                : `${remMins} min${remMins > 1 ? 's' : ''}`;
              const endTimeFormatted = reservation.bookingEndAt ? format(new Date(reservation.bookingEndAt), 'h:mm a') : '';

              return (
                <div
                  data-testid="in-session-relocation-notice"
                  style={{
                    background: '#F0FDF4',
                    border: '1px solid #BBF7D0',
                    color: '#166534',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    marginBottom: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span>⚡</span>
                  <span>Session in progress. Reallocating for remaining time: {remainingTimeText} (until {endTimeFormatted}).</span>
                </div>
              );
            })()}

            <div style={{ background: '#F8FAFC', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Customer:</span>
                <span style={{ fontWeight: 700 }}>{customerFullName}</span>
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
                  {scheduleText}
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

      {/* Booking QR Code Modal */}
      {showQrModal && reservation && (
        <div
          data-modal="booking-qr-modal"
          data-testid="booking-qr-modal"
          onClick={() => setShowQrModal(false)}
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
              maxWidth: '420px',
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
                  Booking QR Code
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: 0 }}>
                  Scan at front desk or kiosk for check-in / re-entry
                </p>
              </div>
              <button
                data-testid="close-qr-modal-x-button"
                onClick={() => setShowQrModal(false)}
                aria-label="Close modal"
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

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px dashed var(--da-border)',
                margin: '16px 0',
              }}
            >
              <QRCodeSVG
                value={getBookingQrValue(reservation)}
                size={200}
                level="H"
              />
              <div style={{ marginTop: '14px', textAlign: 'center' }}>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '14px',
                    fontWeight: 800,
                    color: 'var(--da-brand-dark)',
                    letterSpacing: '0.05em',
                  }}
                >
                  {reservation.referenceCode}
                </span>
                <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginTop: '2px' }}>
                  {customerFullName}
                </div>
              </div>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginBottom: '18px', background: '#F1F8F3', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid var(--da-brand-dark)' }}>
              <div style={{ fontWeight: 700, color: 'var(--da-brand-dark)' }}>Schedule</div>
              <div>{scheduleText} ({durationText})</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                data-testid="close-qr-modal-button"
                onClick={() => setShowQrModal(false)}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: 'var(--da-brand-dark)',
                  color: '#fff',
                  border: 'none',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Proof Viewer Modal with MF-114 Zoom and Pan */}
      {viewingProofAttemptId && (
        <div
          data-testid="proof-viewer-modal"
          onClick={() => setViewingProofAttemptId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
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
              maxWidth: '560px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
              border: '1px solid var(--da-border)',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0 }}>
                Payment Proof Inspection
              </h3>
              <button
                data-testid="close-proof-modal-button"
                onClick={() => setViewingProofAttemptId(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  color: 'var(--da-text-secondary)',
                }}
              >
                ✕
              </button>
            </div>
            <ProofImageViewer proofUrl={viewingProofUrl} loading={loadingProofUrl} height="360px" alt="Payment proof submission" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button
                onClick={() => setViewingProofAttemptId(null)}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: 'var(--da-brand-dark)',
                  color: '#fff',
                  border: 'none',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
