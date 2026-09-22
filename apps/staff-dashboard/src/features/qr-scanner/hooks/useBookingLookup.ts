"use client";

import { useState } from 'react';
import { type BookingScanResult, extractBookingToken } from '@deskatlas/domain';
import { useAuth } from '../../auth/components/AuthProvider';

export { extractBookingToken };


export function useBookingLookup() {
  const { user } = useAuth();
  const [result, setResult] = useState<BookingScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupToken = async (rawInput: string) => {
    setLoading(true);
    setError(null);
    setResult(null);

    const token = extractBookingToken(rawInput);
    if (!token) {
      const msg = "Invalid booking QR token or reference code.";
      setError(msg);
      setLoading(false);
      throw new Error(msg);
    }
    
    try {
      const queryParams = new URLSearchParams();
      if (user?.id) {
        queryParams.set("actorUserId", user.id);
        queryParams.set("actorRole", (user.role || "STAFF").toUpperCase());
      }
      const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";
      const res = await fetch(`/api/booking/${encodeURIComponent(token)}${queryString}`, {
        headers: {
          ...(user?.id ? {
            'x-actor-user-id': user.id,
            'x-actor-role': (user.role || 'STAFF').toUpperCase(),
            'x-user-id': user.id,
            'x-user-role': (user.role || 'STAFF').toUpperCase(),
          } : {}),
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to lookup booking');
      }
      const data: BookingScanResult = await res.json();
      setResult(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setResult(null);
    setError(null);
  };

  return { lookupToken, result, loading, error, clear };
}

