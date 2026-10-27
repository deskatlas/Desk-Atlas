"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useRewardsSession,
  type RewardsSession,
} from "../context/RewardsSessionContext";
import { ForgotCustomerIdModal } from "./ForgotCustomerIdModal";

export const STORAGE_KEY_VERIFY_LOCKOUT = "deskatlas_customer_verify_lockout";

export function formatLockoutTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface RewardsAccessCardProps {
  compact?: boolean;
  accessIntent?: 'REWARDS' | 'REWARDS_AND_ASSISTANT';
  standalone?: boolean;
  initialError?: string | null;
  onSuccess?: (session: RewardsSession) => void;
}

export function RewardsAccessCard({
  compact = false,
  accessIntent = 'REWARDS',
  standalone = false,
  initialError = null,
  onSuccess,
}: RewardsAccessCardProps) {
  const router = useRouter();
  const { setSession } = useRewardsSession();
  const [customerCode, setCustomerCode] = useState("");
  const [email, setEmail] = useState("");
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const customerCodeInputRef = useRef<HTMLInputElement>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(initialError);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const verificationRequest = useRef<AbortController | null>(null);
  useEffect(() => () => verificationRequest.current?.abort(), []);

  const isLocked = Boolean(lockedUntil && remainingSeconds > 0);

  // Restore lockout state from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_VERIFY_LOCKOUT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.lockedUntil && parsed.lockedUntil > Date.now()) {
          setLockedUntil(parsed.lockedUntil);
          const diff = Math.max(1, Math.ceil((parsed.lockedUntil - Date.now()) / 1000));
          setRemainingSeconds(diff);
          if (parsed.customerCode && !customerCode) {
            setCustomerCode(parsed.customerCode);
          }
          if (parsed.email && !email) {
            setEmail(parsed.email);
          }
        } else {
          localStorage.removeItem(STORAGE_KEY_VERIFY_LOCKOUT);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Wall-clock active countdown timer with multi-tab and visibility sync
  useEffect(() => {
    if (!lockedUntil) return;

    const updateTimer = () => {
      const diff = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setRemainingSeconds(diff);
      if (diff === 0) {
        setLockedUntil(null);
        try {
          localStorage.removeItem(STORAGE_KEY_VERIFY_LOCKOUT);
        } catch {
          // ignore
        }
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    const onVisibilityOrFocus = () => {
      updateTimer();
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_VERIFY_LOCKOUT) {
        if (e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue);
            if (parsed?.lockedUntil && parsed.lockedUntil > Date.now()) {
              setLockedUntil(parsed.lockedUntil);
              updateTimer();
            }
          } catch {
            // ignore
          }
        } else {
          setLockedUntil(null);
          setRemainingSeconds(0);
        }
      }
    };

    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);
    window.addEventListener("storage", onStorage);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [lockedUntil]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && verifyError && !isLocked) {
        setVerifyError(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [verifyError, isLocked]);

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // DevTools protection: verify lockout status in runtime even if DOM disabled was removed
    if (lockedUntil && Date.now() < lockedUntil) {
      const diff = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
      setRemainingSeconds(diff);
      setVerifyError(
        `Too many failed verification attempts. Please wait ${formatLockoutTime(diff)} before trying again.`
      );
      return;
    }

    setVerifyError(null);
    setIsVerifying(true);
    verificationRequest.current?.abort();
    const controller = new AbortController();
    verificationRequest.current = controller;

    try {
      const res = await fetch("/api/customer/verify-identity", {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_code: customerCode.trim().toUpperCase(),
          email: email.trim().toLowerCase(),
          access_intent: accessIntent,
        }),
      });

      const json = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok) {
        if (res.status === 429 || json?.error?.lockedUntil || json?.error?.retryAfterSeconds) {
          const lockTime =
            json?.error?.lockedUntil ||
            Date.now() + (json?.error?.retryAfterSeconds || 300) * 1000;
          setLockedUntil(lockTime);
          const diff = Math.max(1, Math.ceil((lockTime - Date.now()) / 1000));
          setRemainingSeconds(diff);
          try {
            localStorage.setItem(
              STORAGE_KEY_VERIFY_LOCKOUT,
              JSON.stringify({
                lockedUntil: lockTime,
                customerCode: customerCode.trim().toUpperCase(),
                email: email.trim().toLowerCase(),
              })
            );
          } catch {
            // ignore
          }
          setVerifyError(
            json?.error?.message ||
              "Too many failed verification attempts. Please try again in 5 minutes."
          );
        } else {
          setVerifyError(
            json?.error?.message ||
              "Customer ID and email do not match our records. Please check and try again."
          );
        }
        setIsVerifying(false);
        return;
      }

      const sessionData: RewardsSession = {
        accessToken: json.data.access_token,
        expiresAt: json.data.expires_at,
        purpose: json.data.purpose,
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
      if (controller.signal.aborted) return;
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
      data-compact={compact || undefined}
    >
      <div>
        {!compact && <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--da-primary)]">
          My Bookings & Rewards
        </p>}
        <h2 className={`${compact ? 'text-sm font-bold' : 'mt-2 text-2xl font-extrabold tracking-[-0.03em]'} text-[var(--da-brand-dark)]`}>
          {accessIntent === 'REWARDS_AND_ASSISTANT' ? 'Verify Customer ID and email' : 'Access reward portal'}
        </h2>
        <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
          Enter your 6-character Customer ID and registered email address to access {accessIntent === 'REWARDS_AND_ASSISTANT' ? 'private reservation assistance and rewards' : 'your rewards'}.
        </p>
      </div>

      <form onSubmit={handleVerify} className={`${compact ? 'mt-3 gap-3' : 'mt-6 gap-4'} grid w-full`}>
        <label className="grid gap-2 text-xs font-bold text-[var(--da-brand-dark)]">
          <div className="flex items-center justify-between">
            <span>Customer ID</span>
            <button
              type="button"
              onClick={() => setIsForgotModalOpen(true)}
              className="text-xs font-semibold text-[var(--da-primary)] hover:underline focus:outline-none transition-colors"
              data-testid="forgot-customer-id-trigger"
            >
              Forgot your Customer ID?
            </button>
          </div>
          <input
            ref={customerCodeInputRef}
            type="text"
            maxLength={6}
            value={customerCode}
            onChange={(e) => setCustomerCode(e.target.value.toUpperCase())}
            placeholder="e.g. 7K9M2P"
            className="da-input font-mono uppercase tracking-widest text-sm w-full disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isVerifying || isLocked}
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
            className="da-input text-sm w-full disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isVerifying || isLocked}
            required
            data-testid="rewards-email-input"
          />
        </label>

        <button
          type="submit"
          disabled={isVerifying || isLocked || !customerCode.trim() || !email.trim()}
          className="da-primary-button mt-2 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="rewards-verify-submit"
        >
          {isLocked
            ? `Try again in ${formatLockoutTime(remainingSeconds)}`
            : isVerifying
            ? "Verifying..."
            : accessIntent === 'REWARDS_AND_ASSISTANT' ? 'Enable private assistance' : "View My Bookings & Rewards"}
        </button>

        {verifyError && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rewards-error-title"
            onClick={() => {
              if (!isLocked) {
                setVerifyError(null);
              }
            }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
            data-testid="rewards-verify-error-modal"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md rounded-[28px] border border-[var(--da-border)] bg-white p-6 md:p-8 shadow-2xl"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold ${
                    isLocked ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"
                  }`}
                >
                  {isLocked ? "⏳" : "⚠️"}
                </div>
                <div>
                  <h3
                    id="rewards-error-title"
                    className="text-lg font-extrabold text-[var(--da-brand-dark)]"
                  >
                    Verification Failed
                  </h3>
                  <p className="text-xs text-[var(--da-text-secondary)]">
                    {isLocked
                      ? "Form temporarily locked for your security"
                      : "Unable to access rewards portal"}
                  </p>
                </div>
              </div>

              {isLocked && (
                <div
                  className="mt-4 rounded-[18px] border border-amber-300 bg-amber-50 p-4 text-center"
                  data-testid="rewards-verify-lockout-banner"
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-800">
                    Too Many Failed Attempts
                  </div>
                  <div
                    className="mt-1 font-mono text-3xl font-extrabold text-amber-900"
                    data-testid="rewards-verify-countdown"
                  >
                    {formatLockoutTime(remainingSeconds)}
                  </div>
                  <div className="mt-1 text-xs text-amber-700">
                    Please wait until the countdown ends before trying again.
                  </div>
                </div>
              )}

              <div
                className="mt-6 rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                data-testid="rewards-verify-error"
              >
                {verifyError}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => {
                    if (!isLocked) {
                      setVerifyError(null);
                    }
                  }}
                  className="da-primary-button text-sm font-bold px-6 py-2.5 justify-center disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="rewards-verify-error-close"
                >
                  {isLocked ? `Locked (${formatLockoutTime(remainingSeconds)})` : "Try Again"}
                </button>
              </div>
            </div>
          </div>
        )}
      </form>
      <ForgotCustomerIdModal
        isOpen={isForgotModalOpen}
        onClose={() => setIsForgotModalOpen(false)}
        initialEmail={email}
        onSuccessReturn={() => {
          setIsForgotModalOpen(false);
          setTimeout(() => customerCodeInputRef.current?.focus(), 50);
        }}
      />
    </div>
  );
}
