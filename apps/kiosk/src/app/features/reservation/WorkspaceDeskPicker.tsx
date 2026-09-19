"use client";

import { useEffect, useState } from "react";
import { fetchTemplateAvailability } from "../../lib/availabilityApi";

interface WorkspaceDeskPickerProps {
  template: any;
  durationHours: number;
  workspaces: any[];
  onSelect: (workspace: any) => void;
  onBack: () => void;
  kioskMarker?: any;
  floor?: any;
  allowanceMinutes?: number;
}

function getNowManilaTime(allowanceMinutes: number = 5): { date: string; time: string; nowIso: string } {
  const now = new Date();
  const leewayDate = new Date(now.getTime() + allowanceMinutes * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(leewayDate);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "08";
  const day = parts.find((p) => p.type === "day")?.value ?? "31";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "09";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    nowIso: now.toISOString(),
  };
}

export function WorkspaceDeskPicker({
  template,
  durationHours,
  workspaces,
  onSelect,
  onBack,
  kioskMarker,
  floor,
  allowanceMinutes = 5,
}: WorkspaceDeskPickerProps) {
  const [availabilityList, setAvailabilityList] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const { date, time, nowIso } = getNowManilaTime(allowanceMinutes);

    fetchTemplateAvailability({
      templateId: template.id,
      date,
      durationMinutes: durationHours * 60,
      startTime: time,
      nowIso,
    })
      .then((res) => {
        if (cancelled) return;
        setAvailabilityList(res.allInstances || []);
        setLoading(false);
      })
      .catch((_err) => {
        if (cancelled) return;
        // Fallback to published workspaces list
        setAvailabilityList(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [template.id, durationHours, allowanceMinutes]);

  // Combine workspace data with real-time availability if available
  const displayDesks = workspaces.map((ws) => {
    if (availabilityList) {
      const live = availabilityList.find((a) => a.workspaceInstanceId === ws.id);
      if (live) {
        return {
          ...ws,
          name: live.displayName || ws.name,
          isAvailable: live.isAvailable,
          blockingReason: live.blockingReason,
        };
      }
    }
    const isAvailable = ws.operational_status === "ACTIVE" || ws.operationalStatus === "ACTIVE";
    return {
      ...ws,
      isAvailable,
      blockingReason: isAvailable ? null : "MAINTENANCE",
    };
  });

  return (
    <main data-screen-label="Kiosk Desk Picker" style={{ maxWidth: "1000px", margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: "20px" }}>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: "#65736A",
            fontSize: "20px",
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          ← Back to Duration
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "40px", fontWeight: 800, color: "#0C3B27", margin: "0 0 8px" }}>
            Pick your {template.name}
          </h1>
          <p style={{ fontSize: "18px", color: "#65736A", margin: 0 }}>
            {durationHours} {durationHours === 1 ? "hour" : "hours"} · Starting now
          </p>
        </div>

        {kioskMarker && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: "12px",
              padding: "10px 18px",
              color: "#991B1B",
              fontWeight: 700,
              fontSize: "16px",
            }}
          >
            <span style={{ fontSize: "20px" }}>📍</span>
            <span>
              You are here: <strong>{kioskMarker.label || "Kiosk Location"}</strong>
              {floor?.name ? ` on ${floor.name}` : ""}
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: "22px", color: "#65736A", padding: "40px 0", textAlign: "center" }}>
          Checking real-time spot availability...
        </div>
      ) : displayDesks.length === 0 ? (
        <div style={{ fontSize: "22px", color: "#65736A", padding: "40px 0", textAlign: "center" }}>
          No spots currently found for this category.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "20px",
          }}
        >
          {displayDesks.map((ws) => {
            const available = ws.isAvailable;
            return (
              <button
                key={ws.id}
                onClick={() => available && onSelect(ws)}
                disabled={!available}
                style={{
                  padding: "28px 16px",
                  borderRadius: "20px",
                  textAlign: "center",
                  cursor: available ? "pointer" : "not-allowed",
                  background: available ? "#FFFFFF" : "#F0F2F1",
                  border: available ? "2px solid #DCE6DF" : "2px solid #E1E9E3",
                  color: available ? "#12251A" : "#8E9992",
                  boxShadow: available ? "0 4px 12px rgba(0,0,0,0.04)" : "none",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ fontSize: "24px", fontWeight: 800, marginBottom: "6px" }}>
                  {ws.name}
                </div>
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: 600,
                    color: available ? "#16723A" : "#991B1B",
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {available ? "✓ Available Now" : ws.blockingReason ? ws.blockingReason.replace(/_/g, " ") : "Unavailable"}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}
