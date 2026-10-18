"use client";

import React, { useState } from "react";

interface CustomerCancelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  referenceCode: string;
  customerEmail: string;
  amountDue: number;
  formattedSchedule?: string;
  workspaceName?: string;
}

export function CustomerCancelModal({
  isOpen,
  onClose,
  onSuccess,
  referenceCode,
  customerEmail,
  amountDue,
  formattedSchedule,
  workspaceName,
}: CustomerCancelModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const formattedAmount = Number(amountDue || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const handleConfirmCancel = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/track/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceCode,
          customerEmail,
          reason: "Customer requested self-service cancellation on tracking portal",
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Failed to cancel reservation. Please try again.");
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel reservation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
        data-testid="customer-cancel-modal"
      >
        <div className="flex items-center justify-between border-b border-[var(--da-border-light)] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--da-text-primary)]">Cancel Reservation</h2>
              <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-mono font-bold text-gray-700">
                #{referenceCode}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="py-4 space-y-4">
          <p className="text-sm text-[var(--da-text-secondary)] leading-relaxed">
            Are you sure you want to cancel your upcoming reservation
            {workspaceName ? ` for ${workspaceName}` : ""}
            {formattedSchedule ? ` (${formattedSchedule})` : ""}? Once confirmed, your assigned workspace spot will be immediately released.
          </p>

          <div
            data-testid="cancellation-refund-notice-banner"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 leading-relaxed"
          >
            <div className="flex items-start gap-2">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" className="text-amber-600 flex-shrink-0 mt-0.5">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <strong className="block font-bold text-amber-950 mb-1">100% Refund Notice:</strong>
                You are cancelling within the allowed notice period. You are eligible for a 100% refund of your payment (₱{formattedAmount}). Our administrative team will process the refund to your source account.
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--da-border-light)] pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="da-secondary-button text-xs font-bold"
            data-testid="customer-keep-reservation-button"
          >
            Keep Reservation
          </button>
          <button
            type="button"
            onClick={handleConfirmCancel}
            disabled={loading}
            className="rounded-full bg-red-600 px-5 py-2 text-xs font-bold text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            data-testid="customer-confirm-cancel-button"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Cancelling...</span>
              </>
            ) : (
              <span>Confirm Cancellation</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
