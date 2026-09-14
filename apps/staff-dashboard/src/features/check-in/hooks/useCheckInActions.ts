"use client";

import { useState } from 'react';
import { useAuth } from '@/features/auth';

export function useCheckInActions() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performAction = async (reservationId: string, action: 'check-in' | 'check-out') => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/operations/reservations/${reservationId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor: {
            userId: user?.id,
            role: user?.role?.toUpperCase() || 'STAFF'
          }
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const actionErr: any = new Error(data.error || `Failed to ${action}`);
        if (data.code) actionErr.code = data.code;
        throw actionErr;
      }

      return await res.json();
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const checkIn = (id: string) => performAction(id, 'check-in');
  const checkOut = (id: string) => performAction(id, 'check-out');
  const clearError = () => setError(null);

  return { checkIn, checkOut, loading, error, clearError };
}
