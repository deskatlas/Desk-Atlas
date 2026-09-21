"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  AlertTriangle,
  Clock,
  User,
  Hash,
  ArrowRight,
  X,
  ChevronLeft,
  ChevronRight,
  BellRing,
} from "lucide-react";
import type {
  UrgentPaymentAlert,
  UrgentPaymentThresholdLevel,
} from "@deskatlas/domain";
import {
  makeUrgentAlertDismissKey,
  isUrgentAlertDismissed,
  formatCountdown,
} from "@deskatlas/domain";

const STORAGE_KEY_DISMISSED = "deskatlas_urgent_payments_dismissed";
const STORAGE_KEY_SNOOZED = "deskatlas_urgent_payments_snoozed";
const SNOOZE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

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

function saveStoredDismissedKeys(keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY_DISMISSED, JSON.stringify(Array.from(keys)));
  } catch {
    // Ignore storage write errors
  }
}

function getStoredSnoozes(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_SNOOZED);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredSnoozes(snoozes: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY_SNOOZED, JSON.stringify(snoozes));
  } catch {
    // Ignore storage write errors
  }
}

function formatBookingTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return `${date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })} at ${date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })}`;
  } catch {
    return isoString;
  }
}

export function UrgentPaymentModal() {
  const router = useRouter();
  const pathname = usePathname();

  const [rawAlerts, setRawAlerts] = useState<UrgentPaymentAlert[]>([]);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(getStoredDismissedKeys);
  const [snoozedMap, setSnoozedMap] = useState<Record<string, number>>(getStoredSnoozes);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchUrgentAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/payments/urgent", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.urgentAlerts)) {
          setRawAlerts(data.urgentAlerts);
        }
      }
    } catch {
      // Silently ignore network failures on background poll
    }
  }, []);

  useEffect(() => {
    fetchUrgentAlerts();
    const interval = setInterval(fetchUrgentAlerts, 15000);
    return () => clearInterval(interval);
  }, [fetchUrgentAlerts]);

  // Filter out dismissed, currently snoozed, or payment that the admin is actively reviewing on page
  const activeAlerts = useMemo(() => {
    const nowMs = Date.now();
    return rawAlerts.filter((alert) => {
      // If admin is currently on this payment review page, do not pop up modal
      if (
        pathname === `/manage/payments/${alert.paymentAttemptId}` ||
        pathname === `/manage/payments/review/${alert.paymentAttemptId}`
      ) {
        return false;
      }

      // Check if dismissed for this specific threshold level
      if (
        isUrgentAlertDismissed(
          dismissedKeys,
          alert.paymentAttemptId,
          alert.thresholdLevel
        )
      ) {
        return false;
      }

      // Check if snoozed
      const snoozeUntil = snoozedMap[alert.paymentAttemptId];
      if (snoozeUntil && nowMs < snoozeUntil) {
        return false;
      }

      return true;
    });
  }, [rawAlerts, dismissedKeys, snoozedMap, pathname]);

  // Keep index within bounds
  useEffect(() => {
    if (currentIndex >= activeAlerts.length && activeAlerts.length > 0) {
      setCurrentIndex(activeAlerts.length - 1);
    }
  }, [currentIndex, activeAlerts.length]);

  if (activeAlerts.length === 0) {
    return null;
  }

  const safeIndex = Math.min(currentIndex, activeAlerts.length - 1);
  const alert = activeAlerts[safeIndex];
  if (!alert) return null;

  const startMs = alert.startAt ? new Date(alert.startAt).getTime() : NaN;
  const remainingMs = !Number.isNaN(startMs)
    ? Math.max(0, startMs - nowMs)
    : Math.max(0, Math.round((alert.timeRemainingMinutes || 0) * 60 * 1000));

  const handleDismiss = () => {
    const key = makeUrgentAlertDismissKey(
      alert.paymentAttemptId,
      alert.thresholdLevel
    );
    const updated = new Set(dismissedKeys);
    updated.add(key);
    setDismissedKeys(updated);
    saveStoredDismissedKeys(updated);
  };

  const handleRemindLater = () => {
    const nowMs = Date.now();
    const updated = {
      ...snoozedMap,
      [alert.paymentAttemptId]: nowMs + SNOOZE_DURATION_MS,
    };
    setSnoozedMap(updated);
    saveStoredSnoozes(updated);
  };

  const handleReviewNow = () => {
    // Dismiss this threshold so it doesn't pop up again immediately
    const key = makeUrgentAlertDismissKey(
      alert.paymentAttemptId,
      alert.thresholdLevel
    );
    const updated = new Set(dismissedKeys);
    updated.add(key);
    setDismissedKeys(updated);
    saveStoredDismissedKeys(updated);

    router.push(alert.reviewUrl);
  };

  const formattedAmount = `${alert.currency === "PHP" ? "₱" : `${alert.currency} `}${Number(
    alert.amountDue
  ).toFixed(2)}`;

  return (
    <div
      data-testid="urgent-payment-modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        zIndex: 150,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        data-testid="urgent-payment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="urgent-payment-headline"
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          boxShadow:
            "0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)",
          width: "100%",
          maxWidth: "500px",
          border: "1px solid #fde68a",
          overflow: "hidden",
          animation: "fadeInScale 0.2s ease-out",
        }}
      >
        {/* Urgent Header Banner */}
        <div
          style={{
            background: "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)",
            borderBottom: "1px solid #FCD34D",
            padding: "18px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "#F59E0B",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                boxShadow: "0 2px 4px rgba(245, 158, 11, 0.3)",
              }}
            >
              <AlertTriangle size={20} />
            </div>
            <div>
              <h2
                id="urgent-payment-headline"
                data-testid="urgent-payment-headline"
                style={{
                  margin: 0,
                  fontSize: "16px",
                  fontWeight: 800,
                  color: "#92400E",
                  letterSpacing: "-0.01em",
                }}
              >
                ⚠️ Urgent: Pending Payment Starting Soon
              </h2>
              <div
                style={{
                  fontSize: "12px",
                  color: "#B45309",
                  fontWeight: 600,
                  marginTop: "2px",
                }}
              >
                A customer is awaiting workspace allocation
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#92400E",
              padding: "6px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "24px" }}>
          {/* Multiple items banner if applicable */}
          {activeAlerts.length > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#F8FAFC",
                border: "1px solid var(--da-border)",
                borderRadius: "8px",
                padding: "6px 12px",
                marginBottom: "16px",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--da-text-secondary)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <BellRing size={14} color="#D97706" />
                <span>
                  Urgent Item {safeIndex + 1} of {activeAlerts.length}
                </span>
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  type="button"
                  disabled={safeIndex === 0}
                  onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                  style={{
                    background: safeIndex === 0 ? "transparent" : "#ffffff",
                    border: "1px solid var(--da-border)",
                    borderRadius: "4px",
                    padding: "2px 6px",
                    cursor: safeIndex === 0 ? "not-allowed" : "pointer",
                    opacity: safeIndex === 0 ? 0.4 : 1,
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  disabled={safeIndex === activeAlerts.length - 1}
                  onClick={() =>
                    setCurrentIndex((prev) =>
                      Math.min(activeAlerts.length - 1, prev + 1)
                    )
                  }
                  style={{
                    background:
                      safeIndex === activeAlerts.length - 1
                        ? "transparent"
                        : "#ffffff",
                    border: "1px solid var(--da-border)",
                    borderRadius: "4px",
                    padding: "2px 6px",
                    cursor:
                      safeIndex === activeAlerts.length - 1
                        ? "not-allowed"
                        : "pointer",
                    opacity: safeIndex === activeAlerts.length - 1 ? 0.4 : 1,
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Time Remaining Callout */}
          <div
            style={{
              background: "#FFFBEB",
              border: "1px solid #FCD34D",
              borderRadius: "12px",
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Clock size={18} color="#D97706" />
              <div>
                <span
                  data-testid="urgent-payment-time-remaining"
                  style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    color: "#92400E",
                  }}
                >
                  {formatCountdown(remainingMs)} remaining
                </span>
              </div>
            </div>
          </div>

          {/* Reservation Details Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "14px",
              marginBottom: "24px",
              background: "#FAFAFA",
              padding: "16px",
              borderRadius: "12px",
              border: "1px solid var(--da-border)",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--da-text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <User size={12} /> Customer
              </div>
              <div
                data-testid="urgent-payment-customer-name"
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "var(--da-text-primary)",
                }}
              >
                {alert.customerName}
              </div>
              {alert.customerEmail && (
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--da-text-secondary)",
                    marginTop: "2px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {alert.customerEmail}
                </div>
              )}
            </div>

            <div>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--da-text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Hash size={12} /> Reference
              </div>
              <div
                data-testid="urgent-payment-reference-code"
                style={{
                  fontSize: "14px",
                  fontWeight: 800,
                  color: "var(--da-brand-dark)",
                  fontFamily: "monospace",
                }}
              >
                {alert.reservationReferenceCode}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "var(--da-brand-dark)",
                  marginTop: "2px",
                }}
              >
                {formattedAmount}
              </div>
            </div>

            <div style={{ gridColumn: "span 2", paddingTop: "4px" }}>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--da-text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Clock size={12} /> Scheduled Start Time
              </div>
              <div
                data-testid="urgent-payment-start-time"
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--da-text-primary)",
                }}
              >
                {formatBookingTime(alert.startAt)}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <button
              type="button"
              data-testid="urgent-payment-review-cta"
              onClick={handleReviewNow}
              style={{
                width: "100%",
                background:
                  "linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)",
                color: "#ffffff",
                border: "none",
                borderRadius: "10px",
                padding: "12px 18px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                boxShadow: "0 4px 12px rgba(12, 59, 39, 0.2)",
              }}
            >
              <span>Review Payment Now</span>
              <ArrowRight size={16} />
            </button>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                data-testid="urgent-payment-remind-later-btn"
                onClick={handleRemindLater}
                style={{
                  flex: 1,
                  background: "#ffffff",
                  border: "1px solid var(--da-border)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--da-text-primary)",
                  cursor: "pointer",
                }}
              >
                Remind me later
              </button>
              <button
                type="button"
                data-testid="urgent-payment-dismiss-btn"
                onClick={handleDismiss}
                style={{
                  flex: 1,
                  background: "#ffffff",
                  border: "1px solid var(--da-border)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--da-text-secondary)",
                  cursor: "pointer",
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
