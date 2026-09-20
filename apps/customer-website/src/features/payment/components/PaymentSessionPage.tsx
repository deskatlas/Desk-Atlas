"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePaymentSession } from "../hooks/usePaymentSession";
import type { PaymentMethod } from "@deskatlas/domain";

function getMethodProviderInfo(method: PaymentMethod) {
  const name = method.displayName.toLowerCase();
  if (method.methodType === "GCASH" || name.includes("gcash")) {
    return {
      label: "GCash",
      badgeBg: "#E0F2FE",
      badgeColor: "#0284C7",
      badgeBorder: "#BAE6FD",
      icon: "📱",
    };
  }
  if (name.includes("maya")) {
    return {
      label: "Maya",
      badgeBg: "#DCFCE7",
      badgeColor: "#15803D",
      badgeBorder: "#BBF7D0",
      icon: "💚",
    };
  }
  if (name.includes("mari") || name.includes("seabank")) {
    return {
      label: "MariBank",
      badgeBg: "#FFEDD5",
      badgeColor: "#C2410C",
      badgeBorder: "#FED7AA",
      icon: "🏦",
    };
  }
  if (name.includes("bdo")) {
    return {
      label: "BDO",
      badgeBg: "#EFF6FF",
      badgeColor: "#1D4ED8",
      badgeBorder: "#BFDBFE",
      icon: "🏦",
    };
  }
  if (name.includes("bpi")) {
    return {
      label: "BPI",
      badgeBg: "#FEE2E2",
      badgeColor: "#B91C1C",
      badgeBorder: "#FECACA",
      icon: "🏦",
    };
  }
  if (name.includes("union")) {
    return {
      label: "UnionBank",
      badgeBg: "#FEF3C7",
      badgeColor: "#D97706",
      badgeBorder: "#FDE68A",
      icon: "🏦",
    };
  }
  return {
    label: "Bank Transfer",
    badgeBg: "#F3E8FF",
    badgeColor: "#7E22CE",
    badgeBorder: "#E9D5FF",
    icon: "🏦",
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PaymentSessionPage({ token }: { token: string }) {
  const { data, loading, error, refetch } = usePaymentSession(token);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const webPaymentMethods = useMemo(() => {
    return (data?.paymentMethods ?? []).filter(
      (m) => m.allowWeb && m.methodType !== "CASH"
    );
  }, [data?.paymentMethods]);

  useEffect(() => {
    if (!paymentMethodId && webPaymentMethods[0]?.id) {
      setPaymentMethodId(webPaymentMethods[0].id);
    }
  }, [webPaymentMethods, paymentMethodId]);

  // Clean up object URLs on change / unmount
  useEffect(() => {
    return () => {
      if (proofPreviewUrl) {
        URL.revokeObjectURL(proofPreviewUrl);
      }
    };
  }, [proofPreviewUrl]);

  const remainingSeconds = useMemo(() => {
    if (!data?.expiresAt) {
      return 0;
    }

    return Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - now) / 1000));
  }, [data?.expiresAt, now]);

  const isExpired =
    data?.paymentStatus === "EXPIRED" ||
    data?.reservationStatus === "EXPIRED" ||
    (!loading && !!data?.expiresAt && remainingSeconds === 0 && !data?.proofSubmittedAt);

  const isUnderReview =
    data?.paymentStatus === "UNDER_REVIEW" ||
    data?.reservationStatus === "PAYMENT_UNDER_REVIEW" ||
    submitted;

  const selectedMethod = useMemo(() => {
    if (webPaymentMethods.length === 0) {
      return null;
    }
    return (
      webPaymentMethods.find((m) => m.id === (paymentMethodId || data?.paymentMethodId)) ??
      webPaymentMethods[0]
    );
  }, [webPaymentMethods, data?.paymentMethodId, paymentMethodId]);

  const selectedProviderInfo = useMemo(() => {
    if (!selectedMethod) return null;
    return getMethodProviderInfo(selectedMethod);
  }, [selectedMethod]);

  const businessName = data?.businessName || "DeskAtlas";

  function handleCopyAccountNumber(accountNumber: string) {
    if (!accountNumber) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(accountNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleCopyReferenceCode(code: string) {
    if (!code) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setCopiedRef(true);
      window.setTimeout(() => setCopiedRef(false), 2000);
    }
  }

  function handleFileSelect(file: File | null) {
    setSubmitError(null);
    if (!file) {
      setProof(null);
      if (proofPreviewUrl) {
        URL.revokeObjectURL(proofPreviewUrl);
        setProofPreviewUrl(null);
      }
      return;
    }

    const maxSizeBytes = 10 * 1024 * 1024; // 10MB
    if (file.size === 0) {
      setSubmitError("Selected file is empty.");
      setProof(null);
      if (proofPreviewUrl) {
        URL.revokeObjectURL(proofPreviewUrl);
        setProofPreviewUrl(null);
      }
      return;
    }

    if (file.size > maxSizeBytes) {
      setSubmitError("File size must not exceed 10 MB.");
      setProof(null);
      if (proofPreviewUrl) {
        URL.revokeObjectURL(proofPreviewUrl);
        setProofPreviewUrl(null);
      }
      return;
    }

    const isImage =
      file.type === "image/png" ||
      file.type === "image/jpeg" ||
      file.type === "image/jpg" ||
      file.type === "image/webp";
    const hasValidExt = /\.(png|jpe?g|webp)$/i.test(file.name);

    if (!isImage && !hasValidExt) {
      setSubmitError("Only PNG, JPG, and WebP images are accepted.");
      setProof(null);
      if (proofPreviewUrl) {
        URL.revokeObjectURL(proofPreviewUrl);
        setProofPreviewUrl(null);
      }
      return;
    }

    setProof(file);
    if (proofPreviewUrl) {
      URL.revokeObjectURL(proofPreviewUrl);
    }
    setProofPreviewUrl(URL.createObjectURL(file));
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  }

  async function handleSubmit() {
    if (!paymentMethodId) {
      setSubmitError("Choose a payment method before uploading proof.");
      return;
    }

    if (!proof) {
      setSubmitError("Attach your payment proof file before submitting.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    const formData = new FormData();
    formData.set("paymentMethodId", paymentMethodId);
    formData.set("proof", proof);

    try {
      const response = await fetch(`/api/pay/${encodeURIComponent(token)}/proof`, {
        method: "POST",
        body: formData,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to submit payment proof.");
      }
      setSubmitted(true);
      refetch();
    } catch (nextError) {
      setSubmitError(
        nextError instanceof Error ? nextError.message : "Unable to submit payment proof."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--da-canvas)] px-6 py-12">
      <div className="mx-auto max-w-4xl rounded-[28px] border border-[var(--da-border)] bg-white p-8 shadow-[var(--da-shadow-lg)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--da-primary)]">
              Payment Session
            </p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-[-0.03em] text-[var(--da-brand-dark)]">
              {isUnderReview ? "Proof Submitted" : "Complete your payment"}
            </h1>
          </div>
          <Link href="/track" className="da-secondary-button">
            Track Reservation
          </Link>
        </div>

        {loading ? (
          <div className="mt-8 rounded-[22px] bg-[var(--da-canvas)] p-6 text-sm text-[var(--da-text-secondary)]">
            Loading payment session...
          </div>
        ) : null}

        {error ? (
          <div className="mt-8 rounded-[22px] border border-red-200 bg-red-50 p-6">
            <p className="font-semibold text-red-900">Payment session unavailable</p>
            <p className="mt-2 text-sm text-red-700">{error}</p>
            <button className="mt-4 da-inline-button" onClick={refetch}>
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !error && data ? (
          <>
            {isUnderReview ? (
              /* MF-38 Proof-Submitted Confirmation Screen */
              <div className="mt-8 space-y-6">
                {/* Prominent Confirmation Banner */}
                <div className="rounded-[24px] border border-blue-200 bg-gradient-to-br from-blue-50 via-sky-50 to-indigo-50 p-6 sm:p-8">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--da-primary)] text-2xl text-white shadow-sm">
                      ⏳
                    </div>
                    <div>
                      <span className="inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
                        Payment Under Review
                      </span>
                      <h2 className="mt-2 text-2xl font-extrabold text-[var(--da-brand-dark)]">
                        Wait for {businessName} confirmation.
                      </h2>
                      <p className="mt-2 text-sm leading-relaxed text-slate-700">
                        Your payment proof has been uploaded and is under review. Our team will verify the payment and confirm your workspace allocation.
                      </p>
                      <p className="mt-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200/60 rounded-xl p-3">
                        ⚠️ Please note: Submitting payment proof does not automatically reserve or confirm inventory. Spots are confirmed only after verification by {businessName} staff.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Details Summary Card */}
                <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-6">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--da-text-secondary)]">
                    Reservation Details
                  </h3>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl bg-[var(--da-canvas)] p-4">
                      <p className="text-xs font-bold text-[var(--da-text-secondary)] uppercase">Reference Code</p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="font-mono text-base font-extrabold text-[var(--da-brand-dark)]">
                          {data.reservationReferenceCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyReferenceCode(data.reservationReferenceCode)}
                          className="da-secondary-button text-xs py-1 px-2.5"
                        >
                          {copiedRef ? "✓ Copied" : "Copy"}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-[var(--da-canvas)] p-4">
                      <p className="text-xs font-bold text-[var(--da-text-secondary)] uppercase">Guest</p>
                      <p className="mt-1 font-bold text-[var(--da-text-primary)]">
                        {data.customerFirstName} {data.customerLastName}
                      </p>
                      <p className="text-xs text-[var(--da-text-secondary)]">{data.customerEmail}</p>
                    </div>

                    <div className="rounded-2xl bg-[var(--da-canvas)] p-4">
                      <p className="text-xs font-bold text-[var(--da-text-secondary)] uppercase">Amount Paid / Due</p>
                      <p className="mt-1 text-lg font-extrabold text-[var(--da-primary)]">
                        {data.currency} {data.amountDue}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[var(--da-canvas)] p-4">
                      <p className="text-xs font-bold text-[var(--da-text-secondary)] uppercase">Payment Method</p>
                      <p className="mt-1 font-bold text-[var(--da-text-primary)]">
                        {selectedMethod?.displayName ?? "Online Payment"}
                      </p>
                      {selectedProviderInfo ? (
                        <span
                          className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: selectedProviderInfo.badgeBg,
                            color: selectedProviderInfo.badgeColor,
                          }}
                        >
                          {selectedProviderInfo.icon} {selectedProviderInfo.label}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-6 rounded-2xl bg-[var(--da-soft)] p-4 text-xs text-[var(--da-text-secondary)] leading-relaxed">
                    <p className="font-semibold text-[var(--da-text-primary)] mb-1">What happens next?</p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Staff reviews your submitted receipt against merchant records.</li>
                      <li>Candidate allocation assigns your preferred workspace (Main → Alt 1 → Alt 2).</li>
                      <li>A confirmation email with your booking QR code and details will be sent to <strong>{data.customerEmail}</strong>.</li>
                    </ol>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                  <Link href={`/track?code=${encodeURIComponent(data.reservationReferenceCode)}`} className="da-primary-button">
                    Track Reservation
                  </Link>
                  <Link href="/" className="da-secondary-button">
                    Back to Home
                  </Link>
                </div>
              </div>
            ) : isExpired ? (
              /* Expired Session Screen */
              <div className="mt-8 space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <Panel label="Reference" value={data.reservationReferenceCode} />
                  <Panel label="Guest" value={`${data.customerFirstName} ${data.customerLastName}`} />
                  <Panel label="Amount Due" value={`${data.currency} ${data.amountDue}`} />
                  <Panel label="Status" value="Payment session expired" />
                </div>
                <StateBox
                  tone="warning"
                  title="Payment session expired"
                  body="This one-hour payment session has expired and is no longer accepting proof uploads. If you still need a workspace, please create a new reservation."
                />
                <div className="flex items-center gap-4 pt-4">
                  <Link href="/reserve" className="da-primary-button">
                    Start New Reservation
                  </Link>
                  <Link href="/" className="da-secondary-button">
                    Return to Home
                  </Link>
                </div>
              </div>
            ) : (
              /* Active Payment Form with Method Selection and Drag/Drop Upload */
              <>
                <div className="mt-8 grid gap-4 md:grid-cols-2">
                  <Panel label="Reference" value={data.reservationReferenceCode} />
                  <Panel label="Guest" value={`${data.customerFirstName} ${data.customerLastName}`} />
                  <Panel label="Amount Due" value={`${data.currency} ${data.amountDue}`} />
                  <Panel label="Status" value="Awaiting proof submission" />
                </div>

                <StateBox
                  tone="success"
                  title="Upload proof before the timer ends"
                  body={`Time remaining: ${formatCountdown(remainingSeconds)}. The deadline stops only after successful server-accepted proof submission.`}
                />

                {webPaymentMethods.length === 0 ? (
                  <div className="mt-8 rounded-[22px] border border-amber-200 bg-amber-50 p-6">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">⚠️</span>
                      <h3 className="font-bold text-amber-900">No online payment methods available</h3>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-amber-800">
                      There are currently no active online payment methods configured for web bookings. Please contact the front desk or customer support for payment instructions.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                    <section className="space-y-5">
                      {/* Method Selector */}
                      <div className="rounded-[24px] bg-[var(--da-canvas)] p-5">
                        <h2 className="text-xl font-extrabold text-[var(--da-brand-dark)]">
                          Choose payment method
                        </h2>
                        <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
                          Select a payment provider below to view account details and receiving QR.
                        </p>
                        <div className="mt-4 grid gap-3">
                          {webPaymentMethods.map((method) => {
                            const isSelected = (selectedMethod?.id ?? paymentMethodId) === method.id;
                            const providerInfo = getMethodProviderInfo(method);
                            return (
                              <button
                                type="button"
                                key={method.id}
                                onClick={() => setPaymentMethodId(method.id)}
                                className={`w-full rounded-[18px] border p-4 text-left transition-all ${
                                  isSelected
                                    ? "border-[var(--da-primary)] bg-white shadow-sm ring-2 ring-[var(--da-primary)]/20"
                                    : "border-[var(--da-border-light)] bg-white hover:border-[var(--da-primary)]/40"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-3">
                                    <div
                                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold"
                                      style={{
                                        backgroundColor: providerInfo.badgeBg,
                                        borderColor: providerInfo.badgeBorder,
                                        borderWidth: 1,
                                      }}
                                    >
                                      {providerInfo.icon}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <p className="font-bold text-[var(--da-text-primary)]">
                                          {method.displayName}
                                        </p>
                                        <span
                                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                                          style={{
                                            backgroundColor: providerInfo.badgeBg,
                                            color: providerInfo.badgeColor,
                                          }}
                                        >
                                          {providerInfo.label}
                                        </span>
                                      </div>
                                      {method.accountNumber ? (
                                        <p className="text-xs text-[var(--da-text-secondary)]">
                                          {method.accountNumber}
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div
                                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                      isSelected
                                        ? "border-[var(--da-primary)] bg-[var(--da-primary)] text-white"
                                        : "border-gray-300 bg-white"
                                    }`}
                                  >
                                    {isSelected ? (
                                      <div className="h-2 w-2 rounded-full bg-white" />
                                    ) : null}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Selected Method Details */}
                      {selectedMethod && selectedProviderInfo ? (
                        <div className="rounded-[24px] border border-[var(--da-border)] bg-white p-5">
                          <div className="flex items-center justify-between border-b border-[var(--da-border-light)] pb-4">
                            <div>
                              <span className="text-xs font-bold uppercase tracking-wider text-[var(--da-primary)]">
                                Selected Method
                              </span>
                              <h3 className="text-lg font-extrabold text-[var(--da-brand-dark)]">
                                {selectedMethod.displayName}
                              </h3>
                            </div>
                            <span
                              className="rounded-full px-2.5 py-1 text-xs font-bold"
                              style={{
                                backgroundColor: selectedProviderInfo.badgeBg,
                                color: selectedProviderInfo.badgeColor,
                              }}
                            >
                              {selectedProviderInfo.icon} {selectedProviderInfo.label}
                            </span>
                          </div>

                          {selectedMethod.instructions ? (
                            <div className="mt-4 rounded-[16px] bg-[var(--da-canvas)] p-4 text-sm text-[var(--da-text-primary)]">
                              <p className="font-semibold text-[var(--da-text-secondary)] text-xs uppercase tracking-wide mb-1">
                                Payment Instructions
                              </p>
                              <p className="leading-relaxed">{selectedMethod.instructions}</p>
                            </div>
                          ) : null}

                          <div className="mt-4 grid gap-3">
                            {selectedMethod.accountName ? (
                              <div className="flex items-center justify-between rounded-[14px] bg-[var(--da-soft)] px-4 py-3 text-sm">
                                <span className="text-xs font-semibold text-[var(--da-text-secondary)]">
                                  Account Name
                                </span>
                                <span className="font-bold text-[var(--da-text-primary)]">
                                  {selectedMethod.accountName}
                                </span>
                              </div>
                            ) : null}

                            {selectedMethod.accountNumber ? (
                              <div className="flex items-center justify-between rounded-[14px] bg-[var(--da-soft)] px-4 py-3 text-sm">
                                <div>
                                  <span className="block text-xs font-semibold text-[var(--da-text-secondary)]">
                                    Account Number / Mobile
                                  </span>
                                  <span className="font-mono text-sm font-bold text-[var(--da-text-primary)]">
                                    {selectedMethod.accountNumber}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleCopyAccountNumber(selectedMethod.accountNumber!)}
                                  className="da-secondary-button text-xs py-1.5 px-3"
                                >
                                  {copied ? "✓ Copied!" : "Copy"}
                                </button>
                              </div>
                            ) : null}
                          </div>

                          {/* Receiving QR Code Preview */}
                          {selectedMethod.qrImagePath ? (
                            <div className="mt-5 rounded-[20px] border border-[var(--da-border-light)] bg-[var(--da-canvas)] p-4 text-center">
                              <p className="text-xs font-bold uppercase tracking-wider text-[var(--da-text-secondary)] mb-3">
                                Scan QR to Pay
                              </p>
                              <div className="mx-auto inline-block rounded-2xl border border-[var(--da-border)] bg-white p-3 shadow-sm">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={selectedMethod.qrImagePath}
                                  alt={`${selectedMethod.displayName} Receiving QR`}
                                  className="max-h-56 max-w-full rounded-xl object-contain mx-auto"
                                />
                              </div>
                              <p className="mt-2 text-xs text-[var(--da-text-secondary)]">
                                Open your {selectedProviderInfo.label} or banking app to scan this receiving code.
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </section>

                    {/* Proof Upload Section with Drag/Drop and Validation */}
                    <section className="rounded-[24px] border border-[var(--da-border)] bg-white p-5 self-start">
                      <h2 className="text-xl font-extrabold text-[var(--da-brand-dark)]">
                        Upload payment proof
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--da-text-secondary)]">
                        Transfer the exact amount (<strong>{data.currency} {data.amountDue}</strong>), then attach your screenshot or receipt.
                      </p>

                      {selectedMethod ? (
                        <div className="mt-4 rounded-xl border border-[var(--da-border-light)] bg-[var(--da-canvas)] p-3 text-xs text-[var(--da-text-secondary)]">
                          Paying via <strong className="text-[var(--da-text-primary)]">{selectedMethod.displayName}</strong>
                        </div>
                      ) : null}

                      {/* Dropzone Container */}
                      <div className="mt-5">
                        <label
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-[20px] border-2 border-dashed p-6 text-center transition-all ${
                            isDragging
                              ? "border-[var(--da-primary)] bg-[var(--da-soft)] ring-4 ring-[var(--da-primary)]/15"
                              : proof
                                ? "border-emerald-300 bg-emerald-50/40"
                                : "border-gray-300 bg-[var(--da-canvas)] hover:border-[var(--da-primary)]/60 hover:bg-white"
                          }`}
                        >
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(event) => {
                              handleFileSelect(event.target.files?.[0] ?? null);
                              event.target.value = "";
                            }}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          />

                          {proof ? (
                            <div className="space-y-3">
                              {proofPreviewUrl ? (
                                <div className="mx-auto h-20 w-20 overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-xs">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={proofPreviewUrl}
                                    alt="Proof preview"
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                              ) : (
                                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-2xl text-emerald-800">
                                  📄
                                </div>
                              )}
                              <div>
                                <p className="font-bold text-sm text-[var(--da-brand-dark)] truncate max-w-[240px]">
                                  {proof.name}
                                </p>
                                <p className="text-xs font-semibold text-emerald-700 mt-0.5">
                                  {formatFileSize(proof.size)} · Ready to submit
                                </p>
                              </div>
                              <span className="inline-block text-xs font-bold text-[var(--da-primary)] underline hover:text-[var(--da-primary-hover)]">
                                Click or drop another file to replace
                              </span>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-xs text-xl">
                                📤
                              </div>
                              <div>
                                <p className="text-sm font-bold text-[var(--da-text-primary)]">
                                  {isDragging ? "Drop your payment receipt here" : "Click to upload or drag & drop"}
                                </p>
                                <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
                                  Accepted formats: PNG, JPG, WebP. Maximum size: 10 MB.
                                </p>
                              </div>
                            </div>
                          )}
                        </label>

                        {proof ? (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleFileSelect(null)}
                              className="text-xs font-semibold text-red-600 hover:text-red-800"
                            >
                              Remove file
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {submitError ? (
                        <div className="mt-4 rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          {submitError}
                        </div>
                      ) : null}

                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={submitting || !selectedMethod || !proof}
                        className="da-primary-button mt-6 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {submitting ? "Submitting proof..." : "Submit Proof"}
                      </button>
                      <p className="mt-3 text-center text-xs text-[var(--da-text-secondary)]">
                        Deadline stops only after successful server acceptance.
                      </p>
                    </section>
                  </div>
                )}
              </>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}

function Panel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] bg-[var(--da-canvas)] px-5 py-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--da-text-secondary)]">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-[var(--da-text-primary)]">{value}</p>
    </div>
  );
}

function StateBox({
  tone,
  title,
  body,
}: {
  tone: "success" | "warning" | "info";
  title: string;
  body: string;
}) {
  const style =
    tone === "success"
      ? "border-[var(--da-border)] bg-[var(--da-soft)] text-[var(--da-text-primary)]"
      : tone === "warning"
        ? "border-[#F3D07A] bg-[#FFF6DD] text-[var(--da-text-primary)]"
        : "border-[var(--da-border)] bg-[var(--da-info)] text-[var(--da-primary)]";

  return (
    <div className={`mt-6 rounded-[22px] border p-5 ${style}`}>
      <p className="font-bold">{title}</p>
      <p className="mt-2 text-sm leading-7">{body}</p>
    </div>
  );
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
