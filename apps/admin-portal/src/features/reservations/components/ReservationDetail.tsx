"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import type { AdminReservationDetail as AdminReservationDetailType } from '@deskatlas/domain';
import { formatTimelineDate } from '@deskatlas/domain';

export function canViewBookingQr(detail: AdminReservationDetailType | null): boolean {
  if (!detail) return false;
  const isEligibleStatus = detail.reservationStatus === 'CONFIRMED' || detail.reservationStatus === 'CHECKED_IN';
  if (!isEligibleStatus) return false;
  if (detail.qrRevokedAt) return false;
  return Boolean(detail.bookingToken || detail.bookingAccessUrl || detail.hasBookingQr);
}

export function getBookingQrValue(detail: AdminReservationDetailType): string {
  return detail.bookingAccessUrl || detail.bookingToken || detail.referenceCode;
}

export function ReservationDetail({ id }: { id: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<AdminReservationDetailType | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadDetail() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/reservations/${encodeURIComponent(id)}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(`Reservation ${id} not found.`);
          }
          throw new Error(`Failed to load reservation (${response.status})`);
        }
        const data = await response.json();
        if (!isCancelled) {
          setDetail(data);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setError(err?.message ?? 'Failed to load reservation detail');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadDetail();

    return () => {
      isCancelled = true;
    };
  }, [id]);

  const detailFields = detail
    ? [
        { label: 'Customer Name', value: detail.customerName },
        { label: 'Email', value: detail.customerEmail },
        { label: 'Schedule', value: detail.schedule },
        { label: 'Duration', value: detail.duration },
        { label: 'Payment Status', value: detail.paymentStatus },
        ...(detail.reservationStatus === 'EXPIRED' || (detail.paymentAttempts && detail.paymentAttempts.length > 0)
          ? [
              {
                label: 'Payment Attempt',
                value: detail.paymentAttempts && detail.paymentAttempts.length > 0
                  ? `${detail.paymentAttempts[0].channel} (${detail.paymentAttempts[0].status})`
                  : 'None',
              },
              {
                label: 'Proof Uploaded',
                value: detail.proofSubmittedAt
                  ? `Yes (${formatTimelineDate(detail.proofSubmittedAt)})`
                  : 'No proof uploaded',
              },
              ...(detail.expiryReason
                ? [{ label: 'Expiry Reason', value: detail.expiryReason }]
                : []),
            ]
          : []),
      ]
    : [
        { label: 'Customer Name', value: '...' },
        { label: 'Email', value: '...' },
        { label: 'Schedule', value: '...' },
        { label: 'Duration', value: '...' },
        { label: 'Payment Status', value: '...' },
      ];

  const isConfirmed = detail?.reservationStatus === 'CONFIRMED' || detail?.reservationStatus === 'CHECKED_IN';
  const detailActions: Array<{
    label: string;
    style: React.CSSProperties;
    onClick?: () => void;
    testId?: string;
  }> = [];

  if (isConfirmed) {
    detailActions.push({
      label: 'Reschedule',
      style: { background: 'transparent', color: 'var(--da-text-primary)', border: '1px solid var(--da-border)' },
    });
    detailActions.push({
      label: 'Cancel Booking',
      style: { background: 'transparent', color: 'var(--da-danger)', border: '1px solid #FECACA' },
    });
    if (canViewBookingQr(detail)) {
      detailActions.push({
        label: 'View QR Code',
        style: { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' },
        onClick: () => setShowQrModal(true),
        testId: 'view-qr-code-button',
      });
    }
  }

  const detailCandidates = detail?.candidates && detail.candidates.length > 0
    ? detail.candidates.map((c) => ({
        tier: c.tier + (c.isAssigned ? ' • ALLOCATED' : ''),
        name: c.workspaceDisplayName || c.workspaceInstanceCode || 'Spot',
        color: c.isAssigned ? 'var(--da-brand-dark)' : c.color,
      }))
    : [];

  const detailTimeline = detail?.timeline && detail.timeline.length > 0
    ? detail.timeline
    : ['Reservation recorded'];

  if (loading) {
    return (
      <main data-screen-label="Reservation Detail" style={{ padding: '26px 28px 40px' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); router.push('/manage/reservations'); }} style={{ fontSize: '12px', color: 'var(--da-brand-dark)', fontFamily: 'var(--da-font-family)', fontWeight: 700 }}>&larr; Back to Reservations</a>
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
          Loading reservation details...
        </div>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main data-screen-label="Reservation Detail" style={{ padding: '26px 28px 40px' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); router.push('/manage/reservations'); }} style={{ fontSize: '12px', color: 'var(--da-brand-dark)', fontFamily: 'var(--da-font-family)', fontWeight: 700 }}>&larr; Back to Reservations</a>
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--da-danger)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
          {error ?? 'Reservation not found.'}
        </div>
      </main>
    );
  }

  return (
    <main data-screen-label="Reservation Detail" style={{ padding: '26px 28px 40px' }}>
      <a href="#" onClick={(e) => { e.preventDefault(); router.push('/manage/reservations'); }} style={{ fontSize: '12px', color: 'var(--da-brand-dark)', fontFamily: 'var(--da-font-family)', fontWeight: 700 }}>&larr; Back to Reservations</a>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '14px 0 20px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0, letterSpacing: '-0.02em' }}>{detail.referenceCode}</h1>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: 800, padding: '4px 10px', borderRadius: '9999px', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', ...detail.statusStyle }}>
          <span aria-hidden="true" style={{ fontSize: '10px', lineHeight: 1 }}>{detail.mark}</span>{detail.status}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1.3, minWidth: '320px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '0 0 12px' }}>Reservation Information</h3>
          {detailFields.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid var(--da-border-light)', fontSize: '13px' }}>
              <span style={{ color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>{f.label}</span>
              <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{f.value}</span>
            </div>
          ))}
          {detailActions.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '18px', flexWrap: 'wrap' }}>
              {detailActions.map((act, i) => (
                <button
                  key={i}
                  data-testid={act.testId}
                  onClick={act.onClick}
                  style={{ padding: '9px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', ...act.style }}
                >
                  {act.label}
                </button>
              ))}
            </div>
          )}
          {detail.paymentAttempts && detail.paymentAttempts.length > 0 && (
            <div style={{ marginTop: '20px', borderTop: '1px solid var(--da-border-light)', paddingTop: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '0 0 10px' }}>Payment History</h3>
              {detail.paymentAttempts.map((pa, i) => (
                <div key={pa.id || i} style={{ borderLeft: '3px solid var(--da-border)', padding: '8px 10px', marginBottom: '8px', background: '#F8FAFC', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--da-text-primary)' }}>
                    <span>{pa.channel} Attempt</span>
                    <span style={{ color: pa.status === 'APPROVED' ? 'var(--da-success)' : pa.status === 'EXPIRED' ? 'var(--da-text-secondary)' : 'var(--da-brand-dark)' }}>{pa.status}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '2px' }}>
                    {pa.proofSubmittedAt ? `Proof uploaded: ${formatTimelineDate(pa.proofSubmittedAt)}` : 'No proof submitted'}
                    {pa.expiresAt ? ` • Expired: ${formatTimelineDate(pa.expiresAt)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: '260px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '0 0 12px' }}>Candidates</h3>
          {detailCandidates.map((c, i) => (
            <div key={i} style={{ borderLeft: `3px solid ${c.color}`, padding: '8px 10px', marginBottom: '8px', background: '#F1F8F3', borderRadius: '6px' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, color: c.color, fontFamily: 'var(--da-font-family)' }}>{c.tier}</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)' }}>{c.name}</div>
            </div>
          ))}
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '20px 0 12px' }}>Timeline</h3>
          {detailTimeline.map((t, i) => {
            const isReentry = t.toLowerCase().includes("re-entered") || t.toLowerCase().includes("re-entry") || t.toLowerCase().includes("re-check-in");
            return (
              <div
                key={i}
                style={{
                  fontSize: '12px',
                  color: isReentry ? '#0369A1' : 'var(--da-text-primary)',
                  fontWeight: isReentry ? 600 : 400,
                  fontFamily: 'var(--da-font-family)',
                  padding: '6px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--da-border-light)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isReentry && <span aria-hidden="true" style={{ fontSize: '11px', color: '#0284C7', fontWeight: 800 }}>↺</span>}
                <span>{t}</span>
              </div>
            );
          })}
        </div>
      </div>

      {showQrModal && detail && (
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
                value={getBookingQrValue(detail)}
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
                  {detail.referenceCode}
                </span>
                <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginTop: '2px' }}>
                  {detail.customerName}
                </div>
              </div>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginBottom: '18px', background: '#F1F8F3', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid var(--da-brand-dark)' }}>
              <div style={{ fontWeight: 700, color: 'var(--da-brand-dark)' }}>Schedule</div>
              <div>{detail.schedule} ({detail.duration})</div>
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
    </main>
  );
}
