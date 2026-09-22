"use client";

import React, { useEffect, useState } from "react";
import type {
  AdminReservationAdvancedFilters,
  DateRangePreset,
} from "@deskatlas/domain";

interface ReservationFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters: AdminReservationAdvancedFilters;
  onApply: (newFilters: AdminReservationAdvancedFilters) => void;
  onReset: () => void;
  availableTemplates?: string[];
}

export function ReservationFilterModal({
  isOpen,
  onClose,
  filters,
  onApply,
  onReset,
  availableTemplates = [
    "Hot Desk",
    "Dedicated Desk",
    "Private Office",
    "Meeting Room",
  ],
}: ReservationFilterModalProps) {
  const [datePreset, setDatePreset] = useState<DateRangePreset>(
    filters.datePreset || "all"
  );
  const [startDate, setStartDate] = useState<string>(filters.startDate || "");
  const [endDate, setEndDate] = useState<string>(filters.endDate || "");
  const [workspaceTemplate, setWorkspaceTemplate] = useState<string>(
    filters.workspaceTemplate || "all"
  );
  const [paymentMethod, setPaymentMethod] = useState<string>(
    filters.paymentMethod || "all"
  );
  const [paymentStatus, setPaymentStatus] = useState<string>(
    filters.paymentStatus || "all"
  );
  const [status, setStatus] = useState<string>(filters.status || "all");
  const [source, setSource] = useState<string>(filters.source || "all");

  useEffect(() => {
    if (isOpen) {
      setDatePreset(filters.datePreset || "all");
      setStartDate(filters.startDate || "");
      setEndDate(filters.endDate || "");
      setWorkspaceTemplate(filters.workspaceTemplate || "all");
      setPaymentMethod(filters.paymentMethod || "all");
      setPaymentStatus(filters.paymentStatus || "all");
      setStatus(filters.status || "all");
      setSource(filters.source || "all");
    }
  }, [isOpen, filters]);

  if (!isOpen) return null;

  const handleApply = () => {
    onApply({
      datePreset,
      startDate: datePreset === "custom" || (!datePreset && startDate) ? startDate : undefined,
      endDate: datePreset === "custom" || (!datePreset && endDate) ? endDate : undefined,
      workspaceTemplate: workspaceTemplate !== "all" ? workspaceTemplate : undefined,
      paymentMethod: paymentMethod !== "all" ? paymentMethod : undefined,
      paymentStatus: paymentStatus !== "all" ? paymentStatus : undefined,
      status: status !== "all" ? status : undefined,
      source: source !== "all" ? source : undefined,
    });
    onClose();
  };

  const handleReset = () => {
    setDatePreset("all");
    setStartDate("");
    setEndDate("");
    setWorkspaceTemplate("all");
    setPaymentMethod("all");
    setPaymentStatus("all");
    setStatus("all");
    setSource("all");
    onReset();
    onClose();
  };

  const presetOptions: Array<{ label: string; value: DateRangePreset }> = [
    { label: "All Time", value: "all" },
    { label: "Today", value: "today" },
    { label: "Tomorrow", value: "tomorrow" },
    { label: "This Week", value: "this_week" },
    { label: "This Month", value: "this_month" },
    { label: "Custom Range", value: "custom" },
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-modal-title"
        style={{
          background: "#fff",
          borderRadius: "16px",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.15)",
          width: "100%",
          maxWidth: "520px",
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid var(--da-border)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "20px 24px",
            borderBottom: "1px solid var(--da-border-light)",
          }}
        >
          <div>
            <h2
              id="filter-modal-title"
              style={{
                fontSize: "18px",
                fontWeight: 800,
                color: "var(--da-brand-dark)",
                margin: 0,
              }}
            >
              Filter Reservations
            </h2>
            <p
              style={{
                fontSize: "12px",
                color: "var(--da-text-secondary)",
                margin: "4px 0 0",
              }}
            >
              Refine bookings by schedule, tier, payment, and channel
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close filters"
            style={{
              background: "transparent",
              border: "none",
              fontSize: "18px",
              cursor: "pointer",
              color: "var(--da-text-secondary)",
              padding: "4px 8px",
              borderRadius: "6px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          {/* Date Range Section */}
          <div>
            <label
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--da-brand-dark)",
                display: "block",
                marginBottom: "8px",
              }}
            >
              Date Range
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
                marginBottom: datePreset === "custom" ? "12px" : "0",
              }}
            >
              {presetOptions.map((opt) => {
                const isSelected = datePreset === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDatePreset(opt.value)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      border: isSelected
                        ? "1px solid var(--da-brand-dark)"
                        : "1px solid var(--da-border)",
                      background: isSelected
                        ? "var(--da-brand-dark)"
                        : "#fff",
                      color: isSelected ? "#fff" : "var(--da-text-primary)",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {datePreset === "custom" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                  marginTop: "10px",
                }}
              >
                <div>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--da-text-secondary)",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    From Date
                  </span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    aria-label="From Date"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: "1px solid var(--da-border)",
                      fontSize: "12px",
                      color: "var(--da-text-primary)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--da-text-secondary)",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    To Date
                  </span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    aria-label="To Date"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: "1px solid var(--da-border)",
                      fontSize: "12px",
                      color: "var(--da-text-primary)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Workspace Tier / Template */}
          <div>
            <label
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--da-brand-dark)",
                display: "block",
                marginBottom: "6px",
              }}
            >
              Workspace Tier / Template
            </label>
            <select
              value={workspaceTemplate}
              onChange={(e) => setWorkspaceTemplate(e.target.value)}
              aria-label="Workspace Tier"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--da-border)",
                fontSize: "13px",
                color: "var(--da-text-primary)",
                background: "#fff",
                boxSizing: "border-box",
              }}
            >
              <option value="all">All Workspace Tiers</option>
              {availableTemplates.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Payment Method */}
          <div>
            <label
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--da-brand-dark)",
                display: "block",
                marginBottom: "6px",
              }}
            >
              Payment Method
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              aria-label="Payment Method"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--da-border)",
                fontSize: "13px",
                color: "var(--da-text-primary)",
                background: "#fff",
                boxSizing: "border-box",
              }}
            >
              <option value="all">All Payment Methods</option>
              <option value="gcash">GCash (Online QR)</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cash">Cash (Onsite Counter)</option>
            </select>
          </div>

          {/* Payment Status */}
          <div>
            <label
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--da-brand-dark)",
                display: "block",
                marginBottom: "6px",
              }}
            >
              Payment Status
            </label>
            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              aria-label="Payment Status"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--da-border)",
                fontSize: "13px",
                color: "var(--da-text-primary)",
                background: "#fff",
                boxSizing: "border-box",
              }}
            >
              <option value="all">All Payment Statuses</option>
              <option value="paid">Paid / Approved</option>
              <option value="under_review">Payment Review</option>
              <option value="pending">Pending Payment</option>
              <option value="expired">Expired</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          {/* Reservation Status */}
          <div>
            <label
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--da-brand-dark)",
                display: "block",
                marginBottom: "6px",
              }}
            >
              Reservation Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Reservation Status"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--da-border)",
                fontSize: "13px",
                color: "var(--da-text-primary)",
                background: "#fff",
                boxSizing: "border-box",
              }}
            >
              <option value="all">All Reservation Statuses</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="REJECTED">Rejected</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="CHECKED_IN">Checked In</option>
              <option value="COMPLETED">Completed</option>
              <option value="EXPIRED">Expired</option>
              <option value="PAYMENT_UNDER_REVIEW">Payment Review</option>
              <option value="PENDING_PAYMENT">Awaiting Proof / Pending</option>
              <option value="PENDING_COUNTER_CONFIRMATION">Counter Queue</option>
            </select>
          </div>

          {/* Source / Channel */}
          <div>
            <label
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--da-brand-dark)",
                display: "block",
                marginBottom: "6px",
              }}
            >
              Source / Booking Channel
            </label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              aria-label="Source Channel"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--da-border)",
                fontSize: "13px",
                color: "var(--da-text-primary)",
                background: "#fff",
                boxSizing: "border-box",
              }}
            >
              <option value="all">All Channels</option>
              <option value="online">Customer Web (Online)</option>
              <option value="kiosk">Kiosk Walk-in</option>
            </select>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 24px",
            borderTop: "1px solid var(--da-border-light)",
            background: "#F9FAF8",
            borderBottomLeftRadius: "16px",
            borderBottomRightRadius: "16px",
          }}
        >
          <button
            type="button"
            onClick={handleReset}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--da-text-secondary)",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              padding: "8px 12px",
            }}
          >
            Reset / Clear All
          </button>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "#fff",
                border: "1px solid var(--da-border)",
                borderRadius: "8px",
                padding: "8px 16px",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--da-text-primary)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              style={{
                background: "var(--da-brand-dark)",
                border: "none",
                borderRadius: "8px",
                padding: "8px 18px",
                fontSize: "12px",
                fontWeight: 700,
                color: "#fff",
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(12, 59, 39, 0.2)",
              }}
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
