"use client";

import React, { useState, useEffect } from "react";
import type { GuestReservationTrackingResult } from "@deskatlas/domain";

interface CustomerRescheduleModalProps {
  trackingData: GuestReservationTrackingResult;
  customerEmail?: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function CustomerRescheduleModal({
  trackingData,
  customerEmail,
  onClose,
  onSuccess,
}: CustomerRescheduleModalProps) {
  const timezone = "Asia/Manila";
  const [rescheduleDate, setRescheduleDate] = useState<string>(() => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(tomorrow);
    } catch {
      return new Date().toISOString().split("T")[0];
    }
  });

  const [openTime, setOpenTime] = useState<string>("08:00");
  const [closeTime, setCloseTime] = useState<string>("20:00");
  const [is24Hours, setIs24Hours] = useState<boolean>(false);
  const [isClosed, setIsClosed] = useState<boolean>(false);
  const [timeOptions, setTimeOptions] = useState<string[]>(() =>
    generateRescheduleTimeOptions("08:00", "20:00", false, false, 2)
  );

  const [selectedTime, setSelectedTime] = useState<string>("09:00");
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [isSlotAvailable, setIsSlotAvailable] = useState<boolean | null>(null);
  const [availabilityReason, setAvailabilityReason] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const finalAssignment = trackingData.finalAssignment;
  const originalStartAt = finalAssignment?.bookingStartAt;
  const originalEndAt = finalAssignment?.bookingEndAt;

  // Calculate original duration in hours
  const originalDurationHours = (() => {
    if (!originalStartAt || !originalEndAt) return 2;
    const startMs = new Date(originalStartAt).getTime();
    const endMs = new Date(originalEndAt).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return 2;
    return Math.round(((endMs - startMs) / (1000 * 60 * 60)) * 10) / 10;
  })();

  const minDate = (() => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch {
      return new Date().toISOString().split("T")[0];
    }
  })();

  // Compute calculated end time
  const calculatedEndTime = (() => {
    const [hStr, mStr] = selectedTime.split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr || "0", 10);
    if (isNaN(h)) return "";
    const totalMinutes = h * 60 + m + Math.round(originalDurationHours * 60);
    const endH = Math.floor(totalMinutes / 60);
    const endM = totalMinutes % 60;
    return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  })();

  const startIso = (() => {
    if (!rescheduleDate || !selectedTime) return "";
    return `${rescheduleDate}T${selectedTime}:00+08:00`;
  })();

  const endIso = (() => {
    if (!startIso) return "";
    const startMs = new Date(startIso).getTime();
    if (isNaN(startMs)) return "";
    const durationMs = Math.round(originalDurationHours * 60 * 60 * 1000);
    const endMs = startMs + durationMs;
    const endDate = new Date(endMs);

    const nextDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(endDate);

    const timeParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(endDate);

    return `${nextDateStr}T${timeParts}:00+08:00`;
  })();

  useEffect(() => {
    checkAvailability();
  }, [rescheduleDate, selectedTime]);

  async function checkAvailability() {
    if (!rescheduleDate) return;
    try {
      setIsCheckingAvailability(true);
      setErrorMessage(null);
      const res = await fetch("/api/track/reschedule-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceCode: trackingData.referenceCode,
          customerEmail,
          date: rescheduleDate,
          startAt: startIso ? new Date(startIso).toISOString() : undefined,
          endAt: endIso ? new Date(endIso).toISOString() : undefined,
          durationHours: originalDurationHours,
          workspaceInstanceId: finalAssignment?.workspaceInstanceId,
        }),
      });

      const data = await res.json().catch(() => ({}));

      const respOpenTime = data.openTime || (data.is24Hours ? "00:00" : "08:00");
      const respCloseTime = data.closeTime || (data.is24Hours ? "24:00" : "20:00");
      const respIs24Hours = Boolean(data.is24Hours);
      const respIsClosed = Boolean(data.isClosed);

      setOpenTime(respOpenTime);
      setCloseTime(respCloseTime);
      setIs24Hours(respIs24Hours);
      setIsClosed(respIsClosed);

      const newSlots = generateRescheduleTimeOptions(
        respOpenTime,
        respCloseTime,
        respIs24Hours,
        respIsClosed,
        originalDurationHours
      );
      setTimeOptions(newSlots);

      if (respIsClosed) {
        setIsSlotAvailable(false);
        setAvailabilityReason(data.reason || "The facility is closed on the selected date.");
      } else if (!res.ok) {
        setIsSlotAvailable(false);
        setAvailabilityReason(data.error || "Slot is unavailable");
      } else {
        setIsSlotAvailable(data.available !== false);
        setAvailabilityReason(data.reason || (data.available !== false ? null : "Spot is occupied during this time window"));
        if (newSlots.length > 0 && !newSlots.includes(selectedTime)) {
          setSelectedTime(newSlots[0]);
        }
      }
    } catch {
      setIsSlotAvailable(false);
      setAvailabilityReason("Unable to verify slot availability.");
    } finally {
      setIsCheckingAvailability(false);
    }
  }

  async function handleConfirmReschedule() {
    if (!isSlotAvailable || isCheckingAvailability || isSubmitting) return;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const res = await fetch("/api/track/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceCode: trackingData.referenceCode,
          customerEmail,
          startAt: new Date(startIso).toISOString(),
          endAt: new Date(endIso).toISOString(),
          workspaceInstanceId: finalAssignment?.workspaceInstanceId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to reschedule reservation.");
      }

      onSuccess(data.message || "Reservation rescheduled successfully! An updated confirmation email has been sent.");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to reschedule reservation.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      data-modal="customer-reschedule-modal"
      data-testid="customer-reschedule-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-[28px] border border-[var(--da-border)] bg-white p-6 shadow-2xl md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--da-border-light)] pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--da-primary)]">
              Self-Service Reschedule
            </p>
            <h2 className="mt-1 text-2xl font-extrabold text-[var(--da-brand-dark)]">
              Reschedule Reservation
            </h2>
            <p className="mt-0.5 text-xs text-[var(--da-text-secondary)]">
              Reference: <strong className="font-mono">{trackingData.referenceCode}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={() => !isSubmitting && onClose()}
            disabled={isSubmitting}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-[14px] border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="mt-4 rounded-[18px] bg-[var(--da-canvas)] p-4 text-xs">
          <div className="flex justify-between py-1">
            <span className="text-[var(--da-text-secondary)]">Allocated Spot:</span>
            <span className="font-bold text-[var(--da-brand-dark)]">
              {finalAssignment?.workspaceDisplayName || "Assigned Spot"} ({finalAssignment?.workspaceTemplateName || "Standard"})
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-[var(--da-text-secondary)]">Current Schedule:</span>
            <span className="font-bold text-[var(--da-brand-dark)]">
              {originalStartAt ? formatScheduleTime(originalStartAt, originalEndAt) : "N/A"}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-[var(--da-text-secondary)]">Locked Duration:</span>
            <span className="font-bold text-[var(--da-brand-dark)]">
              {originalDurationHours} {originalDurationHours === 1 ? "Hour" : "Hours"} (Same Tier Spot)
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <div>
            <label className="block text-xs font-bold text-[var(--da-brand-dark)]">
              New Date *
            </label>
            <input
              type="date"
              min={minDate}
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              disabled={isSubmitting}
              className="da-input mt-1 w-full text-sm font-semibold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[var(--da-brand-dark)]">
                Start Time *
              </label>
              <select
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                disabled={isSubmitting || isClosed || timeOptions.length === 0}
                className="da-input mt-1 w-full text-sm font-semibold bg-white disabled:bg-gray-100 disabled:text-gray-400"
              >
                {timeOptions.length === 0 ? (
                  <option value="">{isClosed ? "Facility Closed" : "No slots available"}</option>
                ) : (
                  timeOptions.map((time) => (
                    <option key={time} value={time}>
                      {format12HourTime(time)}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--da-brand-dark)]">
                End Time (Calculated)
              </label>
              <input
                type="text"
                readOnly
                value={format12HourTime(calculatedEndTime)}
                className="da-input mt-1 w-full bg-gray-50 text-sm font-semibold text-gray-600"
              />
            </div>
          </div>

          {/* Availability Status Badge */}
          <div className="rounded-[14px] border border-[var(--da-border-light)] p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--da-text-secondary)]">Spot Availability:</span>
              {isCheckingAvailability ? (
                <span className="text-gray-500 font-medium">Checking availability...</span>
              ) : isSlotAvailable ? (
                <span className="font-bold text-emerald-600 flex items-center gap-1">
                  ✓ Available for booking
                </span>
              ) : (
                <span className="font-bold text-red-600 flex items-center gap-1">
                  ✕ {availabilityReason || "Unavailable"}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-[14px] bg-amber-50 border border-amber-200 p-3 text-[11px] text-amber-800 leading-relaxed">
            ℹ️ <strong>Self-Service Rule:</strong> Rescheduling is allowed max <strong>1 time</strong> with the same duration and template tier. Must be submitted at least <strong>{trackingData.rescheduleCutoffHours ?? 12} hours</strong> before original start time.
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-[var(--da-border-light)] pt-4">
          <button
            type="button"
            onClick={() => !isSubmitting && onClose()}
            disabled={isSubmitting}
            className="da-secondary-button text-xs font-bold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmReschedule}
            disabled={!isSlotAvailable || isCheckingAvailability || isSubmitting || isClosed}
            className="da-primary-button text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Rescheduling..." : "Confirm Reschedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

function generateRescheduleTimeOptions(
  openTime: string = "08:00",
  closeTime: string = "20:00",
  is24Hours: boolean = false,
  isClosed: boolean = false,
  durationHours: number = 2
): string[] {
  if (isClosed) return [];

  const intervalMinutes = 30;
  const durationMinutes = Math.round(durationHours * 60);

  if (is24Hours) {
    const slots: string[] = [];
    for (let m = 0; m < 1440; m += intervalMinutes) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
    }
    return slots.length > 0 ? slots : ["00:00"];
  }

  const [openH, openM] = openTime.split(":").map(Number);
  const openMinutes = (openH || 0) * 60 + (openM || 0);

  let closeMinutes = 20 * 60;
  if (closeTime) {
    const [closeH, closeM] = closeTime.split(":").map(Number);
    closeMinutes = (closeH === 0 || closeH === 24 ? 24 : (closeH || 0)) * 60 + (closeM || 0);
  }

  const maxStartMinute = closeMinutes - durationMinutes;
  const slots: string[] = [];

  for (let m = openMinutes; m <= maxStartMinute; m += intervalMinutes) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }

  return slots;
}

function format12HourTime(timeStr: string) {
  if (!timeStr) return "";
  const [hStr, mStr] = timeStr.split(":");
  const rawH = parseInt(hStr, 10);
  const m = parseInt(mStr || "0", 10);
  if (isNaN(rawH)) return timeStr;
  const isNextDay = rawH >= 24;
  const h = rawH % 24;
  const period = h >= 12 && h < 24 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const formatted = `${hour12}:${String(m).padStart(2, "0")} ${period}`;
  return isNextDay ? `${formatted} (Next Day)` : formatted;
}

function formatScheduleTime(startIso: string, endIso?: string | null, timezone = "Asia/Manila") {
  try {
    const s = new Date(startIso);
    if (isNaN(s.getTime())) return startIso;
    const dateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(s);
    const startStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(s);

    if (endIso) {
      const e = new Date(endIso);
      const endStr = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(e);
      return `${dateStr}, ${startStr} - ${endStr}`;
    }
    return `${dateStr}, ${startStr}`;
  } catch {
    return startIso;
  }
}
