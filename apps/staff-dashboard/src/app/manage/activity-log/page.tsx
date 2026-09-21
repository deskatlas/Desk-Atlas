"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/features/auth";
import { getHumanReadableMetadata, type ActivityLogEntry } from "@deskatlas/domain";

const ACTION_GROUPS: { label: string; value: string; types?: string[] }[] = [
  { label: "All Actions", value: "ALL" },
  {
    label: "Check-ins & QR Scans",
    value: "SCANS",
    types: [
      "reservation_checked_in",
      "STAFF_CHECKED_IN",
      "reservation_checked_out",
      "STAFF_CHECKED_OUT",
      "CHECK_IN",
      "CHECK_OUT",
      "recheckin",
      "RECHECKIN",
    ],
  },
  {
    label: "Kiosk & Counter Confirmations",
    value: "COUNTER",
    types: [
      "counter_payment_confirmed",
      "COUNTER_PAYMENT_CONFIRMED",
    ],
  },
  {
    label: "Relocations & Extensions",
    value: "RESERVATIONS",
    types: [
      "reservation_relocated",
      "RESERVATION_RELOCATED",
      "reservation_extended",
      "RESERVATION_EXTENDED",
    ],
  },
  {
    label: "Workspace Status",
    value: "WORKSPACE",
    types: [
      "workspace_status_updated",
      "WORKSPACE_STATUS_UPDATED",
    ],
  },
];

