"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useReservationTracking } from "../hooks/useReservationTracking";
import { CustomerRescheduleModal } from "./CustomerRescheduleModal";

interface TrackingPageProps {
  initialReferenceCode?: string;
  initialEmail?: string;
}

export function TrackingPage({
  initialReferenceCode = "",
  initialEmail = "",
}: TrackingPageProps = {}) {
  const [referenceCode, setReferenceCode] = useState(initialReferenceCode);
  const [customerEmail, setCustomerEmail] = useState(initialEmail);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { data, loading, error, trackReservation } = useReservationTracking();

  useEffect(() => {
    let code = initialReferenceCode;
    let email = initialEmail;

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const codeFromUrl =
        params.get("code") || params.get("reference") || params.get("referenceCode");
      const emailFromUrl = params.get("email") || params.get("customerEmail");
      if (codeFromUrl) {
        code = codeFromUrl;
      }
      if (emailFromUrl) {
        email = emailFromUrl;
      }
    }

    if (code) {
      const cleanedCode = code.trim().toUpperCase();
      setReferenceCode(cleanedCode);
      if (email) {
        setCustomerEmail(email.trim());
      }
      trackReservation({
        referenceCode: cleanedCode,
        customerEmail: email?.trim() || undefined,
      });
    }
  }, [initialReferenceCode, initialEmail]);

  return (
    <main className="min-h-screen bg-[var(--da-canvas)] px-6 py-12">
      <div className="mx-auto max-w-3xl rounded-[28px] border border-[var(--da-border)] bg-white p-8 shadow-[var(--da-shadow-lg)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--da-primary)]">
              Track Reservation
            </p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-[-0.03em] text-[var(--da-brand-dark)]">
              Check your reservation status
            </h1>
          </div>
          <Link href="/reserve" className="da-secondary-button">
            Reserve Workspace
          </Link>
        </div>

        <div className="mt-8 grid gap-4">
          <label className="grid gap-2 text-sm font-bold">
            Reference code
            <input
              value={referenceCode}
              onChange={(event) => setReferenceCode(event.target.value)}
              className="da-input"
              placeholder="DA-2026-01234"
            />
          </label>
          <label className="grid gap-2 text-sm font-bold">
            Email address
            <input
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              className="da-input"
              placeholder="guest@example.com"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setSuccessMessage(null);
              trackReservation({ referenceCode, customerEmail });
            }}
            disabled={loading}
            className="da-primary-button mt-2 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Checking reservation..." : "Check Status"}
          </button>
        </div>

        {successMessage ? (
          <div className="mt-6 rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {successMessage}
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {data ? (() => {
          const isRejected =
            data.status === "REJECTED" ||
            data.paymentStatus === "REJECTED" ||
            (data.status === "CANCELLED" && (!data.confirmedAt || data.paymentStatus === "REJECTED"));

          const confirmedAtValue = isRejected
            ? "Rejected"
            : data.confirmedAt
            ? formatDateTime(data.confirmedAt)
            : "Pending";

          const finalWorkspaceValue = isRejected
            ? "Rejected"
            : (data.finalAssignment?.workspaceDisplayName ?? "Not assigned yet");

          const bookingTimeValue = isRejected
            ? "Rejected"
            : data.finalAssignment
            ? `${formatDateTime(data.finalAssignment.bookingStartAt)} to ${formatTime(
                data.finalAssignment.bookingEndAt
              )}`
            : "Not assigned yet";

          return (
            <div className="mt-8 rounded-[24px] bg-[var(--da-canvas)] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--da-text-secondary)]">
                    Reference
                  </p>
                  <p className="mt-1 text-lg font-extrabold text-[var(--da-brand-dark)]">
                    {data.referenceCode}
                  </p>
                </div>
                <span
                  className={`rounded-full px-4 py-2 text-xs font-bold ${
                    isRejected
                      ? "bg-red-100 text-red-700"
                      : "bg-[var(--da-info)] text-[var(--da-primary)]"
                  }`}
                >
                  {isRejected ? "REJECTED" : data.status}
                </span>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <InfoCard label="Amount due" value={`${data.currency} ${data.amountDue}`} />
                <InfoCard label="Confirmed at" value={confirmedAtValue} />
                <InfoCard label="Final workspace" value={finalWorkspaceValue} />
                <InfoCard label="Booking time" value={bookingTimeValue} />
              </div>

              {/* Reschedule Action Section */}
              {!isRejected && data.status === "CONFIRMED" && (
                <div className="mt-6 rounded-[18px] border border-[var(--da-border-light)] bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--da-text-secondary)]">
                        Schedule Management
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--da-text-primary)]">
                        {data.canReschedule
                          ? "Need to adjust your visit? You can reschedule your booking date/time."
                          : data.rescheduleCount && data.rescheduleCount >= 1
                          ? "This reservation has already been rescheduled (limit 1x)."
                          : `Self-service rescheduling closes ${data.rescheduleCutoffHours ?? 12} hours prior to booking start time.`}
                      </p>
                    </div>

                    {data.canReschedule ? (
                      <button
                        type="button"
                        onClick={() => setShowRescheduleModal(true)}
                        className="da-primary-button text-xs font-bold"
                        data-testid="customer-reschedule-button"
                      >
                        Reschedule Reservation
                      </button>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-500">
                        {data.rescheduleCount && data.rescheduleCount >= 1
                          ? "Rescheduled (1/1)"
                          : "Reschedule Unavailable"}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })() : null}

        {showRescheduleModal && data && (
          <CustomerRescheduleModal
            trackingData={data}
            customerEmail={customerEmail || undefined}
            onClose={() => setShowRescheduleModal(false)}
            onSuccess={(msg) => {
              setShowRescheduleModal(false);
              setSuccessMessage(msg);
              trackReservation({ referenceCode, customerEmail });
            }}
          />
        )}
      </div>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-[var(--da-border-light)] bg-white px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--da-text-secondary)]">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-[var(--da-text-primary)]">{value}</p>
    </div>
  );
}

function formatDateTime(value: string, timezone = "Asia/Manila") {
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    const dateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
    return `${dateStr}, ${timeStr}`;
  } catch {
    return value;
  }
}

function formatTime(value: string, timezone = "Asia/Manila") {
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return value;
  }
}
