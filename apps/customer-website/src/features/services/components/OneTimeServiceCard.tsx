"use client";

export interface OneTimeServiceItem {
  id: string;
  name: string;
  description: string;
  details: string;
  isActive?: boolean;
}

interface OneTimeServiceCardProps {
  service: OneTimeServiceItem;
}

export function OneTimeServiceCard({ service }: OneTimeServiceCardProps) {
  // Parse details lines for clean formatted presentation
  const detailLines = service.details
    ? service.details
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

  return (
    <article
      data-testid={`one-time-card-${service.id}`}
      className="flex flex-col justify-between rounded-2xl border border-[var(--da-border)] bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
    >
      <div>
        {/* Operational Badge */}
        <div className="mb-3">
          <span
            data-testid="one-time-info-badge"
            className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200"
          >
            Informational Service - Inquire with Front Desk Staff
          </span>
        </div>

        {/* Service Name */}
        <h3 className="text-lg font-bold text-[var(--da-brand-dark)]">
          {service.name}
        </h3>

        {/* Service Overview */}
        <p className="mt-2 text-xs leading-relaxed text-[var(--da-text-secondary)]">
          {service.description || "On-demand facility service handled directly at reception."}
        </p>

        {/* Specifications & Pricing Details Block */}
        <div
          className="mt-4 rounded-xl bg-[var(--da-canvas)] border border-[var(--da-border-light)] p-3.5"
          data-testid="one-time-details-block"
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--da-text-secondary)] mb-2">
            Pricing & Service Details
          </p>
          {detailLines.length > 0 ? (
            <ul className="space-y-1.5 text-xs text-[var(--da-brand-dark)]">
              {detailLines.map((line, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-[var(--da-primary)] font-bold">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--da-text-secondary)]">
              Inquire at the front desk for options and pricing details.
            </p>
          )}
        </div>
      </div>

      {/* Operational Callout Notice */}
      <div className="mt-6 pt-4 border-t border-[var(--da-border-light)]">
        <p
          data-testid="one-time-callout-notice"
          className="text-xs font-medium text-[var(--da-text-secondary)] bg-amber-50/70 border border-amber-200/80 rounded-lg p-2.5 text-center text-amber-900"
        >
          Payment and processing handled directly at the staff counter.
        </p>
      </div>
    </article>
  );
}

