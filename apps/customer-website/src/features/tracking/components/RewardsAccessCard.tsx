"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useRewardsSession,
  type RewardsSession,
} from "../context/RewardsSessionContext";

interface RewardsAccessCardProps {
  standalone?: boolean;
  initialError?: string | null;
  onSuccess?: (session: RewardsSession) => void;
}

export function RewardsAccessCard({
  standalone = false,
  initialError = null,
  onSuccess,
}: RewardsAccessCardProps) {
  const router = useRouter();
  const { setSession } = useRewardsSession();
  const [customerCode, setCustomerCode] = useState("");
  const [email, setEmail] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(initialError);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && verifyError) {
        setVerifyError(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [verifyError]);

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setVerifyError(null);
    setIsVerifying(true);

    try {
      const res = await fetch("/api/customer/verify-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_code: customerCode.trim().toUpperCase(),
          email: email.trim().toLowerCase(),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setVerifyError(
          json.error?.message ||
            "Customer ID and email do not match our records. Please check and try again."
        );
        setIsVerifying(false);
        return;
      }

      const sessionData: RewardsSession = {
        accessToken: json.data.access_token,
        expiresAt: json.data.expires_at,
        customer: {
          customerCode: json.data.customer.customer_code,
          firstName: json.data.customer.first_name,
          lastName: json.data.customer.last_name,
          email: email.trim().toLowerCase(),
          createdAt: json.data.customer.created_at,
        },
      };

      setSession(sessionData);
      setIsVerifying(false);

      if (onSuccess) {
        onSuccess(sessionData);
      } else {
        router.push("/track/rewards");
      }
    } catch {
      setVerifyError(
        "Customer ID and email do not match our records. Please check and try again."
      );
      setIsVerifying(false);
    }
  };

  return (
    <div
      className={`rounded-[28px] border border-[var(--da-border)] bg-white p-8 shadow-[var(--da-shadow-lg)] flex flex-col justify-between h-full ${
        standalone ? "mx-auto max-w-xl" : "w-full"
      }`}
      data-testid="my-bookings-rewards-card"
    >
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--da-primary)]">
          My Bookings & Rewards
        </p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-[var(--da-brand-dark)]">
          Access reward portal
        </h2>
        <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
          Enter your 6-character Customer ID and registered email address to access your rewards.
        </p>
      </div>

      <form onSubmit={handleVerify} className="mt-6 grid gap-4 w-full">
        <label className="grid gap-2 text-xs font-bold text-[var(--da-brand-dark)]">
          Customer ID
          <input
            type="text"
            maxLength={6}
            value={customerCode}
            onChange={(e) => setCustomerCode(e.target.value.toUpperCase())}
            placeholder="e.g. 7K9M2P"
            className="da-input font-mono uppercase tracking-widest text-sm w-full"
            disabled={isVerifying}
            required
            data-testid="rewards-customer-id-input"
          />
        </label>

        <label className="grid gap-2 text-xs font-bold text-[var(--da-brand-dark)]">
          Email address
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="guest@example.com"
            className="da-input text-sm w-full"
            disabled={isVerifying}
            required
            data-testid="rewards-email-input"
          />
        </label>

        <button
          type="submit"
          disabled={isVerifying || !customerCode.trim() || !email.trim()}
          className="da-primary-button mt-2 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="rewards-verify-submit"
        >
          {isVerifying ? "Verifying..." : "View My Bookings & Rewards"}
        </button>

        {verifyError && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rewards-error-title"
            onClick={() => setVerifyError(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
            data-testid="rewards-verify-error-modal"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md rounded-[28px] border border-[var(--da-border)] bg-white p-6 md:p-8 shadow-2xl"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 font-bold">
                  ⚠️
                </div>
                <div>
                  <h3
                    id="rewards-error-title"
                    className="text-lg font-extrabold text-[var(--da-brand-dark)]"
                  >
                    Verification Failed
                  </h3>
                  <p className="text-xs text-[var(--da-text-secondary)]">
                    Unable to access rewards portal
                  </p>
                </div>
              </div>

              <div
                className="mt-6 rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                data-testid="rewards-verify-error"
              >
                {verifyError}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setVerifyError(null)}
                  className="da-primary-button text-sm font-bold px-6 py-2.5 justify-center"
                  data-testid="rewards-verify-error-close"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
