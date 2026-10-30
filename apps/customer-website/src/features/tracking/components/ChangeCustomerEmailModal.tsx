"use client";

import { useEffect, useState, useRef } from "react";
import { isValidEmail } from "@deskatlas/validation";

export type EmailChangeStep =
  | "ENTER_CURRENT_EMAIL"
  | "VERIFY_OTP"
  | "ENTER_NEW_EMAIL"
  | "DOUBLE_CHECK_MODAL"
  | "PENDING_CONFIRMATION";

export interface ChangeCustomerEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
  onProceedToForgotCustomerId?: () => void;
  onEmailChanged?: (newEmail: string, customerCode: string) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function ChangeCustomerEmailModal({
  isOpen,
  onClose,
  initialEmail = "",
  onProceedToForgotCustomerId,
}: ChangeCustomerEmailModalProps) {
  const [step, setStep] = useState<EmailChangeStep>("ENTER_CURRENT_EMAIL");
  const [currentEmail, setCurrentEmail] = useState(initialEmail);
  const [newEmail, setNewEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [customerCode, setCustomerCode] = useState("");
  const [verificationToken, setVerificationToken] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [collisionError, setCollisionError] = useState<string | null>(null);

  // OTP Countdown (300 seconds = 5 minutes)
  const [otpRemainingSeconds, setOtpRemainingSeconds] = useState(300);
  // Resend Cooldown (60 seconds)
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  const otpInputRef = useRef<HTMLInputElement>(null);

  // Reset or sync state when opened
  useEffect(() => {
    if (isOpen) {
      setStep("ENTER_CURRENT_EMAIL");
      setCurrentEmail(initialEmail || "");
      setNewEmail("");
      setOtp("");
      setCustomerCode("");
      setVerificationToken("");
      setIsLoading(false);
      setErrorMessage(null);
      setCollisionError(null);
      setOtpRemainingSeconds(300);
      setResendCooldownSeconds(0);
      setRemainingAttempts(null);
    }
  }, [isOpen, initialEmail]);

  // Handle OTP countdown timer
  useEffect(() => {
    if (!isOpen || step !== "VERIFY_OTP") return;

    const timer = setInterval(() => {
      setOtpRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, step]);

  // Handle Resend cooldown timer
  useEffect(() => {
    if (!isOpen || resendCooldownSeconds <= 0) return;

    const timer = setInterval(() => {
      setResendCooldownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, resendCooldownSeconds]);

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

  // Step 1: Request OTP
  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isLoading) return;

    const trimmed = currentEmail.trim().toLowerCase();
    if (!trimmed) {
      setErrorMessage("Please enter your email address.");
      return;
    }

    if (!isValidEmail(trimmed)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/customer/email-change/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: currentEmail.trim().toLowerCase() }),
      });

      const data = await res.json().catch(() => null);

      if (res.status === 429) {
        setErrorMessage(
          data?.error?.message || "Too many verification requests. Please try again later."
        );
        setIsLoading(false);
        return;
      }

      if (!res.ok) {
        setErrorMessage(
          data?.error?.message || "Unable to send verification code. Please try again."
        );
        setIsLoading(false);
        return;
      }

      setStep("VERIFY_OTP");
      setOtp("");
      setOtpRemainingSeconds(300);
      setResendCooldownSeconds(60);
      setRemainingAttempts(null);
      setIsLoading(false);
      setTimeout(() => otpInputRef.current?.focus(), 50);
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
      setIsLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!otp.trim() || isLoading || otpRemainingSeconds <= 0) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/customer/email-change/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: currentEmail.trim().toLowerCase(),
          otp: otp.trim(),
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.status === 429) {
        setErrorMessage(data?.error?.message || "Too many attempts. Please try again in 5 minutes.");
        setIsLoading(false);
        return;
      }

      if (!res.ok) {
        if (typeof data?.error?.remainingAttempts === "number") {
          setRemainingAttempts(data.error.remainingAttempts);
        }
        setErrorMessage(data?.error?.message || "Invalid verification code. Please try again.");
        setIsLoading(false);
        return;
      }

      setCustomerCode(data.data.customer_code);
      setVerificationToken(data.data.verification_token);
      setStep("ENTER_NEW_EMAIL");
      setIsLoading(false);
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
      setIsLoading(false);
    }
  };

  // Step 3: Validate New Email and Proceed to Review
  const handleContinueToReview = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNew = newEmail.trim().toLowerCase();
    const trimmedCurrent = currentEmail.trim().toLowerCase();

    if (!trimmedNew) {
      setErrorMessage("Please enter your new email address.");
      return;
    }

    if (!isValidEmail(trimmedNew)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    if (trimmedNew === trimmedCurrent) {
      setErrorMessage("New email must be different from your current email.");
      return;
    }

    setErrorMessage(null);
    setCollisionError(null);
    setStep("DOUBLE_CHECK_MODAL");
  };

  // Step 4: Initiate Email Change Link Dispatch
  const handleInitiateTransfer = async () => {
    if (isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);
    setCollisionError(null);

    try {
      const res = await fetch("/api/customer/email-change/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationToken,
          newEmail: newEmail.trim().toLowerCase(),
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.status === 409 && data?.error?.code === "EMAIL_ALREADY_BOUND") {
        setCollisionError(
          data?.error?.message ||
            `The email address ${newEmail} is already bound to another Customer ID.`
        );
        setIsLoading(false);
        return;
      }

      if (res.status === 429) {
        setErrorMessage(data?.error?.message || "Too many transfer attempts. Please try again later.");
        setIsLoading(false);
        return;
      }

      if (!res.ok) {
        setErrorMessage(data?.error?.message || "Unable to initiate email change. Please try again.");
        setIsLoading(false);
        return;
      }

      setStep("PENDING_CONFIRMATION");
      setIsLoading(false);
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
      setIsLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-email-modal-title"
      onClick={() => {
        if (!isLoading) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="change-customer-email-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg rounded-[28px] border border-[var(--da-border)] bg-white p-6 sm:p-8 shadow-2xl"
      >
        {/* Close Icon Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="absolute right-5 top-5 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none transition-colors"
          aria-label="Close dialog"
        >
          ✕
        </button>

        {/* STEP 1: Enter Current Email */}
        {step === "ENTER_CURRENT_EMAIL" && (
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 font-bold">
                ✉️
              </div>
              <div>
                <h3
                  id="change-email-modal-title"
                  className="text-lg font-extrabold text-[var(--da-brand-dark)]"
                >
                  Change Email Bound to Customer ID
                </h3>
                <p className="text-xs text-[var(--da-text-secondary)]">
                  Step 1 of 4: Verify Current Email
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs text-[var(--da-text-secondary)] leading-relaxed">
              Enter the email address currently associated with your Customer ID and vouchers. We will
              send a 5-minute verification code to verify your ownership.
            </p>

            {errorMessage && (
              <div
                className="mt-4 rounded-[14px] border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                data-testid="change-email-error-banner"
              >
                {errorMessage}
              </div>
            )}

            <form noValidate onSubmit={handleRequestOtp} className="mt-5 space-y-4">
              <label className="block text-xs font-bold text-[var(--da-brand-dark)]">
                Current Registered Email
                <input
                  type="email"
                  value={currentEmail}
                  onChange={(e) => { setCurrentEmail(e.target.value); if (errorMessage) setErrorMessage(null); }}
                  placeholder="your.email@example.com"
                  className="da-input mt-1.5 w-full text-sm"
                  disabled={isLoading}
                  required
                  data-testid="change-email-current-input"
                  autoFocus
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isLoading}
                  className="da-secondary-button text-xs px-4 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !currentEmail.trim()}
                  className="da-primary-button text-xs px-5 py-2 font-bold"
                  data-testid="change-email-send-code-btn"
                >
                  {isLoading ? "Sending Code..." : "Send Verification Code"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STEP 2: Verify OTP */}
        {step === "VERIFY_OTP" && (
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 font-bold">
                🔐
              </div>
              <div>
                <h3
                  id="change-email-modal-title"
                  className="text-lg font-extrabold text-[var(--da-brand-dark)]"
                >
                  Verify Current Email
                </h3>
                <p className="text-xs text-[var(--da-text-secondary)]">
                  Step 2 of 4: Enter Verification Code
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs text-[var(--da-text-secondary)]">
              We sent a 6-digit verification code to <span className="font-semibold text-slate-800">{currentEmail}</span>. The code expires in 5 minutes.
            </p>

            {/* Countdown Banner */}
            <div className="mt-4 flex items-center justify-between rounded-[14px] border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
              <span className="text-slate-600 font-medium">Code expires in:</span>
              <span
                className={`font-mono font-bold text-sm ${
                  otpRemainingSeconds <= 60 ? "text-red-600 animate-pulse" : "text-emerald-700"
                }`}
                data-testid="change-email-otp-countdown"
              >
                {formatTime(otpRemainingSeconds)}
              </span>
            </div>

            {remainingAttempts !== null && remainingAttempts > 0 && (
              <p
                className="mt-2 text-xs font-semibold text-amber-700"
                data-testid="change-email-otp-attempts"
              >
                {remainingAttempts} attempt{remainingAttempts === 1 ? "" : "s"} remaining
              </p>
            )}

            {errorMessage && (
              <div
                className="mt-4 rounded-[14px] border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                data-testid="change-email-otp-error"
              >
                {errorMessage}
              </div>
            )}

            <form noValidate onSubmit={handleVerifyOtp} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-[var(--da-brand-dark)] text-center mb-1.5">
                  6-Digit Verification Code
                </label>
                <input
                  ref={otpInputRef}
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="da-input font-mono text-center tracking-widest text-2xl w-full py-2 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isLoading || otpRemainingSeconds <= 0}
                  required
                  data-testid="change-email-otp-input"
                  autoFocus
                />
                {otpRemainingSeconds <= 0 && (
                  <p className="mt-1 text-center text-xs text-red-600 font-semibold">
                    Code expired. Please request a new code.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={isLoading || resendCooldownSeconds > 0}
                  className="text-xs font-semibold text-[var(--da-primary)] hover:underline disabled:text-slate-400 disabled:no-underline"
                  data-testid="change-email-resend-otp-btn"
                >
                  {resendCooldownSeconds > 0
                    ? `Resend Code (${resendCooldownSeconds}s)`
                    : "Resend Code"}
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep("ENTER_CURRENT_EMAIL")}
                    disabled={isLoading}
                    className="da-secondary-button text-xs px-3 py-2"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading || otp.trim().length !== 6 || otpRemainingSeconds <= 0}
                    className="da-primary-button text-xs px-5 py-2 font-bold"
                    data-testid="change-email-verify-otp-btn"
                  >
                    {isLoading ? "Verifying..." : "Verify Code"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* STEP 3: Enter New Email */}
        {step === "ENTER_NEW_EMAIL" && (
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 font-bold">
                🆔
              </div>
              <div>
                <h3
                  id="change-email-modal-title"
                  className="text-lg font-extrabold text-[var(--da-brand-dark)]"
                >
                  Enter New Email Address
                </h3>
                <p className="text-xs text-[var(--da-text-secondary)]">
                  Step 3 of 4: Propose New Destination
                </p>
              </div>
            </div>

            {/* Verified Customer ID Display */}
            <div className="mt-4 rounded-[18px] border border-emerald-200 bg-emerald-50 p-4 text-center">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Verified Customer ID
              </span>
              <div
                className="mt-1 font-mono text-2xl font-extrabold text-emerald-900"
                data-testid="verified-customer-id-display"
              >
                {customerCode}
              </div>
              <p className="mt-1 text-xs text-emerald-700">
                All historical bookings and active vouchers will transfer with this ID.
              </p>
            </div>

            {errorMessage && (
              <div
                className="mt-4 rounded-[14px] border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                data-testid="change-email-new-error"
              >
                {errorMessage}
              </div>
            )}

            <form noValidate onSubmit={handleContinueToReview} className="mt-5 space-y-4">
              <label className="block text-xs font-bold text-[var(--da-brand-dark)]">
                Proposed New Email Address
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => { setNewEmail(e.target.value); if (errorMessage) setErrorMessage(null); }}
                  placeholder="new.email@example.com"
                  className="da-input mt-1.5 w-full text-sm"
                  disabled={isLoading}
                  required
                  data-testid="change-email-new-input"
                  autoFocus
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep("ENTER_CURRENT_EMAIL")}
                  disabled={isLoading}
                  className="da-secondary-button text-xs px-4 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !newEmail.trim()}
                  className="da-primary-button text-xs px-5 py-2 font-bold"
                  data-testid="change-email-continue-review-btn"
                >
                  Continue to Review
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STEP 4: Double Check Confirmation Modal */}
        {step === "DOUBLE_CHECK_MODAL" && (
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-800 font-bold">
                🔍
              </div>
              <div>
                <h3
                  id="change-email-modal-title"
                  className="text-lg font-extrabold text-[var(--da-brand-dark)]"
                >
                  Double-Check New Email Address
                </h3>
                <p className="text-xs text-[var(--da-text-secondary)]">
                  Step 4 of 4: Review Before Dispatch
                </p>
              </div>
            </div>

            {/* Comparison Summary Table */}
            <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 p-4 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Customer ID:</span>
                <span className="font-mono font-bold text-slate-900 text-sm">{customerCode}</span>
              </div>
              <div className="flex justify-between items-center border-t border-slate-200 pt-2">
                <span className="text-slate-500 font-medium">Current Email:</span>
                <span className="font-medium text-slate-800">{currentEmail}</span>
              </div>
              <div className="flex justify-between items-center border-t border-slate-200 pt-2">
                <span className="text-slate-500 font-medium">New Email:</span>
                <span className="font-bold text-[var(--da-primary)]">{newEmail}</span>
              </div>
            </div>

            <div className="mt-3 rounded-[14px] border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 leading-relaxed">
              <strong>Notice:</strong> Please verify that your new email is typed correctly. Once you confirm,
              a confirmation link will be sent to your new email. Your Customer ID will not change until that
              link is opened.
            </div>

            {/* Collision Guard Warning Alert */}
            {collisionError && (
              <div
                className="mt-4 rounded-[18px] border border-amber-300 bg-amber-50 p-4"
                data-testid="email-already-bound-alert"
              >
                <div className="flex items-center gap-2 font-bold text-amber-900 text-sm">
                  <span>⚠️</span> This email already has a Customer ID
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  The email address {newEmail} is already bound to another Customer ID. You cannot merge separate customer accounts.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (onProceedToForgotCustomerId) {
                        onProceedToForgotCustomerId();
                      }
                    }}
                    className="inline-flex items-center justify-center rounded-full bg-[var(--da-primary)] px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:brightness-110 active:scale-95 transition-all"
                    data-testid="proceed-to-forgot-customer-id-btn"
                  >
                    Proceed to Forgot Customer ID
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCollisionError(null);
                      setStep("ENTER_NEW_EMAIL");
                    }}
                    className="inline-flex items-center justify-center rounded-full border border-[var(--da-border)] bg-white px-3.5 py-1.5 text-xs font-bold text-[var(--da-brand-dark)] shadow-xs hover:bg-slate-50 hover:border-slate-300 active:scale-95 transition-all"
                    data-testid="try-different-email-btn"
                  >
                    Try Different Email
                  </button>
                </div>
              </div>
            )}

            {errorMessage && !collisionError && (
              <div
                className="mt-4 rounded-[14px] border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                data-testid="change-email-initiate-error"
              >
                {errorMessage}
              </div>
            )}

            {!collisionError && (
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep("ENTER_NEW_EMAIL")}
                  disabled={isLoading}
                  className="da-secondary-button text-xs px-4 py-2"
                  data-testid="change-email-back-edit-btn"
                >
                  Back to Edit
                </button>
                <button
                  type="button"
                  onClick={handleInitiateTransfer}
                  disabled={isLoading}
                  className="da-primary-button text-xs px-5 py-2 font-bold"
                  data-testid="change-email-confirm-send-btn"
                >
                  {isLoading ? "Sending Link..." : "Confirm & Send Link"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 5: Confirmation Link Dispatched */}
        {step === "PENDING_CONFIRMATION" && (
          <div className="text-center py-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">
              📬
            </div>

            <h3
              id="change-email-modal-title"
              className="mt-4 text-xl font-extrabold text-[var(--da-brand-dark)]"
            >
              Confirmation Link Sent!
            </h3>

            <p className="mt-2 text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
              We sent an email with a confirmation link to{" "}
              <strong className="text-slate-900">{newEmail}</strong>. Please check your inbox and click the link within 24 hours to finalize your email change.
            </p>

            <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              Your Customer ID and vouchers remain on your current email until the link is confirmed.
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={onClose}
                className="da-primary-button w-full justify-center text-sm font-bold py-2.5"
                data-testid="change-email-success-close-btn"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

