"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth';
import type {
  PaymentReviewDetail,
  PaymentReviewDecisionResult,
} from '@deskatlas/domain';

import { ProofImageViewer } from './ProofImageViewer';

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return 'just now';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  if (diffMs < 0 || isNaN(diffMs)) return 'just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} mins ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function formatScheduleRange(startIso?: string, endIso?: string, timezone = 'Asia/Manila'): string {
  if (!startIso || !endIso) return 'Schedule not specified';
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return `${startIso} - ${endIso}`;
    }
    const dateFormatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(start);
    const startTime = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(start);
    const endTime = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(end);
    return `${dateFormatted}, ${startTime} - ${endTime}`;
  } catch {
    return `${startIso} - ${endIso}`;
  }
}

export function PaymentReview({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();

  const [detail, setDetail] = useState<PaymentReviewDetail | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProof, setLoadingProof] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showApproveModal, setShowApproveModal] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isApproveSuccess, setIsApproveSuccess] = useState(false);
  const [approveResult, setApproveResult] = useState<PaymentReviewDecisionResult | null>(null);

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const [showReconsiderModal, setShowReconsiderModal] = useState(false);
  const [isReconsidering, setIsReconsidering] = useState(false);

  const confirmReconsider = async () => {
    if (!detail) return;
    setIsReconsidering(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/admin/payments/reviews/${encodeURIComponent(detail.paymentAttemptId)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'RECONSIDER_APPROVE',
          actorUserId: user?.id,
          actorRole: 'ADMIN',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reconsider payment.');
      }

      setShowReconsiderModal(false);
      setApproveResult(data);
      setIsApproveSuccess(true);
      setShowApproveModal(true);
      fetchDetail();
    } catch (err: any) {
      setActionError(err.message || 'Error reconsidering payment.');
    } finally {
      setIsReconsidering(false);
    }
  };

  const fetchDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/admin/payments/reviews/${encodeURIComponent(id)}`);
      if (!res.ok) {
        throw new Error(`Failed to load payment review detail (${res.status})`);
      }
      const data: PaymentReviewDetail = await res.json();
      setDetail(data);

      if (data.proofStoragePath) {
        fetchProofUrl();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load payment details.');
    } finally {
      setLoading(false);
    }
  };

  const fetchProofUrl = async () => {
    try {
      setLoadingProof(true);
      const res = await fetch(`/api/admin/payments/reviews/${encodeURIComponent(id)}/proof`);
      if (res.ok) {
        const data = await res.json();
        if (data.signedUrl) {
          setProofUrl(data.signedUrl);
        }
      }
    } catch {
      // ignore proof load error
    } finally {
      setLoadingProof(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchDetail();
    }
  }, [id]);

  const confirmApprove = async () => {
    if (!detail) return;
    setIsApproving(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/admin/payments/reviews/${encodeURIComponent(detail.paymentAttemptId)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'APPROVE',
          actorUserId: user?.id,
          actorRole: 'ADMIN',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to approve payment.');
      }

      setApproveResult(data);
      setIsApproveSuccess(true);
    } catch (err: any) {
      setActionError(err.message || 'Error approving payment.');
    } finally {
      setIsApproving(false);
    }
  };

  const closeApprove = () => {
    setShowApproveModal(false);
    if (isApproveSuccess) {
      router.push('/manage/payments');
    }
  };

  const confirmReject = async () => {
    if (!detail) return;
    if (!rejectReason.trim()) {
      setActionError('Please provide a rejection reason.');
      return;
    }

    setIsRejecting(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/admin/payments/reviews/${encodeURIComponent(detail.paymentAttemptId)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'REJECT',
          rejectionReason: rejectReason.trim(),
          actorUserId: user?.id,
          actorRole: 'ADMIN',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reject payment.');
      }

      setShowRejectModal(false);
      router.push('/manage/payments');
    } catch (err: any) {
      setActionError(err.message || 'Error rejecting payment.');
    } finally {
      setIsRejecting(false);
    }
  };

  if (loading) {
    return (
      <main data-screen-label="Payment Review" style={{ padding: '26px 28px 40px' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); router.push('/manage/payments'); }} style={{ fontSize: '12px', color: 'var(--da-brand-dark)', fontFamily: 'var(--da-font-family)', fontWeight: 700 }}>&larr; Back to Payments</a>
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '14px', fontFamily: 'var(--da-font-family)' }}>
          Loading payment review details...
        </div>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main data-screen-label="Payment Review" style={{ padding: '26px 28px 40px' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); router.push('/manage/payments'); }} style={{ fontSize: '12px', color: 'var(--da-brand-dark)', fontFamily: 'var(--da-font-family)', fontWeight: 700 }}>&larr; Back to Payments</a>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '14px 0 3px', letterSpacing: '-0.02em' }}>Payment Review</h1>
        <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: '12px', padding: '16px 20px', color: '#991B1B', fontSize: '13px', margin: '20px 0' }}>
          {error || 'Payment review item was not found.'}
        </div>
        <button onClick={() => router.push('/manage/payments')} style={{ background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>Return to Queue</button>
      </main>
    );
  }

  const customerName = `${detail.customerFirstName} ${detail.customerLastName}`.trim();
  const formattedAmount = `₱${Number(detail.amountDue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const submittedAgo = formatTimeAgo(detail.proofSubmittedAt);
  const primaryCandidate = detail.submittedCandidates?.[0];
  const scheduleDisplay = primaryCandidate
    ? formatScheduleRange(primaryCandidate.startAt, primaryCandidate.endAt)
    : 'Not scheduled';

  const reviewFields = [
    { label: 'Customer', value: customerName },
    { label: 'Email', value: detail.customerEmail },
    { label: 'Reference', value: detail.reservationReferenceCode || detail.paymentAttemptId.slice(0, 8) },
    { label: 'Amount', value: formattedAmount },
    { label: 'Date/Time', value: scheduleDisplay },
    { label: 'Submitted', value: submittedAgo },
    { label: 'Status', value: detail.paymentStatus },
  ];

  const assignedCandidateFromDetail = approveResult?.assignedCandidateRank !== null && approveResult?.assignedCandidateRank !== undefined
    ? detail.submittedCandidates?.find((c) => c.rank === approveResult.assignedCandidateRank)
    : null;

  const assignedWorkspaceName = assignedCandidateFromDetail?.workspaceDisplayName
    || assignedCandidateFromDetail?.workspaceInstanceCode
    || 'Workspace';

  return (
    <main data-screen-label="Payment Review" style={{ padding: '26px 28px 40px' }}>
      <a href="#" onClick={(e) => { e.preventDefault(); router.push('/manage/payments'); }} style={{ fontSize: '12px', color: 'var(--da-brand-dark)', fontFamily: 'var(--da-font-family)', fontWeight: 700 }}>&larr; Back to Payments</a>
      <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '14px 0 3px', letterSpacing: '-0.02em' }}>Payment Proof</h1>
      <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '20px' }}>Approving allocates Main &rarr; Alt 1 &rarr; Alt 2 by live availability</div>
      
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1.2, minWidth: '300px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '20px' }}>
          {detail.paymentStatus === 'REJECTED' && (
            <div
              data-testid="rejected-proof-badge"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#FEE2E2',
                border: '1px solid #FCA5A5',
                borderRadius: '8px',
                padding: '9px 12px',
                marginBottom: '14px',
                color: '#991B1B',
                fontSize: '12px',
                fontWeight: 700,
                fontFamily: 'var(--da-font-family)',
              }}
            >
              <span>✕ REJECTED PAYMENT PROOF</span>
              {detail.rejectionReason && (
                <span style={{ fontWeight: 500, fontSize: '11px', color: '#7F1D1D' }}>
                  Reason: {detail.rejectionReason}
                </span>
              )}
            </div>
          )}

          <ProofImageViewer proofUrl={proofUrl} loading={loadingProof} alt="Payment proof submission" />

          {reviewFields.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid var(--da-border-light)', fontSize: '13px' }}>
              <span style={{ color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>{f.label}</span>
              <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{f.value}</span>
            </div>
          ))}
        </div>
        
        <div style={{ flex: 1, minWidth: '260px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '0 0 12px' }}>Reservation Candidates</h3>
          {detail.submittedCandidates && detail.submittedCandidates.length > 0 ? (
            detail.submittedCandidates.map((c, i) => {
              const tierLabel = c.rank === 0 ? 'MAIN' : c.rank === 1 ? 'ALTERNATIVE 1' : 'ALTERNATIVE 2';
              const tierColor = c.rank === 0 ? 'var(--da-brand-dark)' : 'var(--da-text-secondary)';
              const candidateName = c.workspaceDisplayName || c.workspaceInstanceCode || `Spot #${i + 1}`;
              const candidateSubtext = [c.workspaceTemplateName, c.floorName].filter(Boolean).join(' · ');

              return (
                <div key={i} style={{ borderLeft: `3px solid ${tierColor}`, padding: '8px 10px', marginBottom: '8px', background: '#F1F8F3', borderRadius: '6px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 800, color: tierColor, fontFamily: 'var(--da-font-family)' }}>{tierLabel}</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)' }}>{candidateName}</div>
                  {candidateSubtext && (
                    <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>{candidateSubtext}</div>
                  )}
                </div>
              );
            })
          ) : (
            <div style={{ color: 'var(--da-text-secondary)', fontSize: '12px', fontFamily: 'var(--da-font-family)' }}>No candidate workspaces recorded.</div>
          )}

          {detail.paymentStatus === 'UNDER_REVIEW' ? (
            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button
                data-testid="open-reject-modal-button"
                onClick={() => { setActionError(null); setShowRejectModal(true); }}
                style={{ flex: 1, background: '#fff', border: '1px solid var(--da-brand-dark)', color: 'var(--da-brand-dark)', padding: '11px', borderRadius: '9px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
              >
                Reject Payment
              </button>
              <button
                data-testid="open-approve-modal-button"
                onClick={() => { setActionError(null); setShowApproveModal(true); }}
                style={{ flex: 1, background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)', color: '#fff', border: 'none', padding: '11px', borderRadius: '9px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
              >
                Approve Payment
              </button>
            </div>
          ) : detail.paymentStatus === 'APPROVED' ? (
            <div style={{ marginTop: '20px', padding: '12px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '8px', color: '#166534', fontSize: '13px', fontWeight: 700, textAlign: 'center' }}>
              Payment is APPROVED
            </div>
          ) : detail.paymentStatus === 'REJECTED' ? (
            <div style={{ marginTop: '20px', padding: '14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#991B1B', fontWeight: 800, fontSize: '13px' }}>
                <span>✕ Payment is REJECTED</span>
              </div>
              {detail.rejectionReason && (
                <div style={{ fontSize: '12px', color: '#991B1B', marginTop: '4px' }}>
                  Reason: <strong>{detail.rejectionReason}</strong>
                </div>
              )}
              <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)', marginTop: '8px', lineHeight: 1.4, fontFamily: 'var(--da-font-family)' }}>
                Mistakenly rejected? Re-evaluates live availability, assigns the best available workspace candidate, confirms the reservation, and dispatches the booking confirmation email with access QR.
              </div>
              <button
                data-testid="reconsider-approve-button"
                onClick={() => { setActionError(null); setShowReconsiderModal(true); }}
                style={{
                  marginTop: '12px',
                  width: '100%',
                  background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)',
                  color: '#fff',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(12,59,39,.15)',
                }}
              >
                Reconsider & Approve
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '20px', padding: '12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', color: '#991B1B', fontSize: '13px', textAlign: 'center' }}>
              <strong>Payment is {detail.paymentStatus}</strong>
              {detail.rejectionReason && <div style={{ fontSize: '12px', marginTop: '4px' }}>Reason: {detail.rejectionReason}</div>}
            </div>
          )}
        </div>
      </div>

      {showApproveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(12,59,39,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '26px', maxWidth: '380px', width: '90%' }}>
            {!isApproveSuccess ? (
              <>
                <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 10px' }}>Approve payment?</h3>
                <p style={{ fontSize: '13px', color: 'var(--da-text-primary)', lineHeight: 1.5, margin: '0 0 14px' }}>DeskAtlas will check Main &rarr; Alternative 1 &rarr; Alternative 2 against current availability.</p>
                {actionError && (
                  <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: '8px', padding: '8px 12px', color: '#991B1B', fontSize: '12px', marginBottom: '12px' }}>
                    {actionError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button onClick={closeApprove} disabled={isApproving} style={{ background: 'transparent', border: '1px solid var(--da-border)', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={confirmApprove} disabled={isApproving} style={{ background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: isApproving ? 0.7 : 1 }}>{isApproving ? 'Approving...' : 'Approve & Allocate'}</button>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'var(--da-info)', color: 'var(--da-brand-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', margin: '0 auto 12px' }}>✓</div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 8px' }}>Payment approved</h3>
                {approveResult?.reservationStatus === 'CONFIRMED' ? (
                  <>
                    <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: '0 0 4px', fontFamily: 'var(--da-font-family)' }}>Assigned workspace</p>
                    <p style={{ fontSize: '15px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 14px' }}>{assignedWorkspaceName}</p>
                    <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: '0 0 16px' }}>Booking QR created and confirmation email dispatched.</p>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-warning-dark, #B45309)', margin: '0 0 8px' }}>Needs Manual Resolution</p>
                    <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: '0 0 16px' }}>All candidates were unavailable. Follow up with guest.</p>
                  </>
                )}
                <button onClick={closeApprove} style={{ width: '100%', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', padding: '11px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>Done</button>
              </div>
            )}
          </div>
        </div>
      )}

      {showRejectModal && (
        <div
          data-testid="confirm-rejection-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(12,59,39,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div style={{ background: '#fff', borderRadius: '14px', padding: '26px', maxWidth: '440px', width: '90%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#991B1B', margin: '0 0 10px' }}>Confirm Payment Rejection</h3>
            <p style={{ fontSize: '13px', color: 'var(--da-text-primary)', lineHeight: 1.5, margin: '0 0 14px' }}>
              Are you sure you want to reject this payment? This will cancel reservation <strong>#{detail.reservationReferenceCode || detail.paymentAttemptId.slice(0, 8)}</strong> and send an email notification to <strong>{detail.customerEmail}</strong> with your stated reason.
            </p>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)' }}>Rejection Reason (Required) *</label>
            <textarea
              data-testid="rejection-reason-textarea"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '10px', fontSize: '13px', margin: '6px 0 16px', minHeight: '75px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
              placeholder="Explain why this payment is rejected (required, sent to customer)"
            />
            {actionError && (
              <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: '8px', padding: '8px 12px', color: '#991B1B', fontSize: '12px', marginBottom: '12px' }}>
                {actionError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowRejectModal(false)} disabled={isRejecting} style={{ background: 'transparent', border: '1px solid var(--da-border)', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button
                data-testid="confirm-reject-payment-button"
                onClick={confirmReject}
                disabled={isRejecting || !rejectReason.trim()}
                style={{
                  background: '#991B1B',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isRejecting || !rejectReason.trim() ? 'not-allowed' : 'pointer',
                  opacity: isRejecting || !rejectReason.trim() ? 0.6 : 1,
                }}
              >
                {isRejecting ? 'Rejecting...' : 'Confirm & Reject Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReconsiderModal && (
        <div
          data-testid="confirm-reconsider-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(12,59,39,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div style={{ background: '#fff', borderRadius: '14px', padding: '26px', maxWidth: '440px', width: '90%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 10px' }}>Reconsider & Approve Payment?</h3>
            <p style={{ fontSize: '13px', color: 'var(--da-text-primary)', lineHeight: 1.5, margin: '0 0 14px' }}>
              Mistakenly rejected this customer? Reconsidering will re-evaluate live availability, assign the best available candidate (Main &rarr; Alternative 1 &rarr; Alternative 2), confirm the reservation, and email the customer their booking confirmation pass with access QR.
            </p>
            {actionError && (
              <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: '8px', padding: '8px 12px', color: '#991B1B', fontSize: '12px', marginBottom: '12px' }}>
                {actionError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowReconsiderModal(false)} disabled={isReconsidering} style={{ background: 'transparent', border: '1px solid var(--da-border)', padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button
                data-testid="confirm-reconsider-button"
                onClick={confirmReconsider}
                disabled={isReconsidering}
                style={{
                  background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isReconsidering ? 'not-allowed' : 'pointer',
                  opacity: isReconsidering ? 0.7 : 1,
                }}
              >
                {isReconsidering ? 'Reconsidering...' : 'Confirm Reconsider & Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
