"use client";

import React, { useEffect, useRef } from "react";

export interface DeactivatedAccountModalProps {
  isOpen: boolean;
  onReturnToLogin?: () => void;
  loginUrl?: string;
  className?: string;
  style?: React.CSSProperties;
}

function ShieldAlertIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#DC2626"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function DeactivatedAccountModal({
  isOpen,
  onReturnToLogin,
  loginUrl,
  className,
  style,
}: DeactivatedAccountModalProps) {
  const returnBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Focus the return to login button on appearance
    returnBtnRef.current?.focus();

    // Prevent scrolling on body
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Strictly intercept and prevent Escape key dismissal
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.keyCode === 27) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleReturnClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onReturnToLogin) {
      onReturnToLogin();
    } else if (loginUrl && typeof window !== "undefined") {
      window.location.href = loginUrl;
    }
  };

  return (
    <div
      data-testid="deactivated-account-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deactivated-modal-title"
      aria-describedby="deactivated-modal-description"
      className={className}
      onClick={(e) => {
        // Prevent dismissal on overlay clicks
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        backgroundColor: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        cursor: "default",
        ...style,
      }}
    >
      <div
        data-testid="deactivated-account-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "460px",
          background: "#ffffff",
          borderRadius: "16px",
          padding: "32px 28px",
          boxShadow:
            "0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.05)",
          textAlign: "center",
          fontFamily: "var(--da-font-family, 'Inter', -apple-system, BlinkMacSystemFont, sans-serif)",
          boxSizing: "border-box",
        }}
      >
        {/* Shield Alert Icon Circle */}
        <div
          data-testid="deactivated-modal-icon"
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            backgroundColor: "#FEE2E2",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px auto",
          }}
        >
          <ShieldAlertIcon />
        </div>

        {/* Headline */}
        <h2
          id="deactivated-modal-title"
          data-testid="deactivated-modal-headline"
          style={{
            fontSize: "20px",
            fontWeight: 800,
            color: "var(--da-text-primary, #0f172a)",
            margin: "0 0 12px 0",
            lineHeight: 1.3,
            letterSpacing: "-0.01em",
          }}
        >
          Account Deactivated
        </h2>

        {/* Professional Body Copy */}
        <p
          id="deactivated-modal-description"
          data-testid="deactivated-modal-message"
          style={{
            fontSize: "14px",
            color: "var(--da-text-secondary, #475569)",
            lineHeight: 1.6,
            margin: "0 0 28px 0",
          }}
        >
          Your account has been deactivated by an administrator. Your active
          session has ended. If you believe this is an error or need your access
          restored, please contact your workspace administrator.
        </p>

        {/* Return to Login Action Button */}
        <button
          ref={returnBtnRef}
          type="button"
          data-testid="return-to-login-btn"
          onClick={handleReturnClick}
          style={{
            width: "100%",
            padding: "13px 20px",
            background: "linear-gradient(0deg, var(--da-brand-dark, #0f172a) 70%, #154A32)",
            color: "#ffffff",
            border: "none",
            borderRadius: "10px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: "pointer",
            outline: "none",
            boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
            transition: "opacity 0.15s ease, transform 0.1s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "0.92";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
        >
          Return to Login
        </button>
      </div>
    </div>
  );
}
