"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Clock,
  Check,
  MapPin,
  User,
  Hash,
  X,
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
    // Ignore storage errors
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

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<BookingEndAlert[]>([]);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => getStoredDismissedKeys());
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/operations/approaching-ends", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.alerts)) {
          setAlerts(data.alerts);
        }
      }
    } catch {
      // Ignore background poll errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Close dropdown on click outside or escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const activeAlerts = alerts.filter(
    (a) => !isEndAlertDismissed(dismissedKeys, a.reservationId)
  );

  const unreadCount = activeAlerts.length;

  const markSingleAsDismissed = (reservationId: string, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    const next = new Set(dismissedKeys);
    next.add(makeEndAlertDismissKey(reservationId));
    setDismissedKeys(next);
    saveStoredDismissedKeys(next);
  };

  const markAllAsDismissed = () => {
    const next = new Set(dismissedKeys);
    for (const a of alerts) {
      next.add(makeEndAlertDismissKey(a.reservationId));
    }
    setDismissedKeys(next);
    saveStoredDismissedKeys(next);
  };

  const handleAlertClick = (alert: BookingEndAlert) => {
    markSingleAsDismissed(alert.reservationId);
    setOpen(false);
    router.push(`/manage/reservations?search=${encodeURIComponent(alert.referenceCode)}`);
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Bell Button */}
      <button
        type="button"
        data-testid="staff-notification-bell-btn"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Notifications (${unreadCount} active)`}
        title={`Notifications (${unreadCount} active)`}
        style={{
          position: "relative",
          width: "32px",
          height: "32px",
          borderRadius: "9px",
          background: open ? "var(--da-soft, #e6f7f5)" : "var(--da-canvas, #f8f9fa)",
          border: "1px solid var(--da-border, #e5e7eb)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          color: open ? "var(--da-primary, #009689)" : "var(--da-text-primary, #111827)",
          transition: "all 0.15s ease",
        }}
      >
        <Bell style={{ width: "15px", height: "15px" }} />
        {unreadCount > 0 && (
          <span
            data-testid="staff-notification-badge"
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              minWidth: "16px",
              height: "16px",
              borderRadius: "9999px",
              background: "#ef4444",
              color: "#ffffff",
              fontSize: "10px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
              border: "2px solid #ffffff",
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div
          data-testid="staff-notification-dropdown"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "360px",
            maxWidth: "calc(100vw - 32px)",
            background: "#ffffff",
            borderRadius: "12px",
            border: "1px solid var(--da-border, #e5e7eb)",
            boxShadow:
              "0 10px 25px -5px rgba(0,0,0,0.12), 0 8px 10px -6px rgba(0,0,0,0.08)",
            zIndex: 100,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: "var(--da-font-family, inherit)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--da-border, #e5e7eb)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#fafafa",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "var(--da-text-primary, #111827)",
                }}
              >
                Booking Alerts
              </span>
              {unreadCount > 0 && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    background: "#fee2e2",
                    color: "#dc2626",
                    padding: "2px 6px",
                    borderRadius: "9999px",
                  }}
                >
                  {unreadCount} ending soon
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsDismissed}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--da-primary, #009689)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "4px 8px",
                  borderRadius: "6px",
                }}
                title="Dismiss all"
              >
                <Check style={{ width: "12px", height: "12px" }} />
                Dismiss all
              </button>
            )}
          </div>

          {/* List */}
          <div
            style={{
              maxHeight: "340px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {activeAlerts.length === 0 ? (
              <div
                style={{
                  padding: "36px 20px",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  color: "var(--da-text-secondary, #6b7280)",
                }}
              >
                <Bell
                  style={{
                    width: "28px",
                    height: "28px",
                    color: "var(--da-border, #d1d5db)",
                  }}
                />
                <div style={{ fontSize: "13px", fontWeight: 600 }}>
                  No bookings ending soon
                </div>
                <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                  Alerts will appear here when checked-in sessions approach expiration.
                </div>
              </div>
            ) : (
              activeAlerts.map((item) => {
                const minsLeft = Math.max(1, Math.round(item.minutesRemaining));

                return (
                  <div
                    key={item.reservationId}
                    data-testid={`staff-notification-item-${item.referenceCode}`}
                    onClick={() => handleAlertClick(item)}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      padding: "12px 16px",
                      borderBottom: "1px solid #f3f4f6",
                      cursor: "pointer",
                      background: "rgba(234, 88, 12, 0.04)",
                      transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(234, 88, 12, 0.08)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(234, 88, 12, 0.04)";
                    }}
                  >
                    {/* Event Icon */}
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        background: "#ffedd5",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: "2px",
                      }}
                    >
                      <Clock
                        style={{
                          width: "16px",
                          height: "16px",
                          color: "#ea580c",
                        }}
                      />
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          marginBottom: "2px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "var(--da-text-primary, #111827)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.spotName} • {minsLeft}m left
                        </div>
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            background: "#fed7aa",
                            color: "#9a3412",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            flexShrink: 0,
                          }}
                        >
                          {formatBookingTime(item.endAt)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--da-text-secondary, #4b5563)",
                          lineHeight: 1.35,
                          marginBottom: "2px",
                        }}
                      >
                        {item.customerName} ({item.referenceCode})
                      </div>
                    </div>

                    {/* Dismiss Button */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "6px",
                        flexShrink: 0,
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => markSingleAsDismissed(item.reservationId, e)}
                        title="Dismiss"
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "2px",
                          cursor: "pointer",
                          color: "#9ca3af",
                          borderRadius: "4px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#ea580c")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
                      >
                        <X style={{ width: "14px", height: "14px" }} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
