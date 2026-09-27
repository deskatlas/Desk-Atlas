"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Clock, AlertTriangle, X, ArrowUpRight, CheckCircle2 } from "lucide-react";
import type { BookingEndAlert } from "@deskatlas/domain";
import { useAlerts } from "./AlertsContext";
import { ExtendReservationModal } from "../reservations/components/ExtendReservationModal";

function playAlertChime() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Audio autoplay restrictions or unsupported audio context
  }
}

function formatEndTime(isoString: string): string {
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

export function NearCheckoutAlertToasts() {
  const { activeAlerts, markSingleAsDismissed, fetchAlerts } = useAlerts();
  const [selectedExtendAlert, setSelectedExtendAlert] = useState<BookingEndAlert | null>(null);
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);
  const [checkoutSuccessMsg, setCheckoutSuccessMsg] = useState<string | null>(null);

  // Sound chime when a new alert appears
  const [prevAlertCount, setPrevAlertCount] = useState<number>(0);
  useEffect(() => {
    if (activeAlerts.length > prevAlertCount && activeAlerts.length > 0) {
      playAlertChime();
    }
    setPrevAlertCount(activeAlerts.length);
  }, [activeAlerts.length, prevAlertCount]);

  const handleCheckout = useCallback(
    async (alert: BookingEndAlert) => {
      try {
        setCheckingOutId(alert.reservationId);
        const res = await fetch(
          `/api/operations/reservations/${encodeURIComponent(alert.reservationId)}/checkout`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              actedAt: new Date().toISOString(),
            }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to checkout reservation");
        }

        markSingleAsDismissed(alert.reservationId);
        setCheckoutSuccessMsg(`Successfully checked out ${alert.customerName} (${alert.spotName})`);
        setTimeout(() => setCheckoutSuccessMsg(null), 4000);
        await fetchAlerts();
      } catch (err) {
        console.error("Checkout error:", err);
      } finally {
        setCheckingOutId(null);
      }
    },
    [markSingleAsDismissed, fetchAlerts]
  );

  if (activeAlerts.length === 0 && !checkoutSuccessMsg) {
    return null;
  }

  return (
    <>
      <div
        data-testid="near-checkout-toast-container"
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 140,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          maxWidth: "400px",
          width: "calc(100vw - 48px)",
          pointerEvents: "none",
        }}
      >
        {checkoutSuccessMsg && (
          <div
            data-testid="near-checkout-success-toast"
            style={{
              pointerEvents: "auto",
              background: "#ECFDF5",
              border: "1px solid #A7F3D0",
              borderRadius: "12px",
              padding: "12px 16px",
              boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "13px",
              fontWeight: 700,
              color: "#065F46",
            }}
          >
            <CheckCircle2 size={18} color="#059669" />
            <span>{checkoutSuccessMsg}</span>
          </div>
        )}

        {activeAlerts.slice(0, 3).map((alert) => {
          const minutesRemaining = Math.max(1, Math.round(alert.minutesRemaining));
          const isCheckingOut = checkingOutId === alert.reservationId;

          return (
            <div
              key={alert.reservationId}
              data-testid={`near-checkout-toast-${alert.reservationId}`}
              style={{
                pointerEvents: "auto",
                background: "#ffffff",
                border: "1.5px solid #FDE68A",
                borderRadius: "14px",
                boxShadow: "0 10px 25px -5px rgba(217, 119, 6, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                overflow: "hidden",
                transition: "all 0.2s ease",
              }}
            >
              {/* Header Bar */}
              <div
                style={{
                  background: "#FFFBEB",
                  borderBottom: "1px solid #FEF3C7",
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                  <AlertTriangle size={15} color="#D97706" />
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 800,
                      color: "#92400E",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Reservation Ending Soon
                  </span>
                </div>
                <button
                  type="button"
                  data-testid={`dismiss-toast-btn-${alert.reservationId}`}
                  onClick={() => markSingleAsDismissed(alert.reservationId)}
                  aria-label="Dismiss alert"
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "#92400E",
                    padding: "2px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <X size={15} />
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: "12px 14px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--da-text-primary)", marginBottom: "4px" }}>
                  {alert.customerName} &middot;{" "}
                  <span style={{ color: "var(--da-brand-dark)", fontWeight: 800 }}>{alert.spotName}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--da-text-secondary)", marginBottom: "12px" }}>
                  <Clock size={13} color="#D97706" />
                  <span>
                    <strong style={{ color: "#B45309" }}>{minutesRemaining} mins left</strong> (ends {formatEndTime(alert.endAt)})
                  </span>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    data-testid={`extend-toast-btn-${alert.reservationId}`}
                    onClick={() => setSelectedExtendAlert(alert)}
                    style={{
                      flex: 1,
                      padding: "7px 10px",
                      background: "var(--da-brand-dark)",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "7px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                    }}
                  >
                    <span>Extend</span>
                    <ArrowUpRight size={13} />
                  </button>
                  <button
                    type="button"
                    data-testid={`checkout-toast-btn-${alert.reservationId}`}
                    disabled={isCheckingOut}
                    onClick={() => handleCheckout(alert)}
                    style={{
                      flex: 1,
                      padding: "7px 10px",
                      background: "#F1F5F9",
                      color: "#334155",
                      border: "1px solid #CBD5E1",
                      borderRadius: "7px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: isCheckingOut ? "not-allowed" : "pointer",
                      opacity: isCheckingOut ? 0.6 : 1,
                    }}
                  >
                    {isCheckingOut ? "Checking out..." : "Check Out"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedExtendAlert && (
        <ExtendReservationModal
          isOpen={Boolean(selectedExtendAlert)}
          onClose={() => setSelectedExtendAlert(null)}
          onSuccess={() => {
            if (selectedExtendAlert) {
              markSingleAsDismissed(selectedExtendAlert.reservationId);
            }
            setSelectedExtendAlert(null);
            fetchAlerts();
          }}
          reservationId={selectedExtendAlert.reservationId}
          referenceCode={selectedExtendAlert.referenceCode}
          customerName={selectedExtendAlert.customerName}
          spotDisplayName={selectedExtendAlert.spotName}
          currentEndAt={selectedExtendAlert.endAt}
        />
      )}
    </>
  );
}
