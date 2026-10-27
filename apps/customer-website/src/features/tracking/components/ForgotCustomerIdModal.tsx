"use client";

import { useEffect, useState } from "react";

export interface ForgotCustomerIdModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
  onSuccessReturn?: () => void;
}

function formatRetryAfter(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.ceil(seconds / 3600);
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}

export function ForgotCustomerIdModal({
  isOpen,
  onClose,
  initialEmail = "",
  onSuccessReturn,
}: ForgotCustomerIdModalProps) {
  const [email, setEmail] = useState(initialEmail);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Sync initialEmail when opened and reset statuses
  useEffect(() => {
    if (isOpen) {
      setEmail(initialEmail || "");
      setIsSuccess(false);
      setRateLimitMessage(null);
      setGeneralError(null);
      setIsLoading(false);
    }
  }, [isOpen, initialEmail]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || isLoading) return;

    setIsLoading(true);
    setRateLimitMessage(null);
    setGeneralError(null);

    try {
      const res = await fetch("/api/customer/forgot-customer-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json().catch(() => null);

      if (res.status === 429) {
        const retrySeconds = data?.error?.retryAfterSeconds || 86400;
        setRateLimitMessage(
          `You have reached the maximum limit of 2 Customer ID recovery requests for today. Please check your inbox for previous emails or try again in ${formatRetryAfter(
            retrySeconds
          )}.`
        );
        setIsLoading(false);
        return;
      }

      if (!res.ok) {
        setGeneralError(
          data?.error?.message ||
            "Unable to process recovery request. Please try again."
        );
        setIsLoading(false);
        return;
      }

      setIsSuccess(true);
      setIsLoading(false);
    } catch {
      setGeneralError("Network error. Please check your connection and try again.");
      setIsLoading(false);
    }
  };

  const handleReturn = () => {
    if (onSuccessReturn) {
      onSuccessReturn();
    } else {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forgot-modal-title"
      onClick={() => {
        if (!isLoading) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="forgot-customer-id-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-[28px] border border-[var(--da-border)] bg-white p-6 md:p-8 shadow-2xl"
      >
        {isSuccess ? (
          <div className="text-center" data-testid="forgot-customer-id-success-view">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-2xl font-bold">
              ✓
            </div>
            <h3
              id="forgot-modal-title"
              className="mt-4 text-xl font-extrabold text-[var(--da-brand-dark)]"
              data-testid="forgot-customer-id-success-headline"
            >
              Check Your Inbox
            </h3>
            <p className="mt-2 text-sm text-[var(--da-text-secondary)] leading-relaxed">
              If this email address is registered with DeskAtlas, your permanent Customer ID has been sent. Please check your inbox and spam folder.
            </p>
            <div className="mt-4 rounded-[16px] border border-[var(--da-border)] bg-gray-50 p-3.5 text-xs text-[var(--da-text-secondary)] leading-relaxed text-left">
              <strong>Your Customer ID does not change.</strong> Once you find it in your email, return here to log in.
            </div>
            <button
              type="button"
              onClick={handleReturn}
              className="da-primary-button mt-6 w-full justify-center text-sm font-bold py-3"
              data-testid="forgot-customer-id-return-btn"
            >
              Return to Log In
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between">
              <div>
                <h3
                  id="forgot-modal-title"
                  className="text-lg font-extrabold text-[var(--da-brand-dark)]"
                >
                  Forgot Your Customer ID?
                </h3>
                <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
                  Enter your registered email address and we will email your permanent Customer ID to you.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                aria-label="Close dialog"
                className="rounded-lg p-1 text-gray-400 hover:text-gray-600 focus:outline-none"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 rounded-[14px] border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-800">
              For security, Customer ID recovery is limited to 2 requests per day.
            </div>

            {rateLimitMessage && (
              <div
                className="mt-4 rounded-[16px] border border-amber-300 bg-amber-50 p-4 text-left"
                data-testid="forgot-customer-id-rate-limit-banner"
              >
                <div className="text-xs font-bold uppercase tracking-wider text-amber-800">
                  Daily Request Limit Reached
                </div>
                <div className="mt-1 text-xs text-amber-700 leading-relaxed">
                  {rateLimitMessage}
                </div>
              </div>
            )}

            {generalError && (
              <div
                className="mt-4 rounded-[14px] border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                data-testid="forgot-customer-id-error-banner"
              >
                {generalError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
              <label className="grid gap-1.5 text-xs font-bold text-[var(--da-brand-dark)]">
                Email address
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="guest@example.com"
                  className="da-input text-sm w-full disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={isLoading}
                  required
                  data-testid="forgot-customer-id-email-input"
                />
              </label>

              <div className="mt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isLoading}
                  className="da-secondary-button text-xs font-bold px-4 py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="forgot-customer-id-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !email.trim()}
                  className="da-primary-button text-xs font-bold px-5 py-2.5 justify-center disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="forgot-customer-id-submit"
                >
                  {isLoading ? "Sending Customer ID..." : "Send Customer ID"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

