"use client";

import React from "react";

export interface UrgentClosureImpactBannerProps {
  impactedCount: number;
  closureDateRange?: string | null;
  closureReason?: string | null;
  onReview?: () => void;
  reviewUrl?: string;
}

export function UrgentClosureImpactBanner({
  impactedCount,
  closureDateRange = "Upcoming Dates",
  closureReason = "Facility Maintenance",
  onReview,
  reviewUrl,
}: UrgentClosureImpactBannerProps) {
  if (impactedCount <= 0) return null;

  const handleReview = () => {
    if (onReview) {
      onReview();
    } else if (reviewUrl && typeof window !== "undefined") {
      window.location.href = reviewUrl;
    }
  };

  return (
    <div
      data-testid="urgent-closure-impact-banner"
      style={{
        background: "#FEF2F2",
        border: "2px solid #EF4444",
        borderRadius: "12px",
        padding: "16px 20px",
        marginBottom: "20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: "0 4px 12px rgba(239, 68, 68, 0.15)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div style={{ fontSize: "24px" }}>🚨</div>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "#991B1B" }}>
            Urgent: {impactedCount} Reservation{impactedCount === 1 ? "" : "s"} Impacted by Facility Closure
          </div>
          <div style={{ fontSize: "13px", color: "#B91C1C", marginTop: "2px" }}>
            Closure scheduled for {closureDateRange || "Upcoming Dates"} ({closureReason || "Facility Maintenance"}). Action required to notify or reallocate customers.
          </div>
        </div>
      </div>
      <button
        onClick={handleReview}
        data-testid="review-impacted-bookings-button"
        style={{
          padding: "9px 18px",
          background: "#DC2626",
          color: "#FFFFFF",
          borderRadius: "8px",
          border: "none",
          fontWeight: 700,
          fontSize: "13px",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Review Impacted Bookings &rarr;
      </button>
    </div>
  );
}
