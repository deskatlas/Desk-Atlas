"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useReservationTracking } from "../hooks/useReservationTracking";
import { CustomerRescheduleModal } from "./CustomerRescheduleModal";
import { CustomerRelocateModal } from "./CustomerRelocateModal";
import { CancellationTermsModal } from "./CancellationTermsModal";
import { mapReservationStatusDisplay } from "../utils/reservationStatusMap";

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
  const [showRelocateModal, setShowRelocateModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTermsModal(true)}
              data-testid="cancellation-terms-link"
              className="da-secondary-button text-xs font-bold"
            >
              Cancellation & Rescheduling Terms
            </button>
            <Link href="/reserve" className="da-secondary-button">
              Reserve Workspace
            </Link>
          </div>
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

          const isExpired = data.status === "EXPIRED";
          const statusDisplay = mapReservationStatusDisplay(data.status, data.paymentStatus);

          const confirmedAtValue = isRejected
            ? "Rejected"
            : isExpired && !data.confirmedAt
            ? "Expired"
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
                <div className="flex flex-wrap items-center gap-2">
                  {data.isInSession && (
                    <span
                      data-testid="in-session-badge"
                      className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3.5 py-1.5 text-xs font-bold text-emerald-800"
                    >
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      Session In Progress {data.remainingMinutes ? `(${Math.floor(data.remainingMinutes / 60) > 0 ? `${Math.floor(data.remainingMinutes / 60)}h ` : ""}${data.remainingMinutes % 60}m remaining)` : ""}
                    </span>
                  )}
                  <span
                    data-testid="tracking-status-badge"
                    className={`rounded-full px-4 py-2 text-xs font-bold ${
                      isRejected
                        ? "bg-red-100 text-red-700"
                        : statusDisplay.badgeClass
                    }`}
                  >
                    {isRejected ? "REJECTED" : statusDisplay.label}
                  </span>
                </div>
              </div>

              {isExpired && (
                <div
                  data-testid="expired-reservation-notice"
                  className="mt-6 rounded-[18px] border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700"
                >
                  <p className="font-semibold text-gray-900">Reservation Expired</p>
                  <p className="mt-1 text-xs text-gray-600">
                    This reservation has expired. The booking window has passed without confirmed payment.
                    Please create a new reservation if you still wish to book.
                  </p>
                </div>
              )}

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <InfoCard label="Amount due" value={`${data.currency} ${data.amountDue}`} />
                <InfoCard label="Confirmed at" value={confirmedAtValue} />
                <InfoCard label="Final workspace" value={finalWorkspaceValue} />
                <InfoCard label="Booking time" value={bookingTimeValue} />
              </div>

              {/* Closure Impact Remedy Banner */}
              {data.isClosureImpacted && (
                <div
                  data-testid="closure-impact-remedy-banner"
                  className="mt-6 rounded-[20px] border border-amber-300 bg-amber-50 p-5 shadow-sm"
                >
                  <div className="flex items-start gap-3.5">
                    <span className="text-2xl">⚠️</span>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-extrabold uppercase tracking-[0.14em] text-amber-900">
                          Action Required: Booking Impacted by Business Closure
                        </h3>
                        <span className="rounded-full bg-amber-200/80 px-3 py-1 text-xs font-bold text-amber-950">
                          {data.closureImpactStatus === "MANUAL_RESOLUTION_REQUIRED"
                            ? "Staff Intervention In Progress"
                            : data.closureImpactStatus === "CUSTOMER_RESOLVED"
                            ? "Resolved by Customer"
                            : data.closureImpactStatus === "STAFF_RESOLVED"
                            ? "Resolved by Staff"
                            : "Self-Service Remedy Available"}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs font-medium text-amber-900 leading-relaxed">
                        Your reservation overlaps with a scheduled facility closure or holiday maintenance. Advance rescheduling cutoffs and reschedule limits have been waived so you can immediately choose a new date or time or switch spots at no penalty.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          onClick={() => setShowRescheduleModal(true)}
                          data-testid="closure-remedy-reschedule-button"
                          className="da-primary-button text-xs font-bold"
                        >
                          Reschedule Date / Time
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowRelocateModal(true)}
                          data-testid="closure-remedy-relocate-button"
                          className="da-secondary-button text-xs font-bold"
                        >
                          Relocate Spot
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* In-Session Spot Relocation Section */}
              {!isRejected && !isExpired && data.status === "CONFIRMED" && (
                data.pendingRelocationRequest?.status === "PENDING" ? (
                  <div
                    data-testid="customer-pending-relocation-badge"
                    className="mt-6 rounded-[18px] border border-amber-200 bg-amber-50 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl">⏳</span>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-800">
                            Relocation Request Pending Approval
                          </p>
                          <span className="rounded-full bg-amber-200/70 px-2.5 py-0.5 text-[10px] font-bold text-amber-900">
                            Awaiting Staff
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-amber-900">
                          Your request to move to <strong>{data.pendingRelocationRequest.targetWorkspaceDisplayName}</strong> has been submitted to on-duty staff.
                        </p>
                        <p className="mt-1 text-[11px] text-amber-700">
                          Reason: <em>{data.pendingRelocationRequest.reason}</em>
                          {data.pendingRelocationRequest.notes ? ` (${data.pendingRelocationRequest.notes})` : ""}
                        </p>
                        <p className="mt-1.5 text-[11px] text-amber-700/80">
                          Please remain at your current desk until staff approves your request. Your digital QR pass will automatically update once confirmed.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 rounded-[18px] border border-[var(--da-border-light)] bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--da-text-secondary)]">
                          Spot Relocation
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--da-text-primary)]">
                          {data.isInSession
                            ? "Experiencing physical issues with your spot? You can request to relocate to another available spot."
                            : "In-session spot swap is available while your booking is underway."}
                        </p>
                      </div>

                      {data.isInSession ? (
                        <button
                          type="button"
                          onClick={() => setShowRelocateModal(true)}
                          className="da-primary-button text-xs font-bold"
                          data-testid="customer-relocate-button"
                        >
                          Request Spot Relocation
                        </button>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-500">
                          Available During Session
                        </span>
                      )}
                    </div>
                  </div>
                )
              )}

              {/* Reschedule Action Section */}
              {!isRejected && !isExpired && data.status === "CONFIRMED" && (
                <div className="mt-4 rounded-[18px] border border-[var(--da-border-light)] bg-white p-4">
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

              {/* View Terms & Policy Footer Link */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--da-border-light)] pt-3 text-xs text-[var(--da-text-secondary)]">
                <span>Need details on notice cutoffs or refund guidelines?</span>
                <button
                  type="button"
                  onClick={() => setShowTermsModal(true)}
                  data-testid="cancellation-terms-button"
                  className="font-bold text-[var(--da-primary)] hover:underline flex items-center gap-1"
                >
                  View Cancellation & Rescheduling Terms ↗
                </button>
              </div>
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

        {showRelocateModal && data && (
          <CustomerRelocateModal
            trackingData={data}
            customerEmail={customerEmail || undefined}
            onClose={() => setShowRelocateModal(false)}
            onSuccess={(msg) => {
              setShowRelocateModal(false);
              setSuccessMessage(msg);
              trackReservation({ referenceCode, customerEmail });
            }}
          />
        )}

        <CancellationTermsModal
          isOpen={showTermsModal}
          onClose={() => setShowTermsModal(false)}
          defaultCutoffHours={data?.rescheduleCutoffHours ?? 12}
        />
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
