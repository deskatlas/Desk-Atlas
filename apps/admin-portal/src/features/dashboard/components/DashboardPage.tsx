"use client";

import React, { useState, useEffect } from "react";
import type { AdminDashboardRange, AdminDashboardSnapshot, OccupancySummary } from "@deskatlas/domain";
import { WorkspaceOverview } from "./WorkspaceOverview";
import { MaintenanceOverview } from "./MaintenanceOverview";

export function DashboardPage() {
  const [range, setRange] = useState<AdminDashboardRange>("today");
  const [data, setData] = useState<AdminDashboardSnapshot | null>(null);
  const [occupancySummary, setOccupancySummary] = useState<OccupancySummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/admin/dashboard?range=${range}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to load dashboard data");
        }
        return res.json();
      })
      .then((snapshot: AdminDashboardSnapshot) => {
        if (!isCancelled) {
          setData(snapshot);
          if (snapshot.occupancySummary) {
            setOccupancySummary(snapshot.occupancySummary);
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [range]);

  useEffect(() => {
    let isCancelled = false;

    const fetchOccupancy = async () => {
      try {
        const res = await fetch("/api/admin/dashboard/occupancy");
        if (res.ok) {
          const json: OccupancySummary = await res.json();
          if (!isCancelled) {
            setOccupancySummary(json);
          }
        }
      } catch {
        // silent fail on poll
      }
    };

    fetchOccupancy();
    const interval = setInterval(fetchOccupancy, 60000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, []);

  const rangeTabs: Array<{ id: AdminDashboardRange; label: string }> = [
    { id: "today", label: "Today" },
    { id: "7d", label: "7 days" },
    { id: "30d", label: "30 days" },
  ];

  const reservationsMetric = data?.metrics.reservations ?? {
    label: range === "today" ? "Today's Reservations" : range === "7d" ? "7 Days Reservations" : "30 Days Reservations",
    value: 0,
    formattedValue: "0",
    changeText: "0%",
    subText: range === "today" ? "vs yesterday" : range === "7d" ? "vs last week" : "vs last 30 days",
  };

  const checkedInMetric = data?.metrics.checkedIn ?? {
    label: "Currently Checked In",
    value: 0,
    formattedValue: "0",
    capacityPercentage: 0,
    totalCapacity: 0,
    subText: "0% capacity of 0",
  };

  const pendingPaymentsMetric = data?.metrics.pendingPayments ?? {
    label: "Pending Payments",
    value: 0,
    formattedValue: "0",
    changeText: "0%",
    subText: range === "today" ? "vs yesterday" : range === "7d" ? "vs last week" : "vs last 30 days",
  };

  const rescheduledMetric = data?.metrics.rescheduled ?? {
    label: "Rescheduled Bookings",
    value: 0,
    formattedValue: "0",
    changeText: "0%",
    subText: range === "today" ? "vs yesterday" : range === "7d" ? "vs last week" : "vs last 30 days",
  };

  const cancelledMetric = data?.metrics.cancelled ?? {
    label: "Cancelled Bookings",
    value: 0,
    formattedValue: "0",
    changeText: "0%",
    subText: range === "today" ? "vs yesterday" : range === "7d" ? "vs last week" : "vs last 30 days",
  };

  const activity = data?.activity ?? [];

  const occupancy = data?.workspaceOverview.breakdown ?? [
    { label: "Available", value: "0", swatch: { background: "var(--da-brand-accent)" } },
    { label: "In Use", value: "0", swatch: { background: "var(--da-text-secondary)" } },
    { label: "Reserved", value: "0", swatch: { background: "var(--da-soft)" } },
    { label: "Maintenance", value: "0", swatch: { background: "var(--da-brand-dark)" } },
  ];

  const occupancyBar = data?.workspaceOverview.occupancyBar ?? {
    availablePct: 0,
    inUsePct: 0,
    reservedPct: 0,
    maintenancePct: 0,
  };

  const floorLabel = data?.workspaceOverview.floorLabel ?? "Ground Floor · 0 workspaces";

  const currentOccupancy: OccupancySummary = occupancySummary ?? data?.occupancySummary ?? {
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
        dot: "#EF4444",
        badgeBg: "#FEE2E2",
      };
    }
    if (rate >= 70) {
      return {
        bg: "#FFFBEB",
        border: "#FDE68A",
        text: "#92400E",
        dot: "#F59E0B",
        badgeBg: "#FEF3C7",
      };
    }
    return {
      bg: "#F0FDF4",
      border: "#BBF7D0",
      text: "#166534",
      dot: "#10B981",
      badgeBg: "#DCFCE7",
    };
  };

  const indicatorStyle = getOccupancyIndicatorStyles(currentOccupancy.occupancyRate);

  return (
    <main data-screen-label="Dashboard" style={{ padding: "26px 28px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px", marginBottom: "22px" }}>
        <div>
          <h1 style={{ fontSize: "26px", fontWeight: 800, color: "var(--da-brand-dark)", margin: "0 0 3px", letterSpacing: "-0.02em" }}>Dashboard</h1>
          <div style={{ fontSize: "13px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)" }}>
            Overview of workspace operations &middot; {data?.rangeLabel ?? (range === "today" ? "Today" : range === "7d" ? "Last 7 Days" : "Last 30 Days")}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {rangeTabs.map((rt) => {
            const isActive = range === rt.id;
            const tabStyle = isActive
              ? { background: "var(--da-brand-dark)", color: "#fff", border: "none" }
              : { background: "transparent", color: "var(--da-text-secondary)", border: "1px solid var(--da-border)" };

            return (
              <button
                key={rt.id}
                onClick={() => setRange(rt.id)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "9px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--da-font-family)",
                  ...tabStyle,
                }}
              >
                {rt.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "10px", background: "#FFF1F2", border: "1px solid #FECDD3", color: "#9F1239", fontSize: "13px", fontFamily: "var(--da-font-family)", marginBottom: "18px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: "14px", marginBottom: "22px" }}>
        {/* Metric 1 */}
        <div style={{ background: "#fff", border: "1px solid var(--da-border)", borderRadius: "14px", padding: "18px", boxShadow: "var(--da-shadow-sm)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
            <div style={{ width: "38px", height: "38px", borderRadius: "11px", background: "var(--da-info)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "15px", height: "15px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px" }}></div>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px", opacity: 0.6 }}></div>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px", opacity: 0.6 }}></div>
              </div>
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)", marginBottom: "4px" }}>
            {reservationsMetric.label}
          </div>
          <div style={{ fontSize: "30px", fontWeight: 800, color: "var(--da-brand-dark)", lineHeight: 1, marginBottom: "8px" }}>
            {loading ? "..." : reservationsMetric.formattedValue}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontFamily: "var(--da-font-family)" }}>
            <span style={{ color: "var(--da-brand-dark)", fontWeight: 800 }}>{reservationsMetric.changeText}</span>
            <span style={{ color: "var(--da-text-secondary)" }}>{reservationsMetric.subText}</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div style={{ background: "#fff", border: "1px solid var(--da-border)", borderRadius: "14px", padding: "18px", boxShadow: "var(--da-shadow-sm)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
            <div style={{ width: "38px", height: "38px", borderRadius: "11px", background: "var(--da-info)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "15px", height: "15px", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--da-brand-dark)" }}></div>
                <div style={{ width: "13px", height: "5px", borderRadius: "9999px 9999px 3px 3px", background: "var(--da-brand-dark)", opacity: 0.65 }}></div>
              </div>
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)", marginBottom: "4px" }}>
            {checkedInMetric.label}
          </div>
          <div style={{ fontSize: "30px", fontWeight: 800, color: "var(--da-brand-dark)", lineHeight: 1, marginBottom: "8px" }}>
            {loading ? "..." : checkedInMetric.formattedValue}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontFamily: "var(--da-font-family)" }}>
            <span style={{ color: "var(--da-brand-dark)", fontWeight: 800 }}>{checkedInMetric.capacityPercentage}% capacity</span>
            <span style={{ color: "var(--da-text-secondary)" }}>of {checkedInMetric.totalCapacity}</span>
          </div>
        </div>

        {/* Metric 3 */}
        <div style={{ background: "#fff", border: "1px solid var(--da-border)", borderRadius: "14px", padding: "18px", boxShadow: "var(--da-shadow-sm)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
            <div style={{ width: "38px", height: "38px", borderRadius: "11px", background: "#FFF8E8", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "15px", height: "15px", border: "2.5px solid var(--da-brand-dark)", borderRadius: "50%" }}></div>
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)", marginBottom: "4px" }}>
            {pendingPaymentsMetric.label}
          </div>
          <div style={{ fontSize: "30px", fontWeight: 800, color: "var(--da-brand-dark)", lineHeight: 1, marginBottom: "8px" }}>
            {loading ? "..." : pendingPaymentsMetric.formattedValue}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontFamily: "var(--da-font-family)" }}>
            <span style={{ color: "var(--da-brand-dark)", fontWeight: 800 }}>{pendingPaymentsMetric.changeText}</span>
            <span style={{ color: "var(--da-text-secondary)" }}>{pendingPaymentsMetric.subText}</span>
          </div>
        </div>

        {/* Metric 4 */}
        <div style={{ background: "#fff", border: "1px solid var(--da-border)", borderRadius: "14px", padding: "18px", boxShadow: "var(--da-shadow-sm)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
            <div style={{ width: "38px", height: "38px", borderRadius: "11px", background: "#EBF5FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--da-brand-dark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M21 21v-5h-5" />
              </svg>
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)", marginBottom: "4px" }}>
            {rescheduledMetric.label}
          </div>
          <div style={{ fontSize: "30px", fontWeight: 800, color: "var(--da-brand-dark)", lineHeight: 1, marginBottom: "8px" }}>
            {loading ? "..." : rescheduledMetric.formattedValue}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontFamily: "var(--da-font-family)" }}>
            <span style={{ color: "var(--da-brand-dark)", fontWeight: 800 }}>{rescheduledMetric.changeText}</span>
            <span style={{ color: "var(--da-text-secondary)" }}>{rescheduledMetric.subText}</span>
          </div>
        </div>

        {/* Metric 5 */}
        <div style={{ background: "#fff", border: "1px solid var(--da-border)", borderRadius: "14px", padding: "18px", boxShadow: "var(--da-shadow-sm)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
            <div style={{ width: "38px", height: "38px", borderRadius: "11px", background: "#FFF1F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--da-brand-dark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)", marginBottom: "4px" }}>
            {cancelledMetric.label}
          </div>
          <div style={{ fontSize: "30px", fontWeight: 800, color: "var(--da-brand-dark)", lineHeight: 1, marginBottom: "8px" }}>
            {loading ? "..." : cancelledMetric.formattedValue}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontFamily: "var(--da-font-family)" }}>
            <span style={{ color: "var(--da-brand-dark)", fontWeight: 800 }}>{cancelledMetric.changeText}</span>
            <span style={{ color: "var(--da-text-secondary)" }}>{cancelledMetric.subText}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ flex: 1.7, minWidth: "360px", background: "#fff", border: "1px solid var(--da-border)", borderRadius: "14px", boxShadow: "var(--da-shadow-sm)", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--da-border-light)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
              <div style={{ width: "15px", height: "15px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px" }}></div>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px", opacity: 0.5 }}></div>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px", opacity: 0.5 }}></div>
              </div>
              <h3 style={{ fontSize: "15px", fontWeight: 800, color: "var(--da-text-primary)", margin: 0 }}>
                {range === "today" ? "Today's Activity" : `${data?.rangeLabel ?? "Recent"} Activity`}
              </h3>
            </div>
            <a href="/manage/reservations" style={{ fontSize: "12px", fontWeight: 700, color: "var(--da-brand-dark)", fontFamily: "var(--da-font-family)" }}>View all</a>
          </div>

          {loading && activity.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--da-text-secondary)", fontSize: "13px", fontFamily: "var(--da-font-family)" }}>
              Loading operational activity...
            </div>
          ) : activity.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--da-text-secondary)", fontSize: "13px", fontFamily: "var(--da-font-family)" }}>
              No activity recorded for this period
            </div>
          ) : (
            activity.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 20px", borderBottom: "1px solid var(--da-border-light)" }}>
                <div style={{ display: "flex", gap: "13px", alignItems: "center" }}>
                  <span style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)", width: "64px", fontWeight: 600 }}>{a.time}</span>
                  <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: "var(--da-canvas)", color: "var(--da-text-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 800 }}>{a.initials}</div>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--da-text-primary)" }}>{a.name}</div>
                    <div style={{ fontSize: "11px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family)" }}>{a.workspace}</div>
                  </div>
                </div>
                <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 700, padding: "4px 10px", borderRadius: "9999px", whiteSpace: "nowrap", ...a.style }}>
                  <span aria-hidden="true" style={{ fontSize: "11px", lineHeight: 1, fontWeight: 800 }}>{a.mark}</span>{a.status}
                </span>
              </div>
            ))
          )}
        </div>

        <MaintenanceOverview />
      </div>

      <WorkspaceOverview
        range={range}
        floorLabel={floorLabel}
        occupancyBar={occupancyBar}
        occupancy={occupancy}
        occupancySummary={occupancySummary ?? data?.occupancySummary}
      />
    </main>
  );
}
