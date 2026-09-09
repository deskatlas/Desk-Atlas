"use client";

import React, { useState } from 'react';
import { useKioskConfirm } from '../hooks/useKioskConfirm';

export function KioskConfirmPage() {
  const [paymentId, setPaymentId] = useState('');
  const { lookupRecord, confirmPayment, loading, error, pendingRecord, result, reset } = useKioskConfirm();

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentId.trim()) return;
    await lookupRecord(paymentId.trim());
  };

  const handleConfirm = async () => {
    if (!paymentId.trim()) return;
    await confirmPayment(paymentId.trim());
  };

  return (
    <main style={{ padding: '26px 28px 40px', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: '22px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>Kiosk Payment</h1>
        <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: "'Inter', sans-serif" }}>Confirm counter payments manually</div>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '24px' }}>
        {result ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--da-info)', color: 'var(--da-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '24px' }}>✓</div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--da-brand-dark)', marginBottom: '8px' }}>Payment Confirmed</h2>
            <div style={{ fontSize: '14px', color: 'var(--da-text-secondary)', marginBottom: '24px' }}>
              Reservation is now {result.reservationStatus}.
            </div>
            <button 
              onClick={() => { reset(); setPaymentId(''); }}
              style={{ padding: '10px 20px', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
            >
              Confirm Another
            </button>
          </div>
        ) : (
          <div>
            <form onSubmit={handleLookup}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '8px' }}>Kiosk ID / Reference Code</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <input 
                  value={paymentId} 
                  onChange={(e) => setPaymentId(e.target.value)} 
                  placeholder="Enter reference code or ID from kiosk..." 
                  style={{ flex: 1, border: '1px solid var(--da-border)', borderRadius: '8px', padding: '12px', fontSize: '14px', outline: 'none' }}
                />
                <button
                  type="submit"
                  disabled={loading || !paymentId.trim()}
                  style={{ padding: '12px 18px', background: '#F0F4F2', color: 'var(--da-brand-dark)', border: '1px solid var(--da-border)', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: (loading || !paymentId.trim()) ? 'not-allowed' : 'pointer' }}
                >
                  Look Up
                </button>
              </div>
            </form>

            {error && (
              <div style={{ color: 'var(--da-danger)', fontSize: '13px', marginBottom: '16px', background: '#FEE2E2', padding: '12px', borderRadius: '6px' }}>
                {error}
              </div>
            )}

            {pendingRecord && (
              <div style={{ background: '#F9FAF9', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>Booking Summary</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '14px' }}>
                  <span style={{ color: 'var(--da-text-secondary)' }}>Reference:</span>
                  <span style={{ fontWeight: 700, color: 'var(--da-brand-dark)' }}>{pendingRecord.reservationReferenceCode}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '14px' }}>
                  <span style={{ color: 'var(--da-text-secondary)' }}>Customer:</span>
                  <span style={{ fontWeight: 600 }}>{pendingRecord.customerFirstName} {pendingRecord.customerLastName}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '14px' }}>
                  <span style={{ color: 'var(--da-text-secondary)' }}>Email:</span>
                  <span>{pendingRecord.customerEmail}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '14px' }}>
                  <span style={{ color: 'var(--da-text-secondary)' }}>Payment Method:</span>
                  <span style={{ fontWeight: 700, color: 'var(--da-brand-dark)' }}>
                    {pendingRecord.paymentMethodType === 'CASH'
                      ? '💵 Cash'
                      : pendingRecord.paymentMethodDisplayName || pendingRecord.paymentMethodType || 'Counter QR'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '14px' }}>
                  <span style={{ color: 'var(--da-text-secondary)' }}>Amount Due:</span>
                  <span style={{ fontWeight: 800, color: 'var(--da-brand-dark)' }}>₱{pendingRecord.amountDue}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                  <span style={{ color: 'var(--da-text-secondary)' }}>Status:</span>
                  <span style={{ fontWeight: 600 }}>{pendingRecord.reservationStatus}</span>
                </div>
              </div>
            )}

            <button 
              type="button"
              onClick={handleConfirm}
              disabled={loading || !paymentId.trim()}
              style={{ width: '100%', padding: '12px', background: 'var(--da-brand-dark)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: (loading || !paymentId.trim()) ? 'not-allowed' : 'pointer', opacity: (loading || !paymentId.trim()) ? 0.7 : 1 }}
            >
              {loading
                ? 'Confirming...'
                : pendingRecord?.paymentMethodType === 'CASH'
                ? `Confirm Cash Receipt & Activate (₱${pendingRecord.amountDue})`
                : 'Confirm Kiosk Payment'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
