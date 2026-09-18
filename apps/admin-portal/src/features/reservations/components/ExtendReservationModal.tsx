"use client";

import React, { useState, useEffect } from "react";

interface ExtendReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result?: any) => void;
  reservationId: string;
  referenceCode: string;
  customerName?: string;
  spotDisplayName?: string;
  templateName?: string;
  currentSchedule?: string;
  currentEndAt?: string;
  hourlyRate?: number;
  apiPrefix?: string;
  actorRole?: "ADMIN" | "STAFF";
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0 mins";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m === 0) return `${h} hour${h > 1 ? "s" : ""}`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} mins`;
}

export function ExtendReservationModal({
  isOpen,
  onClose,
  onSuccess,
  reservationId,
  referenceCode,
  customerName,
  spotDisplayName,
  templateName,
  currentSchedule,
  currentEndAt,
  hourlyRate = 150,
  apiPrefix = "/api/admin/reservations",
  actorRole = "ADMIN",
}: ExtendReservationModalProps) {
  const [selectedMinutes, setSelectedMinutes] = useState<number>(60);
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [customValue, setCustomValue] = useState<string>("60");
  const [customUnit, setCustomUnit] = useState<"MINUTES" | "HOURS">("MINUTES");
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");

  const [loadingAvailability, setLoadingAvailability] = useState<boolean>(false);
  const [availabilityData, setAvailabilityData] = useState<any>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Compute active minutes to check
  const activeMinutes = isCustom
    ? (customUnit === "HOURS" ? Number(customValue) * 60 : Number(customValue)) || 0
    : selectedMinutes;

  useEffect(() => {
    if (!isOpen || !reservationId) return;

    let cancelled = false;
    const checkAvailability = async () => {
      setLoadingAvailability(true);
      setErrorMsg(null);
      try {
        const res = await fetch(
          `${apiPrefix}/${encodeURIComponent(reservationId)}/extend/availability?extensionMinutes=${encodeURIComponent(
            String(activeMinutes)
          )}`
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to check availability");
        }
        const data = await res.json();
        if (!cancelled) {
          setAvailabilityData(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(err.message || "Failed to check availability");
          setAvailabilityData(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingAvailability(false);
        }
      }
    };

    checkAvailability();

    return () => {
      cancelled = true;
    };
  }, [isOpen, reservationId, activeMinutes, apiPrefix]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (activeMinutes <= 0) {
      setErrorMsg("Please specify a valid extension duration greater than 0.");
      return;
    }
    if (availabilityData && !availabilityData.canExtend) {
      setErrorMsg(availabilityData.reason || "Extension cannot be confirmed due to conflicting booking.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${apiPrefix}/${encodeURIComponent(reservationId)}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extensionMinutes: activeMinutes,
          additionalFee: availabilityData?.additionalFee,
          paymentMethod,
          actorRole,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to extend reservation");
      }

      if (onSuccess) {
        onSuccess(data);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to extend reservation");
    } finally {
      setSubmitting(false);
    }
  };

  const rate = availabilityData?.hourlyRate ?? hourlyRate;
  const computedFee = availabilityData?.additionalFee ?? Math.round(((activeMinutes / 60) * rate) * 100) / 100;
  const isOverMax = availabilityData && activeMinutes > availabilityData.maxExtensionMinutes;
  const canSubmit = !loadingAvailability && !submitting && activeMinutes > 0 && availabilityData?.canExtend && !isOverMax;

  return (
    <div
      data-testid="extend-reservation-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "520px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "90vh",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--da-border-light)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "var(--da-canvas)",
          }}
        >
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 800, color: "var(--da-brand-dark)", margin: 0 }}>
              Extend Reservation
            </h2>
            <div style={{ fontSize: "12px", color: "var(--da-text-secondary)", marginTop: "2px", fontWeight: 600 }}>
              #{referenceCode} {customerName ? `• ${customerName}` : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Close modal"
            style={{
              background: "none",
              border: "none",
              fontSize: "20px",
              cursor: "pointer",
              color: "var(--da-text-secondary)",
              lineHeight: 1,
              padding: "4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Booking Context Card */}
          <div
            style={{
              backgroundColor: "#F8FAFC",
              border: "1px solid var(--da-border)",
              borderRadius: "10px",
              padding: "12px 16px",
              fontSize: "13px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--da-text-secondary)" }}>Spot:</span>
              <span style={{ fontWeight: 700, color: "var(--da-text-primary)" }}>
                {spotDisplayName || availabilityData?.workspaceDisplayName || "Assigned Spot"}{" "}
                {templateName || availabilityData?.templateName ? `(${templateName || availabilityData?.templateName})` : ""}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--da-text-secondary)" }}>Current Schedule:</span>
              <span style={{ fontWeight: 700, color: "var(--da-text-primary)" }}>
                {currentSchedule || "Active Booking"}
              </span>
            </div>
          </div>

          {/* Extension Duration Options */}
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--da-text-primary)", marginBottom: "8px" }}>
              Select Added Time
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) auto", gap: "8px" }}>
              {[
                { label: "+30 mins", minutes: 30 },
                { label: "+1 hour", minutes: 60 },
                { label: "+2 hours", minutes: 120 },
                { label: "+3 hours", minutes: 180 },
              ].map((opt) => {
                const isSelected = !isCustom && selectedMinutes === opt.minutes;
                return (
                  <button
                    key={opt.minutes}
                    type="button"
                    onClick={() => {
                      setIsCustom(false);
                      setSelectedMinutes(opt.minutes);
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: 700,
                      border: isSelected ? "2px solid var(--da-brand-dark)" : "1px solid var(--da-border)",
                      backgroundColor: isSelected ? "var(--da-brand-dark)" : "#fff",
                      color: isSelected ? "#fff" : "var(--da-text-primary)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      textAlign: "center",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setIsCustom(true)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 700,
                  border: isCustom ? "2px solid var(--da-brand-dark)" : "1px solid var(--da-border)",
                  backgroundColor: isCustom ? "var(--da-brand-dark)" : "#fff",
                  color: isCustom ? "#fff" : "var(--da-text-primary)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                Custom
              </button>
            </div>

            {/* Custom Duration Input */}
            {isCustom && (
              <div style={{ display: "flex", gap: "8px", marginTop: "10px", alignItems: "center" }}>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  style={{
                    width: "100px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--da-border)",
                    fontSize: "13px",
                    fontWeight: 700,
                  }}
                />
                <select
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value as any)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--da-border)",
                    fontSize: "13px",
                    fontWeight: 600,
                    backgroundColor: "#fff",
                  }}
                >
                  <option value="MINUTES">Minutes</option>
                  <option value="HOURS">Hours</option>
                </select>
                <span style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontWeight: 600 }}>
                  ({formatMinutes(activeMinutes)})
                </span>
              </div>
            )}
          </div>

          {/* Real-time Overlap & Live Availability Indicator */}
          <div>
            {loadingAvailability ? (
              <div style={{ padding: "10px 14px", borderRadius: "8px", backgroundColor: "#F1F5F9", color: "#475569", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
                <span>Checking spot availability...</span>
              </div>
            ) : availabilityData?.canExtend && !isOverMax ? (
              <div
                data-testid="availability-success-badge"
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  backgroundColor: "#ECFDF5",
                  border: "1px solid #A7F3D0",
                  color: "#065F46",
                  fontSize: "12px",
                  fontWeight: 600,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
                  <span>🟢 Spot Available for Extension</span>
                </div>
                <div>
                  Max permissible extension: <strong>{formatMinutes(availabilityData.maxExtensionMinutes)}</strong>
                  {availabilityData.nextBooking && (
                    <span> (Reserved at {availabilityData.nextBooking.startTimeFormatted || availabilityData.nextBooking.startAt})</span>
                  )}
                </div>
              </div>
            ) : (
              <div
                data-testid="availability-conflict-badge"
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  backgroundColor: "#FEF2F2",
                  border: "1px solid #FECACA",
                  color: "#991B1B",
                  fontSize: "12px",
                  fontWeight: 600,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
                  <span>🔴 Conflict Detected / Cannot Extend</span>
                </div>
                <div>
                  {availabilityData?.reason ||
                    (availabilityData && activeMinutes > availabilityData.maxExtensionMinutes
                      ? `Requested ${formatMinutes(activeMinutes)} exceeds maximum available duration (${formatMinutes(availabilityData.maxExtensionMinutes)}).`
                      : "The spot is not available for the requested extension.")}
                </div>
              </div>
            )}
          </div>

          {/* Billing & Rate Summary */}
          <div
            style={{
              backgroundColor: "var(--da-canvas)",
              borderRadius: "10px",
              padding: "14px 16px",
              border: "1px solid var(--da-border)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              fontSize: "13px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--da-text-secondary)" }}>
              <span>Additional Time:</span>
              <span style={{ fontWeight: 700, color: "var(--da-text-primary)" }}>{formatMinutes(activeMinutes)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--da-text-secondary)" }}>
              <span>Hourly Rate:</span>
              <span style={{ fontWeight: 700, color: "var(--da-text-primary)" }}>₱{rate.toFixed(2)}/hr</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--da-text-secondary)", borderTop: "1px solid var(--da-border-light)", paddingTop: "8px", marginTop: "2px" }}>
              <span style={{ fontWeight: 800, color: "var(--da-brand-dark)" }}>Additional Fee:</span>
              <span style={{ fontWeight: 800, fontSize: "15px", color: "var(--da-brand-dark)" }}>₱{computedFee.toFixed(2)}</span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--da-text-primary)", marginBottom: "6px" }}>
              Payment Collection Method
            </label>
            <div style={{ display: "flex", gap: "10px" }}>
              {[
                { label: "Cash", value: "CASH" },
                { label: "Counter QR", value: "COUNTER_QR" },
              ].map((pm) => (
                <button
                  key={pm.value}
                  type="button"
                  onClick={() => setPaymentMethod(pm.value)}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontWeight: 700,
                    border: paymentMethod === pm.value ? "2px solid var(--da-brand-dark)" : "1px solid var(--da-border)",
                    backgroundColor: paymentMethod === pm.value ? "#F8FAFC" : "#fff",
                    color: paymentMethod === pm.value ? "var(--da-brand-dark)" : "var(--da-text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>

          {errorMsg && (
            <div style={{ color: "var(--da-danger)", fontSize: "12px", backgroundColor: "#FEE2E2", padding: "8px 12px", borderRadius: "6px" }}>
              {errorMsg}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--da-border-light)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            backgroundColor: "#F8FAFC",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "9px 16px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 700,
              backgroundColor: "#fff",
              border: "1px solid var(--da-border)",
              color: "var(--da-text-primary)",
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-extend-button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            style={{
              padding: "9px 20px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 700,
              backgroundColor: canSubmit ? "var(--da-brand-dark)" : "#94A3B8",
              border: "none",
              color: "#fff",
              cursor: canSubmit ? "pointer" : "not-allowed",
              boxShadow: canSubmit ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
            }}
          >
            {submitting ? "Extending..." : "Confirm Extension"}
          </button>
        </div>
      </div>
    </div>
  );
}
