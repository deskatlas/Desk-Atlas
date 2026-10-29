"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import jsQR from "jsqr";
import { Search, Camera, AlertCircle, CheckCircle2, User, MapPin, Tag } from "lucide-react";
import { type BookingScanResult, extractBookingToken } from "@deskatlas/domain";

interface VideoDeviceOption {
  deviceId: string;
  label: string;
}

function checkIsMobileOrTablet(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isIPadOS = /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return isMobileUA || isIPadOS;
}

interface BookingLookupCardProps {
  onVerifiedBookingSelected: (booking: BookingScanResult) => void;
  onClearBooking?: () => void;
  actorRole?: "STAFF" | "ADMIN";
  staffUserId?: string | null;
}

export function BookingLookupCard({
  onVerifiedBookingSelected,
  onClearBooking,
  actorRole = "STAFF",
  staffUserId,
}: BookingLookupCardProps) {
  const [inputCode, setInputCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [verifiedBooking, setVerifiedBooking] = useState<BookingScanResult | null>(null);

  // Scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isMobileOrTablet, setIsMobileOrTablet] = useState<boolean>(() => checkIsMobileOrTablet());
  const [cameraFacingMode, setCameraFacingMode] = useState<"environment" | "user">(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("desk_atlas_staff_camera_facing");
        if (saved === "user" || saved === "environment") return saved;
      } catch {}
    }
    return "environment";
  });
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem("desk_atlas_staff_camera_device_id") || "";
      } catch {}
    }
    return "";
  });
  const [videoDevices, setVideoDevices] = useState<VideoDeviceOption[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsMobileOrTablet(checkIsMobileOrTablet());
    }
  }, []);

  const stopStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  const handleCameraChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMode = e.target.value as "environment" | "user";
    stopStream();
    setCameraFacingMode(newMode);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("desk_atlas_staff_camera_facing", newMode);
      } catch {}
    }
  };

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDeviceId = e.target.value;
    stopStream();
    setSelectedDeviceId(newDeviceId);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("desk_atlas_staff_camera_device_id", newDeviceId);
      } catch {}
    }
  };

  const handleLookup = async (tokenOrCode: string) => {
    const raw = tokenOrCode.trim();
    if (!raw) return;

    setLoading(true);
    setErrorMsg(null);
    setWarningMsg(null);
    setVerifiedBooking(null);
    if (onClearBooking) onClearBooking();

    try {
      const token = extractBookingToken(raw) || raw;
      const queryParams = new URLSearchParams();
      if (staffUserId) {
        queryParams.set("actorUserId", staffUserId);
        queryParams.set("actorRole", actorRole);
      }
      const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";
      const res = await fetch(`/api/booking/${encodeURIComponent(token)}${queryString}`, {
        headers: {
          ...(staffUserId ? {
            "x-actor-user-id": staffUserId,
            "x-actor-role": actorRole,
            "x-user-id": staffUserId,
            "x-user-role": actorRole,
          } : {}),
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Reservation not found");
      }

      const booking: BookingScanResult = await res.json();

      // Invariant: Customer must have an active checked-in or confirmed booking
      const isActive =
        booking.reservationStatus === "CHECKED_IN" ||
        booking.reservationStatus === "CONFIRMED";

      if (!isActive) {
        setWarningMsg(
          "Customer does not have an active checked-in booking. Rentals require an in-progress workspace session."
        );
        return;
      }

      setVerifiedBooking(booking);
      if (cameraActive) {
        stopStream();
        setCameraActive(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to lookup customer booking";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // Video scanning loop matching ScannerPage pattern
  useEffect(() => {
    if (!cameraActive) {
      stopStream();
      return;
    }

    let requestAnimationFrameId: number;
    let localStream: MediaStream | null = null;
    let isMounted = true;

    const startVideo = async () => {
      try {
        setCameraError(null);
        if (isMobileOrTablet) {
          try {
            localStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: cameraFacingMode },
            });
          } catch {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true });
          }
        } else {
          const constraints: MediaStreamConstraints = selectedDeviceId
            ? { video: { deviceId: { exact: selectedDeviceId } } }
            : { video: true };
          try {
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
          } catch {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true });
          }
        }

        if (!isMounted) {
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }

        setStream(localStream);

        // Enumerate devices on PC/laptop
        if (!isMobileOrTablet && navigator.mediaDevices?.enumerateDevices) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices
              .filter((d) => d.kind === "videoinput")
              .map((d, index) => ({
                deviceId: d.deviceId,
                label: d.label || `Camera ${index + 1}`,
              }));
            setVideoDevices(videoInputs);

            const activeDeviceId = localStream.getVideoTracks()[0]?.getSettings()?.deviceId;
            if (activeDeviceId && (!selectedDeviceId || !videoInputs.some((v) => v.deviceId === selectedDeviceId))) {
              setSelectedDeviceId(activeDeviceId);
              try {
                localStorage.setItem("desk_atlas_staff_camera_device_id", activeDeviceId);
              } catch {}
            }
          } catch (enumErr) {
            console.warn("Could not enumerate video devices:", enumErr);
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.play().catch(() => {});
          requestAnimationFrameId = requestAnimationFrame(tick);
        }
      } catch (err) {
        if (isMounted) {
          console.error("Error accessing camera:", err);
          setCameraError("Unable to access the camera. Please check permissions or select another camera.");
        }
      }
    };

    const tick = () => {
      if (
        videoRef.current &&
        canvasRef.current &&
        videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA
      ) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { willReadFrequently: true });

        if (context) {
          canvas.height = video.videoHeight;
          canvas.width = video.videoWidth;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code && code.data) {
            setCameraActive(false);
            setInputCode(code.data);
            handleLookup(code.data);
            return;
          }
        }
      }
      if (isMounted) {
        requestAnimationFrameId = requestAnimationFrame(tick);
      }
    };

    startVideo();

    return () => {
      isMounted = false;
      if (requestAnimationFrameId) cancelAnimationFrame(requestAnimationFrameId);
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
    };
  }, [cameraActive, cameraFacingMode, selectedDeviceId, isMobileOrTablet]);

  const toggleCamera = () => {
    setCameraActive((prev) => !prev);
    setErrorMsg(null);
    setCameraError(null);
  };

  return (
    <div
      data-testid="booking-lookup-card"
      style={{
        background: "#ffffff",
        border: "1px solid var(--da-border)",
        borderRadius: "14px",
        padding: "20px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        marginBottom: "24px",
      }}
    >
      <div style={{ marginBottom: "14px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 800, color: "var(--da-text-primary)", margin: 0 }}>
          Verify Active Workspace Booking
        </h2>
        <p style={{ fontSize: "12px", color: "var(--da-text-secondary)", marginTop: "4px", margin: 0 }}>
          Equipment checkout strictly requires an active, checked-in workspace reservation.
        </p>
      </div>

      {/* Input Bar */}
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "var(--da-canvas)",
            border: "1px solid var(--da-border)",
            borderRadius: "10px",
            padding: "8px 14px",
          }}
        >
          <Search size={16} color="var(--da-text-secondary)" />
          <input
            data-testid="booking-lookup-input"
            aria-label="Customer Booking Reference / Pass QR"
            placeholder="Customer Booking Reference / Pass QR"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleLookup(inputCode);
              }
            }}
            style={{
              border: "none",
              background: "transparent",
              outline: "none",
              fontSize: "14px",
              flex: 1,
              color: "var(--da-text-primary)",
            }}
          />
        </div>

        <button
          type="button"
          data-testid="toggle-qr-scanner-btn"
          onClick={toggleCamera}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "10px 14px",
            background: cameraActive ? "#FEE2E2" : "#F1F5F9",
            color: cameraActive ? "#DC2626" : "var(--da-text-primary)",
            border: "1px solid var(--da-border)",
            borderRadius: "10px",
            fontSize: "13px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <Camera size={16} />
          <span>{cameraActive ? "Close Camera" : "Scan QR"}</span>
        </button>

        <button
          type="button"
          data-testid="lookup-booking-submit-btn"
          disabled={loading || !inputCode.trim()}
          onClick={() => handleLookup(inputCode)}
          style={{
            padding: "10px 18px",
            background: "var(--da-primary)",
            color: "#ffffff",
            border: "none",
            borderRadius: "10px",
            fontSize: "13px",
            fontWeight: 700,
            cursor: loading || !inputCode.trim() ? "not-allowed" : "pointer",
            opacity: loading || !inputCode.trim() ? 0.6 : 1,
          }}
        >
          {loading ? "Verifying..." : "Lookup Booking"}
        </button>
      </div>

      {/* Video element for QR scanner */}
      {cameraActive && (
        <div
          style={{
            marginTop: "16px",
            padding: "16px",
            background: "#F8FAFC",
            border: "1px solid var(--da-border)",
            borderRadius: "14px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: "360px",
              aspectRatio: "1/1",
              background: "#000",
              borderRadius: "14px",
              overflow: "hidden",
            }}
          >
            <video
              ref={videoRef}
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            <canvas ref={canvasRef} style={{ display: "none" }} />
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  width: "180px",
                  height: "180px",
                  border: "2px solid var(--da-accent)",
                  borderRadius: "12px",
                  boxShadow: "0 0 0 4000px rgba(0,0,0,0.4)",
                }}
              />
            </div>
          </div>

          <div style={{ marginTop: "12px", fontSize: "13px", color: "var(--da-text-secondary)", textAlign: "center" }}>
            Align customer QR pass within the camera frame
          </div>

          {/* Camera Selector Dropdown */}
          <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
            <label
              htmlFor="rental-camera-select"
              style={{ fontSize: "12px", fontWeight: 600, color: "var(--da-text-secondary)" }}
            >
              Camera:
            </label>
            {isMobileOrTablet ? (
              <select
                id="rental-camera-select"
                value={cameraFacingMode}
                onChange={handleCameraChange}
                style={{
                  borderRadius: "8px",
                  border: "1px solid var(--da-border)",
                  padding: "5px 10px",
                  fontSize: "12px",
                  background: "#fff",
                  color: "var(--da-brand-dark)",
                  fontWeight: 600,
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                <option value="environment">Back Camera (Rear)</option>
                <option value="user">Front Camera (Selfie / Desk)</option>
              </select>
            ) : (
              <select
                id="rental-camera-select"
                value={selectedDeviceId}
                onChange={handleDeviceChange}
                style={{
                  borderRadius: "8px",
                  border: "1px solid var(--da-border)",
                  padding: "5px 10px",
                  fontSize: "12px",
                  background: "#fff",
                  color: "var(--da-brand-dark)",
                  fontWeight: 600,
                  cursor: "pointer",
                  outline: "none",
                  maxWidth: "240px",
                }}
              >
                {videoDevices.length > 0 ? (
                  videoDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))
                ) : (
                  <option value="">Default Camera</option>
                )}
              </select>
            )}
          </div>

          {cameraError && (
            <div
              style={{
                marginTop: "10px",
                fontSize: "12px",
                color: "#DC2626",
                textAlign: "center",
              }}
            >
              {cameraError}
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {errorMsg && (
        <div
          data-testid="booking-lookup-error"
          style={{
            marginTop: "14px",
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

      {/* Warning State: Inactive / Unverified Booking */}
      {warningMsg && (
        <div
          data-testid="booking-lookup-warning"
          style={{
            marginTop: "14px",
            padding: "12px 16px",
            background: "#FFFBEB",
            border: "1.5px solid #FDE68A",
            borderRadius: "10px",
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            fontSize: "13px",
            color: "#92400E",
          }}
        >
          <AlertCircle size={18} color="#D97706" style={{ flexShrink: 0, marginTop: "2px" }} />
          <div>
            <strong>Rental Locked:</strong> {warningMsg}
          </div>
        </div>
      )}

      {/* Verified Active Booking Card */}
      {verifiedBooking && (
        <div
          data-testid="verified-booking-summary"
          style={{
            marginTop: "16px",
            padding: "16px",
            background: "#F0FDF4",
            border: "1.5px solid #BBF7D0",
            borderRadius: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <CheckCircle2 size={18} color="#16A34A" />
              <span style={{ fontSize: "14px", fontWeight: 800, color: "#166534" }}>
                Active Booking Verified
              </span>
            </div>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                padding: "3px 8px",
                background: "#DCFCE7",
                color: "#15803D",
                borderRadius: "6px",
              }}
            >
              Checked In
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "12px",
              fontSize: "13px",
            }}
          >
            <div>
              <div style={{ fontSize: "11px", color: "var(--da-text-secondary)", display: "flex", alignItems: "center", gap: "4px" }}>
                <User size={12} /> Customer Name
              </div>
              <strong data-testid="verified-customer-name" style={{ color: "var(--da-text-primary)" }}>
                {verifiedBooking.customerName}
              </strong>
            </div>

            <div>
              <div style={{ fontSize: "11px", color: "var(--da-text-secondary)", display: "flex", alignItems: "center", gap: "4px" }}>
                <Tag size={12} /> Booking Reference
              </div>
              <strong data-testid="verified-reference-code" style={{ color: "var(--da-text-primary)" }}>
                {verifiedBooking.referenceCode}
              </strong>
            </div>

            <div>
              <div style={{ fontSize: "11px", color: "var(--da-text-secondary)", display: "flex", alignItems: "center", gap: "4px" }}>
                <MapPin size={12} /> Assigned Workspace Spot
              </div>
              <strong data-testid="verified-spot-name" style={{ color: "var(--da-text-primary)" }}>
                {verifiedBooking.workspaceDisplayName || verifiedBooking.workspaceInstanceCode}
              </strong>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
            <button
              type="button"
              data-testid="assign-rental-btn"
              onClick={() => onVerifiedBookingSelected(verifiedBooking)}
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
              Assign Rental Item
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

