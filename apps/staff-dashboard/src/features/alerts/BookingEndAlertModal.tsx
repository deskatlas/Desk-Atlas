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
  MapPin,
} from "lucide-react";
import type { BookingEndAlert } from "@deskatlas/domain";
import {
  makeEndAlertDismissKey,
  isEndAlertDismissed,
} from "@deskatlas/domain";

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

function saveStoredDismissedKeys(keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY_DISMISSED, JSON.stringify(Array.from(keys)));
  } catch {
    // Ignore storage write errors
  }
}

function formatBookingTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export function BookingEndAlertModal() {
  const router = useRouter();
  const pathname = usePathname();

  const [rawAlerts, setRawAlerts] = useState<BookingEndAlert[]>([]);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(getStoredDismissedKeys);
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  const fetchApproachingAlerts = useCallback(async () => {
    try {
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
      // Silently ignore network failures on background poll
    }
  }, []);

  useEffect(() => {
    fetchApproachingAlerts();
    const interval = setInterval(fetchApproachingAlerts, 60000);
    return () => clearInterval(interval);
  }, [fetchApproachingAlerts]);

  // Filter out dismissed alerts
  const activeAlerts = useMemo(() => {
    return rawAlerts.filter((alert) => {
      if (isEndAlertDismissed(dismissedKeys, alert.reservationId)) {
        return false;
      }
      return true;
    });
  }, [rawAlerts, dismissedKeys]);

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

  const handleDismiss = () => {
    const key = makeEndAlertDismissKey(alert.reservationId);
    const updated = new Set(dismissedKeys);
    updated.add(key);
    setDismissedKeys(updated);
    saveStoredDismissedKeys(updated);
  };

  const handleViewReservation = () => {
    const key = makeEndAlertDismissKey(alert.reservationId);
    const updated = new Set(dismissedKeys);
    updated.add(key);
    setDismissedKeys(updated);
    saveStoredDismissedKeys(updated);

    router.push(`/manage/reservations?search=${encodeURIComponent(alert.referenceCode)}`);
  };

  const minutesText = Math.max(1, Math.round(alert.minutesRemaining));

  return (
    <div
      data-testid="booking-end-alert-modal-backdrop"
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
        data-testid="booking-end-alert-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-end-headline"
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          boxShadow:
            "0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)",
          width: "100%",
          maxWidth: "480px",
          border: "1px solid #fed7aa",
          overflow: "hidden",
        }}
      >
        {/* Urgent Header Banner */}
        <div
          style={{
            background: "linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)",
            borderBottom: "1px solid #FDBA74",
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
                background: "#EA580C",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                boxShadow: "0 2px 4px rgba(234, 88, 12, 0.3)",
              }}
            >
              <Clock size={20} />
            </div>
            <div>
              <h2
                id="booking-end-headline"
                data-testid="booking-end-headline"
                style={{
                  margin: 0,
                  fontSize: "16px",
                  fontWeight: 800,
                  color: "#9A3412",
                  letterSpacing: "-0.01em",
                }}
              >
                ⏰ Booking Ending Soon
              </h2>
              <div
                style={{
                  fontSize: "12px",
                  color: "#C2410C",
                  fontWeight: 600,
                  marginTop: "2px",
                }}
              >
                A customer's active session is approaching expiration
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Close"
            data-testid="booking-end-close-btn"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#9A3412",
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
                <BellRing size={14} color="#EA580C" />
                <span>
                  Approaching End {safeIndex + 1} of {activeAlerts.length}
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
              background: "#FFF7ED",
              border: "1px solid #FDBA74",
              borderRadius: "12px",
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Clock size={18} color="#EA580C" />
              <div>
                <span
                  data-testid="booking-end-time-remaining"
                  style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    color: "#9A3412",
                  }}
                >
                  Ends in {minutesText} {minutesText === 1 ? "minute" : "minutes"}
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    color: "#C2410C",
                    marginLeft: "6px",
                    fontWeight: 600,
                  }}
                >
                  (at {formatBookingTime(alert.endAt)})
                </span>
              </div>
            </div>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: "#EA580C",
                color: "#ffffff",
                padding: "3px 8px",
                borderRadius: "9999px",
              }}
            >
              Checked In
            </span>
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
                <MapPin size={12} /> Spot
              </div>
              <div
                data-testid="booking-end-spot-name"
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "var(--da-text-primary)",
                }}
              >
                {alert.spotName}
              </div>
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
                data-testid="booking-end-reference-code"
                style={{
                  fontSize: "14px",
                  fontWeight: 800,
                  color: "var(--da-brand-dark)",
                  fontFamily: "monospace",
                }}
              >
                {alert.referenceCode}
              </div>
            </div>

            <div style={{ gridColumn: "span 2", paddingTop: "4px", borderTop: "1px solid #f1f5f9" }}>
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
                data-testid="booking-end-customer-name"
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
                    fontSize: "12px",
                    color: "var(--da-text-secondary)",
                    marginTop: "2px",
                  }}
                >
                  {alert.customerEmail}
                </div>
              )}
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
              data-testid="booking-end-view-cta"
              onClick={handleViewReservation}
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
              <span>View Reservation</span>
              <ArrowRight size={16} />
            </button>

            <button
              type="button"
              data-testid="booking-end-dismiss-btn"
              onClick={handleDismiss}
              style={{
                width: "100%",
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
              Dismiss Alert
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
