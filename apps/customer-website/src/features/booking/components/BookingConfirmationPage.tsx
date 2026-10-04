"use client";

import Link from "next/link";
import { formatBookingAccessState, formatBookingCheckInState } from "@deskatlas/domain";
import { useBookingAccess } from "../hooks/useBookingAccess";

export function BookingConfirmationPage({ token }: { token: string }) {
  const { data, loading, error, refetch } = useBookingAccess(token);

  return (
    <main className="min-h-screen bg-[var(--da-canvas)] px-6 py-12">
      <div className="mx-auto max-w-4xl rounded-[28px] border border-[var(--da-border)] bg-white p-8 shadow-[var(--da-shadow-lg)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--da-primary)]">
              Booking
            </p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-[-0.03em] text-[var(--da-brand-dark)]">
              Booking confirmation
            </h1>
          </div>
          <Link href="/track" className="da-secondary-button">
            Track Reservation
          </Link>
        </div>

        {loading ? (
          <div className="mt-8 rounded-[22px] bg-[var(--da-canvas)] p-6 text-sm text-[var(--da-text-secondary)]">
            Loading booking details...
          </div>
        ) : null}

        {error ? (
          <div className="mt-8 rounded-[22px] border border-red-200 bg-red-50 p-6">
            <p className="font-semibold text-red-900">Booking unavailable</p>
            <p className="mt-2 text-sm text-red-700">{error}</p>
            <button className="mt-4 da-inline-button" onClick={refetch}>
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !error && data ? (
          <>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <Card label="Reference" value={data.referenceCode} />
              <Card label="Guest" value={data.customerName} />
              <Card label="Workspace" value={data.workspaceDisplayName} />
              <Card label="Floor" value={data.floorName} />
              <Card label="Access state" value={formatBookingAccessState(data.accessState)} />
              <Card label="Check-in state" value={formatBookingCheckInState(data.checkInState)} />
            </div>

            <div className="mt-6 rounded-[24px] bg-[var(--da-canvas)] p-6">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--da-text-secondary)]">
                Booking window
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--da-text-primary)]">
                {new Date(data.bookingStartAt).toLocaleString()} to{" "}
                {new Date(data.bookingEndAt).toLocaleString()}
              </p>
              <p className="mt-4 text-sm leading-7 text-[var(--da-text-secondary)]">
                This page reflects the real backend token state. Booking QR access is only
                active during the confirmed booking window and can support re-entry.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] bg-[var(--da-canvas)] px-5 py-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--da-text-secondary)]">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-[var(--da-text-primary)]">{value}</p>
    </div>
  );
}
