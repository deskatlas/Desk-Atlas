"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Monitor, Clock, ShieldCheck, CheckCircle2, RotateCcw } from "lucide-react";
import type { BookingScanResult, BookingRental } from "@deskatlas/domain";
import { BookingLookupCard } from "./BookingLookupCard";
import { AssignRentalModal } from "./AssignRentalModal";
import { ActiveRentalsTable } from "./ActiveRentalsTable";

interface RentalDeskPageProps {
  apiPrefix?: string;
  actorRole?: "STAFF" | "ADMIN";
  staffUserId?: string | null;
}

export function RentalDeskPage({
  apiPrefix = "/api/operations/rentals",
  actorRole = "STAFF",
  staffUserId,
}: RentalDeskPageProps) {
  const [rentals, setRentals] = useState<BookingRental[]>([]);
  const [loading, setLoading] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingScanResult | null>(null);

  const fetchRentals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(apiPrefix, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.rentals)) {
          setRentals(data.rentals);
        }
      }
    } catch (err) {
      console.error("Failed to fetch rentals:", err);
    } finally {
      setLoading(false);
    }
  }, [apiPrefix]);

  useEffect(() => {
    fetchRentals();
    const interval = setInterval(fetchRentals, 30000);
    return () => clearInterval(interval);
  }, [fetchRentals]);

  const activeCount = rentals.filter((r) => r.status === "active").length;
  const overdueCount = rentals.filter(
    (r) => r.status === "overdue" || (r.status === "active" && r.isOverdue)
  ).length;
  const returnedCount = rentals.filter((r) => r.status === "returned").length;

  const handleVerifiedBookingSelected = (booking: BookingScanResult) => {
    setSelectedBooking(booking);
    setAssignModalOpen(true);
  };

  return (
    <div
      data-testid="rental-desk-page"
      style={{
        padding: "24px 28px",
        maxWidth: "1400px",
        margin: "0 auto",
        width: "100%",
        fontFamily: "var(--da-font-family)",
      }}
    >
      {/* Top Banner / Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--da-text-primary)", margin: 0 }}>
          Equipment Rental Desk
        </h1>
        <p style={{ fontSize: "13px", color: "var(--da-text-secondary)", marginTop: "4px", margin: 0 }}>
          Manage peripheral hardware checkouts, duration extensions, and asset returns.
        </p>
      </div>

      {/* Metric Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div
          data-testid="stat-card-active"
          style={{
            background: "#ffffff",
            border: "1px solid var(--da-border)",
            borderRadius: "12px",
            padding: "16px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--da-text-secondary)" }}>
              Active Rentals
            </span>
            <div style={{ padding: "6px", background: "#DCFCE7", borderRadius: "8px" }}>
              <Monitor size={16} color="#15803D" />
            </div>
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--da-text-primary)", marginTop: "8px" }}>
            {activeCount}
          </div>
        </div>

        <div
          data-testid="stat-card-overdue"
          style={{
            background: "#ffffff",
            border: "1px solid var(--da-border)",
            borderRadius: "12px",
            padding: "16px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--da-text-secondary)" }}>
              Overdue Rentals
            </span>
            <div style={{ padding: "6px", background: "#FFE4E6", borderRadius: "8px" }}>
              <Clock size={16} color="#BE123C" />
            </div>
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: overdueCount > 0 ? "#DC2626" : "var(--da-text-primary)", marginTop: "8px" }}>
            {overdueCount}
          </div>
        </div>

        <div
          data-testid="stat-card-returned"
          style={{
            background: "#ffffff",
            border: "1px solid var(--da-border)",
            borderRadius: "12px",
            padding: "16px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--da-text-secondary)" }}>
              Returned Records
            </span>
            <div style={{ padding: "6px", background: "#F1F5F9", borderRadius: "8px" }}>
              <RotateCcw size={16} color="#475569" />
            </div>
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--da-text-primary)", marginTop: "8px" }}>
            {returnedCount}
          </div>
        </div>
      </div>

      {/* Part 1: Booking Lookup Card */}
      <BookingLookupCard
        onVerifiedBookingSelected={handleVerifiedBookingSelected}
        onClearBooking={() => setSelectedBooking(null)}
        actorRole={actorRole}
        staffUserId={staffUserId}
      />

      {/* Part 2: Active Rentals Table */}
      <ActiveRentalsTable
        rentals={rentals}
        loading={loading}
        onRefresh={fetchRentals}
        apiPrefix={apiPrefix}
        staffUserId={staffUserId}
      />

      {/* Assignment Modal */}
      {assignModalOpen && (
        <AssignRentalModal
          isOpen={assignModalOpen}
          onClose={() => setAssignModalOpen(false)}
          onSuccess={() => {
            setAssignModalOpen(false);
            fetchRentals();
          }}
          booking={selectedBooking}
          apiPrefix={apiPrefix}
          staffUserId={staffUserId}
        />
      )}
    </div>
  );
}

