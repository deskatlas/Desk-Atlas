"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type ConfirmationStatus = "VALIDATING" | "SUCCESS" | "INVALID" | "COLLISION";

function ConfirmEmailChangeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<ConfirmationStatus>("VALIDATING");
  const [customerCode, setCustomerCode] = useState<string>("");
  const [newEmail, setNewEmail] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setStatus("INVALID");
      setErrorMessage("No confirmation token was provided.");
      return;
    }

    let isMounted = true;

    const confirmToken = async () => {
      try {
        const res = await fetch("/api/customer/email-change/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = await res.json().catch(() => null);

        if (!isMounted) return;

        if (res.status === 409 || data?.error?.code === "EMAIL_COLLISION") {
          setStatus("COLLISION");
          setErrorMessage(
            data?.error?.message ||
              "The destination email was claimed by another customer before confirmation completed."
          );
          return;
        }

        if (!res.ok) {
          setStatus("INVALID");
          setErrorMessage(
            data?.error?.message ||
              "This confirmation link has expired or has already been used."
          );
          return;
        }

        setCustomerCode(data?.data?.customer_code || "");
        setNewEmail(data?.data?.new_email || "");
        setStatus("SUCCESS");
      } catch {
        if (!isMounted) return;
        setStatus("INVALID");
        setErrorMessage("Network error. Please check your connection and try again.");
      }
    };

    void confirmToken();

    return () => {
      isMounted = false;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-[var(--da-canvas,#f8fafc)] flex items-center justify-center p-4">
      <div
        className="w-full max-w-lg rounded-[28px] border border-[var(--da-border)] bg-white p-8 shadow-[var(--da-shadow-lg)]"
        data-testid="confirm-email-change-container"
      >
        {/* VALIDATING STATE */}
        {status === "VALIDATING" && (
          <div className="text-center py-8 space-y-4" data-testid="confirm-email-validating">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-[var(--da-primary)]" />
            <h2 className="text-xl font-extrabold text-[var(--da-brand-dark)]">
              Verifying Confirmation Link
            </h2>
            <p className="text-xs text-[var(--da-text-secondary)]">
              Verifying confirmation link and updating your Customer ID...
            </p>
          </div>
        )}

        {/* SUCCESS STATE */}
        {status === "SUCCESS" && (
          <div className="text-center py-4 space-y-5" data-testid="confirm-email-success">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">
              ✅
            </div>

            <div>
              <h2 className="text-2xl font-black text-[var(--da-brand-dark)] tracking-tight">
                Email Address Successfully Updated!
              </h2>
              <p className="mt-2 text-xs text-[var(--da-text-secondary)] leading-relaxed max-w-md mx-auto">
                Your Customer ID <strong className="font-mono text-slate-900">{customerCode}</strong> is
                now bound to <strong className="text-slate-900">{newEmail}</strong>. All your vouchers
                and booking history have been preserved.
              </p>
            </div>

            <div className="rounded-[20px] border border-emerald-200 bg-emerald-50/80 p-5 text-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                Active Customer ID
              </span>
              <div
                className="mt-1 font-mono text-2xl font-black tracking-widest text-emerald-900"
                data-testid="confirmed-customer-code"
              >
                {customerCode}
              </div>
              <p className="mt-1 text-xs text-emerald-700">
                Bound to: <span className="font-semibold">{newEmail}</span>
              </p>
            </div>

            <div className="pt-2">
              <Link
                href="/track/rewards"
                className="da-primary-button w-full justify-center text-sm font-bold py-3"
                data-testid="go-to-rewards-btn"
              >
                Go to My Bookings & Rewards
              </Link>
            </div>
          </div>
        )}

        {/* INVALID OR EXPIRED STATE */}
        {status === "INVALID" && (
          <div className="text-center py-4 space-y-4" data-testid="confirm-email-invalid">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-3xl">
              ⚠️
            </div>

            <h2 className="text-xl font-extrabold text-[var(--da-brand-dark)]">
              Confirmation Link Invalid or Expired
            </h2>

            <p className="text-xs text-[var(--da-text-secondary)] leading-relaxed max-w-sm mx-auto">
              {errorMessage || "This confirmation link has expired or has already been used."}
            </p>

            <div className="pt-4 flex flex-col gap-2">
              <Link
                href="/track"
                className="da-primary-button w-full justify-center text-xs font-bold py-2.5"
                data-testid="return-to-track-btn"
              >
                Return to Reservation Tracking
              </Link>
            </div>
          </div>
        )}

        {/* COLLISION ERROR STATE */}
        {status === "COLLISION" && (
          <div className="text-center py-4 space-y-4" data-testid="confirm-email-collision">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-3xl">
              🚫
            </div>

            <h2 className="text-xl font-extrabold text-[var(--da-brand-dark)]">
              Email Already Registered
            </h2>

            <p className="text-xs text-[var(--da-text-secondary)] leading-relaxed max-w-sm mx-auto">
              {errorMessage ||
                "The destination email was claimed by another customer before confirmation completed."}
            </p>

            <div className="pt-4 flex flex-col gap-2">
              <Link
                href="/track"
                className="da-secondary-button w-full justify-center text-xs font-bold py-2.5"
                data-testid="collision-return-track-btn"
              >
                Return to Reservation Tracking
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConfirmEmailChangePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--da-canvas,#f8fafc)] flex items-center justify-center p-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[var(--da-primary)]" />
        </div>
      }
    >
      <ConfirmEmailChangeContent />
    </Suspense>
  );
}

