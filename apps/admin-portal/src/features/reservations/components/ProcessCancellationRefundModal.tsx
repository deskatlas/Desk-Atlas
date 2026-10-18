"use client";

import React, { useState } from "react";

interface ProcessCancellationRefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result?: any) => void;
  reservationId: string;
  referenceCode: string;
  customerName: string;
  customerEmail: string;
  formattedSchedule?: string;
  amountDue: number;
}

export function ProcessCancellationRefundModal({
  isOpen,
  onClose,
  onSuccess,
  reservationId,
  referenceCode,
  customerName,
  customerEmail,
  formattedSchedule,
  amountDue,
}: ProcessCancellationRefundModalProps) {
  const [refundNotes, setRefundNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const formattedAmount = Number(amountDue || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);

      const res = await fetch(`/api/admin/reservations/${encodeURIComponent(reservationId)}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refundNotes: refundNotes.trim() || "Customer cancellation refund disbursed to source account.",
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to record refund.");
      }

      onSuccess(data);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to record refund disbursement.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="process-cancellation-refund-modal"
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
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "14px",
          width: "100%",
          maxWidth: "520px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
          border: "1px solid var(--da-border)",
          overflow: "hidden",
          fontFamily: "var(--da-font-family)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--da-border-light)",
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
                borderRadius: "50%",
                background: "#FEF3C7",
                color: "#B45309",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 800, color: "var(--da-text-primary)", margin: 0 }}>
                Process Cancellation Refund
              </h2>
              <div style={{ fontSize: "12px", color: "var(--da-text-secondary)" }}>
                Reference: <strong style={{ color: "var(--da-text-primary)" }}>#{referenceCode}</strong>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "6px",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px" }}>
          {/* Reservation Summary */}
          <div
            style={{
              backgroundColor: "#F8FAF9",
              borderRadius: "10px",
              border: "1px solid var(--da-border-light)",
              padding: "14px 16px",
              marginBottom: "16px",
              fontSize: "12px",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div>
                <span style={{ color: "var(--da-text-secondary)", display: "block" }}>Customer</span>
                <strong style={{ color: "var(--da-text-primary)" }}>{customerName}</strong>
                <div style={{ color: "#64748b", fontSize: "11px" }}>{customerEmail}</div>
              </div>
              <div>
                <span style={{ color: "var(--da-text-secondary)", display: "block" }}>Refund Amount</span>
                <strong style={{ color: "#B45309", fontSize: "15px" }}>₱{formattedAmount}</strong>
              </div>
              {formattedSchedule && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: "var(--da-text-secondary)", display: "block" }}>Scheduled Window</span>
                  <span style={{ color: "var(--da-text-primary)" }}>{formattedSchedule}</span>
                </div>
              )}
            </div>
          </div>

          {/* Amber Notice */}
          <div
            style={{
              backgroundColor: "#FFFBEB",
              border: "1px solid #FCD34D",
              borderRadius: "8px",
              padding: "10px 14px",
              fontSize: "11px",
              color: "#92400E",
              marginBottom: "16px",
              lineHeight: 1.5,
            }}
          >
            <strong>Refund Disbursement Notice:</strong> Verify that the refund has been sent to the customer via your payment provider (e.g. GCash or Bank Transfer) before confirming. Recording this transaction transitions the booking to <strong>Refunded</strong> and emails confirmation to the customer.
          </div>

          {/* Disbursement Notes / Reference */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--da-text-primary)", marginBottom: "6px" }}>
              Disbursement Notes / Reference Code
            </label>
            <textarea
              data-testid="refund-notes-input"
              rows={3}
              value={refundNotes}
              onChange={(e) => setRefundNotes(e.target.value)}
              placeholder="e.g. GCash reference 20261018991823 disbursed to customer source account"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid var(--da-border)",
                fontSize: "12px",
                fontFamily: "var(--da-font-family)",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </div>

          {error && (
            <div
              style={{
                backgroundColor: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: "8px",
                padding: "10px 14px",
                fontSize: "12px",
                color: "#991B1B",
                marginBottom: "16px",
              }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              data-testid="cancel-refund-button"
              style={{
                padding: "9px 18px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 700,
                border: "1px solid var(--da-border)",
                background: "#fff",
                color: "var(--da-text-secondary)",
                cursor: "pointer",
                fontFamily: "var(--da-font-family)",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-testid="confirm-refund-button"
              style={{
                padding: "9px 20px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 700,
                border: "none",
                background: "#B45309",
                color: "#fff",
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
                fontFamily: "var(--da-font-family)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {submitting ? "Processing..." : "Confirm & Record Refund"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
