"use client";

import React, { useEffect, useState } from "react";

interface CancellationTermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultCutoffHours?: number;
}

interface PolicyData {
  policyPdfUrl: string | null;
  filename: string | null;
  updatedAt: string | null;
  rescheduleCutoffHours: number;
  businessName: string;
}

export function CancellationTermsModal({
  isOpen,
  onClose,
  defaultCutoffHours = 12,
}: CancellationTermsModalProps) {
  const [policyData, setPolicyData] = useState<PolicyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const fetchPolicy = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/public/business-policy");
        if (res.ok) {
          const json = await res.json();
          if (isMounted) {
            setPolicyData(json);
          }
        }
      } catch (err) {
        console.error("Failed to load business terms:", err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchPolicy();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const cutoffHours = policyData?.rescheduleCutoffHours ?? defaultCutoffHours;
  const pdfUrl = policyData?.policyPdfUrl;
  const filename = policyData?.filename || "Official_Cancellation_Policy.pdf";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-modal-title"
      data-testid="cancellation-terms-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg rounded-[28px] border border-[var(--da-border)] bg-white p-6 md:p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--da-primary)]">
              Terms & Conditions
            </span>
            <h2
              id="terms-modal-title"
              className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--da-brand-dark)]"
            >
              Cancellation & Rescheduling Terms
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="close-terms-modal-button"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="my-8 text-center text-sm text-[var(--da-text-secondary)]">
            Loading terms and policy...
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {pdfUrl ? (
              <div
                data-testid="custom-pdf-policy-section"
                className="rounded-[20px] border border-emerald-200 bg-emerald-50/70 p-5"
              >
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-lg font-bold text-red-600 shadow-sm">
                    📄
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-[var(--da-brand-dark)]">
                      Official Policy Document
                    </h3>
                    <p className="mt-0.5 text-xs text-[var(--da-text-secondary)] break-all">
                      {filename}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-emerald-900">
                      The official venue policy configured by {policyData?.businessName || "DeskAtlas"} is available for review.
                    </p>
                    <div className="mt-3.5">
                      <a
                        href={pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="view-policy-pdf-link"
                        className="da-primary-button inline-flex items-center gap-2 text-xs font-bold shadow-sm"
                      >
                        <span>↗</span> View / Download Policy (PDF)
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Standard Notice & Reschedule Guidelines */}
            <div className="rounded-[20px] border border-[var(--da-border-light)] bg-[var(--da-canvas)] p-5">
              <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--da-text-secondary)]">
                General Booking Guidelines
              </h3>
              <ul className="mt-3 space-y-2.5 text-xs text-[var(--da-text-primary)]">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>
                    <strong>Rescheduling Notice:</strong> Self-service rescheduling is permitted up to <strong>{cutoffHours} hours</strong> prior to your scheduled booking start time (maximum 1 reschedule per booking).
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>
                    <strong>Onsite Spot Relocation:</strong> If you experience issues with your physical desk during an active session, you may submit an in-session relocation request directly from this tracking page.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>
                    <strong>Unclaimed Spots / No-Shows:</strong> Reservations not claimed on-time without prior notice remain subject to venue release policies.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>
                    <strong>Questions & Inquiries:</strong> For emergency inquiries or custom adjustments beyond the self-service window, please reach out to front desk staff or your host administrator.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="da-secondary-button text-xs font-bold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
