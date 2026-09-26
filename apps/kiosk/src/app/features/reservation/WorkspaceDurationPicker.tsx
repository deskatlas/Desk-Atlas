"use client";

import { useState } from "react";
import { handleNumericKeyDown } from "@deskatlas/ui";

interface WorkspaceDurationPickerProps {
  template: any;
  durationHours: number;
  onSelectDuration: (hours: number) => void;
  onNext: () => void;
  onBack: () => void;
}

const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

function formatTime12Hour(time24: string): string {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  let hour = parseInt(hStr, 10);
  const minute = mStr || "00";
  const period = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  return `${hour}:${minute} ${period}`;
}

export function WorkspaceDurationPicker({
  template,
  durationHours,
  onSelectDuration,
  onNext,
  onBack,
}: WorkspaceDurationPickerProps) {
  const [customInputStr, setCustomInputStr] = useState(String(durationHours > 0 ? durationHours : ""));
  const rate = Number(template.rate_amount ?? template.rateAmount ?? 0);
  const totalAmount = rate * (durationHours > 0 ? durationHours : 0);

  // Compute immediate time window starting now in local time
  const now = new Date();
  const startHour = now.getHours();
  const startMinute = now.getMinutes();
  const startStr = `${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")}`;

  const endTotalMinutes = startHour * 60 + startMinute + (durationHours > 0 ? durationHours : 0) * 60;
  const isNextDay = (durationHours > 0) && (endTotalMinutes >= 1440);
  const endHour = Math.floor(endTotalMinutes / 60) % 24;
  const endMinute = endTotalMinutes % 60;
  const endStr = `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;

  return (
    <main data-screen-label="Kiosk Duration Picker" style={{ maxWidth: "800px", margin: "0 auto", width: "100%" }}>
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
          ← Back to Types
        </button>
      </div>

      <div style={{ marginBottom: "32px" }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: "#1B5E20", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
          Step 2: Walk-In Duration
        </div>
        <h1 style={{ fontSize: "36px", fontWeight: 800, color: "#12251A", margin: "0 0 10px 0" }}>
          {isNextDay
            ? `Walk-in Stay • Concludes Tomorrow at ${formatTime12Hour(endStr)} (Next Day)`
            : `How long do you need this ${template.name}?`}
        </h1>
        <p style={{ fontSize: "18px", color: "#455A64", margin: 0 }}>
          Walk-in bookings start immediately upon confirmation.
        </p>
      </div>

      {/* Immediate time window highlight */}
      <div
        style={{
          background: "#E8F5E9",
          border: "2px solid #A5D6A7",
          borderRadius: "16px",
          padding: "20px 24px",
          marginBottom: "28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#2E7D32", textTransform: "uppercase" }}>
            Immediate Walk-In Window
          </div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#1B5E20", marginTop: "4px" }}>
            Starting Now ({formatTime12Hour(startStr)}) → {formatTime12Hour(endStr)}{isNextDay ? " (Next Day)" : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "14px", color: "#65736A" }}>Estimated Total</div>
          <div style={{ fontSize: "26px", fontWeight: 800, color: "#0C3B27" }}>
            ₱{totalAmount}
          </div>
        </div>
      </div>

      {/* Duration grid options */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        {DURATION_OPTIONS.map((hours) => {
          const isSelected = durationHours === hours;
          const cost = rate * hours;
          const buttonEndMinutes = startHour * 60 + startMinute + hours * 60;
          const buttonIsNextDay = buttonEndMinutes >= 1440;
          return (
            <button
              key={hours}
              type="button"
              onClick={() => {
                onSelectDuration(hours);
                setCustomInputStr(String(hours));
              }}
              style={{
                padding: "24px 16px",
                borderRadius: "18px",
                textAlign: "center",
                cursor: "pointer",
                transition: "all 0.15s ease",
                background: isSelected ? "#0C3B27" : "#FFFFFF",
                border: isSelected ? "3px solid #0C3B27" : "2px solid #E1E9E3",
                color: isSelected ? "#FFFFFF" : "#12251A",
                boxShadow: isSelected ? "0 8px 20px rgba(12, 59, 39, 0.18)" : "none",
              }}
            >
              <div style={{ fontSize: "32px", fontWeight: 800, marginBottom: "4px" }}>
                {hours} {hours === 1 ? "hr" : "hrs"}
              </div>
              {buttonIsNextDay && (
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: isSelected ? "#C8F451" : "#2E7D32",
                    marginBottom: "4px",
                  }}
                >
                  (Next Day)
                </div>
              )}
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: isSelected ? "#C8F451" : "#65736A",
                }}
              >
                ₱{cost}
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom Duration Input */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "32px",
          padding: "16px 20px",
          background: "#FFFFFF",
          borderRadius: "16px",
          border: "1px solid #E1E9E3",
        }}
      >
        <div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#12251A" }}>Custom Duration</div>
          <div style={{ fontSize: "13px", color: "#65736A" }}>Or enter the exact number of hours you need:</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Custom duration in hours"
            value={customInputStr}
            onChange={(e) => {
              const raw = e.target.value;
              const sanitized = raw.replace(/\D/g, "").replace(/^0+/, "");
              setCustomInputStr(sanitized);
              if (sanitized === "") {
                onSelectDuration(0);
              } else {
                const parsed = parseInt(sanitized, 10);
                onSelectDuration(parsed > 0 ? parsed : 0);
              }
            }}
            onKeyDown={handleNumericKeyDown}
            placeholder="Hours"
            style={{
              width: "90px",
              padding: "10px 12px",
              borderRadius: "12px",
              border: "1px solid #C5D6C9",
              fontSize: "16px",
              fontWeight: 800,
              textAlign: "center",
              color: "#12251A",
              outline: "none",
            }}
          />
          <span style={{ fontSize: "15px", fontWeight: 700, color: "#12251A" }}>
            {durationHours === 1 ? "Hour" : "Hours"}
          </span>
        </div>
      </div>

      <button
        type="button"
        disabled={durationHours <= 0}
        onClick={() => {
          if (durationHours <= 0) return;
          onNext();
        }}
        style={{
          width: "100%",
          padding: "22px",
          borderRadius: "16px",
          background: durationHours <= 0 ? "#8FA89B" : "#0C3B27",
          color: "#FFFFFF",
          border: "none",
          fontSize: "22px",
          fontWeight: 800,
          cursor: durationHours <= 0 ? "not-allowed" : "pointer",
          boxShadow: durationHours <= 0 ? "none" : "0 8px 24px rgba(12, 59, 39, 0.2)",
          opacity: durationHours <= 0 ? 0.6 : 1,
        }}
      >
        {durationHours <= 0 ? "Select at least 1 hour" : "Continue to Pick a Spot →"}
      </button>
    </main>
  );
}
