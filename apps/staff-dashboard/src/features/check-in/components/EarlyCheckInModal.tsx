"use client";

import React, { useEffect } from "react";
import { format, isToday, isTomorrow } from "date-fns";

export interface EarlyCheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerName?: string;
  referenceCode?: string;
  workspaceName?: string;
  bookingStartAt?: string;
  bookingEndAt?: string;
}

export function isEarlyCheckInError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as any)?.code;
  return (
    code === "EARLY_CHECK_IN" ||
    msg.includes("Reservation is not currently active for check-in") ||
    msg.includes("not currently active for check-in")
  );
}

export function formatEarlyCheckInSchedule(
  bookingStartAt?: string,
  bookingEndAt?: string
): {
  formattedSchedule: string;
  formattedStartDate: string;
  formattedStartTime: string;
  formattedEndTime: string;
} {
  let formattedSchedule = "-";
  let formattedStartDate = "";
  let formattedStartTime = "";
  let formattedEndTime = "";

  if (bookingStartAt) {
    try {
      const startDate = new Date(bookingStartAt);
      formattedStartTime = format(startDate, "h:mm a");

      if (isToday(startDate)) {
        formattedStartDate = "Today";
      } else if (isTomorrow(startDate)) {
        formattedStartDate = "Tomorrow";
      } else {
        formattedStartDate = format(startDate, "MMM d, yyyy");
      }

      if (bookingEndAt) {
        const endDate = new Date(bookingEndAt);
        formattedEndTime = format(endDate, "h:mm a");
        formattedSchedule = `${formattedStartDate}, ${formattedStartTime} – ${formattedEndTime}`;
      } else {
        formattedSchedule = `${formattedStartDate} at ${formattedStartTime}`;
      }
    } catch {
      formattedSchedule = bookingStartAt;
    }
  }

  return {
    formattedSchedule,
    formattedStartDate,
    formattedStartTime,
    formattedEndTime,
  };
}

export function EarlyCheckInModal({
  isOpen,
  onClose,
  customerName,
  referenceCode,
  workspaceName,
  bookingStartAt,
  bookingEndAt,
}: EarlyCheckInModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const {
    formattedSchedule,
    formattedStartDate,
    formattedStartTime,
  } = formatEarlyCheckInSchedule(bookingStartAt, bookingEndAt);

  return (
    <div
      data-testid="early-checkin-modal"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "16px",
      }}
    >
      <div
        data-testid="early-checkin-modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: "16px",
          maxWidth: "460px",
          width: "100%",
          padding: "24px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          border: "1px solid var(--da-border)",
          boxSizing: "border-box",
          position: "relative",
          animation: "fadeIn 0.15s ease-out",
        }}
      >
        {/* Top bar with Amber Badge and Close 'X' */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              background: "#FEF3C7",
              color: "#D97706",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>

          <button
            data-testid="early-checkin-modal-close-x"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: "transparent",
              border: "none",
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--da-text-secondary)",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "6px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Header Copy */}
        <h2
          style={{
            fontSize: "20px",
            fontWeight: 800,
            color: "var(--da-brand-dark)",
            margin: "0 0 8px",
            letterSpacing: "-0.02em",
          }}
        >
          Check-In Not Yet Available
        </h2>
        <p
          style={{
            fontSize: "14px",
            color: "var(--da-text-secondary)",
            lineHeight: 1.5,
            margin: "0 0 20px",
          }}
        >
          This reservation cannot be checked in right now because the scheduled booking time has not started yet.
        </p>

        {/* Details Card */}
        <div
          style={{
            background: "var(--da-canvas, #F8FAFC)",
            border: "1px solid var(--da-border, #E2E8F0)",
            borderRadius: "12px",
            padding: "16px",
            marginBottom: "20px",
            display: "grid",
            gap: "12px",
          }}
        >
          {customerName && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
              <span style={{ color: "var(--da-text-secondary)", fontWeight: 600 }}>Guest</span>
              <span style={{ color: "var(--da-brand-dark)", fontWeight: 700 }}>{customerName}</span>
            </div>
          )}

          {referenceCode && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
              <span style={{ color: "var(--da-text-secondary)", fontWeight: 600 }}>Reference</span>
              <span style={{ color: "var(--da-text-primary)", fontWeight: 600, fontFamily: "monospace" }}>
                {referenceCode}
              </span>
            </div>
          )}

          {workspaceName && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
              <span style={{ color: "var(--da-text-secondary)", fontWeight: 600 }}>Workspace</span>
              <span style={{ color: "var(--da-text-primary)", fontWeight: 600 }}>{workspaceName}</span>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", borderTop: "1px solid var(--da-border, #E2E8F0)", paddingTop: "8px" }}>
            <span style={{ color: "var(--da-text-secondary)", fontWeight: 600 }}>Scheduled Slot</span>
            <span style={{ color: "var(--da-brand-dark)", fontWeight: 700 }}>{formattedSchedule}</span>
          </div>
        </div>

        {/* Guidance Notice */}
        <div
          style={{
            background: "#EFF6FF",
            border: "1px solid #BFDBFE",
            borderRadius: "10px",
            padding: "12px 14px",
            fontSize: "13px",
            color: "#1E40AF",
            lineHeight: 1.45,
            marginBottom: "24px",
            display: "flex",
            gap: "10px",
            alignItems: "flex-start",
          }}
        >
          <span style={{ fontSize: "15px", lineHeight: 1 }}>ℹ️</span>
          <div>
            Please advise the guest that check-in will become available once their reserved time begins
            {formattedStartTime ? <> at <strong>{formattedStartTime}</strong> ({formattedStartDate})</> : null}.
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            data-testid="early-checkin-modal-close-button"
            onClick={onClose}
            style={{
              width: "100%",
              padding: "12px",
              background: "var(--da-brand-dark)",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: 700,
              cursor: "pointer",
              transition: "opacity 0.15s ease",
            }}
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}
