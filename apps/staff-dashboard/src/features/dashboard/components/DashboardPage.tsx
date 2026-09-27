"use client";

import React, { useState } from "react";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useAlerts } from "../../alerts";
import { format } from "date-fns";
import { AlertTriangle, Clock, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { ExtendReservationModal } from "../../reservations/components/ExtendReservationModal";
import type { BookingEndAlert } from "@deskatlas/domain";

export function DashboardPage() {
  const { data, loading, error, refetch } = useDashboardStats();
  const { rawAlerts, fetchAlerts } = useAlerts();
  const [isTriageModalOpen, setIsTriageModalOpen] = useState<boolean>(false);
  const [selectedExtendAlert, setSelectedExtendAlert] = useState<BookingEndAlert | null>(null);
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);
  const [triageFeedback, setTriageFeedback] = useState<string | null>(null);

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

          {/* Near Checkout Status Card (MS-13) */}
          <div
            data-testid="near-checkout-overview-card"
            onClick={() => setIsTriageModalOpen(true)}
            style={{
              padding: "12px 14px",
              borderRadius: "10px",
              background: "#FFFBEB",
              border: "1.5px solid #FDE68A",
              marginBottom: "14px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 800,
                  color: "#92400E",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <AlertTriangle size={13} color="#D97706" />
                Near Checkout
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "#92400E",
                  background: "#FEF3C7",
                  padding: "2px 7px",
                  borderRadius: "9999px",
                }}
              >
                &lt; 15m remaining
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <span
                  data-testid="near-checkout-count-val"
                  style={{ fontSize: "24px", fontWeight: 800, color: "#92400E", lineHeight: 1 }}
                >
                  {rawAlerts.length}
                </span>
                <span style={{ fontSize: "11px", color: "#B45309", fontWeight: 600 }}>
                  {rawAlerts.length === 1 ? "reservation ending soon" : "reservations ending soon"}
                </span>
              </div>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#D97706" }}>
                Triage View &rarr;
              </span>
            </div>
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

      {/* Near Checkout Triage Modal (MS-13) */}
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
                  Active checked-in sessions nearing checkout window &middot; Front-desk operational triage
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

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
              {rawAlerts.length === 0 ? (
                <div style={{ padding: "48px 0", textAlign: "center", color: "var(--da-text-secondary)", fontSize: "13px" }}>
                  No active reservations currently near checkout.
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
                    {rawAlerts.map((item) => {
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
                                onClick={async () => {
                                  try {
                                    setCheckingOutId(item.reservationId);
                                    const res = await fetch(
                                      `/api/operations/reservations/${encodeURIComponent(item.reservationId)}/checkout`,
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
                                    setTriageFeedback(`Successfully checked out ${item.customerName} (${item.spotName})`);
                                    setTimeout(() => setTriageFeedback(null), 4000);
                                    await fetchAlerts();
                                  } catch (err) {
                                    console.error("Checkout error:", err);
                                  } finally {
                                    setCheckingOutId(null);
                                  }
                                }}
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
            fetchAlerts();
          }}
          reservationId={selectedExtendAlert.reservationId}
          referenceCode={selectedExtendAlert.referenceCode}
          customerName={selectedExtendAlert.customerName}
          spotDisplayName={selectedExtendAlert.spotName}
          currentEndAt={selectedExtendAlert.endAt}
          apiPrefix="/api/operations/reservations"
          actorRole="STAFF"
        />
      )}
    </main>
  );
}
