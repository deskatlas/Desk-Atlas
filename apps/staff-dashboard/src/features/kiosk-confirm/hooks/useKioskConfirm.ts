"use client";

import { useState } from 'react';
import { useAuth } from '../../auth/components/AuthProvider';
import type { CounterPaymentRecord, PaymentReviewDecisionResult } from '@deskatlas/domain';

export function useKioskConfirm() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRecord, setPendingRecord] = useState<CounterPaymentRecord | null>(null);
  const [result, setResult] = useState<PaymentReviewDecisionResult | null>(null);

  const lookupRecord = async (code: string) => {
    if (!code || !code.trim()) return null;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/${encodeURIComponent(code.trim())}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Counter payment record was not found');
      }
      const data: CounterPaymentRecord = await res.json();
      setPendingRecord(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      setPendingRecord(null);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const confirmPayment = async (codeOrId: string) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/payments/${encodeURIComponent(codeOrId.trim())}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: codeOrId.trim(),
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

      const data = await res.json();
      setResult(data.result || data);
      setPendingRecord(null);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setPendingRecord(null);
    setError(null);
  };

  return { lookupRecord, confirmPayment, loading, error, pendingRecord, result, reset };
}