export default function StaffActivityLogPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedGroup, setSelectedGroup] = useState<string>("ALL");
  const [datePreset, setDatePreset] = useState<"all" | "today" | "7d" | "30d" | "custom">("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [selectedEntryForDetails, setSelectedEntryForDetails] = useState<ActivityLogEntry | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", limit.toString());

      if (user?.id) {
        params.set("actorId", user.id);
      }

      const groupObj = ACTION_GROUPS.find((g) => g.value === selectedGroup);
      if (groupObj && groupObj.types && groupObj.types.length > 0) {
        params.set("actionTypes", groupObj.types.join(","));
      }

      if (datePreset === "today") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        params.set("from", today.toISOString());
      } else if (datePreset === "7d") {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        params.set("from", sevenDaysAgo.toISOString());
      } else if (datePreset === "30d") {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        params.set("from", thirtyDaysAgo.toISOString());
      } else if (datePreset === "custom") {
        if (fromDate) params.set("from", new Date(fromDate).toISOString());
        if (toDate) {
          const end = new Date(toDate);
          end.setHours(23, 59, 59, 999);
          params.set("to", end.toISOString());
        }
      }

      const res = await fetch(`/api/activity-log?${params.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Failed to load activity logs (${res.status})`);
      }

      const data = await res.json();
      setEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity logs");
    } finally {
      setLoading(false);
    }
  }, [user?.id, page, limit, selectedGroup, datePreset, fromDate, toDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    } catch {
      return iso;
    }
  };

  const getActionBadgeStyle = (action: string) => {
    const act = action.toLowerCase();
    if (act.includes("approve") || act.includes("check_in") || act.includes("confirm")) {
      return { background: "#ECFDF5", color: "#065F46" };
    }
    if (act.includes("reject") || act.includes("cancel") || act.includes("deactivat")) {
      return { background: "#FEF2F2", color: "#991B1B" };
    }
    if (act.includes("relocat") || act.includes("extend") || act.includes("reschedul")) {
      return { background: "#FFFBEB", color: "#92400E" };
    }
    return { background: "#F1F5F9", color: "#334155" };
  };

  return (
    <div style={{ padding: "28px", maxWidth: "1200px", margin: "0 auto", width: "100%", fontFamily: "var(--da-font-family)" }}>
      {/* HEADER */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 800, color: "var(--da-text-primary)", margin: 0, letterSpacing: "-0.02em" }}>
          My Activity
        </h1>
        <p style={{ fontSize: "14px", color: "var(--da-text-secondary)", marginTop: "4px", marginBottom: 0 }}>
          Chronological feed of your operational actions, check-ins, and desk updates.
        </p>
      </div>

      {/* FILTER CONTROLS */}
      <div style={{ background: "#fff", border: "1px solid var(--da-border)", borderRadius: "12px", padding: "16px 20px", marginBottom: "20px", display: "flex", flexDirection: "column", gap: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          {/* Quick Date Presets */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "var(--da-canvas)", padding: "4px", borderRadius: "8px", border: "1px solid var(--da-border)" }}>
            {[
              { id: "all", label: "All Time" },
              { id: "today", label: "Today" },
              { id: "7d", label: "Last 7 Days" },
              { id: "30d", label: "Last 30 Days" },
              { id: "custom", label: "Custom Range" },
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  setDatePreset(preset.id as any);
                  setPage(1);
                }}
                style={{
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  background: datePreset === preset.id ? "var(--da-brand-dark)" : "transparent",
                  color: datePreset === preset.id ? "#fff" : "var(--da-text-secondary)",
                  transition: "all 0.15s ease",
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {/* Action Group Filter */}
            <select
              value={selectedGroup}
              onChange={(e) => {
                setSelectedGroup(e.target.value);
                setPage(1);
              }}
              style={{
                padding: "8px 12px",
                fontSize: "13px",
                fontWeight: 600,
                borderRadius: "8px",
                border: "1px solid var(--da-border)",
                background: "#fff",
                color: "var(--da-text-primary)",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {ACTION_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>

            {/* Refresh / Reset button */}
            <button
              onClick={() => {
                setSelectedGroup("ALL");
                setDatePreset("all");
                setFromDate("");
                setToDate("");
                setPage(1);
              }}
              style={{
                padding: "8px 14px",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "8px",
                border: "1px solid var(--da-border)",
                background: "var(--da-canvas)",
                color: "var(--da-text-secondary)",
                cursor: "pointer",
              }}
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Custom date range inputs */}
        {datePreset === "custom" && (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", paddingTop: "8px", borderTop: "1px solid var(--da-border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontWeight: 600 }}>From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                style={{
                  padding: "6px 10px",
                  fontSize: "12px",
                  borderRadius: "6px",
                  border: "1px solid var(--da-border)",
                  color: "var(--da-text-primary)",
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontWeight: 600 }}>To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                style={{
                  padding: "6px 10px",
                  fontSize: "12px",
                  borderRadius: "6px",
                  border: "1px solid var(--da-border)",
                  color: "var(--da-text-primary)",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ERROR MESSAGE */}
      {error && (
        <div style={{ padding: "14px 18px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "10px", color: "#991B1B", fontSize: "13px", marginBottom: "20px" }}>
          {error}
        </div>
      )}

      {/* TABLE CONTAINER */}
      <div style={{ background: "#fff", border: "1px solid var(--da-border)", borderRadius: "12px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "var(--da-canvas)", borderBottom: "1px solid var(--da-border)", color: "var(--da-text-secondary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <th style={{ padding: "12px 18px" }}>Date & Time</th>
                <th style={{ padding: "12px 18px" }}>Action</th>
                <th style={{ padding: "12px 18px" }}>Subject / Entity</th>
                <th style={{ padding: "12px 18px", textAlign: "right" }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ padding: "48px 20px", textAlign: "center", color: "var(--da-text-secondary)" }}>
                    <div style={{ display: "inline-block", width: "24px", height: "24px", border: "3px solid #E5E7EB", borderTopColor: "var(--da-brand-dark)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}></div>
                    <div style={{ marginTop: "10px", fontSize: "13px" }}>Loading activity records...</div>
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: "48px 20px", textAlign: "center", color: "var(--da-text-secondary)" }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--da-text-primary)", marginBottom: "4px" }}>
                      No activity records found
                    </div>
                    <div style={{ fontSize: "13px" }}>
                      You have no logged actions matching your current filters.
                    </div>
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const actionStyle = getActionBadgeStyle(entry.action);

                  return (
                    <tr
                      key={entry.id}
                      style={{ borderBottom: "1px solid var(--da-border)", transition: "background 0.15s ease" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "14px 18px", whiteSpace: "nowrap", color: "var(--da-text-primary)", fontWeight: 500 }}>
                        {formatDateTime(entry.createdAt)}
                      </td>
                      <td style={{ padding: "14px 18px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 10px",
                            borderRadius: "6px",
                            fontWeight: 600,
                            fontSize: "12px",
                            ...actionStyle,
                          }}
                        >
                          {entry.actionLabel}
                        </span>
                      </td>
                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 800,
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background: "#F3F4F6",
                              color: "#6B7280",
                            }}
                          >
                            {entry.entityType}
                          </span>
                          {entry.entityLabel && (
                            <span style={{ fontWeight: 600, color: "var(--da-text-primary)" }}>
                              {entry.entityLabel}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "14px 18px", textAlign: "right" }}>
                        <button
                          onClick={() => setSelectedEntryForDetails(entry)}
                          style={{
                            padding: "4px 10px",
                            fontSize: "12px",
                            fontWeight: 600,
                            borderRadius: "6px",
                            border: "1px solid var(--da-border)",
                            background: "#fff",
                            color: "var(--da-text-primary)",
                            cursor: "pointer",
                          }}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION FOOTER */}
        <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--da-border)", background: "var(--da-canvas)" }}>
          <div style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontWeight: 500 }}>
            Showing {entries.length > 0 ? (page - 1) * limit + 1 : 0}–
            {Math.min(page * limit, total)} of {total} records
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "6px",
                border: "1px solid var(--da-border)",
                background: page <= 1 ? "#F3F4F6" : "#fff",
                color: page <= 1 ? "#9CA3AF" : "var(--da-text-primary)",
                cursor: page <= 1 ? "not-allowed" : "pointer",
              }}
            >
              Previous
            </button>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--da-text-primary)" }}>
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              style={{
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "6px",
                border: "1px solid var(--da-border)",
                background: page >= totalPages ? "#F3F4F6" : "#fff",
                color: page >= totalPages ? "#9CA3AF" : "var(--da-text-primary)",
                cursor: page >= totalPages ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* DETAILS MODAL */}
      {selectedEntryForDetails && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "20px",
          }}
          onClick={() => setSelectedEntryForDetails(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "14px",
              maxWidth: "600px",
              width: "100%",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--da-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--da-text-primary)" }}>
                  Activity Record Details
                </h3>
                {selectedEntryForDetails.entityLabel ? (
                  <div style={{ fontSize: "12px", color: "var(--da-brand-dark)", fontWeight: 600, marginTop: "2px" }}>
                    {selectedEntryForDetails.entityLabel}
                  </div>
                ) : null}
              </div>
              <button
                onClick={() => setSelectedEntryForDetails(null)}
                style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", color: "var(--da-text-secondary)" }}
              >
                &times;
              </button>
            </div>

            <div style={{ padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "var(--da-canvas)", padding: "14px", borderRadius: "8px" }}>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--da-text-secondary)", fontWeight: 700 }}>DATE & TIME</div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--da-text-primary)", marginTop: "2px" }}>
                    {formatDateTime(selectedEntryForDetails.createdAt)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--da-text-secondary)", fontWeight: 700 }}>ACTION</div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--da-text-primary)", marginTop: "2px" }}>
                    {selectedEntryForDetails.actionLabel}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--da-text-secondary)", fontWeight: 700 }}>
                    {selectedEntryForDetails.entityType === "reservation" ? "RESERVATION" : selectedEntryForDetails.entityType === "workspace_instance" ? "WORKSPACE" : "SUBJECT"}
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--da-text-primary)", marginTop: "2px" }}>
                    {selectedEntryForDetails.entityLabel || selectedEntryForDetails.entityType.replace(/_/g, " ").toUpperCase()}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--da-text-secondary)", marginBottom: "8px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  Action Information & Details
                </div>
                {(() => {
                  const items = getHumanReadableMetadata(selectedEntryForDetails.metadata ?? {});
                  if (items.length === 0) {
                    return (
                      <div style={{ padding: "16px", background: "var(--da-canvas)", borderRadius: "8px", border: "1px solid var(--da-border)", fontSize: "13px", color: "var(--da-text-secondary)", textAlign: "center" }}>
                        No additional details recorded for this action.
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {items.map((item) => (
                        <div
                          key={item.key}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "16px",
                            padding: "10px 14px",
                            background: "var(--da-canvas)",
                            borderRadius: "8px",
                            border: "1px solid var(--da-border)",
                            fontSize: "13px",
                          }}
                        >
                          <span style={{ fontWeight: 600, color: "var(--da-text-secondary)" }}>
                            {item.label}
                          </span>
                          {item.isBadge ? (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: 700,
                                background: "#EBF3FE",
                                color: "#1D4ED8",
                              }}
                            >
                              {item.value}
                            </span>
                          ) : (
                            <span style={{ fontWeight: 600, color: "var(--da-text-primary)", textAlign: "right" }}>
                              {item.value}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div style={{ padding: "14px 24px", borderTop: "1px solid var(--da-border)", background: "var(--da-canvas)", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setSelectedEntryForDetails(null)}
                style={{
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "1px solid var(--da-border)",
                  background: "var(--da-brand-dark)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
