"use client";

import React, { useState, useEffect } from "react";
import type { GuestReservationTrackingResult } from "@deskatlas/domain";

interface AvailableSpot {
  id: string;
  instanceCode: string;
  displayName: string;
  templateId: string;
  templateName: string;
  floorId: string;
  floorName?: string;
  isAvailable: boolean;
  reason?: string;
}

interface CustomerRelocateModalProps {
  trackingData: GuestReservationTrackingResult;
  customerEmail?: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const RELOCATION_REASONS = [
  "Power outlet issue",
  "Desk / Chair defect",
  "Noise / Disturbance",
  "Wi-Fi / Connectivity issue",
  "Other",
];

function formatTime(isoString?: string | null): string {
  if (!isoString) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

export function CustomerRelocateModal({
  trackingData,
  customerEmail,
  onClose,
  onSuccess,
}: CustomerRelocateModalProps) {
  const [spots, setSpots] = useState<AvailableSpot[]>([]);
  const [selectedSpotId, setSelectedSpotId] = useState<string>("");
  const [reason, setReason] = useState<string>(RELOCATION_REASONS[0]);
  const [notes, setNotes] = useState<string>("");
  const [isLoadingSpots, setIsLoadingSpots] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const finalAssignment = trackingData.finalAssignment;
  const originalEndAt = finalAssignment?.bookingEndAt;
  const remainingMinutes = trackingData.remainingMinutes ?? 0;
  const remainingHours = Math.floor(remainingMinutes / 60);
  const remMins = remainingMinutes % 60;
  const remainingTimeText =
    remainingHours > 0
      ? `${remainingHours} hour${remainingHours > 1 ? "s" : ""}${remMins > 0 ? ` ${remMins} min${remMins > 1 ? "s" : ""}` : ""}`
      : `${remMins} min${remMins > 1 ? "s" : ""}`;

  useEffect(() => {
    let isMounted = true;
    setIsLoadingSpots(true);
    setErrorMessage(null);

    const query = new URLSearchParams({
      referenceCode: trackingData.referenceCode,
    });
    if (customerEmail) {
      query.set("customerEmail", customerEmail);
    }

    fetch(`/api/track/available-relocation-spots?${query.toString()}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to load available spots.");
        }
        if (isMounted) {
          const availableSpots = data.spots || [];
          setSpots(availableSpots);
          if (availableSpots.length > 0) {
            setSelectedSpotId(availableSpots[0].id);
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          setErrorMessage(err.message || "Failed to load available spots.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingSpots(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [trackingData.referenceCode, customerEmail]);

  async function handleConfirmRelocate() {
    if (!selectedSpotId) {
      setErrorMessage("Please select an available target spot.");
      return;
    }
    if (!reason) {
      setErrorMessage("Please select a reason for relocation.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/track/relocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceCode: trackingData.referenceCode,
          customerEmail,
          targetWorkspaceInstanceId: selectedSpotId,
          reason,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to relocate spot.");
      }

      onSuccess(
        data.message ||
          "Relocation request submitted. Please wait for staff or admin approval."
      );
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to relocate reservation.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      data-modal="customer-relocate-modal"
      data-testid="customer-relocate-modal"
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
              In-Session Relocation
            </p>
            <h2 className="mt-1 text-2xl font-extrabold text-[var(--da-brand-dark)]">
              Request Spot Relocation
            </h2>
            <p className="mt-0.5 text-xs text-[var(--da-text-secondary)]">
              Reference: <strong className="font-mono">{trackingData.referenceCode}</strong> • Relocation is subject to staff approval
            </p>
          </div>
          <button
            type="button"
            data-testid="close-customer-relocate-modal"
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
            <span className="text-[var(--da-text-secondary)]">Current Spot:</span>
            <span className="font-bold text-[var(--da-text-primary)]">
              {finalAssignment?.workspaceDisplayName || "Assigned Spot"}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-[var(--da-text-secondary)]">Remaining Time:</span>
            <span className="font-bold text-[var(--da-primary)]">
              {remainingTimeText} (until {formatTime(originalEndAt)})
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-[var(--da-text-secondary)]">Workspace Tier:</span>
            <span className="font-bold text-[var(--da-text-primary)]">
              {finalAssignment?.workspaceTemplateName || "Standard"}
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-bold text-[var(--da-text-primary)]">
              Select Desired Spot *
            </label>
            {isLoadingSpots ? (
              <div className="py-2 text-xs text-[var(--da-text-secondary)]">
                Loading available same-tier spots...
              </div>
            ) : spots.length === 0 ? (
              <div className="mt-1 rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                No same-tier spots currently available. All other spots are occupied for your remaining time. Please speak with the on-duty staff for assistance.
              </div>
            ) : (
              <select
                data-testid="customer-relocate-spot-select"
                value={selectedSpotId}
                onChange={(e) => setSelectedSpotId(e.target.value)}
                disabled={isSubmitting}
                className="da-input mt-1 w-full text-xs font-medium"
              >
                {spots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName} ({s.instanceCode}) — {s.floorName || "Main Area"}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--da-text-primary)]">
              Reason for Relocation *
            </label>
            <select
              data-testid="customer-relocate-reason-select"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSubmitting}
              className="da-input mt-1 w-full text-xs"
            >
              {RELOCATION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--da-text-primary)]">
              Additional Details (Optional)
            </label>
            <textarea
              data-testid="customer-relocate-notes-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. The power outlet under the desk is not providing electricity..."
              disabled={isSubmitting}
              rows={2}
              className="da-input mt-1 w-full text-xs"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-[var(--da-border-light)] pt-4">
          <button
            type="button"
            data-testid="customer-relocate-cancel-button"
            onClick={() => !isSubmitting && onClose()}
            disabled={isSubmitting}
            className="da-secondary-button text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="customer-confirm-relocate-button"
            onClick={handleConfirmRelocate}
            disabled={isSubmitting || isLoadingSpots || spots.length === 0}
            className="da-primary-button text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Submitting Request..." : "Submit Relocation Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
