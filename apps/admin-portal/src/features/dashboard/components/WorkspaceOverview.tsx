"use client";

import React, { useState, useEffect, useMemo } from "react";
import type {
  AdminDashboardRange,
  OccupancySummary,
  WorkspaceUsageRecord,
  WorkspaceUsageSortField,
  WorkspaceUsageSortDirection,
} from "@deskatlas/domain";
import { format } from "date-fns";

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

  // Fetch top 5 workspaces for widget
  useEffect(() => {
    let isCancelled = false;
    setLoadingTop(true);

    fetch(`/api/admin/workspace-usage?limit=5&range=${range}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load top workspaces");
        return res.json();
      })
      .then((records: WorkspaceUsageRecord[]) => {
        if (!isCancelled) {
          setTopWorkspaces(records);
          setLoadingTop(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error("Top workspaces fetch error:", err);
          setLoadingTop(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [range]);

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
    </>
  );
}
