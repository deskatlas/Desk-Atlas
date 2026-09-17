"use client";

import React from "react";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { format } from "date-fns";

export function DashboardPage() {
  const { data, loading, error, refetch } = useDashboardStats();

  if (loading && !data) {
    return (
      <main data-screen-label="Staff Dashboard" style={{ padding: "26px 28px 40px" }}>
        <h1 style={{ fontSize: "26px", fontWeight: 800, color: "var(--da-brand-dark)", margin: "0 0 3px", letterSpacing: "-0.02em" }}>
          Dashboard
        </h1>
        <div style={{ padding: "40px", textAlign: "center", color: "var(--da-text-secondary)", fontSize: "14px" }}>
          Loading operational data...
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main data-screen-label="Staff Dashboard" style={{ padding: "26px 28px 40px" }}>
        <h1 style={{ fontSize: "26px", fontWeight: 800, color: "var(--da-brand-dark)", margin: "0 0 3px", letterSpacing: "-0.02em" }}>
          Dashboard
        </h1>
        <div style={{ padding: "40px", textAlign: "center", color: "var(--da-danger, #9F1239)" }}>
          <div style={{ marginBottom: "12px", fontSize: "14px" }}>{error}</div>
          <button
            onClick={refetch}
            style={{
              padding: "8px 18px",
              background: "var(--da-brand-dark)",
              color: "#fff",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "13px",
            }}
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  const reservationsMetric = data?.metrics.reservations ?? {
    label: "Today's Reservations",
    value: 0,
    formattedValue: "0",
    changeText: "0%",
    subText: "vs yesterday",
  };

  const checkedInMetric = data?.metrics.checkedIn ?? {
    label: "Currently Checked In",
    value: 0,
    formattedValue: "0",
    capacityPercentage: 0,
    totalCapacity: 0,
    subText: "0% capacity of 0",
  };

  const activity = data?.activity ?? [];

  const occupancy = data?.workspaceOverview.breakdown ?? [
    { label: "Available", value: "0", rawValue: 0, swatch: { background: "var(--da-brand-accent)" } },
    { label: "In Use", value: "0", rawValue: 0, swatch: { background: "var(--da-text-secondary)" } },
    { label: "Reserved", value: "0", rawValue: 0, swatch: { background: "var(--da-soft)" } },
    { label: "Maintenance", value: "0", rawValue: 0, swatch: { background: "var(--da-brand-dark)" } },
  ];

  const occupancyBar = data?.workspaceOverview.occupancyBar ?? {
    availablePct: 0,
    inUsePct: 0,
    reservedPct: 0,
    maintenancePct: 0,
  };

  const floorLabel = data?.workspaceOverview.floorLabel ?? "Ground Floor · 0 workspaces";

  return (
    <main data-screen-label="Staff Dashboard" style={{ padding: "26px 28px 40px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px", marginBottom: "22px" }}>
        <div>
          <h1 style={{ fontSize: "26px", fontWeight: 800, color: "var(--da-brand-dark)", margin: "0 0 3px", letterSpacing: "-0.02em" }}>
            Dashboard
          </h1>
          <div style={{ fontSize: "13px", color: "var(--da-text-secondary)", fontFamily: "var(--da-font-family, sans-serif)" }}>
            Overview of workspace operations &middot; {format(new Date(), "EEEE, MMMM d, yyyy")}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "10px", background: "#FFF1F2", border: "1px solid #FECDD3", color: "#9F1239", fontSize: "13px", marginBottom: "18px" }}>
          {error}
        </div>
      )}

      {/* Top 2 Operational Metric Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "24px" }}>
        {/* Metric 1: Today's Reservations */}
        <div style={{ background: "#fff", border: "1px solid var(--da-border)", borderRadius: "14px", padding: "20px", boxShadow: "var(--da-shadow-sm)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
            <div style={{ width: "38px", height: "38px", borderRadius: "11px", background: "var(--da-info)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "15px", height: "15px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px" }}></div>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px", opacity: 0.6 }}></div>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px", opacity: 0.6 }}></div>
              </div>
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "6px" }}>
            {reservationsMetric.label}
          </div>
          <div style={{ fontSize: "32px", fontWeight: 800, color: "var(--da-brand-dark)", lineHeight: 1, marginBottom: "8px" }}>
            {loading ? "..." : reservationsMetric.formattedValue}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px" }}>
            <span style={{ color: "var(--da-brand-dark)", fontWeight: 800 }}>{reservationsMetric.changeText}</span>
            <span style={{ color: "var(--da-text-secondary)" }}>{reservationsMetric.subText}</span>
          </div>
        </div>

        {/* Metric 2: Currently Checked In */}
        <div style={{ background: "#fff", border: "1px solid var(--da-border)", borderRadius: "14px", padding: "20px", boxShadow: "var(--da-shadow-sm)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
            <div style={{ width: "38px", height: "38px", borderRadius: "11px", background: "var(--da-info)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "15px", height: "15px", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--da-brand-dark)" }}></div>
                <div style={{ width: "13px", height: "5px", borderRadius: "9999px 9999px 3px 3px", background: "var(--da-brand-dark)", opacity: 0.65 }}></div>
              </div>
            </div>
          </div>
          <div style={{ fontSize: "12px", color: "var(--da-text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "6px" }}>
            {checkedInMetric.label}
          </div>
          <div style={{ fontSize: "32px", fontWeight: 800, color: "var(--da-brand-dark)", lineHeight: 1, marginBottom: "8px" }}>
            {loading ? "..." : checkedInMetric.formattedValue}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px" }}>
            <span style={{ color: "var(--da-brand-dark)", fontWeight: 800 }}>{checkedInMetric.capacityPercentage}% capacity</span>
            <span style={{ color: "var(--da-text-secondary)" }}>of {checkedInMetric.totalCapacity}</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Recent Activity + Workspace Overview */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        {/* Left Column: Today's Activity */}
        <section style={{ flex: 1.7, minWidth: "340px", background: "#fff", border: "1px solid var(--da-border)", borderRadius: "14px", boxShadow: "var(--da-shadow-sm)", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--da-border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
              <div style={{ width: "15px", height: "15px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px" }}></div>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px", opacity: 0.5 }}></div>
                <div style={{ height: "3px", background: "var(--da-brand-dark)", borderRadius: "2px", opacity: 0.5 }}></div>
              </div>
              <h2 style={{ fontSize: "15px", fontWeight: 800, color: "var(--da-brand-dark)", margin: 0 }}>
                Today's Activity
              </h2>
            </div>
            <a href="/manage/reservations" style={{ fontSize: "12px", fontWeight: 700, color: "var(--da-brand-dark)", textDecoration: "none" }}>
              View all
            </a>
          </div>

          <div style={{ padding: "0" }}>
            {activity.length === 0 ? (
              <div style={{ padding: "36px 20px", textAlign: "center", color: "var(--da-text-secondary)", fontSize: "13px" }}>
                No activity recorded for today.
              </div>
            ) : (
              <div>
                {activity.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "13px 20px",
                      borderBottom: "1px solid var(--da-border)",
                    }}
                  >
                    <div style={{ display: "flex", gap: "13px", alignItems: "center" }}>
                      <span style={{ fontSize: "12px", color: "var(--da-text-secondary)", width: "68px", fontWeight: 600, flexShrink: 0 }}>
                        {a.time}
                      </span>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          background: "var(--da-canvas)",
                          color: "var(--da-text-primary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        {a.initials}
                      </div>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--da-text-primary)" }}>{a.name}</div>
                        <div style={{ fontSize: "11px", color: "var(--da-text-secondary)" }}>
                          {a.workspace}
                          {a.actorName ? ` · Scanned by ${a.actorName}` : ""}
                        </div>
                      </div>
                    </div>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: "9999px",
                        whiteSpace: "nowrap",
                        ...a.style,
                      }}
                    >
                      <span aria-hidden="true" style={{ fontSize: "11px", lineHeight: 1, fontWeight: 800 }}>
                        {a.mark}
                      </span>
                      {a.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Workspace Overview */}
        <section style={{ flex: 1, minWidth: "260px", background: "#fff", border: "1px solid var(--da-border)", borderRadius: "14px", padding: "20px", boxShadow: "var(--da-shadow-sm)" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 800, color: "var(--da-brand-dark)", margin: "0 0 4px" }}>
            Workspace Overview
          </h2>
          <div style={{ fontSize: "11px", color: "var(--da-text-secondary)", marginBottom: "16px" }}>
            {floorLabel}
          </div>
          <div style={{ display: "flex", height: "8px", borderRadius: "9999px", whiteSpace: "nowrap", overflow: "hidden", marginBottom: "18px", background: "var(--da-canvas)" }}>
            <div style={{ width: `${occupancyBar.availablePct}%`, background: "var(--da-brand-accent)" }} title={`Available: ${occupancyBar.availablePct}%`}></div>
            <div style={{ width: `${occupancyBar.inUsePct}%`, background: "var(--da-text-secondary)" }} title={`In Use: ${occupancyBar.inUsePct}%`}></div>
            <div style={{ width: `${occupancyBar.reservedPct}%`, background: "var(--da-soft)" }} title={`Reserved: ${occupancyBar.reservedPct}%`}></div>
            <div style={{ width: `${occupancyBar.maintenancePct}%`, background: "var(--da-brand-dark)" }} title={`Maintenance: ${occupancyBar.maintenancePct}%`}></div>
          </div>
          {occupancy.map((o, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid var(--da-border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                <div style={{ width: "9px", height: "9px", borderRadius: "3px", ...o.swatch }}></div>
                <span style={{ fontSize: "13px", color: "var(--da-text-primary)" }}>{o.label}</span>
              </div>
              <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--da-brand-dark)" }}>{o.value}</span>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
