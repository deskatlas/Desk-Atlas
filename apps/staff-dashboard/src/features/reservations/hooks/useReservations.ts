"use client";

import { useState, useEffect } from 'react';
import type { StaffOperationalReservation } from '@deskatlas/domain';

export function useReservations() {
  const [reservations, setReservations] = useState<StaffOperationalReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReservations = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/operations/reservations');
      if (!res.ok) {
        throw new Error('Failed to load operational reservations');
      }
      const data = await res.json();
      setReservations(data.reservations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReservations();
  }, []);

  return { reservations, loading, error, refetch: fetchReservations };
}

export function useReservationDetail(id: string) {
  const [reservation, setReservation] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id || id.trim() === "") {
      setReservation(null);
      setError("Reservation ID is required");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/operations/reservations/${encodeURIComponent(id)}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("Reservation not found");
        }
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to load operational reservation");
      }
      const data = await res.json();
      setReservation(data.reservation || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setReservation(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  return {
    reservation,
    loading,
    error,
    refetch: fetchDetail,
  };
}
