"use client";

import React, { useState } from "react";
import { X, Clock, Calendar, AlertCircle } from "lucide-react";
import type { BookingRental, RentalBillingMode } from "@deskatlas/domain";
import { handleNumericKeyDown } from "@deskatlas/ui";

interface ExtendRentalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  rental: BookingRental | null;
  apiPrefix?: string;
  staffUserId?: string | null;
}

export function ExtendRentalModal({
  isOpen,
  onClose,
  onSuccess,
  rental,
  apiPrefix = "/api/operations/rentals",
  staffUserId,
}: ExtendRentalModalProps) {
  const [extensionMode, setExtensionMode] = useState<RentalBillingMode>("hourly");
  const [additionalUnits, setAdditionalUnits] = useState<number | string>(1);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !rental) return null;

  const rate = rental.rateApplied || 50;
  const parsedUnits =
    typeof additionalUnits === "number"
      ? additionalUnits
      : parseInt(additionalUnits, 10) || 0;
  const additionalFee = rate * parsedUnits;

  // Calculate projected new due time
  const currentDue = new Date(rental.dueAt);
  const effectiveHoursOrDays = parsedUnits > 0 ? parsedUnits : 1;
  const newDue = new Date(
    currentDue.getTime() +
      (extensionMode === "hourly"
        ? effectiveHoursOrDays * 60 * 60 * 1000
        : effectiveHoursOrDays * 24 * 60 * 60 * 1000)
  );

  const formattedNewDue = newDue.toLocaleTimeString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalUnits = typeof additionalUnits === "number" ? additionalUnits : parseInt(additionalUnits, 10);
    if (isNaN(finalUnits) || finalUnits < 1) {
      setErrorMsg("Additional duration must be at least 1");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`${apiPrefix}/${encodeURIComponent(rental.id)}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rentalId: rental.id,
          extensionMode,
          additionalUnits: finalUnits,
          staffUserId: staffUserId || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to extend rental");
      }

      onSuccess();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to extend rental";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="extend-rental-modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 155,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        data-testid="extend-rental-modal"
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          maxWidth: "480px",
          width: "100%",
          padding: "24px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 800, color: "var(--da-text-primary)", margin: 0 }}>
              Extend Rental Duration
            </h2>
            <p style={{ fontSize: "12px", color: "var(--da-text-secondary)", marginTop: "4px", margin: 0 }}>
              {rental.serviceName || "Hardware Item"} for {rental.customerName}
            </p>
          </div>
          <button
            type="button"
            data-testid="close-extend-modal-btn"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              color: "var(--da-text-secondary)",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {errorMsg && (
          <div
            data-testid="extend-rental-error-banner"
            style={{
              marginBottom: "16px",
              padding: "10px 14px",
              background: "#FEF2F2",
              border: "1px solid #FCA5A5",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              color: "#991B1B",
            }}
          >
            <AlertCircle size={16} color="#DC2626" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Mode Selector */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--da-text-primary)", marginBottom: "6px" }}>
              Extension Mode
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <button
                type="button"
                data-testid="extend-mode-hourly-btn"
                onClick={() => setExtensionMode("hourly")}
                style={{
                  padding: "10px",
                  borderRadius: "8px",
                  border: extensionMode === "hourly" ? "2px solid var(--da-primary)" : "1px solid var(--da-border)",
                  background: extensionMode === "hourly" ? "#F0FDF4" : "#fff",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: extensionMode === "hourly" ? "#166534" : "var(--da-text-secondary)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}
              >
                <Clock size={15} />
                <span>Hourly</span>
              </button>

              <button
                type="button"
                data-testid="extend-mode-daily-btn"
                onClick={() => setExtensionMode("daily")}
                style={{
                  padding: "10px",
                  borderRadius: "8px",
                  border: extensionMode === "daily" ? "2px solid var(--da-primary)" : "1px solid var(--da-border)",
                  background: extensionMode === "daily" ? "#F0FDF4" : "#fff",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: extensionMode === "daily" ? "#166534" : "var(--da-text-secondary)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}
              >
                <Calendar size={15} />
                <span>Daily</span>
              </button>
            </div>
          </div>

          {/* Additional Units */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--da-text-primary)", marginBottom: "6px" }}>
              Additional Duration ({extensionMode === "hourly" ? "Hours" : "Days"})
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <input
                type="number"
                min="1"
                max="24"
                data-testid="additional-units-input"
                value={additionalUnits}
                onChange={(e) => setAdditionalUnits(e.target.value)}
                onBlur={() => {
                  if (!additionalUnits || parseInt(String(additionalUnits), 10) < 1) {
                    setAdditionalUnits(1);
                  }
                }}
                onKeyDown={(e) => handleNumericKeyDown(e)}
                style={{
                  width: "120px",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--da-border)",
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "var(--da-text-primary)",
                  outline: "none",
                }}
              />
              <span style={{ fontSize: "13px", color: "var(--da-text-secondary)" }}>
                {extensionMode === "hourly" ? "hour(s)" : "day(s)"}
              </span>
            </div>
          </div>

          {/* Extension Fee & New Due Preview */}
          <div
            data-testid="extension-preview-banner"
            style={{
              background: "#F8FAFC",
              border: "1px solid var(--da-border)",
              borderRadius: "10px",
              padding: "14px",
              marginBottom: "18px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "13px", color: "var(--da-text-secondary)" }}>Extension Fee:</span>
              <span style={{ fontSize: "15px", fontWeight: 800, color: "var(--da-brand-dark)" }}>
                PHP {additionalFee.toFixed(2)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--da-text-secondary)" }}>New due time:</span>
              <span data-testid="new-due-time-preview" style={{ fontSize: "12px", fontWeight: 700, color: "#166534" }}>
                {formattedNewDue}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 16px",
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
              type="submit"
              data-testid="confirm-extend-submit-btn"
              disabled={submitting || parsedUnits <= 0}
              style={{
                padding: "10px 20px",
                background: "var(--da-primary)",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Extending..." : "Confirm Extension"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

