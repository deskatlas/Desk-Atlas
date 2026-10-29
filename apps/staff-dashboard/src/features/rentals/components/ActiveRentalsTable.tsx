"use client";

import React, { useState } from "react";
import { ArrowUpRight, RotateCcw, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import type { BookingRental } from "@deskatlas/domain";
import { ExtendRentalModal } from "./ExtendRentalModal";

interface ActiveRentalsTableProps {
  rentals: BookingRental[];
  loading: boolean;
  onRefresh: () => void;
  apiPrefix?: string;
  staffUserId?: string | null;
}

function formatClockTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export function ActiveRentalsTable({
  rentals,
  loading,
  onRefresh,
  apiPrefix = "/api/operations/rentals",
  staffUserId,
}: ActiveRentalsTableProps) {
  const [filterTab, setFilterTab] = useState<"all" | "active" | "overdue" | "returned">("active");
  const [selectedExtendRental, setSelectedExtendRental] = useState<BookingRental | null>(null);
  const [returnConfirmRental, setReturnConfirmRental] = useState<BookingRental | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredRentals = rentals.filter((r) => {
    if (filterTab === "active") return r.status === "active";
    if (filterTab === "overdue") return r.status === "overdue" || (r.status === "active" && r.isOverdue);
    if (filterTab === "returned") return r.status === "returned";
    return true;
  }).filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.rentalCode.toLowerCase().includes(q) ||
      (r.customerName && r.customerName.toLowerCase().includes(q)) ||
      (r.spotName && r.spotName.toLowerCase().includes(q)) ||
      (r.serviceName && r.serviceName.toLowerCase().includes(q))
    );
  });

  const handleReturn = async (rentalId: string) => {
    try {
      setReturningId(rentalId);
      const res = await fetch(`${apiPrefix}/${encodeURIComponent(rentalId)}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffUserId: staffUserId || null }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to return rental");
      }

      setReturnConfirmRental(null);
      onRefresh();
    } catch (err) {
      console.error("Return error:", err);
    } finally {
      setReturningId(null);
    }
  };

  return (
    <div
      data-testid="active-rentals-table-container"
      style={{
        background: "#ffffff",
        border: "1px solid var(--da-border)",
        borderRadius: "14px",
        padding: "20px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      {/* Header and Controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        {/* Tabs */}
        <div style={{ display: "flex", gap: "6px" }}>
          {(["active", "overdue", "returned", "all"] as const).map((tab) => {
            const count = rentals.filter((r) => {
              if (tab === "active") return r.status === "active";
              if (tab === "overdue") return r.status === "overdue" || (r.status === "active" && r.isOverdue);
              if (tab === "returned") return r.status === "returned";
              return true;
            }).length;

            return (
              <button
                key={tab}
                type="button"
                data-testid={`rental-tab-${tab}`}
                onClick={() => setFilterTab(tab)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: filterTab === tab ? "1.5px solid var(--da-primary)" : "1px solid var(--da-border)",
                  background: filterTab === tab ? "#F0FDF4" : "#ffffff",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: filterTab === tab ? "#166534" : "var(--da-text-secondary)",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {tab} ({count})
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            data-testid="rentals-table-search-input"
            placeholder="Search code, guest, spot..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: "6px 12px",
              borderRadius: "8px",
              border: "1px solid var(--da-border)",
              fontSize: "12px",
              outline: "none",
              color: "var(--da-text-primary)",
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table
          data-testid="active-rentals-table"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--da-border)", textAlign: "left" }}>
              <th style={{ padding: "10px 12px", color: "var(--da-text-secondary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase" }}>Rental Code</th>
              <th style={{ padding: "10px 12px", color: "var(--da-text-secondary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase" }}>Customer & Spot</th>
              <th style={{ padding: "10px 12px", color: "var(--da-text-secondary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase" }}>Item Rented</th>
              <th style={{ padding: "10px 12px", color: "var(--da-text-secondary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase" }}>Duration & Rate</th>
              <th style={{ padding: "10px 12px", color: "var(--da-text-secondary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase" }}>Rented Time</th>
              <th style={{ padding: "10px 12px", color: "var(--da-text-secondary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase" }}>Due Time</th>
              <th style={{ padding: "10px 12px", color: "var(--da-text-secondary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase" }}>Status</th>
              <th style={{ padding: "10px 12px", color: "var(--da-text-secondary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: "24px", textAlign: "center", color: "var(--da-text-secondary)" }}>
                  Loading rentals...
                </td>
              </tr>
            ) : filteredRentals.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "32px", textAlign: "center", color: "var(--da-text-secondary)" }}>
                  No rental records found.
                </td>
              </tr>
            ) : (
              filteredRentals.map((rental) => {
                const isOverdue = rental.status === "overdue" || (rental.status === "active" && rental.isOverdue);
                const isNearingEnd = rental.status === "active" && rental.isNearingEnd;

                return (
                  <tr
                    key={rental.id}
                    data-testid={`rental-row-${rental.id}`}
                    style={{ borderBottom: "1px solid var(--da-border)" }}
                  >
                    <td style={{ padding: "12px", fontFamily: "monospace", fontWeight: 700 }}>
                      {rental.rentalCode}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <div style={{ fontWeight: 700, color: "var(--da-text-primary)" }}>
                        {rental.customerName || "Customer"}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--da-text-secondary)" }}>
                        {rental.spotName || "Workspace"}
                      </div>
                    </td>
                    <td style={{ padding: "12px", fontWeight: 600, color: "var(--da-brand-dark)" }}>
                      {rental.serviceName || "Hardware Item"}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <div>
                        {rental.durationUnits} {rental.billingMode === "hourly" ? "Hours" : "Days"} @ PHP {rental.rateApplied.toFixed(2)}
                      </div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--da-text-primary)" }}>
                        Total: PHP {rental.totalAmount.toFixed(2)}
                      </div>
                    </td>
                    <td style={{ padding: "12px", color: "var(--da-text-secondary)" }}>
                      {formatClockTime(rental.rentedAt)}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <div
                        style={{
                          fontWeight: 700,
                          color: isOverdue ? "#DC2626" : isNearingEnd ? "#D97706" : "var(--da-text-primary)",
                        }}
                      >
                        {formatClockTime(rental.dueAt)}
                      </div>
                      {isOverdue && (
                        <span style={{ fontSize: "10px", color: "#DC2626", fontWeight: 700 }}>OVERDUE</span>
                      )}
                    </td>
                    <td style={{ padding: "12px" }}>
                      {rental.status === "returned" ? (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "3px 8px",
                            background: "#F1F5F9",
                            color: "#475569",
                            borderRadius: "6px",
                          }}
                        >
                          RETURNED
                        </span>
                      ) : isOverdue ? (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "3px 8px",
                            background: "#FFE4E6",
                            color: "#BE123C",
                            borderRadius: "6px",
                          }}
                        >
                          OVERDUE
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "3px 8px",
                            background: "#DCFCE7",
                            color: "#15803D",
                            borderRadius: "6px",
                          }}
                        >
                          ACTIVE
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      {rental.status !== "returned" ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                          <button
                            type="button"
                            data-testid={`extend-table-btn-${rental.id}`}
                            onClick={() => setSelectedExtendRental(rental)}
                            style={{
                              padding: "6px 10px",
                              background: "var(--da-brand-dark)",
                              color: "#fff",
                              border: "none",
                              borderRadius: "6px",
                              fontSize: "12px",
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <span>Extend</span>
                            <ArrowUpRight size={12} />
                          </button>
                          <button
                            type="button"
                            data-testid={`return-table-btn-${rental.id}`}
                            onClick={() => setReturnConfirmRental(rental)}
                            style={{
                              padding: "6px 10px",
                              background: "#F1F5F9",
                              color: "var(--da-text-primary)",
                              border: "1px solid var(--da-border)",
                              borderRadius: "6px",
                              fontSize: "12px",
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <RotateCcw size={12} />
                            <span>Return</span>
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: "11px", color: "var(--da-text-secondary)" }}>
                          Returned at {formatClockTime(rental.returnedAt || rental.updatedAt)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Return Confirmation Dialog */}
      {returnConfirmRental && (
        <div
          data-testid="table-return-confirm-dialog"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            zIndex: 160,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              maxWidth: "440px",
              width: "100%",
              padding: "24px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 800, color: "var(--da-text-primary)", marginBottom: "8px" }}>
              Confirm Equipment Return
            </h3>
            <p style={{ fontSize: "13px", color: "var(--da-text-secondary)", marginBottom: "16px", lineHeight: "1.5" }}>
              Confirm item has been inspected and customer physical ID has been returned.
            </p>
            <div
              style={{
                background: "var(--da-canvas)",
                border: "1px solid var(--da-border)",
                borderRadius: "10px",
                padding: "12px",
                marginBottom: "20px",
                fontSize: "12px",
              }}
            >
              <div><strong>Code:</strong> {returnConfirmRental.rentalCode}</div>
              <div><strong>Customer:</strong> {returnConfirmRental.customerName}</div>
              <div><strong>Item:</strong> {returnConfirmRental.serviceName}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setReturnConfirmRental(null)}
                style={{
                  padding: "8px 14px",
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
                type="button"
                data-testid="table-confirm-return-submit-btn"
                disabled={Boolean(returningId)}
                onClick={() => handleReturn(returnConfirmRental.id)}
                style={{
                  padding: "8px 16px",
                  background: "var(--da-primary)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {returningId ? "Processing..." : "Confirm Return & Hand Back ID"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extend Modal */}
      {selectedExtendRental && (
        <ExtendRentalModal
          isOpen={Boolean(selectedExtendRental)}
          onClose={() => setSelectedExtendRental(null)}
          onSuccess={() => {
            setSelectedExtendRental(null);
            onRefresh();
          }}
          rental={selectedExtendRental}
          apiPrefix={apiPrefix}
          staffUserId={staffUserId}
        />
      )}
    </div>
  );
}

