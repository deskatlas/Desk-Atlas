"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { BookingEndAlert } from "@deskatlas/domain";
import {
  makeEndAlertDismissKey,
  isEndAlertDismissed,
} from "@deskatlas/domain";
import { useActiveTabPolling } from "@deskatlas/ui";

const STORAGE_KEY_DISMISSED = "deskatlas_staff_booking_ends_dismissed";

function getStoredDismissedKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_DISMISSED);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveStoredDismissedKeys(keys: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY_DISMISSED, JSON.stringify(Array.from(keys)));
  } catch {
    // Ignore storage write errors
  }
}

export interface AlertsContextValue {
  rawAlerts: BookingEndAlert[];
  activeAlerts: BookingEndAlert[];
  unreadCount: number;
  loading: boolean;
  dismissedKeys: Set<string>;
  fetchAlerts: () => Promise<void>;
  markSingleAsDismissed: (reservationId: string) => void;
  markAllAsDismissed: () => void;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

export function AlertsProvider({ children }: { children: ReactNode }) {
  const [rawAlerts, setRawAlerts] = useState<BookingEndAlert[]>([]);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(getStoredDismissedKeys);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/operations/approaching-ends", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.alerts)) {
          setRawAlerts(data.alerts);
        }
      }
    } catch {
      // Ignore background poll errors
    } finally {
      setLoading(false);
    }
  }, []);

  // Consolidated visibility-aware polling interval (MS-05 Phase 1.3)
  useActiveTabPolling(fetchAlerts, 60000);

  const activeAlerts = useMemo(() => {
    return rawAlerts.filter(
      (alert) => !isEndAlertDismissed(dismissedKeys, alert.reservationId)
    );
  }, [rawAlerts, dismissedKeys]);

  const markSingleAsDismissed = useCallback((reservationId: string) => {
    setDismissedKeys((prev) => {
      const next = new Set(prev);
      next.add(makeEndAlertDismissKey(reservationId));
      saveStoredDismissedKeys(next);
      return next;
    });
  }, []);

  const markAllAsDismissed = useCallback(() => {
    setDismissedKeys((prev) => {
      const next = new Set(prev);
      for (const a of rawAlerts) {
        next.add(makeEndAlertDismissKey(a.reservationId));
      }
      saveStoredDismissedKeys(next);
      return next;
    });
  }, [rawAlerts]);

  const value = useMemo<AlertsContextValue>(
    () => ({
      rawAlerts,
      activeAlerts,
      unreadCount: activeAlerts.length,
      loading,
      dismissedKeys,
      fetchAlerts,
      markSingleAsDismissed,
      markAllAsDismissed,
    }),
    [
      rawAlerts,
      activeAlerts,
      loading,
      dismissedKeys,
      fetchAlerts,
      markSingleAsDismissed,
      markAllAsDismissed,
    ]
  );

  return (
    <AlertsContext.Provider value={value}>
      {children}
    </AlertsContext.Provider>
  );
}

export function useAlerts(): AlertsContextValue {
  const context = useContext(AlertsContext);
  if (!context) {
    return {
      rawAlerts: [],
      activeAlerts: [],
      unreadCount: 0,
      loading: false,
      dismissedKeys: new Set(),
      fetchAlerts: async () => {},
      markSingleAsDismissed: () => {},
      markAllAsDismissed: () => {},
    };
  }
  return context;
}
