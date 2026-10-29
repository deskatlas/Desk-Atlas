"use client";

import React, { useState, useEffect } from "react";
import { X, ShieldCheck, AlertCircle, Calendar, Clock, DollarSign } from "lucide-react";
import type { BookingScanResult, AdditionalService, RentalBillingMode } from "@deskatlas/domain";
import { handleNumericKeyDown } from "@deskatlas/ui";

interface AssignRentalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (rental?: any) => void;
  booking: BookingScanResult | null;
  apiPrefix?: string;
  staffUserId?: string | null;
}

export function AssignRentalModal({
  isOpen,
  onClose,
  onSuccess,
  booking,
  apiPrefix = "/api/operations/rentals",
  staffUserId,
}: AssignRentalModalProps) {
  const [items, setItems] = useState<AdditionalService[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [billingMode, setBillingMode] = useState<RentalBillingMode>("hourly");
  const [durationUnits, setDurationUnits] = useState<number | string>(1);
  const [idVerified, setIdVerified] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch available rental items
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const fetchItems = async () => {
      setLoadingItems(true);
      setErrorMsg(null);
      try {
        const res = await fetch(`${apiPrefix}/items`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data.items)) {
            const availableItems = data.items.filter(
              (item: AdditionalService) => item.availableInventory > 0
            );
            setItems(availableItems);
            if (availableItems.length > 0) {
              setSelectedServiceId(availableItems[0].id);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg("Failed to load rental catalog");
        }
      } finally {
        if (!cancelled) {
          setLoadingItems(false);
        }
      }
    };

    fetchItems();
    return () => {
      cancelled = true;
    };
  }, [isOpen, apiPrefix]);

  const selectedItem = items.find((i) => i.id === selectedServiceId);

  // Reset or adjust billing mode if daily rate is not available
  useEffect(() => {
    if (selectedItem && !selectedItem.dailyRate && billingMode === "daily") {
      setBillingMode("hourly");
    }
  }, [selectedItem, billingMode]);

  if (!isOpen || !booking) return null;

  const currentRate =
    billingMode === "hourly"
      ? selectedItem?.hourlyRate ?? 0
      : selectedItem?.dailyRate ?? 0;

  const parsedUnits =
    typeof durationUnits === "number"
      ? durationUnits
      : parseInt(durationUnits, 10) || 0;

  const totalAmount = currentRate * parsedUnits;

  // Calculate projected due time
  const now = new Date();
  const effectiveHoursOrDays = parsedUnits > 0 ? parsedUnits : 1;
  const projectedDue = new Date(
    now.getTime() +
      (billingMode === "hourly"
        ? effectiveHoursOrDays * 60 * 60 * 1000
        : effectiveHoursOrDays * 24 * 60 * 60 * 1000)
  );
  const formattedDueTime = projectedDue.toLocaleTimeString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServiceId) {
      setErrorMsg("Please select a rental item");
      return;
    }
    if (!idVerified) {
      setErrorMsg("Customer ID must be verified and held at the front desk");
      return;
    }

    const finalUnits = typeof durationUnits === "number" ? durationUnits : parseInt(durationUnits, 10);
    if (isNaN(finalUnits) || finalUnits < 1) {
      setErrorMsg("Duration must be at least 1");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch(apiPrefix, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: booking.reservationId,
          serviceId: selectedServiceId,
          billingMode,
          durationUnits: finalUnits,
          idVerified: true,
          idNotes: "",
          staffUserId: staffUserId || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to assign rental");
      }

      const result = await res.json();
      onSuccess(result.rental);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to assign rental";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="assign-rental-modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 150,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        data-testid="assign-rental-modal"
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          maxWidth: "520px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "24px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 800, color: "var(--da-text-primary)", margin: 0 }}>
              Assign Hardware Rental
            </h2>
            <p style={{ fontSize: "12px", color: "var(--da-text-secondary)", marginTop: "4px", margin: 0 }}>
              Assign peripheral equipment to {booking.customerName} ({booking.workspaceDisplayName || booking.workspaceInstanceCode})
            </p>
          </div>
          <button
            type="button"
            data-testid="close-assign-modal-btn"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              color: "var(--da-text-secondary)",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {errorMsg && (
          <div
            data-testid="assign-rental-error-banner"
            style={{
              marginBottom: "16px",
              padding: "10px 14px",
              background: "#FEF2F2",
              border: "1px solid #FCA5A5",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              color: "#991B1B",
            }}
          >
            <AlertCircle size={16} color="#DC2626" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Item Selector */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--da-text-primary)", marginBottom: "6px" }}>
              Select Hardware Item
            </label>
            {loadingItems ? (
              <div style={{ fontSize: "13px", color: "var(--da-text-secondary)" }}>Loading items...</div>
            ) : items.length === 0 ? (
              <div style={{ fontSize: "13px", color: "#DC2626" }}>No rental equipment currently in stock.</div>
            ) : (
              <select
                data-testid="rental-item-select"
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--da-border)",
                  background: "#fff",
                  fontSize: "13px",
                  color: "var(--da-text-primary)",
                  outline: "none",
                }}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.availableInventory} available) - PHP {item.hourlyRate}/hr
                    {item.dailyRate ? ` | PHP ${item.dailyRate}/day` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Billing Mode: Hourly / Daily */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--da-text-primary)", marginBottom: "6px" }}>
              Billing Mode
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <button
                type="button"
                data-testid="billing-mode-hourly-btn"
                onClick={() => setBillingMode("hourly")}
                style={{
                  padding: "10px",
                  borderRadius: "8px",
                  border: billingMode === "hourly" ? "2px solid var(--da-primary)" : "1px solid var(--da-border)",
                  background: billingMode === "hourly" ? "#F0FDF4" : "#fff",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: billingMode === "hourly" ? "#166534" : "var(--da-text-secondary)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}
              >
                <Clock size={15} />
                <span>Hourly (PHP {selectedItem?.hourlyRate || 0}/hr)</span>
              </button>

              <button
                type="button"
                data-testid="billing-mode-daily-btn"
                disabled={!selectedItem?.dailyRate}
                onClick={() => setBillingMode("daily")}
                style={{
                  padding: "10px",
                  borderRadius: "8px",
                  border: billingMode === "daily" ? "2px solid var(--da-primary)" : "1px solid var(--da-border)",
                  background: billingMode === "daily" ? "#F0FDF4" : "#fff",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: billingMode === "daily" ? "#166534" : "var(--da-text-secondary)",
                  cursor: selectedItem?.dailyRate ? "pointer" : "not-allowed",
                  opacity: selectedItem?.dailyRate ? 1 : 0.4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}
              >
                <Calendar size={15} />
                <span>
                  {selectedItem?.dailyRate
                    ? `Daily (PHP ${selectedItem.dailyRate}/day)`
                    : "Daily (Not available)"}
                </span>
              </button>
            </div>
          </div>

          {/* Duration Units Input */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--da-text-primary)", marginBottom: "6px" }}>
              Duration ({billingMode === "hourly" ? "Hours" : "Days"})
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <input
                type="number"
                min="1"
                max="30"
                data-testid="duration-units-input"
                value={durationUnits}
                onChange={(e) => setDurationUnits(e.target.value)}
                onBlur={() => {
                  if (!durationUnits || parseInt(String(durationUnits), 10) < 1) {
                    setDurationUnits(1);
                  }
                }}
                onKeyDown={(e) => handleNumericKeyDown(e)}
                style={{
                  width: "120px",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--da-border)",
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "var(--da-text-primary)",
                  outline: "none",
                }}
              />
              <span style={{ fontSize: "13px", color: "var(--da-text-secondary)" }}>
                {billingMode === "hourly" ? "hour(s)" : "day(s)"}
              </span>
            </div>
          </div>

          {/* Live Fee Calculation Banner */}
          <div
            data-testid="rental-fee-banner"
            style={{
              background: "#F8FAFC",
              border: "1px solid var(--da-border)",
              borderRadius: "10px",
              padding: "14px",
              marginBottom: "18px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "13px", color: "var(--da-text-secondary)" }}>Rental Fee:</span>
              <span style={{ fontSize: "15px", fontWeight: 800, color: "var(--da-brand-dark)" }}>
                PHP {totalAmount.toFixed(2)} ({parsedUnits} x PHP {currentRate.toFixed(2)})
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--da-text-secondary)" }}>Return due by:</span>
              <span data-testid="projected-due-time" style={{ fontSize: "12px", fontWeight: 700, color: "#B45309" }}>
                {formattedDueTime}
              </span>
            </div>
          </div>

          {/* ID Deposit Verification (Mandatory) */}
          <div
            style={{
              background: "#FFFBEB",
              border: "1px solid #FDE68A",
              borderRadius: "10px",
              padding: "14px",
              marginBottom: "20px",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                fontSize: "13px",
                fontWeight: 700,
                color: "#92400E",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                data-testid="id-verified-checkbox"
                checked={idVerified}
                onChange={(e) => setIdVerified(e.target.checked)}
                style={{ marginTop: "2px" }}
              />
              <span>Valid government / corporate ID received and held at front desk</span>
            </label>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 16px",
                background: "#ffffff",
                border: "1px solid var(--da-border)",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="confirm-assign-rental-btn"
              disabled={submitting || !selectedServiceId || !idVerified || items.length === 0 || parsedUnits <= 0}
              style={{
                padding: "10px 20px",
                background: "var(--da-primary)",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: submitting || !selectedServiceId || !idVerified || items.length === 0 || parsedUnits <= 0 ? "not-allowed" : "pointer",
                opacity: submitting || !selectedServiceId || !idVerified || items.length === 0 || parsedUnits <= 0 ? 0.6 : 1,
              }}
            >
              {submitting ? "Assigning..." : "Confirm Assignment & Hand Out Item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

