"use client";

import React, { useState, useEffect } from "react";
import type { WorkspaceInstanceDetails } from "@deskatlas/domain";
import { format } from "date-fns";

export function MaintenanceOverview() {
  const [maintenanceInstances, setMaintenanceInstances] = useState<WorkspaceInstanceDetails[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMaintenance = async () => {
    try {
      const res = await fetch("/api/admin/workspace-instances/maintenance");
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to load maintenance issues");
      }
      const data: WorkspaceInstanceDetails[] = await res.json();
      setMaintenanceInstances(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading maintenance issues");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMaintenance();
    const interval = setInterval(fetchMaintenance, 60000);
    return () => clearInterval(interval);
  }, []);

  const count = maintenanceInstances.length;

  return (
    <div
      data-testid="maintenance-overview-card"
      style={{
        background: "#fff",
        border: "1px solid var(--da-border)",
        borderRadius: "14px",
        boxShadow: "var(--da-shadow-sm)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 20px",
          borderBottom: "1px solid var(--da-border-light)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "8px",
              background: count > 0 ? "#FEF3C7" : "var(--da-info)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: "14px" }}>🛠️</span>
          </div>
          <div>
            <h3
              style={{
                fontSize: "15px",
                fontWeight: 800,
                color: "var(--da-text-primary)",
                margin: 0,
              }}
            >
              Maintenance Overview
            </h3>
            <div
              style={{
                fontSize: "11px",
                color: "var(--da-text-secondary)",
                fontFamily: "var(--da-font-family)",
              }}
            >
              Reported issues & desk status
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            data-testid="maintenance-count-badge"
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "9999px",
              background: count > 0 ? "#FEF3C7" : "#F0FDF4",
              color: count > 0 ? "#92400E" : "#166534",
              border: `1px solid ${count > 0 ? "#FDE68A" : "#BBF7D0"}`,
            }}
          >
            {count} {count === 1 ? "Desk Under Maintenance" : "Desks Under Maintenance"}
          </span>
          <a
            href="/manage/workspace-map"
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--da-brand-dark)",
              fontFamily: "var(--da-font-family)",
              textDecoration: "none",
            }}
          >
            Inspect Map &rarr;
          </a>
        </div>
      </div>

      {loading && maintenanceInstances.length === 0 ? (
        <div
          style={{
            padding: "28px 20px",
            textAlign: "center",
            color: "var(--da-text-secondary)",
            fontSize: "13px",
            fontFamily: "var(--da-font-family)",
          }}
        >
          Loading maintenance overview...
        </div>
      ) : error ? (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            color: "#991B1B",
            fontSize: "12px",
            fontFamily: "var(--da-font-family)",
          }}
        >
          {error}
        </div>
      ) : maintenanceInstances.length === 0 ? (
        <div
          data-testid="maintenance-empty-state"
          style={{
            padding: "28px 20px",
            textAlign: "center",
            color: "var(--da-text-secondary)",
            fontSize: "13px",
            fontFamily: "var(--da-font-family)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ fontSize: "20px" }}>✨</span>
          <span style={{ fontWeight: 600 }}>No active maintenance issues.</span>
          <span style={{ fontSize: "11px", color: "var(--da-text-muted, #94A3B8)" }}>
            All workspaces are operational or ready for booking.
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {maintenanceInstances.map((inst, index) => {
            const hasReason = Boolean(inst.maintenanceNote && inst.maintenanceNote.trim().length > 0);
            const timeStr = inst.updatedAt
              ? format(new Date(inst.updatedAt), "MMM d, yyyy · h:mm a")
              : inst.createdAt
              ? format(new Date(inst.createdAt), "MMM d, yyyy · h:mm a")
              : "Recently";

            return (
              <div
                key={inst.id}
                data-testid="maintenance-row"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  padding: "14px 20px",
                  borderBottom:
                    index === maintenanceInstances.length - 1
                      ? "none"
                      : "1px solid var(--da-border-light)",
                  gap: "14px",
                  background: index % 2 === 0 ? "#fff" : "var(--da-canvas, #F8FAFC)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: "var(--da-text-primary)",
                      }}
                    >
                      {inst.displayName}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background: "var(--da-border-light, #E2E8F0)",
                        color: "var(--da-text-secondary)",
                      }}
                    >
                      {inst.instanceCode}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--da-text-secondary)",
                        fontFamily: "var(--da-font-family)",
                      }}
                    >
                      &middot; {inst.template?.name ?? "Workspace"} &middot; {inst.floor?.name ?? "Floor"}
                    </span>
                  </div>

                  <div
                    data-testid="maintenance-note"
                    style={{
                      fontSize: "12px",
                      marginTop: "2px",
                      color: hasReason ? "#92400E" : "var(--da-text-muted, #94A3B8)",
                      background: hasReason ? "#FEF3C7" : "transparent",
                      padding: hasReason ? "4px 8px" : "0",
                      borderRadius: hasReason ? "6px" : "0",
                      border: hasReason ? "1px solid #FDE68A" : "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      fontStyle: hasReason ? "normal" : "italic",
                      maxWidth: "fit-content",
                    }}
                  >
                    {hasReason ? (
                      <>
                        <span style={{ fontWeight: 700 }}>Problem:</span> {inst.maintenanceNote}
                      </>
                    ) : (
                      "No reason recorded"
                    )}
                  </div>
                </div>

                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--da-text-secondary)",
                    fontFamily: "var(--da-font-family)",
                    whiteSpace: "nowrap",
                    textAlign: "right",
                    flexShrink: 0,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>Status updated</div>
                  <div>{timeStr}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
