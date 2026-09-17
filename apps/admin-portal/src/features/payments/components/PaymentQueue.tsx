"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PaymentReviewQueueItem, PaymentReviewDetail } from '@deskatlas/domain';

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
  const [activeTab, setActiveTab] = useState<'REVIEW' | 'REJECTED'>('REVIEW');
  const [reviewQueue, setReviewQueue] = useState<PaymentReviewQueueItem[]>([]);
  const [rejectedQueue, setRejectedQueue] = useState<PaymentReviewDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQueues = async () => {
    try {
      setLoading(true);
      setError(null);
      const [reviewRes, rejectedRes] = await Promise.all([
        fetch('/api/admin/payments/reviews'),
        fetch('/api/admin/payments/reviews?status=REJECTED'),
      ]);

      if (!reviewRes.ok) {
        throw new Error(`Failed to load payment review queue (${reviewRes.status})`);
      }
      const reviewData = await reviewRes.json();
      const rawReviewQueue: PaymentReviewQueueItem[] = reviewData.queue || [];
      const sortedReview = [...rawReviewQueue].sort((a, b) => {
        const aTime = a.proofSubmittedAt ? new Date(a.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.proofSubmittedAt ? new Date(b.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY;
        if (aTime !== bTime) {
          return aTime - bTime;
        }
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      });
      setReviewQueue(sortedReview);

      if (rejectedRes.ok) {
        const rejectedData = await rejectedRes.json();
        const rawRejected: PaymentReviewDetail[] = rejectedData.rejected || rejectedData.queue || [];
        setRejectedQueue(rawRejected);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load payments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueues();
  }, []);

  return (
    <main data-screen-label="Payments" style={{ padding: '26px 28px 40px' }}>
      <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>Online Payments</h1>
      <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '16px' }}>Review submitted proofs, inspect rejected payments, and allocate workspaces</div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
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
              <strong>Notice:</strong> Payments are sorted by proof upload time (earliest first) so you can review who uploaded their payment proof first.
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '12px' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', letterSpacing: '.08em' }}>AWAITING REVIEW</span>
            <span style={{ fontSize: '10px', fontWeight: 800, background: '#FFF8E8', color: 'var(--da-brand-dark)', borderRadius: '9999px', whiteSpace: 'nowrap', padding: '2px 8px', fontFamily: 'var(--da-font-family)' }}>{reviewQueue.length}</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--da-border)' }}></div>
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

          {!loading && !error && reviewQueue.length === 0 && (
            <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '40px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '14px', fontFamily: 'var(--da-font-family)' }}>
              No online payments awaiting review.
            </div>
          )}

          {!loading && !error && reviewQueue.map((p, index) => {
            const formattedAmount = Number(p.amountDue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            const formattedTime = formatTimeAgo(p.proofSubmittedAt);
            const refDisplay = p.reservationReferenceCode || p.paymentAttemptId.slice(0, 8);
            const customerName = `${p.customerFirstName} ${p.customerLastName}`.trim();
            const queueNumber = index + 1;

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
                  </div>
                </div>
                <button onClick={() => router.push(`/manage/payments/${p.paymentAttemptId}`)} style={{ background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '9px', fontWeight: 700, fontSize: '12px', cursor: 'pointer', boxShadow: '0 4px 10px 1px rgba(12,59,39,.16)' }}>Review</button>
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '12px' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: '#991B1B', fontFamily: 'var(--da-font-family)', letterSpacing: '.08em' }}>REJECTED PAYMENTS</span>
            <span style={{ fontSize: '10px', fontWeight: 800, background: '#FEE2E2', color: '#991B1B', borderRadius: '9999px', whiteSpace: 'nowrap', padding: '2px 8px', fontFamily: 'var(--da-font-family)' }}>{rejectedQueue.length}</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--da-border)' }}></div>
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

          {!loading && !error && rejectedQueue.length === 0 && (
            <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', padding: '40px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '14px', fontFamily: 'var(--da-font-family)' }}>
              No rejected online payments recorded.
            </div>
          )}

          {!loading && !error && rejectedQueue.map((p) => {
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
                      fontSize: '16px',
                      color: '#991B1B',
                      fontFamily: 'var(--da-font-family)',
                      border: '1px solid #FCA5A5',
                    }}
                  >
                    ✕
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 800, color: '#991B1B', fontSize: '14px' }}>{refDisplay}</span>
                      <span style={{ fontSize: '10px', fontWeight: 800, background: '#FEE2E2', color: '#991B1B', padding: '2px 6px', borderRadius: '4px' }}>REJECTED</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)', marginTop: '2px' }}>
                      {customerName} &middot; <strong style={{ color: 'var(--da-text-primary)' }}>₱{formattedAmount}</strong> &middot; rejected {rejectedTime}
                    </div>
                    {p.rejectionReason && (
                      <div style={{ fontSize: '11px', color: '#991B1B', marginTop: '3px', fontWeight: 600 }}>
                        Reason: {p.rejectionReason}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  data-testid="inspect-rejected-proof-button"
                  onClick={() => router.push(`/manage/payments/${p.paymentAttemptId}`)}
                  style={{
                    background: '#fff',
                    border: '1px solid #991B1B',
                    color: '#991B1B',
                    padding: '9px 18px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Inspect Proof
                </button>
              </div>
            );
          })}
        </>
      )}
    </main>
  );
}
