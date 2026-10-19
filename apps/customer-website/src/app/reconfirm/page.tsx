"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function ReconfirmContent() {
  const searchParams = useSearchParams();
  const refParam = searchParams.get("ref") || searchParams.get("reference") || searchParams.get("code") || "";
  const tokenParam = searchParams.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    referenceCode: string;
    customerFirstName: string;
    formattedDate: string;
    startTime: string;
    message?: string;
  } | null>(null);

  useEffect(() => {
    if (!refParam) {
      setLoading(false);
      setError("Missing reservation reference code.");
      return;
    }

    let isMounted = true;

    async function executeReconfirm() {
      try {
        setLoading(true);
        const res = await fetch("/api/track/reconfirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            referenceCode: refParam,
            token: tokenParam,
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (!isMounted) return;

        if (res.ok && json.success) {
          setData({
            referenceCode: json.referenceCode || refParam,
            customerFirstName: json.customerFirstName || "Valued Guest",
            formattedDate: json.formattedDate || "your scheduled date",
            startTime: json.startTime || "scheduled time",
            message: json.message,
          });
          setSuccess(true);
        } else {
          setError(json.error || "Unable to confirm attendance. Please try again or check your booking pass.");
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to confirm attendance.");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    executeReconfirm();

    return () => {
      isMounted = false;
    };
  }, [refParam, tokenParam]);

  const refDisplay = data?.referenceCode || refParam;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {loading && (
          <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-8 text-center shadow-[var(--da-shadow-md)]">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#047857] border-t-transparent mb-4"></div>
            <h2 className="text-xl font-bold text-[var(--da-brand-dark)]">Reconfirming Attendance...</h2>
            <p className="mt-2 text-sm text-[var(--da-text-secondary)]">Please wait while we record your attendance with the venue.</p>
          </div>
        )}

        {!loading && success && data && (
          <div
            data-testid="reconfirm-success-card"
            className="rounded-[24px] border border-[#A7F3D0] bg-[#ECFDF5] p-8 text-center shadow-[var(--da-shadow-md)]"
          >
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#D1FAE5] text-3xl font-extrabold text-[#047857]">
              ✓
            </div>
            <span className="inline-block rounded-full border border-[#A7F3D0] bg-white px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#047857] mb-3">
              Attendance Recorded
            </span>
            <h1 className="text-2xl font-black text-[var(--da-brand-dark)]">
              Attendance Reconfirmed!
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#065F46]">
              Thank you, <strong>{data.customerFirstName}</strong>! Your attendance for reservation <strong>#{data.referenceCode}</strong> on <strong>{data.formattedDate}</strong> at <strong>{data.startTime}</strong> has been successfully recorded. Our team looks forward to welcoming you.
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <Link
                href={`/track?ref=${encodeURIComponent(refDisplay)}`}
                data-testid="view-live-pass-button"
                className="inline-flex items-center justify-center rounded-xl bg-[#047857] px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#065F46]"
              >
                View Live Booking Pass
              </Link>
              <Link
                href="/"
                className="text-xs font-semibold text-[var(--da-text-secondary)] hover:underline"
              >
                Return to DeskAtlas Home
              </Link>
            </div>
          </div>
        )}

        {!loading && !success && (
          <div className="rounded-[24px] border border-[#FECACA] bg-[#FEF2F2] p-8 text-center shadow-[var(--da-shadow-md)]">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#FEE2E2] text-2xl font-extrabold text-[#991B1B]">
              !
            </div>
            <h2 className="text-xl font-bold text-[#991B1B]">Unable to Reconfirm Attendance</h2>
            <p className="mt-2 text-sm text-[#7F1D1D]">{error || "The reconfirmation link may be invalid or expired."}</p>
            <div className="mt-6 flex flex-col gap-3">
              {refParam && (
                <Link
                  href={`/track?ref=${encodeURIComponent(refParam)}`}
                  className="inline-flex items-center justify-center rounded-xl bg-[var(--da-brand-dark)] px-6 py-3 text-sm font-bold text-white shadow-sm"
                >
                  Go to Booking Management
                </Link>
              )}
              <Link href="/" className="text-xs font-semibold text-[var(--da-text-secondary)] hover:underline">
                Return to Home
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReconfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm text-[var(--da-text-secondary)]">Loading confirmation...</div>
        </div>
      }
    >
      <ReconfirmContent />
    </Suspense>
  );
}
