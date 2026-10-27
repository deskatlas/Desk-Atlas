"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  PaymentReviewQueueItem,
  PaymentReviewDetail,
  PaymentQueueSortMode,
  RecentQueueSortMode,
  RankedPaymentReviewQueueItem,
  RejectedQueueSortMode,
} from '@deskatlas/domain';
import {
  assignCanonicalQueueRanks,
  sortPaymentReviewQueue,
  sortRecentPaymentsQueue,
  sortRejectedPaymentsQueue,
  evaluateAndSegregatePaymentReviews,
  getReservationBookingStartTime,
  formatOverdueElapsedDuration,
  formatOverdueElapsedApproxHours,
} from '@deskatlas/domain';

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

export function PaymentQueue() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'REVIEW' | 'OVERDUE' | 'REFUNDED' | 'REJECTED'>('REVIEW');
  const [reviewQueue, setReviewQueue] = useState<RankedPaymentReviewQueueItem[]>([]);
  const [overdueQueue, setOverdueQueue] = useState<PaymentReviewQueueItem[]>([]);
  const [refundedQueue, setRefundedQueue] = useState<PaymentReviewQueueItem[]>([]);
  const [rejectedQueue, setRejectedQueue] = useState<PaymentReviewDetail[]>([]);
  const [sortMode, setSortMode] = useState<PaymentQueueSortMode>('RANK_DESC');
  const [overdueSortMode, setOverdueSortMode] = useState<RecentQueueSortMode>('RECENT_DESC');
  const [refundedSortMode, setRefundedSortMode] = useState<RecentQueueSortMode>('RECENT_DESC');
  const [rejectedSortMode, setRejectedSortMode] = useState<RejectedQueueSortMode>('REJECTED_DESC');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQueues = async () => {
    try {
      setLoading(true);
      setError(null);
      const [reviewRes, rejectedRes, refundedRes] = await Promise.all([
        fetch('/api/admin/payments/reviews'),
        fetch('/api/admin/payments/reviews?status=REJECTED'),
        fetch('/api/admin/payments/reviews?status=REFUNDED'),
      ]);

      if (!reviewRes.ok) {
        throw new Error(`Failed to load payment review queue (${reviewRes.status})`);
      }
      const reviewData = await reviewRes.json();
      const rawAllQueue: PaymentReviewQueueItem[] = reviewData.all || [
        ...(reviewData.queue || []),
        ...(reviewData.overdue || []),
      ];

      // Segregate into active review and overdue review
      const now = new Date();
      const segregated = evaluateAndSegregatePaymentReviews(rawAllQueue, now);

      // Assign canonical FIFO ranks (#1..#N) strictly inside the active awaiting review queue
      const rankedActive = assignCanonicalQueueRanks(segregated.activeQueue);

      setReviewQueue(rankedActive);
      setOverdueQueue(segregated.overdueQueue);

      if (typeof window !== 'undefined') {
        const awaitingCount = segregated.activeQueue.filter(
          (item) => (item.paymentStatus === 'UNDER_REVIEW' || !item.paymentStatus) && item.refundStatus !== 'REFUNDED'
        ).length;
        const overdueCount = segregated.overdueQueue.filter(
          (item) => (item.paymentStatus === 'UNDER_REVIEW' || !item.paymentStatus) && item.refundStatus !== 'REFUNDED'
        ).length;
        window.dispatchEvent(
          new CustomEvent('deskatlas:badge-refresh', {
            detail: { paymentsCount: awaitingCount + overdueCount },
          })
        );
      }

      if (rejectedRes.ok) {
        const rejectedData = await rejectedRes.json();
        const rawRejected: PaymentReviewDetail[] = rejectedData.rejected || rejectedData.queue || [];
        setRejectedQueue(rawRejected);
      }

      if (refundedRes.ok) {
        const refundedData = await refundedRes.json();
        const rawRefunded: PaymentReviewQueueItem[] = refundedData.refunded || refundedData.queue || [];
        setRefundedQueue(rawRefunded);
      } else if (segregated.refundedQueue && segregated.refundedQueue.length > 0) {
        setRefundedQueue(segregated.refundedQueue);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load payments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueues();
  }, []);

  const displayedQueue = useMemo(() => {
    // Defensive sort fallback ensuring earliest proof upload appears first
    const defensiveSort = (a: PaymentReviewQueueItem, b: PaymentReviewQueueItem) => {
      const timeA = a.proofSubmittedAt ? new Date(a.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY;
      const timeB = b.proofSubmittedAt ? new Date(b.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY;
      return timeA - timeB;
    };
    if (!reviewQueue || reviewQueue.length === 0) return [];
    return sortPaymentReviewQueue(reviewQueue, sortMode);
  }, [reviewQueue, sortMode]);

  const displayedOverdueQueue = useMemo(() => {
    return sortRecentPaymentsQueue(overdueQueue, overdueSortMode, (p) => {
      return p.proofSubmittedAt ? new Date(p.proofSubmittedAt).getTime() : 0;
    });
  }, [overdueQueue, overdueSortMode]);

  const displayedRefundedQueue = useMemo(() => {
    return sortRecentPaymentsQueue(refundedQueue, refundedSortMode, (p) => {
      const raw = p.refundedAt || p.proofSubmittedAt;
      return raw ? new Date(raw).getTime() : 0;
    });
  }, [refundedQueue, refundedSortMode]);

  const displayedRejectedQueue = useMemo(() => {
    return sortRejectedPaymentsQueue(rejectedQueue, rejectedSortMode);
  }, [rejectedQueue, rejectedSortMode]);

  return (
    <main data-screen-label="Payments" style={{ padding: '26px 28px 40px' }}>
      <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>Online Payments</h1>
      <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '16px' }}>Review submitted proofs, inspect rejected payments, and allocate workspaces</div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button
          data-testid="tab-awaiting-review"
          onClick={() => setActiveTab('REVIEW')}
          style={{
            padding: '8px 16px',
            borderRadius: '20px',
            border: activeTab === 'REVIEW' ? '2px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
            background: activeTab === 'REVIEW' ? 'var(--da-brand-dark)' : '#fff',
            color: activeTab === 'REVIEW' ? '#fff' : 'var(--da-text-primary)',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--da-font-family)',
          }}
        >
          <span>Awaiting Review</span>
          <span
            data-testid="badge-awaiting-review-count"
            style={{
              fontSize: '11px',
              padding: '1px 7px',
              borderRadius: '9999px',
              background: activeTab === 'REVIEW' ? 'rgba(255,255,255,0.25)' : '#F1F5F9',
              color: activeTab === 'REVIEW' ? '#fff' : 'var(--da-text-secondary)',
            }}
          >
            {reviewQueue.length}
          </span>
        </button>

        <button
          data-testid="tab-overdue-reviews"
          onClick={() => setActiveTab('OVERDUE')}
          style={{
            padding: '8px 16px',
            borderRadius: '20px',
            border: activeTab === 'OVERDUE' ? '2px solid #B45309' : '1px solid var(--da-border)',
            background: activeTab === 'OVERDUE' ? '#B45309' : '#fff',
            color: activeTab === 'OVERDUE' ? '#fff' : 'var(--da-text-primary)',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--da-font-family)',
          }}
        >
          <span>Overdue (Refund Eligible)</span>
          <span
            data-testid="badge-overdue-count"
            style={{
              fontSize: '11px',
              padding: '1px 7px',
              borderRadius: '9999px',
              background: activeTab === 'OVERDUE' ? 'rgba(255,255,255,0.25)' : '#FEF3C7',
              color: activeTab === 'OVERDUE' ? '#fff' : '#B45309',
              fontWeight: 800,
            }}
          >
            {overdueQueue.length}
          </span>
        </button>

        <button
          data-testid="tab-refunded-payments"
          onClick={() => setActiveTab('REFUNDED')}
          style={{
            padding: '8px 16px',
            borderRadius: '20px',
            border: activeTab === 'REFUNDED' ? '2px solid #047857' : '1px solid var(--da-border)',
            background: activeTab === 'REFUNDED' ? '#047857' : '#fff',
            color: activeTab === 'REFUNDED' ? '#fff' : 'var(--da-text-primary)',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--da-font-family)',
          }}
        >
          <span>Refunded</span>
          <span
            data-testid="badge-refunded-count"
            style={{
              fontSize: '11px',
              padding: '1px 7px',
              borderRadius: '9999px',
              background: activeTab === 'REFUNDED' ? 'rgba(255,255,255,0.25)' : '#ECFDF5',
              color: activeTab === 'REFUNDED' ? '#fff' : '#047857',
              fontWeight: 800,
            }}
          >
            {refundedQueue.length}
          </span>
        </button>

        <button
          data-testid="tab-rejected-payments"
          onClick={() => setActiveTab('REJECTED')}
          style={{
            padding: '8px 16px',
            borderRadius: '20px',
            border: activeTab === 'REJECTED' ? '2px solid #991B1B' : '1px solid var(--da-border)',
            background: activeTab === 'REJECTED' ? '#991B1B' : '#fff',
            color: activeTab === 'REJECTED' ? '#fff' : 'var(--da-text-primary)',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--da-font-family)',
          }}
        >
          <span>Rejected Payments</span>
          <span
            data-testid="badge-rejected-count"
            style={{
              fontSize: '11px',
              padding: '1px 7px',
              borderRadius: '9999px',
              background: activeTab === 'REJECTED' ? 'rgba(255,255,255,0.25)' : '#FEE2E2',
              color: activeTab === 'REJECTED' ? '#fff' : '#991B1B',
            }}
          >
            {rejectedQueue.length}
          </span>
        </button>
      </div>

      {activeTab === 'REVIEW' ? (
        <>
          <div
            data-testid="admin-payments-proof-sort-notice"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: '#F8FAFC',
              border: '1px solid var(--da-border)',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '20px',
              fontSize: '12px',
              color: 'var(--da-text-secondary)',
              fontFamily: 'var(--da-font-family)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" style={{ color: 'var(--da-brand-dark)', flexShrink: 0 }}>
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span>
              <strong>Notice:</strong>{' '}
              {sortMode === 'RANK_DESC'
                ? "Payments are sorted by proof upload time (earliest first). The rank badge indicates original queue arrival order."
                : "Active sorting applied. The rank badge (#) permanently identifies each customer's original submission order."}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '14px',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            {/* Left: Queue Section Title & Count Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', letterSpacing: '.08em' }}>
                AWAITING REVIEW
              </span>
              <span style={{ fontSize: '10px', fontWeight: 800, background: '#FFF8E8', color: 'var(--da-brand-dark)', borderRadius: '9999px', whiteSpace: 'nowrap', padding: '2px 8px', fontFamily: 'var(--da-font-family)' }}>
                {reviewQueue.length}
              </span>
            </div>

            {/* Right: Sort Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label
                htmlFor="admin-payments-sort-select"
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--da-text-secondary)',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Sort by:
              </label>
              <select
                id="admin-payments-sort-select"
                data-testid="admin-payments-sort-select"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as PaymentQueueSortMode)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--da-border, #CBD5E1)',
                  background: '#fff',
                  color: 'var(--da-text-primary, #0F172A)',
                  fontSize: '12px',
                  fontWeight: 700,
                  fontFamily: 'var(--da-font-family)',
                  cursor: 'pointer',
                  outline: 'none',
                  boxShadow: 'var(--da-shadow-sm)',
                }}
              >
                <option value="RANK_DESC">Ranking: Descending</option>
                <option value="RANK_ASC">Ranking: Ascending</option>
                <option value="AMOUNT_DESC">Amount: Descending</option>
                <option value="AMOUNT_ASC">Amount: Ascending</option>
              </select>
            </div>
          </div>

          {loading && (
            <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
              Loading payment review queue...
            </div>
          )}

          {error && (
            <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: '12px', padding: '16px 20px', color: '#991B1B', fontSize: '13px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{error}</span>
              <button onClick={fetchQueues} style={{ background: '#991B1B', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
            </div>
          )}

          {!loading && !error && displayedQueue.length === 0 && (
            <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '40px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '14px', fontFamily: 'var(--da-font-family)' }}>
              No online payments awaiting review.
            </div>
          )}

          {!loading && !error && displayedQueue.map((p) => {
            const formattedAmount = Number(p.amountDue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            const formattedTime = formatTimeAgo(p.proofSubmittedAt);
            const refDisplay = p.reservationReferenceCode || p.paymentAttemptId.slice(0, 8);
            const customerName = `${p.customerFirstName} ${p.customerLastName}`.trim();
            const queueNumber = p.queueRank;

            return (
              <div key={p.paymentAttemptId} style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', boxShadow: 'var(--da-shadow-sm)', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    data-testid="payment-queue-number"
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '11px',
                      background: '#FFF8E8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontWeight: 800,
                      fontSize: '15px',
                      color: 'var(--da-brand-dark)',
                      fontFamily: 'var(--da-font-family)',
                      border: '1px solid rgba(12,59,39,0.08)',
                    }}
                  >
                    #{queueNumber}
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, color: 'var(--da-brand-dark)', fontSize: '14px' }}>{refDisplay}</div>
                    <div style={{ fontSize: '12px', color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)' }}>{customerName} &middot; <strong style={{ color: 'var(--da-text-primary)' }}>₱{formattedAmount}</strong> &middot; submitted {formattedTime}</div>
                    {p.companionNames && p.companionNames.length > 0 && (
                      <div style={{ fontSize: '11px', color: '#1D4ED8', marginTop: '2px' }} title={`Companions: ${p.companionNames.join(', ')}`}>
                        +{p.companionNames.length} companion{p.companionNames.length > 1 ? 's' : ''} ({p.companionNames.join(', ')})
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => router.push(`/manage/payments/${p.paymentAttemptId}`)} style={{ background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '9px', fontWeight: 700, fontSize: '12px', cursor: 'pointer', boxShadow: '0 4px 10px 1px rgba(12,59,39,.16)' }}>Review</button>
              </div>
            );
          })}
        </>
      ) : activeTab === 'OVERDUE' ? (
        <>
          <div
            data-testid="admin-payments-overdue-notice"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: '#FFFBEB',
              border: '1px solid #FCD34D',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '20px',
              fontSize: '12px',
              color: '#92400E',
              fontFamily: 'var(--da-font-family)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" style={{ color: '#D97706', flexShrink: 0 }}>
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <strong>Missed Review Notice:</strong> These bookings passed their scheduled start time prior to administrative review. Customers have been automatically notified that they are eligible for a refund. Please inspect proof and disburse the refund or contact the customer to arrange a mutually agreed reschedule.
            </div>
          </div>

          <div
            data-testid="admin-payments-overdue-sort-notice"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: '#FFFBEB',
              border: '1px solid #FCD34D',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '20px',
              fontSize: '12px',
              color: '#92400E',
              fontFamily: 'var(--da-font-family)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" style={{ color: '#B45309', flexShrink: 0 }}>
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span>
              <strong>Notice:</strong>{' '}
              {overdueSortMode === 'RECENT_DESC'
                ? "Overdue reviews are sorted by proof upload time (most recent first)."
                : overdueSortMode === 'RECENT_ASC'
                  ? "Overdue reviews are sorted by proof upload time (oldest first)."
                  : overdueSortMode === 'AMOUNT_DESC'
                    ? "Sorted by highest amount first. Ties are ordered by most recent proof upload."
                    : "Sorted by lowest amount first. Ties are ordered by most recent proof upload."}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '14px',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            {/* Left: Section Title & Count Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: '#B45309', fontFamily: 'var(--da-font-family)', letterSpacing: '.08em' }}>
                OVERDUE (REFUND ELIGIBLE)
              </span>
              <span style={{ fontSize: '10px', fontWeight: 800, background: '#FEF3C7', color: '#B45309', borderRadius: '9999px', whiteSpace: 'nowrap', padding: '2px 8px', fontFamily: 'var(--da-font-family)' }}>
                {overdueQueue.length}
              </span>
            </div>

            {/* Right: Sort Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label
                htmlFor="admin-payments-overdue-sort-select"
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--da-text-secondary)',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Sort by:
              </label>
              <select
                id="admin-payments-overdue-sort-select"
                data-testid="admin-payments-overdue-sort-select"
                value={overdueSortMode}
                onChange={(e) => setOverdueSortMode(e.target.value as RecentQueueSortMode)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--da-border, #CBD5E1)',
                  background: '#fff',
                  color: 'var(--da-text-primary, #0F172A)',
                  fontSize: '12px',
                  fontWeight: 700,
                  fontFamily: 'var(--da-font-family)',
                  cursor: 'pointer',
                  outline: 'none',
                  boxShadow: 'var(--da-shadow-sm)',
                }}
              >
                <option value="RECENT_DESC">Most Recent: Descending</option>
                <option value="RECENT_ASC">Most Recent: Ascending</option>
                <option value="AMOUNT_DESC">Amount: Descending</option>
                <option value="AMOUNT_ASC">Amount: Ascending</option>
              </select>
            </div>
          </div>

          {loading && (
            <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
              Loading overdue payment reviews...
            </div>
          )}

          {error && (
            <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: '12px', padding: '16px 20px', color: '#991B1B', fontSize: '13px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{error}</span>
              <button onClick={fetchQueues} style={{ background: '#991B1B', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
            </div>
          )}

          {!loading && !error && displayedOverdueQueue.length === 0 && (
            <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '40px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '14px', fontFamily: 'var(--da-font-family)' }}>
              No overdue payments requiring refund triage.
            </div>
          )}

          {!loading && !error && displayedOverdueQueue.map((p) => {
            const formattedAmount = Number(p.amountDue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            const refDisplay = p.reservationReferenceCode || p.paymentAttemptId.slice(0, 8);
            const customerName = `${p.customerFirstName} ${p.customerLastName}`.trim();
            const startIso = getReservationBookingStartTime(p.submittedCandidates);
            const elapsedDuration = startIso ? formatOverdueElapsedDuration(startIso) : 'Overdue';
            const elapsedApprox = startIso ? formatOverdueElapsedApproxHours(startIso) : 'Overdue';

            return (
              <div
                key={p.paymentAttemptId}
                data-testid="overdue-payment-item"
                style={{
                  background: '#fff',
                  border: '1px solid #FCD34D',
                  borderRadius: '14px',
                  padding: '16px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                  boxShadow: 'var(--da-shadow-sm)',
                  gap: '16px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    data-testid="overdue-payment-badge"
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '11px',
                      background: '#FEF3C7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontWeight: 800,
                      fontSize: '15px',
                      color: '#B45309',
                      fontFamily: 'var(--da-font-family)',
                      border: '1px solid #FCD34D',
                    }}
                  >
                    !
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, color: 'var(--da-brand-dark)', fontSize: '14px' }}>{refDisplay}</span>
                      <span
                        data-testid="overdue-refund-badge"
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          background: '#FEF3C7',
                          color: '#B45309',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid #FCD34D',
                          letterSpacing: '0.04em',
                          fontFamily: 'var(--da-font-family)',
                        }}
                      >
                        MISSED REVIEW - ELIGIBLE FOR REFUND
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)' }}>
                      {customerName} &middot; <strong style={{ color: 'var(--da-text-primary)' }}>₱{formattedAmount}</strong> &middot;{' '}
                      <span data-testid="overdue-elapsed-text">{elapsedDuration}</span>{' '}
                      <span data-testid="overdue-elapsed-approx" style={{ color: 'var(--da-text-secondary)', fontSize: '11px' }}>({elapsedApprox})</span>
                    </div>
                    {p.companionNames && p.companionNames.length > 0 && (
                      <div style={{ fontSize: '11px', color: '#1D4ED8', marginTop: '2px' }} title={`Companions: ${p.companionNames.join(', ')}`}>
                        +{p.companionNames.length} companion{p.companionNames.length > 1 ? 's' : ''} ({p.companionNames.join(', ')})
                      </div>
                    )}
                  </div>
                </div>
                <button
                  data-testid="review-refund-button"
                  onClick={() => router.push(`/manage/payments/${p.paymentAttemptId}`)}
                  style={{
                    background: 'linear-gradient(0deg, #B45309 70%, #92400E)',
                    color: '#fff',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '9px',
                    fontWeight: 700,
                    fontSize: '12px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 10px 1px rgba(180,83,9,.25)',
                  }}
                >
                  Review & Refund
                </button>
              </div>
            );
          })}
        </>
      ) : activeTab === 'REFUNDED' ? (
        <>
          <div
            data-testid="admin-payments-refunded-notice"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: '#ECFDF5',
              border: '1px solid #A7F3D0',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '20px',
              fontSize: '12px',
              color: '#065F46',
              fontFamily: 'var(--da-font-family)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" style={{ color: '#047857', flexShrink: 0 }}>
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div>
              <strong>Refunds Disbursed:</strong> These payments have been refunded to customers due to missed review window or administrative cancellation. Automated refund confirmation emails have been sent to customers.
            </div>
          </div>

          <div
            data-testid="admin-payments-refunded-sort-notice"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '20px',
              fontSize: '12px',
              color: '#166534',
              fontFamily: 'var(--da-font-family)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" style={{ color: '#047857', flexShrink: 0 }}>
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span>
              <strong>Notice:</strong>{' '}
              {refundedSortMode === 'RECENT_DESC'
                ? "Refunded payments are sorted by refund time (most recent first)."
                : refundedSortMode === 'RECENT_ASC'
                  ? "Refunded payments are sorted by refund time (oldest first)."
                  : refundedSortMode === 'AMOUNT_DESC'
                    ? "Sorted by highest refund amount first. Ties are ordered by most recent refund."
                    : "Sorted by lowest refund amount first. Ties are ordered by most recent refund."}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '14px',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            {/* Left: Section Title & Count Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: '#047857', fontFamily: 'var(--da-font-family)', letterSpacing: '.08em' }}>
                REFUNDED PAYMENTS
              </span>
              <span
                data-testid="refunded-section-count"
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  background: '#ECFDF5',
                  color: '#047857',
                  borderRadius: '9999px',
                  whiteSpace: 'nowrap',
                  padding: '2px 8px',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                {refundedQueue.length}
              </span>
            </div>

            {/* Right: Sort Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label
                htmlFor="admin-payments-refunded-sort-select"
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--da-text-secondary)',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Sort by:
              </label>
              <select
                id="admin-payments-refunded-sort-select"
                data-testid="admin-payments-refunded-sort-select"
                value={refundedSortMode}
                onChange={(e) => setRefundedSortMode(e.target.value as RecentQueueSortMode)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--da-border, #CBD5E1)',
                  background: '#fff',
                  color: 'var(--da-text-primary, #0F172A)',
                  fontSize: '12px',
                  fontWeight: 700,
                  fontFamily: 'var(--da-font-family)',
                  cursor: 'pointer',
                  outline: 'none',
                  boxShadow: 'var(--da-shadow-sm)',
                }}
              >
                <option value="RECENT_DESC">Most Recent: Descending</option>
                <option value="RECENT_ASC">Most Recent: Ascending</option>
                <option value="AMOUNT_DESC">Amount: Descending</option>
                <option value="AMOUNT_ASC">Amount: Ascending</option>
              </select>
            </div>
          </div>

          {loading && (
            <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
              Loading refunded payments...
            </div>
          )}

          {error && (
            <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: '12px', padding: '16px 20px', color: '#991B1B', fontSize: '13px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{error}</span>
              <button onClick={fetchQueues} style={{ background: '#991B1B', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
            </div>
          )}

          {!loading && !error && displayedRefundedQueue.length === 0 && (
            <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '40px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '14px', fontFamily: 'var(--da-font-family)' }}>
              No refunded payments recorded.
            </div>
          )}

          {!loading && !error && displayedRefundedQueue.map((p) => {
            const formattedAmount = Number(p.amountDue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            const refDisplay = p.reservationReferenceCode || p.paymentAttemptId.slice(0, 8);
            const customerName = `${p.customerFirstName} ${p.customerLastName}`.trim();
            const refundedTime = formatTimeAgo(p.refundedAt || p.proofSubmittedAt);

            return (
              <div
                key={p.paymentAttemptId}
                data-testid="refunded-payment-item"
                style={{
                  background: '#fff',
                  border: '1px solid #A7F3D0',
                  borderRadius: '14px',
                  padding: '16px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                  boxShadow: 'var(--da-shadow-sm)',
                  gap: '16px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    data-testid="refunded-payment-badge"
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '11px',
                      background: '#ECFDF5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontWeight: 800,
                      fontSize: '15px',
                      color: '#047857',
                      fontFamily: 'var(--da-font-family)',
                      border: '1px solid #A7F3D0',
                    }}
                  >
                    ✓
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, color: 'var(--da-brand-dark)', fontSize: '14px' }}>{refDisplay}</span>
                      <span
                        data-testid="refunded-status-badge"
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          background: '#ECFDF5',
                          color: '#047857',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid #A7F3D0',
                          letterSpacing: '0.04em',
                          fontFamily: 'var(--da-font-family)',
                        }}
                      >
                        REFUND DISBURSED
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)' }}>
                      {customerName} &middot; <strong style={{ color: 'var(--da-text-primary)' }}>₱{formattedAmount}</strong> &middot; refunded {refundedTime}
                    </div>
                    {p.companionNames && p.companionNames.length > 0 && (
                      <div style={{ fontSize: '11px', color: '#1D4ED8', marginTop: '2px' }} title={`Companions: ${p.companionNames.join(', ')}`}>
                        +{p.companionNames.length} companion{p.companionNames.length > 1 ? 's' : ''} ({p.companionNames.join(', ')})
                      </div>
                    )}
                    {p.refundNotes && (
                      <div style={{ fontSize: '11px', color: '#047857', marginTop: '2px', fontFamily: 'var(--da-font-family)' }}>
                        Note: {p.refundNotes}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  data-testid="inspect-refund-button"
                  onClick={() => router.push(`/manage/payments/${p.paymentAttemptId}`)}
                  style={{
                    background: '#fff',
                    border: '1px solid #A7F3D0',
                    color: '#047857',
                    padding: '9px 18px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Inspect
                </button>
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '14px',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            {/* Left: Title & Count Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: '#991B1B', fontFamily: 'var(--da-font-family)', letterSpacing: '.08em' }}>
                REJECTED PAYMENTS
              </span>
              <span
                data-testid="rejected-section-count"
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  background: '#FEE2E2',
                  color: '#991B1B',
                  borderRadius: '9999px',
                  whiteSpace: 'nowrap',
                  padding: '2px 8px',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                {rejectedQueue.length}
              </span>
            </div>

            {/* Right: Sorting Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label
                htmlFor="admin-payments-rejected-sort-select"
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--da-text-secondary)',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Sort by:
              </label>
              <select
                id="admin-payments-rejected-sort-select"
                data-testid="admin-payments-rejected-sort-select"
                value={rejectedSortMode}
                onChange={(e) => setRejectedSortMode(e.target.value as RejectedQueueSortMode)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--da-border, #CBD5E1)',
                  background: '#fff',
                  color: 'var(--da-text-primary, #0F172A)',
                  fontSize: '12px',
                  fontWeight: 700,
                  fontFamily: 'var(--da-font-family)',
                  cursor: 'pointer',
                  outline: 'none',
                  boxShadow: 'var(--da-shadow-sm)',
                }}
              >
                <option value="REJECTED_DESC">Rejected: Most Recent</option>
                <option value="REJECTED_ASC">Rejected: Oldest First</option>
                <option value="AMOUNT_DESC">Amount: Descending</option>
                <option value="AMOUNT_ASC">Amount: Ascending</option>
              </select>
            </div>
          </div>

          <div
            data-testid="admin-payments-rejected-sort-notice"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '16px',
              fontSize: '12px',
              color: '#991B1B',
              fontFamily: 'var(--da-font-family)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" style={{ color: '#991B1B', flexShrink: 0 }}>
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span>
              <strong>Notice:</strong>{' '}
              {rejectedSortMode === 'REJECTED_DESC'
                ? "Showing most recently rejected payments first (newest to oldest)."
                : rejectedSortMode === 'REJECTED_ASC'
                  ? "Showing oldest rejected payments first (oldest to newest)."
                  : rejectedSortMode === 'AMOUNT_DESC'
                    ? "Sorted by highest rejected amount first. Ties are ordered by most recent rejection."
                    : "Sorted by lowest rejected amount first. Ties are ordered by most recent rejection."}
            </span>
          </div>

          {loading && (
            <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
              Loading rejected payments...
            </div>
          )}

          {error && (
            <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: '12px', padding: '16px 20px', color: '#991B1B', fontSize: '13px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{error}</span>
              <button onClick={fetchQueues} style={{ background: '#991B1B', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
            </div>
          )}

          {!loading && !error && displayedRejectedQueue.length === 0 && (
            <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '40px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '14px', fontFamily: 'var(--da-font-family)' }}>
              No rejected online payments recorded.
            </div>
          )}

          {!loading && !error && displayedRejectedQueue.map((p) => {
            const formattedAmount = Number(p.amountDue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            const refDisplay = p.reservationReferenceCode || p.paymentAttemptId.slice(0, 8);
            const customerName = `${p.customerFirstName} ${p.customerLastName}`.trim();
            const rejectedTime = formatTimeAgo(p.processedAt || p.proofSubmittedAt);

            return (
              <div
                key={p.paymentAttemptId}
                data-testid="rejected-payment-item"
                style={{
                  background: '#fff',
                  border: '1px solid #FECACA',
                  borderRadius: '14px',
                  padding: '16px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                  boxShadow: 'var(--da-shadow-sm)',
                  gap: '16px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '11px',
                      background: '#FEE2E2',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontWeight: 800,
                      fontSize: '15px',
                      color: '#991B1B',
                      fontFamily: 'var(--da-font-family)',
                      border: '1px solid rgba(153,27,27,0.15)',
                    }}
                  >
                    ✕
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, color: '#991B1B', fontSize: '14px' }}>{refDisplay}</div>
                    <div style={{ fontSize: '12px', color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)' }}>
                      {customerName} &middot; <strong style={{ color: 'var(--da-text-primary)' }}>₱{formattedAmount}</strong> &middot; rejected {rejectedTime}
                    </div>
                    {p.companionNames && p.companionNames.length > 0 && (
                      <div style={{ fontSize: '11px', color: '#1D4ED8', marginTop: '2px' }} title={`Companions: ${p.companionNames.join(', ')}`}>
                        +{p.companionNames.length} companion{p.companionNames.length > 1 ? 's' : ''} ({p.companionNames.join(', ')})
                      </div>
                    )}
                    {p.rejectionReason && (
                      <div style={{ fontSize: '11px', color: '#991B1B', marginTop: '2px', fontFamily: 'var(--da-font-family)' }}>
                        Reason: {p.rejectionReason}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => router.push(`/manage/payments/${p.paymentAttemptId}`)}
                  style={{
                    background: '#fff',
                    border: '1px solid #FECACA',
                    color: '#991B1B',
                    padding: '9px 18px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Inspect
                </button>
              </div>
            );
          })}
        </>
      )}
    </main>
  );
}
