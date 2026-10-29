"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Clock, AlertTriangle, X, ArrowUpRight, RotateCcw, Monitor } from "lucide-react";
import type { RentalEndAlert } from "@deskatlas/domain";
import { ExtendRentalModal } from "../rentals/components/ExtendRentalModal";

interface NearRentalEndAlertToastsProps {
  apiPrefix?: string;
}

function playAlertChime() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
    osc.frequency.exponentialRampToValueAtTime(987.77, ctx.currentTime + 0.15); // B5

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Audio restrictions
  }
}

function formatRentalTime(isoString: string): string {
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

export function NearRentalEndAlertToasts({
  apiPrefix = "/api/operations/rentals",
}: NearRentalEndAlertToastsProps) {
  const [alerts, setAlerts] = useState<RentalEndAlert[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [selectedExtendAlert, setSelectedExtendAlert] = useState<RentalEndAlert | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnConfirmAlert, setReturnConfirmAlert] = useState<RentalEndAlert | null>(null);

  const fetchRentalAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${apiPrefix}/alerts`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.alerts)) {
          setAlerts(data.alerts);
        }
      }
    } catch {
      // Ignore background poll errors
    }
  }, [apiPrefix]);

  useEffect(() => {
    fetchRentalAlerts();
    const interval = setInterval(fetchRentalAlerts, 30000);
    return () => clearInterval(interval);
  }, [fetchRentalAlerts]);

  const activeAlerts = alerts.filter((a) => !dismissedIds.has(a.rentalId));

  const [prevCount, setPrevCount] = useState(0);
  useEffect(() => {
    if (activeAlerts.length > prevCount && activeAlerts.length > 0) {
      playAlertChime();
    }
    setPrevCount(activeAlerts.length);
  }, [activeAlerts.length, prevCount]);

  const handleDismiss = (rentalId: string) => {
    setDismissedIds((prev) => new Set(prev).add(rentalId));
  };

  const handleReturn = async (rentalId: string) => {
    try {
      setReturningId(rentalId);
      const res = await fetch(`${apiPrefix}/${encodeURIComponent(rentalId)}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to return rental");
      }

      setDismissedIds((prev) => new Set(prev).add(rentalId));
      setReturnConfirmAlert(null);
      await fetchRentalAlerts();
    } catch (err) {
      console.error("Return error:", err);
    } finally {
      setReturningId(null);
    }
  };

  if (activeAlerts.length === 0) {
    return null;
  }

  return (
    <>
      <div
        data-testid="near-rental-toast-container"
        style={{
          position: "fixed",
          bottom: "160px",
          right: "24px",
          zIndex: 145,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          maxWidth: "420px",
          width: "calc(100vw - 48px)",
          pointerEvents: "none",
        }}
      >
        {activeAlerts.slice(0, 3).map((alert) => {
          const isOverdue = alert.isOverdue;
          const timeText = isOverdue
            ? `Overdue (${Math.abs(alert.timeRemainingMinutes)} mins ago)`
            : `${Math.max(1, alert.timeRemainingMinutes)} mins left`;

          return (
            <div
              key={alert.rentalId}
              data-testid={`near-rental-toast-${alert.rentalId}`}
              style={{
                pointerEvents: "auto",
                background: "#ffffff",
                border: isOverdue ? "1.5px solid #FECDD3" : "1.5px solid #FDE68A",
                borderRadius: "14px",
                boxShadow: isOverdue
                  ? "0 10px 25px -5px rgba(225, 29, 72, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)"
                  : "0 10px 25px -5px rgba(217, 119, 6, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                overflow: "hidden",
                transition: "all 0.2s ease",
              }}
            >
              {/* Header Bar */}
              <div
                style={{
                  background: isOverdue ? "#FFF1F2" : "#FFFBEB",
                  borderBottom: isOverdue ? "1px solid #FFE4E6" : "1px solid #FEF3C7",
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                  <AlertTriangle size={15} color={isOverdue ? "#E11D48" : "#D97706"} />
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 800,
                      color: isOverdue ? "#9F1239" : "#92400E",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {isOverdue ? "Rental Overdue" : "Rental Ending Soon"}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid={`rental-dismiss-btn-${alert.rentalId}`}
                  onClick={() => handleDismiss(alert.rentalId)}
                  aria-label="Dismiss alert"
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: isOverdue ? "#9F1239" : "#92400E",
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

              {/* Body with Mandatory 4 Fields */}
              <div style={{ padding: "12px 14px" }}>
                {/* 1. Spot Name & 2. Customer Full Name */}
                <div style={{ marginBottom: "6px" }}>
                  <div
                    data-testid={`rental-spot-name-${alert.rentalId}`}
                    style={{ fontSize: "13px", fontWeight: 800, color: "var(--da-text-primary)" }}
                  >
                    Spot: <span>{alert.spotName}</span>
                  </div>
                  <div
                    data-testid={`rental-customer-name-${alert.rentalId}`}
                    style={{ fontSize: "12px", fontWeight: 600, color: "var(--da-text-secondary)", marginTop: "2px" }}
                  >
                    Customer: <span>{alert.customerName}</span>
                  </div>
                </div>

                {/* 3. Item Rented */}
                <div
                  data-testid={`rental-item-name-${alert.rentalId}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "var(--da-brand-dark)",
                    marginBottom: "6px",
                  }}
                >
                  <Monitor size={14} color="var(--da-primary)" />
                  <span>Item: {alert.itemName}</span>
                </div>

                {/* 4. Rental Time End */}
                <div
                  data-testid={`rental-due-time-${alert.rentalId}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                    color: "var(--da-text-secondary)",
                    marginBottom: "12px",
                  }}
                >
                  <Clock size={13} color={isOverdue ? "#E11D48" : "#D97706"} />
                  <span>
                    Ends at: <strong>{formatRentalTime(alert.dueAt)}</strong> ({timeText})
                  </span>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    data-testid={`rental-extend-btn-${alert.rentalId}`}
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
                    data-testid={`rental-return-btn-${alert.rentalId}`}
                    onClick={() => setReturnConfirmAlert(alert)}
                    style={{
                      flex: 1,
                      padding: "7px 10px",
                      background: "#F1F5F9",
                      color: "var(--da-text-primary)",
                      border: "1px solid var(--da-border)",
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
                    <RotateCcw size={13} />
                    <span>Return</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Return Confirmation Dialog */}
      {returnConfirmAlert && (
        <div
          data-testid="rental-return-confirm-dialog"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            zIndex: 160,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              maxWidth: "440px",
              width: "100%",
              padding: "24px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 800, color: "var(--da-text-primary)", marginBottom: "8px" }}>
              Confirm Equipment Return
            </h3>
            <p style={{ fontSize: "13px", color: "var(--da-text-secondary)", marginBottom: "16px", lineHeight: "1.5" }}>
              Confirm item has been inspected and customer physical ID has been returned.
            </p>
            <div
              style={{
                background: "var(--da-canvas)",
                border: "1px solid var(--da-border)",
                borderRadius: "10px",
                padding: "12px",
                marginBottom: "20px",
                fontSize: "12px",
              }}
            >
              <div><strong>Customer:</strong> {returnConfirmAlert.customerName}</div>
              <div><strong>Spot:</strong> {returnConfirmAlert.spotName}</div>
              <div><strong>Item:</strong> {returnConfirmAlert.itemName}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setReturnConfirmAlert(null)}
                style={{
                  padding: "8px 14px",
                  background: "#ffffff",
                  border: "1px solid var(--da-border)",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-return-submit-btn"
                disabled={Boolean(returningId)}
                onClick={() => handleReturn(returnConfirmAlert.rentalId)}
                style={{
                  padding: "8px 16px",
                  background: "var(--da-primary)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {returningId ? "Processing..." : "Confirm Return & Hand Back ID"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extend Modal from Alert Toast */}
      {selectedExtendAlert && (
        <ExtendRentalModal
          isOpen={Boolean(selectedExtendAlert)}
          onClose={() => setSelectedExtendAlert(null)}
          onSuccess={() => {
            setSelectedExtendAlert(null);
            fetchRentalAlerts();
          }}
          rental={{
            id: selectedExtendAlert.rentalId,
            rentalCode: selectedExtendAlert.rentalCode,
            reservationId: selectedExtendAlert.reservationId,
            customerId: "",
            serviceId: "",
            unitCount: 1,
            billingMode: "hourly",
            durationUnits: 1,
            rateApplied: 0,
            totalAmount: 0,
            idVerified: true,
            idNotes: "",
            status: "active",
            rentedAt: new Date().toISOString(),
            dueAt: selectedExtendAlert.dueAt,
            notes: "",
            createdAt: "",
            updatedAt: "",
            customerName: selectedExtendAlert.customerName,
            spotName: selectedExtendAlert.spotName,
            serviceName: selectedExtendAlert.itemName,
          }}
          apiPrefix={apiPrefix}
        />
      )}
    </>
  );
}

