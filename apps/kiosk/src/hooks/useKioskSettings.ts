"use client";

import { useEffect, useState } from "react";
import { resolveKioskTimeoutMs, resolveKioskWarningTimeoutMs } from "@deskatlas/domain";

export interface KioskSettingsState {
  kioskTimeoutMinutes: number;
  kioskTimeoutMs: number;
  warningTimeoutMs: number;
  loading: boolean;
}

export function useKioskSettings(): KioskSettingsState {
  const [kioskTimeoutMinutes, setKioskTimeoutMinutes] = useState<number>(60);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    const fetchSettings = async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { kioskTimeoutMinutes?: number | null };
          if (
            isMounted &&
            data &&
            typeof data.kioskTimeoutMinutes === "number" &&
            data.kioskTimeoutMinutes >= 1
          ) {
            setKioskTimeoutMinutes(data.kioskTimeoutMinutes);
          }
        }
      } catch {
        // Fallback silently to 60 minutes
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchSettings();
    return () => {
      isMounted = false;
    };
  }, []);

  const kioskTimeoutMs = resolveKioskTimeoutMs(kioskTimeoutMinutes);
  const warningTimeoutMs = resolveKioskWarningTimeoutMs(kioskTimeoutMs);

  return {
    kioskTimeoutMinutes,
    kioskTimeoutMs,
    warningTimeoutMs,
    loading,
  };
}
