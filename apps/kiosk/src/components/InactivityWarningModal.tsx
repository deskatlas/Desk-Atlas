"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface InactivityWarningModalProps {
  isOpen: boolean;
  remainingSeconds: number;
  onStay: () => void;
}

export function InactivityWarningModal({
  isOpen,
  remainingSeconds,
  onStay,
}: InactivityWarningModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inactivity-warning-title"
      aria-describedby="inactivity-warning-description"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100vh",
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 2147483647, // Maximum safe z-index to render above all layers
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        boxSizing: "border-box",
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "32rem",
          borderRadius: "1.75rem",
          backgroundColor: "#ffffff",
          padding: "2.5rem 2rem",
          textAlign: "center",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          border: "4px solid #0C3B27",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          color: "#0C3B27",
          boxSizing: "border-box",
        }}
      >
        {/* Visual Pulse / Countdown Circle */}
        <div
          style={{
            marginBottom: "1.5rem",
            display: "flex",
            height: "6rem",
            width: "6rem",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "9999px",
            backgroundColor: "#ecfdf5",
            border: "4px solid #10b981",
            boxShadow: "inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)",
          }}
        >
          <span
            data-testid="kiosk-inactivity-countdown"
            style={{
              fontSize: "3rem",
              fontWeight: 900,
              color: "#0C3B27",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {remainingSeconds}
          </span>
        </div>

        {/* Heading */}
        <h2
          id="inactivity-warning-title"
          style={{
            fontSize: "2rem",
            fontWeight: 800,
            color: "#0C3B27",
            letterSpacing: "-0.025em",
            margin: "0 0 0.5rem 0",
            lineHeight: 1.2,
          }}
        >
          Are you still there?
        </h2>

        {/* Subtext */}
        <p
          id="inactivity-warning-description"
          style={{
            marginTop: "0.5rem",
            fontSize: "1.125rem",
            fontWeight: 500,
            color: "#475569",
            maxWidth: "24rem",
            lineHeight: 1.5,
            margin: "0.5rem 0 0 0",
          }}
        >
          This session will reset in{" "}
          <strong style={{ color: "#0C3B27", fontWeight: 700 }}>
            {remainingSeconds} second{remainingSeconds === 1 ? "" : "s"}
          </strong>
          .
        </p>

        {/* Action Button */}
        <div style={{ marginTop: "2rem", width: "100%" }}>
          <button
            type="button"
            data-testid="kiosk-inactivity-stay-btn"
            onClick={(e) => {
              e.stopPropagation();
              onStay();
            }}
            style={{
              width: "100%",
              padding: "1rem 1.5rem",
              fontSize: "1.25rem",
              fontWeight: 700,
              color: "#ffffff",
              backgroundColor: "#0C3B27",
              borderRadius: "1rem",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.2)",
              transition: "transform 0.1s ease, background-color 0.15s ease",
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = "scale(0.98)";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            Yes, I&apos;m here
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
