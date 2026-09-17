"use client";

import { useState } from "react";
import { extractBookingToken, type BookingScanResult } from "@deskatlas/domain";

interface KioskReferenceEntryProps {
  onCancel: () => void;
  onSwitchToScanner?: () => void;
}

function formatBookingTime(isoString?: string): string {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return isoString;
  }
}

export function KioskReferenceEntry({ onCancel, onSwitchToScanner }: KioskReferenceEntryProps) {
  const [referenceInput, setReferenceInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bookingData, setBookingData] = useState<BookingScanResult | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = referenceInput.trim();
    if (!raw) {
      setError("Please enter a booking reference code or reservation ID.");
      return;
    }

    const token = extractBookingToken(raw);
    if (!token) {
      setError("Invalid booking reference code or reservation ID.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/booking/${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Invalid or expired reference code");
      } else {
        setBookingData(data);
      }
    } catch {
      setError("Network error looking up reservation. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setBookingData(null);
    setReferenceInput("");
    setError(null);
    setLoading(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100svh",
        overflow: "hidden",
        background: "#0C3B27",
        display: "flex",
        flexDirection: "column",
        color: "#FFFFFF",
      }}
    >
      <header
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "32px 44px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#C8F451" }}></div>
          <span style={{ fontWeight: 800, fontSize: "26px", color: "#FFFFFF" }}>DeskAtlas</span>
        </div>
        <button
          onClick={onCancel}
          style={{
            fontSize: "20px",
            fontWeight: 700,
            color: "#FFFFFF",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.32)",
            borderRadius: "9999px",
            padding: "14px 28px",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </header>

      <main
        style={{
          flex: 1,
          minHeight: 0,
          padding: "120px 48px 48px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <h1 style={{ fontSize: "44px", fontWeight: 800, color: "#FFFFFF", margin: "0 0 12px", textAlign: "center" }}>
          Enter Reference ID
        </h1>
        <p style={{ fontSize: "18px", color: "rgba(255,255,255,0.75)", margin: "0 0 36px", textAlign: "center" }}>
          Enter your reference code or reservation ID to check in or re-enter
        </p>

        {loading && <div style={{ fontSize: "24px", color: "#FFFFFF", marginBottom: "20px" }}>Looking up booking...</div>}

        {error && (
          <div
            style={{
              background: "#FFEBEE",
              color: "#C62828",
              padding: "20px 32px",
              borderRadius: "16px",
              fontSize: "18px",
              marginBottom: "24px",
              textAlign: "center",
              maxWidth: "540px",
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "8px" }}>{error}</div>
            <button
              onClick={() => setError(null)}
              style={{
                background: "#C62828",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "8px",
                padding: "8px 16px",
                fontSize: "15px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {!bookingData ? (
          <div
            style={{
              background: "#FFFFFF",
              borderRadius: "24px",
              padding: "36px",
              width: "100%",
              maxWidth: "540px",
              boxSizing: "border-box",
              color: "#1E293B",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
          >
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <label
                  htmlFor="referenceInput"
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#475569",
                    marginBottom: "8px",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Reference Code or Reservation ID
                </label>
                <input
                  id="referenceInput"
                  type="text"
                  value={referenceInput}
                  onChange={(e) => {
                    setReferenceInput(e.target.value.toUpperCase());
                    if (error) setError(null);
                  }}
                  placeholder="e.g. DA-2026-01234 or Reservation ID"
                  disabled={loading}
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "18px 20px",
                    fontSize: "20px",
                    fontWeight: 700,
                    fontFamily: "monospace",
                    borderRadius: "14px",
                    border: "2px solid #CBD5E1",
                    outline: "none",
                    boxSizing: "border-box",
                    textAlign: "center",
                    letterSpacing: "0.04em",
                    color: "#0C3B27",
                    background: "#F8FAFC",
                  }}
                />
                <p style={{ fontSize: "13px", color: "#64748B", marginTop: "8px", textAlign: "center" }}>
                  You can find your reference code in your booking confirmation email.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !referenceInput.trim()}
                style={{
                  background: referenceInput.trim() ? "#0C3B27" : "#94A3B8",
                  color: "#C8F451",
                  border: "none",
                  borderRadius: "14px",
                  padding: "18px",
                  fontSize: "20px",
                  fontWeight: 800,
                  cursor: referenceInput.trim() ? "pointer" : "not-allowed",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {loading ? "Checking In..." : "Check In"}
              </button>
            </form>

            {onSwitchToScanner && (
              <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid #E2E8F0", textAlign: "center" }}>
                <button
                  type="button"
                  onClick={onSwitchToScanner}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#0C3B27",
                    fontSize: "15px",
                    fontWeight: 700,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Scan QR Code Instead
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              background: "#FFFFFF",
              borderRadius: "20px",
              padding: "32px",
              width: "100%",
              maxWidth: "600px",
              marginTop: "12px",
              color: "#1E293B",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ fontSize: "28px", fontWeight: 800, color: "#0C3B27", marginBottom: "8px" }}>
              {bookingData.workspaceDisplayName || bookingData.workspaceTemplateName || "Workspace"}
            </div>
            <div style={{ fontSize: "16px", color: "#64748B", marginBottom: "20px" }}>
              Reference: <strong style={{ color: "#0C3B27" }}>{bookingData.referenceCode}</strong>
            </div>

            {bookingData.accessState === "ACTIVE" && !bookingData.reentry && bookingData.checkInState === "CHECKED_IN" && (
              <div
                style={{
                  background: "#DCFCE7",
                  color: "#166534",
                  border: "1px solid #BBF7D0",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: 600,
                  marginBottom: "20px",
                }}
              >
                Checked In: Guest successfully checked in.
              </div>
            )}
            {bookingData.accessState === "ACTIVE" && bookingData.reentry && (
              <div
                style={{
                  background: "#E0F2FE",
                  color: "#0369A1",
                  border: "1px solid #BAE6FD",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: 600,
                  marginBottom: "20px",
                }}
              >
                Active Guest (Re-entry): Guest is currently checked in. Re-entry authorized during active window.
              </div>
            )}
            {bookingData.accessState === "NOT_ACTIVE" && (
              <div
                style={{
                  background: "#FEF3C7",
                  color: "#92400E",
                  border: "1px solid #FDE68A",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: 600,
                  marginBottom: "20px",
                }}
              >
                Too Early: Booking starts at {formatBookingTime(bookingData.bookingStartAt)}. Access is not yet active.
              </div>
            )}
            {bookingData.accessState === "EXPIRED" && (
              <div
                style={{
                  background: "#F1F5F9",
                  color: "#475569",
                  border: "1px solid #E2E8F0",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: 600,
                  marginBottom: "20px",
                }}
              >
                Expired: Booking ended at {formatBookingTime(bookingData.bookingEndAt)}. Access is expired.
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
              <div style={{ background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px" }}>
                <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>Guest</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginTop: "2px" }}>
                  {bookingData.customerName}
                </div>
              </div>
              <div style={{ background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px" }}>
                <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>Spot</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#0C3B27", marginTop: "2px" }}>
                  {bookingData.workspaceDisplayName || bookingData.workspaceInstanceCode || "Assigned Spot"}
                </div>
              </div>
              <div style={{ background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px" }}>
                <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>Start Time</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginTop: "2px" }}>
                  {formatBookingTime(bookingData.bookingStartAt)}
                </div>
              </div>
              <div style={{ background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px" }}>
                <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>End Time</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginTop: "2px" }}>
                  {formatBookingTime(bookingData.bookingEndAt)}
                </div>
              </div>
              <div style={{ background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px" }}>
                <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>Access State</div>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: bookingData.accessState === "ACTIVE" ? "#16A34A" : "#D97706",
                    marginTop: "2px",
                  }}
                >
                  {bookingData.accessState}
                </div>
              </div>
              <div style={{ background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px" }}>
                <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>Check-In</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginTop: "2px" }}>
                  {bookingData.checkInState || "CONFIRMED"}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={handleReset}
                style={{
                  flex: 1,
                  background: "rgba(12, 59, 39, 0.08)",
                  color: "#0C3B27",
                  border: "none",
                  padding: "16px",
                  borderRadius: "12px",
                  fontSize: "18px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Check Another
              </button>
              <button
                onClick={onCancel}
                style={{
                  flex: 1,
                  background: "#0C3B27",
                  color: "#fff",
                  border: "none",
                  padding: "16px",
                  borderRadius: "12px",
                  fontSize: "18px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
