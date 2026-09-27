"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import type {
  AdminDashboardRange,
  OccupancySummary,
  WorkspaceUsageRecord,
  WorkspaceUsageSortField,
  WorkspaceUsageSortDirection,
  BookingEndAlert,
} from "@deskatlas/domain";
import { format } from "date-fns";
import { Clock, AlertTriangle, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { ExtendReservationModal } from "../../reservations/components/ExtendReservationModal";

export interface WorkspaceOverviewProps {
  range: AdminDashboardRange;
  floorLabel: string;
  occupancyBar: {
    availablePct: number;
    inUsePct: number;
    reservedPct: number;
    maintenancePct: number;
  };
  occupancy: Array<{
    label: string;
    value: string;
    swatch: { background: string };
  }>;
  occupancySummary?: OccupancySummary | null;
}

export function WorkspaceOverview({
  range,
  floorLabel,
  occupancyBar,
  occupancy,
  occupancySummary,
}: WorkspaceOverviewProps) {
  const [topWorkspaces, setTopWorkspaces] = useState<WorkspaceUsageRecord[]>([]);
  const [loadingTop, setLoadingTop] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Near Checkout Triage State (MS-13)
  const [nearCheckoutAlerts, setNearCheckoutAlerts] = useState<BookingEndAlert[]>([]);
  const [nearCheckoutThreshold, setNearCheckoutThreshold] = useState<number>(15);
  const [isTriageModalOpen, setIsTriageModalOpen] = useState<boolean>(false);
  const [selectedExtendAlert, setSelectedExtendAlert] = useState<BookingEndAlert | null>(null);
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);
  const [triageFeedback, setTriageFeedback] = useState<string | null>(null);

  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceUsageRecord[]>([]);
  const [loadingAll, setLoadingAll] = useState<boolean>(false);
  const [allError, setAllError] = useState<string | null>(null);

  const [sortField, setSortField] = useState<WorkspaceUsageSortField>("bookings");
  const [sortDirection, setSortDirection] = useState<WorkspaceUsageSortDirection>("desc");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const currentOccupancy: OccupancySummary = occupancySummary ?? {
    occupiedCount: 0,
    totalActiveInstances: 0,
    occupancyRate: 0,
    checkedInCount: 0,
    inWindowCount: 0,
  };

  const getOccupancyIndicatorStyles = (rate: number) => {
    if (rate >= 90) {
      return {
        bg: "#FEF2F2",
        border: "#FECDD3",
        text: "#991B1B",
        dot: "#DC2626",
        badgeBg: "#FEE2E2",
      };
    }
    if (rate >= 75) {
      return {
        bg: "#FFFBEB",
        border: "#FDE68A",
        text: "#92400E",
        dot: "#D97706",
        badgeBg: "#FEF3C7",
      };
    }
    return {
      bg: "#F0FDF4",
      border: "#BBF7D0",
      text: "#166534",
      dot: "#16A34A",
      badgeBg: "#DCFCE7",
    };
  };

  const indicatorStyle = getOccupancyIndicatorStyles(currentOccupancy.occupancyRate);

  // Fetch near-checkout reservations for real-time proximity monitoring (MS-13)
  const fetchNearCheckout = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/reservations/near-checkout", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.reservations || json.alerts)) {
          setNearCheckoutAlerts(json.reservations || json.alerts);
        }
        if (typeof json.thresholdMinutes === "number") {
          setNearCheckoutThreshold(json.thresholdMinutes);
        }
      }
    } catch {
      // Background poll failure silent recovery
    }
  }, []);

  useEffect(() => {
    fetchNearCheckout();
    const interval = setInterval(fetchNearCheckout, 30000);
    return () => clearInterval(interval);
  }, [fetchNearCheckout]);

  const handleOperationalCheckout = useCallback(
    async (alert: BookingEndAlert) => {
      try {
        setCheckingOutId(alert.reservationId);
        const res = await fetch(
          `/api/admin/reservations/${encodeURIComponent(alert.reservationId)}/checkout`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actedAt: new Date().toISOString() }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to checkout reservation");
        }

        setTriageFeedback(`Successfully checked out ${alert.customerName} (${alert.spotName})`);
        setTimeout(() => setTriageFeedback(null), 4000);
        await fetchNearCheckout();
      } catch (err) {
        console.error("Admin triage checkout error:", err);
      } finally {
        setCheckingOutId(null);
      }
    },
    [fetchNearCheckout]
  );

  // Fetch all workspaces when modal opens or range changes
  useEffect(() => {
    if (!isModalOpen) return;

    let isCancelled = false;
    setLoadingAll(true);
    setAllError(null);

    fetch(`/api/admin/workspace-usage?limit=all&range=${range}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load workspace usage records");
        return res.json();
      })
      .then((records: WorkspaceUsageRecord[]) => {
        if (!isCancelled) {
          setAllWorkspaces(records);
          setLoadingAll(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setAllError(err instanceof Error ? err.message : "Error loading data");
          setLoadingAll(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isModalOpen, range]);

  const handleSortToggle = (field: WorkspaceUsageSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const filteredAndSortedAll = useMemo(() => {
    let list = [...allWorkspaces];

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (item) =>
          item.instanceName.toLowerCase().includes(term) ||
          item.templateName.toLowerCase().includes(term) ||
          item.templateTier.toLowerCase().includes(term)
      );
    }

    const factor = sortDirection === "asc" ? 1 : -1;

    list.sort((a, b) => {
      if (sortField === "bookings") {
        if (a.totalBookings !== b.totalBookings) {
          return (a.totalBookings - b.totalBookings) * factor;
        }
        return (a.totalHoursBooked - b.totalHoursBooked) * factor;
      }
      if (sortField === "hours") {
        if (a.totalHoursBooked !== b.totalHoursBooked) {
          return (a.totalHoursBooked - b.totalHoursBooked) * factor;
        }
        return (a.totalBookings - b.totalBookings) * factor;
      }
      if (sortField === "lastBooked") {
        const aTime = a.lastBookedAt ? new Date(a.lastBookedAt).getTime() : 0;
        const bTime = b.lastBookedAt ? new Date(b.lastBookedAt).getTime() : 0;
        if (aTime !== bTime) {
          return (aTime - bTime) * factor;
        }
        return (a.totalBookings - b.totalBookings) * factor;
      }
      if (sortField === "name") {
        return a.instanceName.localeCompare(b.instanceName) * factor;
      }
      return 0;
    });

    return list;
  }, [allWorkspaces, searchTerm, sortField, sortDirection]);

  return (
    <>
      <div
        style={{
          flex: 1,
          minWidth: "280px",
          background: "#fff",
          border: "1px solid var(--da-border)",
          borderRadius: "14px",
          padding: "20px",
          boxShadow: "var(--da-shadow-sm)",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        {/* Workspace Overview Section */}
        <div>
          <h3 style={{ fontSize: "15px", fontWeight: 800, color: "var(--da-text-primary)", margin: "0 0 4px" }}>
            Workspace Overview
          </h3>
          <div style={{ fontSize: "11px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)", marginBottom: "16px" }}>
            {floorLabel}
          </div>

          {/* Currently Occupied Real-Time Monitoring Stat Block */}
          <div
            data-testid="currently-occupied-card"
            style={{
              padding: "14px 16px",
              borderRadius: "12px",
              background: indicatorStyle.bg,
              border: `1px solid ${indicatorStyle.border}`,
              marginBottom: "16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: indicatorStyle.text, textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: indicatorStyle.dot, display: "inline-block" }}></span>
                Currently Occupied
              </span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: indicatorStyle.text, background: indicatorStyle.badgeBg, padding: "2px 8px", borderRadius: "9999px" }}>
                {currentOccupancy.occupancyRate}% Capacity
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "8px" }}>
              <span style={{ fontSize: "28px", fontWeight: 800, color: "var(--da-brand-dark)", lineHeight: 1 }}>
                {currentOccupancy.occupiedCount}
              </span>
              <span style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)" }}>
                of {currentOccupancy.totalActiveInstances} workspaces occupied
              </span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: "6px",
                  background: "#ECFDF5",
                  color: "#065F46",
                  border: "1px solid #A7F3D0",
                }}
              >
                ✓ {currentOccupancy.checkedInCount} Checked In
              </span>
              {currentOccupancy.inWindowCount > 0 && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: "6px",
                    background: "#EFF6FF",
                    color: "#1E40AF",
                    border: "1px solid #BFDBFE",
                  }}
                >
                  ⏳ {currentOccupancy.inWindowCount} Active Booking
                </span>
              )}
            </div>
          </div>

          {/* Near Checkout Operational Proximity Card (MS-13) */}
          <div
            data-testid="near-checkout-overview-card"
            onClick={() => setIsTriageModalOpen(true)}
            style={{
              padding: "12px 16px",
              borderRadius: "12px",
              background: "#FFFBEB",
              border: "1.5px solid #FDE68A",
              marginBottom: "16px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 800,
                  color: "#92400E",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <AlertTriangle size={14} color="#D97706" />
                Near Checkout
              </span>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#92400E",
                  background: "#FEF3C7",
                  padding: "2px 8px",
                  borderRadius: "9999px",
                }}
              >
                &lt; {nearCheckoutThreshold}m remaining
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <span
                  data-testid="near-checkout-count-val"
                  style={{ fontSize: "26px", fontWeight: 800, color: "#92400E", lineHeight: 1 }}
                >
                  {nearCheckoutAlerts.length}
                </span>
                <span style={{ fontSize: "12px", color: "#B45309", fontWeight: 600 }}>
                  {nearCheckoutAlerts.length === 1 ? "reservation ending soon" : "reservations ending soon"}
                </span>
              </div>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#D97706" }}>
                Triage View &rarr;
              </span>
            </div>
          </div>

          <div style={{ display: "flex", height: "8px", borderRadius: "9999px", whiteSpace: "nowrap", overflow: "hidden", marginBottom: "18px" }}>
            <div style={{ width: `${occupancyBar.availablePct}%`, background: "var(--da-brand-accent)" }}></div>
            <div style={{ width: `${occupancyBar.inUsePct}%`, background: "var(--da-text-secondary)" }}></div>
            <div style={{ width: `${occupancyBar.reservedPct}%`, background: "var(--da-soft)" }}></div>
            <div style={{ width: `${occupancyBar.maintenancePct}%`, background: "var(--da-brand-dark)" }}></div>
          </div>
          {occupancy.map((o, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--da-border-light)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                <div style={{ width: "9px", height: "9px", borderRadius: "3px", ...o.swatch }}></div>
                <span style={{ fontSize: "13px", color: "var(--da-text-primary)", fontFamily: "var(--da-font-family)" }}>{o.label}</span>
              </div>
              <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--da-text-primary)" }}>{o.value}</span>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{ height: "1px", background: "var(--da-border-light)", margin: "0 -4px" }} />

        {/* Top 5 Workspace Usage Section */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <h4 style={{ fontSize: "14px", fontWeight: 800, color: "var(--da-text-primary)", margin: 0 }}>
                Top Workspaces by Usage
              </h4>
              <div style={{ fontSize: "11px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)" }}>
                Most booked instances
              </div>
            </div>
            <button
              data-testid="workspace-usage-see-all-btn"
              onClick={() => setIsModalOpen(true)}
              style={{
                background: "transparent",
                border: "none",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--da-brand-dark)",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: "6px",
                fontFamily: "var(--da-font-family)",
              }}
            >
              See all
            </button>
          </div>

          {loadingTop ? (
            <div style={{ padding: "16px 0", textAlign: "center", color: "var(--da-text-secondary)", fontSize: "12px" }}>
              Loading usage ranking...
            </div>
          ) : topWorkspaces.length === 0 ? (
            <div style={{ padding: "16px 0", textAlign: "center", color: "var(--da-text-secondary)", fontSize: "12px" }}>
              No workspace data available
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {topWorkspaces.slice(0, 5).map((item, idx) => {
                const rank = idx + 1;
                const isTop1 = rank === 1;
                const isTop2 = rank === 2;
                const isTop3 = rank === 3;

                const badgeBg = isTop1 ? "#FEF3C7" : isTop2 ? "#F1F5F9" : isTop3 ? "#FFEDD5" : "#F8FAFC";
                const badgeColor = isTop1 ? "#B45309" : isTop2 ? "#475569" : isTop3 ? "#C2410C" : "#64748B";

                return (
                  <div
                    key={item.instanceId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: "var(--da-canvas, #F8FAFC)",
                      border: "1px solid var(--da-border-light, #E2E8F0)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                      <span
                        style={{
                          width: "22px",
                          height: "22px",
                          borderRadius: "6px",
                          background: badgeBg,
                          color: badgeColor,
                          fontSize: "11px",
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        #{rank}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "var(--da-text-primary)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.instanceName}
                        </div>
                        <div
                          style={{
                            fontSize: "10px",
                            color: "var(--da-text-secondary)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.templateName}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "8px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 800, color: "var(--da-brand-dark)" }}>
                        {item.totalBookings} {item.totalBookings === 1 ? "booking" : "bookings"}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--da-text-secondary)" }}>
                        {item.totalHoursBooked} hrs
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: "12px", textAlign: "center" }}>
            <button
              onClick={() => setIsModalOpen(true)}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "transparent",
                border: "1px solid var(--da-border)",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--da-brand-dark)",
                cursor: "pointer",
                fontFamily: "var(--da-font-family)",
                transition: "all 0.15s ease",
              }}
            >
              View Full Workspace Ranking →
            </button>
          </div>
        </div>
      </div>

      {/* See All Modal */}
      {isModalOpen && (
        <div
          data-testid="workspace-usage-modal-backdrop"
          onClick={() => setIsModalOpen(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            data-testid="workspace-usage-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: "16px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              width: "100%",
              maxWidth: "850px",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid var(--da-border-light, #E2E8F0)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 800, color: "var(--da-brand-dark)", margin: "0 0 4px" }}>
                  All Workspace Instances by Usage
                </h2>
                <div style={{ fontSize: "12px", color: "var(--da-text-secondary)" }}>
                  Ranked from top performing to lowest utilization &middot; {range === "today" ? "Today" : range === "7d" ? "Last 7 Days" : "Last 30 Days"}
                </div>
              </div>
              <button
                data-testid="workspace-usage-modal-close"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
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

            {/* Modal Controls (Search & Info) */}
            <div
              style={{
                padding: "14px 24px",
                background: "var(--da-canvas, #F8FAFC)",
                borderBottom: "1px solid var(--da-border-light, #E2E8F0)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <input
                data-testid="workspace-usage-search-input"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search workspace instance or template..."
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--da-border, #CBD5E1)",
                  fontSize: "12px",
                  minWidth: "260px",
                  outline: "none",
                  fontFamily: "var(--da-font-family)",
                }}
              />
              <div style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontWeight: 600 }}>
                Showing {filteredAndSortedAll.length} of {allWorkspaces.length} instances
              </div>
            </div>

            {/* Modal Table Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
              {loadingAll ? (
                <div style={{ padding: "48px 0", textAlign: "center", color: "var(--da-text-secondary)", fontSize: "13px" }}>
                  Loading all workspace instances...
                </div>
              ) : allError ? (
                <div style={{ padding: "32px 0", textAlign: "center", color: "#E11D48", fontSize: "13px" }}>
                  {allError}
                </div>
              ) : filteredAndSortedAll.length === 0 ? (
                <div style={{ padding: "48px 0", textAlign: "center", color: "var(--da-text-secondary)", fontSize: "13px" }}>
                  No workspaces matched your search.
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    textAlign: "left",
                    fontSize: "13px",
                    fontFamily: "var(--da-font-family)",
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1.5px solid var(--da-border, #CBD5E1)" }}>
                      <th
                        onClick={() => handleSortToggle("name")}
                        style={{
                          padding: "12px 8px",
                          fontWeight: 700,
                          color: "var(--da-text-secondary)",
                          fontSize: "11px",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          cursor: "pointer",
                          userSelect: "none",
                          width: "60px",
                        }}
                      >
                        Rank
                      </th>
                      <th
                        onClick={() => handleSortToggle("name")}
                        style={{
                          padding: "12px 12px",
                          fontWeight: 700,
                          color: "var(--da-text-secondary)",
                          fontSize: "11px",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        Workspace Instance {sortField === "name" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        style={{
                          padding: "12px 12px",
                          fontWeight: 700,
                          color: "var(--da-text-secondary)",
                          fontSize: "11px",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        Template / Tier
                      </th>
                      <th
                        onClick={() => handleSortToggle("bookings")}
                        style={{
                          padding: "12px 12px",
                          fontWeight: 700,
                          color: sortField === "bookings" ? "var(--da-brand-dark)" : "var(--da-text-secondary)",
                          fontSize: "11px",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          cursor: "pointer",
                          userSelect: "none",
                          textAlign: "right",
                        }}
                      >
                        Total Bookings {sortField === "bookings" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        onClick={() => handleSortToggle("hours")}
                        style={{
                          padding: "12px 12px",
                          fontWeight: 700,
                          color: sortField === "hours" ? "var(--da-brand-dark)" : "var(--da-text-secondary)",
                          fontSize: "11px",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          cursor: "pointer",
                          userSelect: "none",
                          textAlign: "right",
                        }}
                      >
                        Total Hours {sortField === "hours" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        onClick={() => handleSortToggle("lastBooked")}
                        style={{
                          padding: "12px 12px",
                          fontWeight: 700,
                          color: sortField === "lastBooked" ? "var(--da-brand-dark)" : "var(--da-text-secondary)",
                          fontSize: "11px",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          cursor: "pointer",
                          userSelect: "none",
                          textAlign: "right",
                        }}
                      >
                        Last Booked {sortField === "lastBooked" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedAll.map((item, index) => {
                      const rank = index + 1;
                      const formattedDate = item.lastBookedAt
                        ? format(new Date(item.lastBookedAt), "MMM d, yyyy h:mm a")
                        : "—";

                      return (
                        <tr
                          key={item.instanceId}
                          style={{
                            borderBottom: "1px solid var(--da-border-light, #E2E8F0)",
                            transition: "background 0.1s",
                          }}
                        >
                          <td style={{ padding: "12px 8px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: "26px",
                                height: "26px",
                                borderRadius: "6px",
                                background: rank <= 3 ? "#FEF3C7" : "transparent",
                                color: rank <= 3 ? "#92400E" : "var(--da-text-secondary)",
                                fontWeight: 800,
                                fontSize: "11px",
                              }}
                            >
                              #{rank}
                            </span>
                          </td>
                          <td style={{ padding: "12px 12px", fontWeight: 700, color: "var(--da-text-primary)" }}>
                            {item.instanceName}
                          </td>
                          <td style={{ padding: "12px 12px", color: "var(--da-text-secondary)" }}>
                            <span style={{ fontWeight: 600, color: "var(--da-text-primary)" }}>{item.templateName}</span>
                            <span style={{ margin: "0 6px", opacity: 0.5 }}>&middot;</span>
                            <span style={{ fontSize: "12px" }}>{item.templateTier}</span>
                          </td>
                          <td style={{ padding: "12px 12px", textAlign: "right", fontWeight: 800, color: "var(--da-brand-dark)" }}>
                            {item.totalBookings}
                          </td>
                          <td style={{ padding: "12px 12px", textAlign: "right", fontWeight: 700, color: "var(--da-text-primary)" }}>
                            {item.totalHoursBooked} hrs
                          </td>
                          <td style={{ padding: "12px 12px", textAlign: "right", fontSize: "12px", color: "var(--da-text-secondary)" }}>
                            {formattedDate}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid var(--da-border-light, #E2E8F0)",
                display: "flex",
                justifyContent: "flex-end",
                background: "var(--da-canvas, #F8FAFC)",
              }}
            >
              <button
                data-testid="workspace-usage-modal-done"
                onClick={() => setIsModalOpen(false)}
                style={{
                  padding: "8px 20px",
                  borderRadius: "8px",
                  background: "var(--da-brand-dark, #0F172A)",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--da-font-family)",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Near Checkout Actionable Triage View Modal (MS-13) */}
      {isTriageModalOpen && (
        <div
          data-testid="near-checkout-triage-backdrop"
          onClick={() => setIsTriageModalOpen(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            data-testid="near-checkout-triage-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: "16px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              width: "100%",
              maxWidth: "850px",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid var(--da-border-light, #E2E8F0)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                background: "#FFFBEB",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <AlertTriangle size={18} color="#D97706" />
                  <h2 style={{ fontSize: "18px", fontWeight: 800, color: "#92400E", margin: 0 }}>
                    Near-Checkout Actionable Triage
                  </h2>
                </div>
                <div style={{ fontSize: "12px", color: "#B45309", fontWeight: 600 }}>
                  Active checked-in sessions with less than {nearCheckoutThreshold} minutes remaining &middot; Proactive turnover management
                </div>
              </div>
              <button
                data-testid="near-checkout-triage-close"
                onClick={() => setIsTriageModalOpen(false)}
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "20px",
                  fontWeight: 700,
                  color: "#92400E",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {triageFeedback && (
              <div
                style={{
                  margin: "12px 24px 0",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: "#ECFDF5",
                  border: "1px solid #A7F3D0",
                  color: "#065F46",
                  fontSize: "13px",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <CheckCircle2 size={16} color="#059669" />
                <span>{triageFeedback}</span>
              </div>
            )}

            {/* Modal Table Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
              {nearCheckoutAlerts.length === 0 ? (
                <div style={{ padding: "48px 0", textAlign: "center", color: "var(--da-text-secondary)", fontSize: "13px" }}>
                  No active reservations currently near checkout threshold ({nearCheckoutThreshold}m).
                </div>
              ) : (
                <table
                  data-testid="near-checkout-triage-table"
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    textAlign: "left",
                    fontSize: "13px",
                    fontFamily: "var(--da-font-family)",
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1.5px solid var(--da-border, #CBD5E1)" }}>
                      <th style={{ padding: "10px 8px", fontWeight: 700, color: "var(--da-text-secondary)", fontSize: "11px", textTransform: "uppercase" }}>
                        Workspace
                      </th>
                      <th style={{ padding: "10px 12px", fontWeight: 700, color: "var(--da-text-secondary)", fontSize: "11px", textTransform: "uppercase" }}>
                        Customer
                      </th>
                      <th style={{ padding: "10px 12px", fontWeight: 700, color: "var(--da-text-secondary)", fontSize: "11px", textTransform: "uppercase" }}>
                        Checkout Time
                      </th>
                      <th style={{ padding: "10px 12px", fontWeight: 700, color: "var(--da-text-secondary)", fontSize: "11px", textTransform: "uppercase" }}>
                        Remaining Time
                      </th>
                      <th style={{ padding: "10px 12px", fontWeight: 700, color: "var(--da-text-secondary)", fontSize: "11px", textTransform: "uppercase", textAlign: "right" }}>
                        Quick Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {nearCheckoutAlerts.map((item) => {
                      const minutesLeft = Math.max(1, Math.round(item.minutesRemaining));
                      const endFormatted = item.endAt
                        ? format(new Date(item.endAt), "h:mm a")
                        : "—";
                      const isCheckingOut = checkingOutId === item.reservationId;

                      return (
                        <tr
                          key={item.reservationId}
                          data-testid={`near-checkout-row-${item.reservationId}`}
                          style={{
                            borderBottom: "1px solid var(--da-border-light, #E2E8F0)",
                          }}
                        >
                          <td style={{ padding: "12px 8px", fontWeight: 800, color: "var(--da-brand-dark)" }}>
                            {item.spotName}
                          </td>
                          <td style={{ padding: "12px 12px" }}>
                            <div style={{ fontWeight: 700, color: "var(--da-text-primary)" }}>{item.customerName}</div>
                            {item.customerEmail && (
                              <div style={{ fontSize: "11px", color: "var(--da-text-secondary)" }}>{item.customerEmail}</div>
                            )}
                          </td>
                          <td style={{ padding: "12px 12px", fontWeight: 600, color: "var(--da-text-primary)" }}>
                            {endFormatted}
                          </td>
                          <td style={{ padding: "12px 12px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "3px 10px",
                                borderRadius: "9999px",
                                background: "#FFFBEB",
                                border: "1px solid #FDE68A",
                                color: "#B45309",
                                fontWeight: 800,
                                fontSize: "12px",
                              }}
                            >
                              <Clock size={12} color="#D97706" />
                              {minutesLeft}m left
                            </span>
                          </td>
                          <td style={{ padding: "12px 12px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: "8px", justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                data-testid={`triage-extend-btn-${item.reservationId}`}
                                onClick={() => setSelectedExtendAlert(item)}
                                style={{
                                  padding: "6px 12px",
                                  background: "var(--da-brand-dark)",
                                  color: "#ffffff",
                                  border: "none",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <span>Extend Time</span>
                                <ArrowUpRight size={12} />
                              </button>
                              <button
                                type="button"
                                data-testid={`triage-checkout-btn-${item.reservationId}`}
                                disabled={isCheckingOut}
                                onClick={() => handleOperationalCheckout(item)}
                                style={{
                                  padding: "6px 12px",
                                  background: "#F1F5F9",
                                  color: "#334155",
                                  border: "1px solid #CBD5E1",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  cursor: isCheckingOut ? "not-allowed" : "pointer",
                                  opacity: isCheckingOut ? 0.6 : 1,
                                }}
                              >
                                {isCheckingOut ? "Checking out..." : "Check Out"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "14px 24px",
                borderTop: "1px solid var(--da-border-light, #E2E8F0)",
                display: "flex",
                justifyContent: "flex-end",
                background: "var(--da-canvas, #F8FAFC)",
              }}
            >
              <button
                data-testid="near-checkout-triage-done"
                onClick={() => setIsTriageModalOpen(false)}
                style={{
                  padding: "8px 20px",
                  borderRadius: "8px",
                  background: "var(--da-brand-dark, #0F172A)",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--da-font-family)",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedExtendAlert && (
        <ExtendReservationModal
          isOpen={Boolean(selectedExtendAlert)}
          onClose={() => setSelectedExtendAlert(null)}
          onSuccess={() => {
            setSelectedExtendAlert(null);
            fetchNearCheckout();
          }}
          reservationId={selectedExtendAlert.reservationId}
          referenceCode={selectedExtendAlert.referenceCode}
          customerName={selectedExtendAlert.customerName}
          spotDisplayName={selectedExtendAlert.spotName}
          currentEndAt={selectedExtendAlert.endAt}
          apiPrefix="/api/admin/reservations"
          actorRole="ADMIN"
        />
      )}
    </>
  );
}
