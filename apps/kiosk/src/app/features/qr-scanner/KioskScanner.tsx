"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { extractBookingToken, type BookingScanResult } from "@deskatlas/domain";

interface KioskScannerProps {
  onCancel: () => void;
  onSwitchToReference?: () => void;
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

export function KioskScanner({ onCancel, onSwitchToReference }: KioskScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bookingData, setBookingData] = useState<BookingScanResult | null>(null);
  const scannerInstanceRef = useRef<Html5Qrcode | null>(null);
  const isScanningRef = useRef(false);

  const [isScanning, setIsScanning] = useState(true);

  const startScanner = async () => {
    if (scannerInstanceRef.current?.isScanning) {
      return;
    }

    try {
      // Clear element DOM safely before starting
      const element = document.getElementById("reader");
      if (element) {
        element.innerHTML = "";
      }

      const html5QrCode = new Html5Qrcode("reader");
      scannerInstanceRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "user" },
        { 
          fps: 15,
          aspectRatio: 1.0,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const qrboxSize = Math.max(200, Math.floor(minEdge * 0.75));
            return { width: qrboxSize, height: qrboxSize };
          },
        },
        async (decodedText) => {
          // Stop scanner immediately on hit
          try {
            if (html5QrCode.isScanning) {
              await html5QrCode.stop();
            }
          } catch {
            // ignore
          }

          setIsScanning(false);
          const token = extractBookingToken(decodedText);
          if (!token) {
            setError("Invalid booking QR token.");
            return;
          }

          setLoading(true);
          try {
            const res = await fetch(`/api/booking/${encodeURIComponent(token)}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              setError(data.error || "Invalid or expired token");
            } else {
              setBookingData(data);
            }
          } catch (err) {
            setError("Network error looking up token");
          } finally {
            setLoading(false);
          }
        },
        () => {} // ignore normal read failures (no qr found)
      );

      isScanningRef.current = true;
    } catch (err: any) {
      if (err?.name === "AbortError" || String(err?.message || "").includes("play()")) {
        return;
      }
      console.error("Scanner failed to start", err);
      setError("Failed to access camera");
      setIsScanning(false);
    }
  };

  const handleRestart = () => {
    setError(null);
    setBookingData(null);
    setLoading(false);
    setIsScanning(true);
    setTimeout(() => {
      startScanner();
    }, 50);
  };

  useEffect(() => {
    startScanner();

    return () => {
      if (scannerInstanceRef.current) {
        try {
          if (scannerInstanceRef.current.isScanning) {
            scannerInstanceRef.current.stop().catch(() => {});
          }
        } catch {
          // ignore
        }
        try {
          scannerInstanceRef.current.clear();
        } catch {
          // ignore
        }
        scannerInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      width: "100vw",
      height: "100svh",
      overflow: "hidden",
      background: "#0C3B27",
      display: "flex",
      flexDirection: "column",
      color: "#FFFFFF"
    }}>
      <header style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 2,
        display: "flex", alignItems: "center", justifyContent: "space-between", 
        padding: "32px 44px", boxSizing: "border-box"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#C8F451" }}></div>
          <span style={{ fontWeight: 800, fontSize: "26px", color: "#FFFFFF" }}>DeskAtlas</span>
        </div>
        <button onClick={onCancel} style={{
          fontSize: "20px", fontWeight: 700, color: "#FFFFFF", background: "rgba(255,255,255,0.08)", 
          border: "1px solid rgba(255,255,255,0.32)", borderRadius: "9999px", padding: "14px 28px", cursor: "pointer"
        }}>
          Close
        </button>
      </header>

      <main style={{
        flex: 1,
        minHeight: 0,
        padding: "120px 48px 48px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <h1 style={{ fontSize: "44px", fontWeight: 800, color: "#FFFFFF", margin: "0 0 40px" }}>
          Scan Booking QR
        </h1>
        
        {loading && <div style={{ fontSize: "24px", color: "#FFFFFF" }}>Looking up booking...</div>}
        
        {error && (
          <div style={{ background: "#FFEBEE", color: "#C62828", padding: "24px 32px", borderRadius: "16px", fontSize: "22px", marginBottom: "20px", textAlign: "center", maxWidth: "600px" }}>
            <div style={{ marginBottom: "16px", fontWeight: 700 }}>{error}</div>
            <button 
              onClick={handleRestart} 
              style={{ background: "#C62828", color: "#FFFFFF", border: "none", borderRadius: "8px", padding: "12px 24px", fontSize: "18px", fontWeight: 700, cursor: "pointer" }}
            >
              Retry
            </button>
          </div>
        )}

        {bookingData && (
          <div style={{ background: "#FFFFFF", borderRadius: "18px", padding: "32px", width: "100%", maxWidth: "600px", marginTop: "24px", color: "#1E293B" }}>
            <div style={{ fontSize: "28px", fontWeight: 800, color: "#0C3B27", marginBottom: "8px" }}>
              {bookingData.workspaceDisplayName || bookingData.workspaceTemplateName || "Workspace"}
            </div>
            <div style={{ fontSize: "16px", color: "#64748B", marginBottom: "20px" }}>
              Reference: <strong style={{ color: "#0C3B27" }}>{bookingData.referenceCode}</strong>
            </div>

            {bookingData.accessState === "ACTIVE" && !bookingData.reentry && bookingData.checkInState === "CHECKED_IN" && (
              <div style={{ background: "#DCFCE7", color: "#166534", border: "1px solid #BBF7D0", padding: "12px 16px", borderRadius: "12px", fontSize: "15px", fontWeight: 600, marginBottom: "20px" }}>
                Checked In: Guest successfully checked in.
              </div>
            )}
            {bookingData.accessState === "ACTIVE" && bookingData.reentry && (
              <div style={{ background: "#E0F2FE", color: "#0369A1", border: "1px solid #BAE6FD", padding: "12px 16px", borderRadius: "12px", fontSize: "15px", fontWeight: 600, marginBottom: "20px" }}>
                Active Guest (Re-entry): Guest is currently checked in. Re-entry authorized during active window.
              </div>
            )}
            {bookingData.accessState === "NOT_ACTIVE" && (
              <div style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A", padding: "12px 16px", borderRadius: "12px", fontSize: "15px", fontWeight: 600, marginBottom: "20px" }}>
                Too Early: Booking starts at {formatBookingTime(bookingData.bookingStartAt)}. Access is not yet active.
              </div>
            )}
            {bookingData.accessState === "EXPIRED" && (
              <div style={{ background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0", padding: "12px 16px", borderRadius: "12px", fontSize: "15px", fontWeight: 600, marginBottom: "20px" }}>
                Expired: Booking ended at {formatBookingTime(bookingData.bookingEndAt)}. Access is expired.
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
              <div style={{ background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px" }}>
                <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>Guest</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginTop: "2px" }}>{bookingData.customerName}</div>
              </div>
              <div style={{ background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px" }}>
                <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>Spot</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#0C3B27", marginTop: "2px" }}>{bookingData.workspaceDisplayName || bookingData.workspaceInstanceCode || "Assigned Spot"}</div>
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
                <div style={{ fontSize: "16px", fontWeight: 700, color: bookingData.accessState === "ACTIVE" ? "#16A34A" : "#D97706", marginTop: "2px" }}>
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
                onClick={handleRestart}
                style={{ flex: 1, background: "rgba(12, 59, 39, 0.08)", color: "#0C3B27", border: "none", padding: "16px", borderRadius: "12px", fontSize: "18px", fontWeight: 700, cursor: "pointer" }}
              >
                Scan Another
              </button>
              <button 
                onClick={onCancel}
                style={{ flex: 1, background: "#0C3B27", color: "#fff", border: "none", padding: "16px", borderRadius: "12px", fontSize: "18px", fontWeight: 700, cursor: "pointer" }}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Scanner container, hide if we have result or error */}
        <div 
          id="reader" 
          style={{ 
            position: "relative",
            width: "min(500px, calc(100vw - 96px), calc(100svh - 260px))", 
            aspectRatio: "1 / 1",
            background: "#000",
            display: (bookingData || error || loading) ? "none" : "block",
            borderRadius: "24px",
            overflow: "hidden"
          }}
        ></div>

        {onSwitchToReference && !bookingData && !error && !loading && (
          <button
            type="button"
            onClick={onSwitchToReference}
            style={{
              marginTop: "24px",
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.3)",
              color: "#FFFFFF",
              padding: "14px 28px",
              borderRadius: "9999px",
              fontSize: "16px",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              backdropFilter: "blur(4px)"
            }}
          >
            Enter Reference Code or ID Instead
          </button>
        )}

        <style>{`
          #reader {
            position: relative !important;
            overflow: hidden !important;
          }
          #reader video {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            border-radius: 24px !important;
          }
          #reader canvas {
            display: none !important;
          }
          #reader__scan_region {
            width: 100% !important;
            height: 100% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          #reader__scan_region video {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
          }
          #reader__dashboard_section {
            display: none !important;
          }
        `}</style>
      </main>
    </div>
  );
}

