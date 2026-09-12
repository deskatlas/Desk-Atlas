"use client";

import { useState } from "react";
import type { GuestReservationTrackingResult } from "@deskatlas/domain";

export function useReservationTracking() {
  const [data, setData] = useState<GuestReservationTrackingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trackReservation(input: {
    referenceCode: string;
    customerEmail?: string;
  }) {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await fetch("/api/track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to track reservation.");
      }
      setData(body as GuestReservationTrackingResult);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to track reservation."
      );
    } finally {
      setLoading(false);
    }
  }

  return {
    data,
    loading,
    error,
    trackReservation,
  };
}
